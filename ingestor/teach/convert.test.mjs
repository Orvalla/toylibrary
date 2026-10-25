import { describe, expect, it } from 'vitest'
import { buildVerifiedSample, convertLearnedSite, diffSpecs, isWireOnlyDiff } from './convert.mjs'
import { loadSpec } from '../lib/specall.mjs'

// Fabricated learned site JSON, modelled field-for-field on the pinned
// tool's site format (src/spec.ts in api-anything @441e509; cf. its
// bundled sites/hacker-news.json): an op learned from a Trustpilot-
// style widget request, with a full set of captured browser headers,
// one slot param (sku), and one public constant (businessUnitId) that
// stayed literal in the request URL.
const learned = {
  name: 'acme',
  baseUrl: 'https://shop.example.com',
  description: 'Acme storefront.',
  operations: [
    {
      name: 'productRating',
      description: 'Widget product-review aggregate for a set of SKUs.',
      request: {
        method: 'GET',
        url: 'https://widget.example.com/trustbox-data/ABC123?businessUnitId=BU-123&locale=en-UK&sku={sku}&reviewsPerPage=10',
        headers: {
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
          cookie: 'session=DO-NOT-KEEP-ME',
          authorization: 'Bearer DO-NOT-KEEP-ME-EITHER',
          referer: 'https://shop.example.com/products/x',
          'sec-ch-ua': '"Google Chrome";v="153"',
          'sec-fetch-mode': 'cors',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/153.0.0.0',
          'x-widget-key': 'public-widget-key-123',
        },
      },
      slots: [{ param: 'sku', at: ['query:sku'] }],
      volatile: [],
      trigger: { url: 'https://shop.example.com/products/{sku}' },
      match: { host: 'widget.example.com', path: '/trustbox-data/ABC123' },
      response: {
        format: 'json',
        contentType: 'application/json; charset=UTF-8',
        extract: 'productReviewsSummary',
        pick: ['rating=starsAverage', 'rating_count=numberOfReviews.total', 'sku'],
        shape: {
          'productReviewsSummary.starsAverage': 'number',
          'productReviewsSummary.numberOfReviews.total': 'number',
          'productReviewsSummary.sku': 'string',
          'productReviewsSummary.unpickedField': 'string',
        },
      },
      params: [
        { name: 'sku', type: 'string', required: true, example: 'SKU-EXAMPLE-1' },
        { name: 'businessUnitId', type: 'string', required: true, example: 'BU-123' },
      ],
      readOnly: true,
      public: ['x-widget-key', 'businessUnitId'],
      minTier: 1,
      learnedLoggedIn: false,
      learnedAt: '2026-10-24T12:00:00.000Z',
    },
  ],
}

const hints = {
  site: 'acme',
  op: 'product-rating',
  platform: 'acme',
  purpose: 'ratings',
  bindings: { sku: { from: 'row.skus' } },
  taughtAt: '2026-10-24',
  taughtFrom: 'https://shop.example.com/products/widget-thing',
  teachRun: 'https://github.com/Orvalla/toylibrary/actions/runs/123',
  captures: ['cap-a', 'cap-b'],
  verifiedSamples: [{ name: 'fresh', params: { sku: 'SKU-FRESH' }, expect: { rating: 4.5, rating_count: 2 }, at: '2026-10-24' }],
}

describe('convertLearnedSite', () => {
  it('drops captured browser headers; only content-type + declared public headers survive', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(spec.steps[0].request.headers).toEqual({
      'content-type': 'application/json',
      'x-widget-key': 'public-widget-key-123',
    })
    const whole = JSON.stringify(spec)
    expect(whole).not.toContain('DO-NOT-KEEP-ME')
    expect(whole).not.toContain('Mozilla')
    expect(whole).not.toContain('sec-ch-ua')
  })

  it('turns slots into params and applies the binding hints', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(spec.steps[0].params).toContainEqual({ name: 'sku', bind: { from: 'row.skus' } })
    expect(spec.steps[0].name).toBe('product-rating')
    expect(spec.steps[0].request.url).toContain('sku={sku}')
  })

  it('accepts a string binding hint and normalizes it to { from }', () => {
    const { spec } = convertLearnedSite(learned, { ...hints, bindings: { sku: 'row.skus' } })
    expect(spec.steps[0].params).toContainEqual({ name: 'sku', bind: { from: 'row.skus' } })
  })

  it('defaults an unbound declared-public param to a const binding with its learned literal', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(spec.steps[0].params).toContainEqual({
      name: 'businessUnitId',
      bind: { from: 'const', value: 'BU-123' },
    })
  })

  it('fails loudly on an unbound param that is not a public constant', () => {
    expect(() => convertLearnedSite(learned, { ...hints, bindings: {} })).toThrow(/unbound param 'sku'/)
  })

  it('retains the response shape, relativized to extract.path and limited to picked fields', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(spec.steps[0].extract).toEqual({
      format: 'json',
      path: 'productReviewsSummary',
      pick: { rating: 'starsAverage', rating_count: 'numberOfReviews.total', sku: 'sku' },
      shape: { starsAverage: 'number', 'numberOfReviews.total': 'number', sku: 'string' },
    })
  })

  it('stamps provenance and applies the rating write rule by default', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(spec.provenance).toMatchObject({
      taught_at: '2026-10-24',
      taught_from: 'https://shop.example.com/products/widget-thing',
      tool: { name: 'api-anything', version: '0.1.0', commit: '441e50905acea35f407127c2b8a4032e969288f7' },
      teach_run: 'https://github.com/Orvalla/toylibrary/actions/runs/123',
      captures: ['cap-a', 'cap-b'],
    })
    expect(spec.provenance.verified_samples).toHaveLength(1)
    expect(spec.write_rule).toBe('rating_only_with_count_gt_0')
    expect(spec.id).toBe('acme-product-rating')
    expect(spec.fields).toEqual({ rating: 'rating', rating_count: 'rating_count', sku: 'sku' })
  })

  it('produces a spec the estate loader accepts', () => {
    const { spec } = convertLearnedSite(learned, hints)
    expect(() => loadSpec(spec)).not.toThrow()
  })

  it('refuses an html-recipe op, which specall cannot execute', () => {
    const htmlLearned = structuredClone(learned)
    htmlLearned.operations[0].response = {
      format: 'html',
      html: { items: 'div.card', fields: { title: '.t' } },
    }
    expect(() => convertLearnedSite(htmlLearned, hints)).toThrow(/format 'html'.*specall cannot execute/)
  })

  it('refuses a cookie/session-backed slot (no secrets in specs)', () => {
    const sessionLearned = structuredClone(learned)
    sessionLearned.operations[0].slots = [{ ref: 'cookie:session', at: ['header:cookie'] }]
    expect(() => convertLearnedSite(sessionLearned, hints)).toThrow(/cookie\/session/)
  })
})

describe('buildVerifiedSample', () => {
  it('records observed rating + count in the specall sample shape', () => {
    const sample = buildVerifiedSample({
      input: 'sku=SKU-FRESH',
      params: { sku: 'SKU-FRESH' },
      data: { starsAverage: 4.7, numberOfReviews: { total: 2013 }, sku: 'SKU-FRESH' },
      at: '2026-10-24',
    })
    expect(sample.expect).toEqual({ rating: 4.7, rating_count: 2013 })
    expect(sample.params).toEqual({ sku: 'SKU-FRESH' })
    expect(sample.at).toBe('2026-10-24')
  })

  it('falls back to a raw-response summary when no rating fields are present', () => {
    const sample = buildVerifiedSample({
      input: 'q=widgets',
      params: { q: 'widgets' },
      data: { results: [1, 2, 3] },
      at: '2026-10-24',
    })
    expect(sample.expect.observed_summary).toContain('"results":[1,2,3]')
  })
})

describe('diffSpecs (reteach contract freeze)', () => {
  const { spec: base } = convertLearnedSite(learned, hints)

  it('classifies a wire-template-only change (plus provenance) as wire-only', () => {
    const next = structuredClone(base)
    next.steps[0].request.url = 'https://widget.example.com/trustbox-data/DEF456?businessUnitId=BU-123&sku={sku}'
    next.provenance = { ...next.provenance, taught_at: '2026-11-01', teach_run: 'https://example.invalid/runs/999' }
    const diff = diffSpecs(base, next)
    expect(diff.wireOnly).toBe(true)
    expect(diff.contractChanges).toEqual([])
    expect(diff.wireChanges.map((c) => c.path)).toContain('steps[0].request.url')
    expect(isWireOnlyDiff(base, next)).toBe(true)
  })

  it('classifies a binding change as a contract change', () => {
    const next = structuredClone(base)
    next.steps[0].params[0].bind = { from: 'row.other_field' }
    const diff = diffSpecs(base, next)
    expect(diff.wireOnly).toBe(false)
    expect(diff.contractChanges.map((c) => c.path)).toContain('steps[0].params')
  })

  it('classifies extract, fields and write_rule changes as contract changes', () => {
    for (const mutate of [
      (s) => (s.steps[0].extract.pick.rating = 'otherPath'),
      (s) => (s.fields = { rating: 'other_field' }),
      (s) => delete s.write_rule,
    ]) {
      const next = structuredClone(base)
      mutate(next)
      const diff = diffSpecs(base, next)
      expect(diff.wireOnly).toBe(false)
      expect(diff.contractChanges.length).toBeGreaterThan(0)
    }
  })

  it('reports no changes at all for identical specs', () => {
    const diff = diffSpecs(base, structuredClone(base))
    expect(diff).toMatchObject({ wireOnly: true, contractChanges: [], wireChanges: [], metadataChanges: [] })
  })
})
