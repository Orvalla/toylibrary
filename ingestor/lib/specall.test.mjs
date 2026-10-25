import { describe, expect, it } from 'vitest'
import { CANONICAL_UA, callSpec, createSpecCaller, loadSpec, verifySpec } from './specall.mjs'

// Fake transport only — no network. A handler maps (url, init) to
// { status, body } (body may be an object, serialized as JSON).
function fakeFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, at: Date.now() })
    const out = (await handler(url, init, calls.length)) ?? { status: 200, body: {} }
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {})
    return { status: out.status ?? 200, ok: (out.status ?? 200) >= 200 && (out.status ?? 200) < 300, text: async () => text }
  }
  impl.calls = calls
  return impl
}

const fastCaller = (fetchImpl, extra = {}) =>
  createSpecCaller({ minIntervalMs: 5, maxStrikes: 3, fetchImpl, ...extra })

// A two-step spec modelled on §3's Yoto example, on fake hosts.
function ratingSpec(overrides = {}) {
  return {
    spec_version: 1,
    id: 'fake-rating',
    platform: 'fake',
    purpose: 'ratings',
    status: 'active',
    steps: [
      {
        name: 'resolve-skus',
        request: {
          method: 'POST',
          url: 'https://shop.example/api/graphql',
          headers: { 'content-type': 'application/json' },
          body: '{"variables":{"h":"{handle}"}}',
        },
        params: [{ name: 'handle', bind: { from: 'row.source_url', take: 'last_path_segment' } }],
        extract: { format: 'json', path: 'data.product.variants.nodes', pick: { skus: '[].sku' } },
      },
      {
        name: 'rating',
        request: { method: 'GET', url: 'https://widget.example/data?bu={bu}&sku={skus}', headers: {} },
        params: [
          { name: 'skus', bind: { from: 'step.resolve-skus.skus', join: ',' } },
          { name: 'bu', bind: { from: 'const', value: 'UNIT42' } },
        ],
        extract: {
          format: 'json',
          path: 'productReviewsSummary',
          pick: { rating: 'starsAverage', rating_count: 'numberOfReviews.total' },
          shape: { starsAverage: 'number', 'numberOfReviews.total': 'number' },
        },
      },
    ],
    fields: { rating: 'rating', rating_count: 'rating_count' },
    write_rule: 'rating_only_with_count_gt_0',
    ...overrides,
  }
}

function yotoLikeFetch({ summary } = {}) {
  return fakeFetch((url) => {
    if (url.startsWith('https://shop.example/')) {
      return { status: 200, body: { data: { product: { variants: { nodes: [{ sku: 'A1' }, { sku: 'B2' }] } } } } }
    }
    if (url.startsWith('https://widget.example/')) {
      return { status: 200, body: { productReviewsSummary: summary ?? { starsAverage: 4.5, numberOfReviews: { total: 12 } } } }
    }
    return { status: 404, body: {} }
  })
}

const ROW = { source_url: 'https://us.yotoplay.com/products/ohana-means-family' }

describe('createSpecCaller pacing', () => {
  it('serializes per host with >= minIntervalMs between request starts', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: {} }))
    const caller = createSpecCaller({ minIntervalMs: 60, fetchImpl })
    await Promise.all([
      caller.request('https://a.example/1'),
      caller.request('https://a.example/2'),
      caller.request('https://a.example/3'),
    ])
    const starts = fetchImpl.calls.map((c) => c.at)
    expect(fetchImpl.calls).toHaveLength(3)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(55)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(55)
  })

  it('lets different hosts run in parallel', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: {} }))
    const caller = createSpecCaller({ minIntervalMs: 80, fetchImpl })
    const t0 = Date.now()
    await Promise.all([
      caller.request('https://a.example/1'),
      caller.request('https://a.example/2'),
      caller.request('https://b.example/1'),
      caller.request('https://b.example/2'),
    ])
    // Serialized globally this would take >= 240ms of spacing alone;
    // per-host queues overlap, so only ~80ms of spacing is on the path.
    expect(Date.now() - t0).toBeLessThan(200)
  })

  it('sends the canonical UA by default and never a spec-supplied one', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: {} }))
    const caller = fastCaller(fetchImpl)
    await caller.request('https://a.example/x', { headers: { 'user-agent': 'Browser/1.0', 'x-public': 'k' } })
    const headers = fetchImpl.calls[0].init.headers
    expect(headers['user-agent']).toBe(CANONICAL_UA)
    expect(headers['user-agent']).toBe('ToyLibraryIngestor/1.0 (contact via toylibrary.store)')
    expect(headers.accept).toBe('application/json')
    expect(headers['x-public']).toBe('k')
  })
})

describe('createSpecCaller strikes', () => {
  it('drops a host at maxStrikes and reports the remainder as skipped', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 403, body: {} }))
    const caller = fastCaller(fetchImpl)
    const results = await Promise.all(
      ['1', '2', '3', '4', '5'].map((n) => caller.request(`https://a.example/${n}`)),
    )
    expect(results.map((r) => (r.blocked ? 'blocked' : r.skipped ? 'skipped' : 'other'))).toEqual([
      'blocked',
      'blocked',
      'blocked',
      'skipped',
      'skipped',
    ])
    expect(fetchImpl.calls).toHaveLength(3) // nothing more was sent after the drop
    expect(caller.hostState('a.example')).toEqual({ strikes: 3, stopped: true })
    expect(caller.totals()).toMatchObject({ calls: 3, http_blocked: 3, skipped_stopped: 2 })
  })

  it('resets the strike counter on success', async () => {
    const statuses = [403, 429, 200, 403, 403, 200, 403, 403, 403]
    const fetchImpl = fakeFetch((url, init, n) => ({ status: statuses[n - 1], body: {} }))
    const caller = fastCaller(fetchImpl)
    for (let i = 0; i < statuses.length; i++) await caller.request(`https://a.example/${i}`)
    // Never three in a row until the final triple, so all nine were sent.
    expect(fetchImpl.calls).toHaveLength(9)
    expect(caller.hostState('a.example')).toEqual({ strikes: 3, stopped: true })
    const after = await caller.request('https://a.example/late')
    expect(after.skipped).toBe(true)
    expect(fetchImpl.calls).toHaveLength(9)
  })

  it('classifies other statuses and network errors as failed, not strikes', async () => {
    const fetchImpl = fakeFetch((url, init, n) => {
      if (n === 1) return { status: 500, body: {} }
      if (n === 2) throw new Error('socket hangup')
      return { status: 200, body: {} }
    })
    const caller = fastCaller(fetchImpl)
    expect((await caller.request('https://a.example/1')).failed).toBe(true)
    expect((await caller.request('https://a.example/2')).failed).toBe(true)
    expect((await caller.request('https://a.example/3')).ok).toBe(true)
    expect(caller.hostState('a.example')).toEqual({ strikes: 0, stopped: false })
    expect(caller.totals()).toMatchObject({ calls: 3, fetch_failed: 2 })
  })
})

describe('loadSpec', () => {
  it('accepts a well-formed spec object', () => {
    expect(loadSpec(ratingSpec()).id).toBe('fake-rating')
  })

  it('loads the shipped Yoto spec from disk', () => {
    // Repo-root-relative: vitest runs from the repo root (npm test),
    // and import.meta.url is not a file URL under the jsdom env.
    const spec = loadSpec('ingestor/specs/yoto-trustpilot-rating.json')
    expect(spec.id).toBe('yoto-trustpilot-rating')
    expect(spec.steps.map((s) => s.name)).toEqual(['resolve-skus', 'rating'])
    expect(spec.write_rule).toBe('rating_only_with_count_gt_0')
  })

  it('rejects a wrong spec_version, unknown top-level fields and missing fields', () => {
    expect(() => loadSpec({ ...ratingSpec(), spec_version: 2 })).toThrow(/spec_version must be 1/)
    expect(() => loadSpec({ ...ratingSpec(), captured_headers: {} })).toThrow(/unknown top-level field 'captured_headers'/)
    const noId = ratingSpec()
    delete noId.id
    expect(() => loadSpec(noId)).toThrow(/missing required field 'id'/)
    expect(() => loadSpec({ ...ratingSpec(), status: 'live' })).toThrow(/status 'live'/)
    expect(() => loadSpec({ ...ratingSpec(), steps: [] })).toThrow(/steps must be a non-empty array/)
  })

  it('rejects bad bindings: unknown take, step refs that are not earlier steps', () => {
    const badTake = ratingSpec()
    badTake.steps[0].params[0].bind.take = 'first_path_segment'
    expect(() => loadSpec(badTake)).toThrow(/unknown take/)
    const forwardRef = ratingSpec()
    forwardRef.steps[0].params[0] = { name: 'x', bind: { from: 'step.rating.rating' } }
    expect(() => loadSpec(forwardRef)).toThrow(/not an earlier step/)
    const badFrom = ratingSpec()
    badFrom.steps[0].params[0] = { name: 'x', bind: { from: 'secrets.api_key' } }
    expect(() => loadSpec(badFrom)).toThrow(/bind\.from/)
  })
})

describe('callSpec bindings + extraction', () => {
  it('resolves row/const/step bindings, extracts via path+pick, maps fields', async () => {
    const fetchImpl = yotoLikeFetch()
    const caller = fastCaller(fetchImpl)
    const res = await callSpec(caller, ratingSpec(), ROW)
    expect(res.ok).toBe(true)
    expect(res.values).toEqual({ rating: 4.5, rating_count: 12 })
    expect(res.stats).toMatchObject({ calls: 2, filled: 1, empty_extract: 0, shape_drift: 0, honest_zero: 0 })
    // row.source_url + last_path_segment landed in the GraphQL body.
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({ variables: { h: 'ohana-means-family' } })
    expect(fetchImpl.calls[0].init.method).toBe('POST')
    // step output joined with ',', and the const binding, landed in the URL.
    expect(fetchImpl.calls[1].url).toBe('https://widget.example/data?bu=UNIT42&sku=A1,B2')
  })

  it('supports the host take and a trailing-slash source_url', async () => {
    const spec = {
      spec_version: 1,
      id: 'host-take',
      platform: 'fake',
      purpose: 'detail',
      status: 'active',
      steps: [
        {
          name: 'only',
          request: { method: 'GET', url: 'https://api.example/lookup?host={host}&slug={slug}' },
          params: [
            { name: 'host', bind: { from: 'row.source_url', take: 'host' } },
            { name: 'slug', bind: { from: 'row.source_url', take: 'last_path_segment' } },
          ],
          extract: { format: 'json', pick: { title: 'title' } },
        },
      ],
      fields: { title: 'title' },
    }
    const fetchImpl = fakeFetch(() => ({ status: 200, body: { title: 'Some Toy' } }))
    const res = await callSpec(fastCaller(fetchImpl), spec, {
      source_url: 'https://shop.example/products/some-toy/',
    })
    expect(res.ok).toBe(true)
    expect(res.values).toEqual({ title: 'Some Toy' })
    expect(fetchImpl.calls[0].url).toBe('https://api.example/lookup?host=shop.example&slug=some-toy')
  })

  it('counts an empty extraction (200 but nothing picked) as empty_extract', async () => {
    const fetchImpl = yotoLikeFetch({ summary: {} })
    const spec = ratingSpec()
    delete spec.write_rule
    spec.steps[1].extract.shape = undefined
    const res = await callSpec(fastCaller(fetchImpl), spec, ROW)
    expect(res.ok).toBe(false)
    expect(res.values).toEqual({})
    expect(res.stats).toMatchObject({ calls: 2, filled: 0, empty_extract: 1 })
  })

  it('counts a blocked step as http_blocked and a 500 as fetch_failed', async () => {
    const blocked = fakeFetch(() => ({ status: 429, body: {} }))
    const r1 = await callSpec(fastCaller(blocked), ratingSpec(), ROW)
    expect(r1).toMatchObject({ ok: false, stats: { calls: 1, http_blocked: 1 } })
    const failed = fakeFetch(() => ({ status: 500, body: {} }))
    const r2 = await callSpec(fastCaller(failed), ratingSpec(), ROW)
    expect(r2).toMatchObject({ ok: false, stats: { calls: 1, fetch_failed: 1 } })
  })

  it('reports skipped_stopped when the host was already dropped', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 403, body: {} }))
    const caller = fastCaller(fetchImpl)
    for (let i = 0; i < 3; i++) await caller.request('https://shop.example/warmup')
    const res = await callSpec(caller, ratingSpec(), ROW)
    expect(res.ok).toBe(false)
    expect(res.stats).toMatchObject({ calls: 0, skipped_stopped: 1 })
  })
})

describe('callSpec write rule (honest zeros)', () => {
  it('returns no values and honest_zero when the count is 0', async () => {
    const fetchImpl = yotoLikeFetch({ summary: { starsAverage: 0, numberOfReviews: { total: 0 } } })
    const res = await callSpec(fastCaller(fetchImpl), ratingSpec(), ROW)
    expect(res.ok).toBe(false)
    expect(res.values).toEqual({})
    expect(res.stats).toMatchObject({ filled: 0, honest_zero: 1, empty_extract: 0 })
  })

  it('returns honest_zero when the count is missing entirely', async () => {
    const fetchImpl = yotoLikeFetch({ summary: { starsAverage: 4.9 } })
    const res = await callSpec(fastCaller(fetchImpl), ratingSpec(), ROW)
    expect(res.ok).toBe(false)
    expect(res.stats.honest_zero).toBe(1)
  })
})

describe('callSpec shape drift', () => {
  const driftSpec = (shape) => ({
    spec_version: 1,
    id: 'drift',
    platform: 'fake',
    purpose: 'ratings',
    status: 'active',
    steps: [
      {
        name: 'only',
        request: { method: 'GET', url: 'https://widget.example/x' },
        params: [],
        extract: {
          format: 'json',
          path: 'summary',
          pick: { rating: 'starsAverage', rating_count: 'numberOfReviews.total', label: 'label' },
          shape,
        },
      },
    ],
    fields: { rating: 'rating', rating_count: 'rating_count', label: 'label' },
  })
  const SHAPE = { starsAverage: 'number', 'numberOfReviews.total': 'number', label: 'string', source: 'string' }

  it('is quiet when the shape matches', async () => {
    const fetchImpl = fakeFetch(() => ({
      status: 200,
      body: { summary: { starsAverage: 4.2, numberOfReviews: { total: 9 }, label: 'Excellent', source: 'tp' } },
    }))
    const res = await callSpec(fastCaller(fetchImpl), driftSpec(SHAPE), {})
    expect(res.ok).toBe(true)
    expect(res.stats.shape_drift).toBe(0)
  })

  it('tolerates exactly 50% matching (the §6 boundary)', async () => {
    const fetchImpl = fakeFetch(() => ({
      status: 200,
      body: { summary: { starsAverage: 4.2, numberOfReviews: { total: 9 } } }, // 2 of 4 shape keys
    }))
    const res = await callSpec(fastCaller(fetchImpl), driftSpec(SHAPE), {})
    expect(res.stats.shape_drift).toBe(0)
  })

  it('counts drift below 50% (wrong types count as missing) but still returns what it found', async () => {
    const fetchImpl = fakeFetch(() => ({
      status: 200,
      // starsAverage wrong type, total fine, label/source absent: 1 of 4.
      body: { summary: { starsAverage: '4.2', numberOfReviews: { total: 9 } } },
    }))
    const res = await callSpec(fastCaller(fetchImpl), driftSpec(SHAPE), {})
    expect(res.stats.shape_drift).toBe(1)
    expect(res.ok).toBe(true)
    expect(res.values).toEqual({ rating: '4.2', rating_count: 9 })
  })

  it('counts a non-JSON 2xx body as shape drift', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: '<html>not json</html>' }))
    const res = await callSpec(fastCaller(fetchImpl), driftSpec(SHAPE), {})
    expect(res.ok).toBe(false)
    expect(res.stats.shape_drift).toBe(1)
  })
})

describe('verifySpec', () => {
  const withSamples = (samples) => ratingSpec({ provenance: { verified_samples: samples } })

  it('passes a params sample on an exact rating match', async () => {
    const spec = withSamples([
      { name: 'set A', params: { skus: 'A1,B2' }, expect: { rating: 4.5, rating_count: 12 } },
    ])
    const out = await verifySpec(fastCaller(yotoLikeFetch()), spec)
    expect(out.ok).toBe(true)
    expect(out.samples).toEqual([
      { name: 'set A', pass: true, observed: { rating: 4.5, rating_count: 12 }, expect: { rating: 4.5, rating_count: 12 } },
    ])
  })

  it('passes when the live count has grown past the sample', async () => {
    const spec = withSamples([
      { name: 'set A', params: { skus: 'A1,B2' }, expect: { rating: 4.5, rating_count: 3 } },
    ])
    const out = await verifySpec(fastCaller(yotoLikeFetch()), spec)
    expect(out.samples[0].pass).toBe(true)
  })

  it('fails on a stars mismatch and on a shrunk count', async () => {
    const spec = withSamples([
      { name: 'stars', params: { skus: 'A1,B2' }, expect: { rating: 4.9, rating_count: 12 } },
      { name: 'count', params: { skus: 'A1,B2' }, expect: { rating: 4.5, rating_count: 99 } },
    ])
    const out = await verifySpec(fastCaller(yotoLikeFetch()), spec)
    expect(out.ok).toBe(false)
    expect(out.samples.map((s) => s.pass)).toEqual([false, false])
    expect(out.samples[0].note).toMatch(/rating/)
    expect(out.samples[1].note).toMatch(/rating_count/)
  })

  it('runs a row sample through the full step chain', async () => {
    const spec = withSamples([{ name: 'row chain', row: ROW, expect: { rating: 4.5, rating_count: 12 } }])
    const fetchImpl = yotoLikeFetch()
    const out = await verifySpec(fastCaller(fetchImpl), spec)
    expect(out.samples[0].pass).toBe(true)
    expect(fetchImpl.calls).toHaveLength(2) // GraphQL resolve + widget call
  })

  it('treats a 0/0 expect as "must come back honest_zero"', async () => {
    const spec = withSamples([
      { name: 'no reviews', params: { skus: 'PRP4XX05512' }, expect: { rating: 0, rating_count: 0 } },
    ])
    const fetchImpl = yotoLikeFetch({ summary: { starsAverage: 0, numberOfReviews: { total: 0 } } })
    const out = await verifySpec(fastCaller(fetchImpl), spec)
    expect(out.samples[0].pass).toBe(true)
    expect(out.samples[0].observed).toEqual({ rating: 0, rating_count: 0, honest_zero: true })
  })

  it('fails a 0/0 sample that unexpectedly has reviews', async () => {
    const spec = withSamples([
      { name: 'no reviews', params: { skus: 'A1,B2' }, expect: { rating: 0, rating_count: 0 } },
    ])
    const out = await verifySpec(fastCaller(yotoLikeFetch()), spec)
    expect(out.samples[0].pass).toBe(false)
  })
})
