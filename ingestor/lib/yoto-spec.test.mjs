import { describe, expect, it } from 'vitest'
import { createSpecCaller } from './specall.mjs'
import { rateYotoRows } from './yoto-spec.mjs'

// Fake transport only — no network. A handler maps (url, init) to
// { status, body } (body may be an object, serialized as JSON),
// keyed by which of the spec's real hosts the URL names.
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

const fastCaller = (fetchImpl) => createSpecCaller({ minIntervalMs: 5, maxStrikes: 3, fetchImpl })

const GRAPHQL_OK = {
  status: 200,
  body: { data: { product: { variants: { nodes: [{ sku: 'A1' }, { sku: 'B2' }] } } } },
}
const GRAPHQL_NULL = { status: 200, body: { data: { product: null } } }

// Handler skeleton for the three hosts the Yoto spec chain talks
// to; each test fills in the responses it exercises.
function yotoFetch({ graphql, js, trustpilot }) {
  return fakeFetch((url) => {
    if (url.includes('yoto-usa.myshopify.com/api/')) return graphql
    if (url.includes('yoto-usa.myshopify.com/products/') && url.endsWith('.js')) {
      return typeof js === 'function' ? js(url) : js
    }
    if (url.startsWith('https://widget.trustpilot.com/')) {
      return typeof trustpilot === 'function' ? trustpilot(url) : trustpilot
    }
    return { status: 404, body: {} }
  })
}

const ITEM = { id: 'row-1', url: 'https://us.yotoplay.com/products/some-card' }

describe('rateYotoRows', () => {
  it('(a) rates a row through GraphQL SKUs + a Trustpilot aggregate', async () => {
    const fetchImpl = yotoFetch({
      graphql: GRAPHQL_OK,
      js: { status: 404, body: {} },
      trustpilot: {
        status: 200,
        body: { productReviewsSummary: { starsAverage: 4.5, numberOfReviews: { total: 12 } } },
      },
    })
    const rated = []
    const out = await rateYotoRows({
      items: [ITEM],
      caller: fastCaller(fetchImpl),
      onRating: (r) => rated.push(r),
    })
    expect(out.error).toBeNull()
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({
      id: 'row-1',
      outcome: 'rated',
      rating: 4.5,
      rating_count: 12,
      calls: 2, // GraphQL resolve + Trustpilot rating
      http_blocked: 0,
      fetch_failed: 0,
      skipped_stopped: 0,
      shape_drift: 0,
      usedFallback: false,
    })
    expect(rated).toEqual([{ id: 'row-1', rating: 4.5, rating_count: 12 }])
    expect(out.totals).toMatchObject({ rows: 1, resolved: 1, rated: 1, honest_zero: 0, unresolved: 0, calls: 2, usedFallback: 0 })
    // The rating call carried the product's own variant SKUs.
    const tpCall = fetchImpl.calls.find((c) => c.url.startsWith('https://widget.trustpilot.com/'))
    expect(tpCall.url).toContain('sku=A1,B2')
  })

  it('(b) falls back to /products/<handle>.js when GraphQL sees no product', async () => {
    const fetchImpl = yotoFetch({
      graphql: GRAPHQL_NULL,
      js: { status: 200, body: { variants: [{ sku: 'X1' }, { sku: 'Y2' }] } },
      trustpilot: (url) =>
        url.includes('sku=X1,Y2')
          ? { status: 200, body: { productReviewsSummary: { starsAverage: 4.8, numberOfReviews: { total: 7 } } } }
          : { status: 200, body: { productReviewsSummary: { starsAverage: 0, numberOfReviews: { total: 0 } } } },
    })
    const rated = []
    const out = await rateYotoRows({
      items: [ITEM],
      caller: fastCaller(fetchImpl),
      onRating: (r) => rated.push(r),
    })
    expect(out.error).toBeNull()
    expect(out.rows[0]).toMatchObject({
      id: 'row-1',
      outcome: 'rated',
      rating: 4.8,
      rating_count: 7,
      calls: 3, // GraphQL (miss) + .js resolve + rating-only call
      http_blocked: 0,
      fetch_failed: 0,
      usedFallback: true,
    })
    expect(rated).toEqual([{ id: 'row-1', rating: 4.8, rating_count: 7 }])
    expect(out.totals).toMatchObject({ rows: 1, resolved: 1, rated: 1, calls: 3, usedFallback: 1 })
    const jsCall = fetchImpl.calls.find((c) => c.url.endsWith('.js'))
    expect(jsCall.url).toBe('https://yoto-usa.myshopify.com/products/some-card.js')
  })

  it('(c) reports an honest zero when Trustpilot has no reviews', async () => {
    const fetchImpl = yotoFetch({
      graphql: GRAPHQL_OK,
      js: { status: 404, body: {} },
      trustpilot: {
        status: 200,
        body: { productReviewsSummary: { starsAverage: 0, numberOfReviews: { total: 0 } } },
      },
    })
    const rated = []
    const out = await rateYotoRows({
      items: [ITEM],
      caller: fastCaller(fetchImpl),
      onRating: (r) => rated.push(r),
    })
    expect(out.error).toBeNull()
    expect(out.rows[0]).toMatchObject({
      id: 'row-1',
      outcome: 'honest_zero',
      calls: 2,
      http_blocked: 0,
      fetch_failed: 0,
      usedFallback: false,
    })
    expect(out.rows[0].rating).toBeUndefined()
    expect(rated).toEqual([])
    expect(out.totals).toMatchObject({ rows: 1, resolved: 1, rated: 0, honest_zero: 1, unresolved: 0, calls: 2 })
  })

  it('(d) leaves the row unresolved on a GraphQL + .js double miss', async () => {
    const fetchImpl = yotoFetch({
      graphql: GRAPHQL_NULL,
      js: { status: 404, body: {} },
      trustpilot: { status: 200, body: {} },
    })
    const rated = []
    const out = await rateYotoRows({
      items: [ITEM],
      caller: fastCaller(fetchImpl),
      onRating: (r) => rated.push(r),
    })
    expect(out.error).toBeNull()
    expect(out.rows[0]).toMatchObject({
      id: 'row-1',
      outcome: 'unresolved',
      calls: 2, // GraphQL step 1 + the .js attempt; no rating call was made
      http_blocked: 0,
      fetch_failed: 1, // the .js 404
      skipped_stopped: 0,
      usedFallback: false,
    })
    expect(out.rows[0].rating).toBeUndefined()
    expect(rated).toEqual([])
    expect(out.totals).toMatchObject({ rows: 1, resolved: 0, rated: 0, honest_zero: 0, unresolved: 1, calls: 2, fetch_failed: 1 })
    // Trustpilot was never consulted — there were no SKUs to rate.
    expect(fetchImpl.calls.some((c) => c.url.startsWith('https://widget.trustpilot.com/'))).toBe(false)
  })
})
