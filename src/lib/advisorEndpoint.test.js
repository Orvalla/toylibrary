// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { NOT_FOUND_BODY, createHandler } from '../../supabase/functions/gift-advisor/advisor.js'
import {
  BREAKER_USD,
  COPY,
  MAX_SHOPPER_CHARS,
  MemoryLimiter,
  isAllowedOrigin,
} from '../../supabase/functions/gift-advisor/controls.js'
import { itemKey } from '../../supabase/functions/gift-advisor/retrieval.js'
import { bakeoffCatalog, memoryCatalog } from '../test/advisorFixtures'

// WS7 endpoint behaviour with a mocked provider and an in-memory
// store: SSE shape, metadata first, the $15 breaker, CORS, the flag,
// per-IP caps, history caps. No network, no secret.

const ORIGIN = 'https://millers.toylibrary.store'
const TODAY = new Date('2026-11-13T12:00:00Z')

function mockProvider(chunks = ['Hello ', 'from the shelves.'], usage = { in: 1500, out: 700 }, fail = null) {
  const p = {
    name: 'anthropic',
    model: 'claude-haiku-5-5',
    price: { inPerM: 0.1, outPerM: 0.5 },
    calls: [],
    async *stream(args) {
      p.calls.push(args)
      if (fail) throw fail
      yield { type: 'usage', input_tokens: usage.in, output_tokens: 1 }
      for (const c of chunks) yield { type: 'text', text: c }
      yield { type: 'usage', output_tokens: usage.out }
    },
  }
  return p
}

function mockStore(over = {}) {
  const s = {
    spend: 0,
    allow: true,
    usage: [],
    alerts: [],
    page: {
      age: 3,
      interests: ['dinosaurs'],
      players: ['yoto'],
      excludeKeys: new Set([itemKey('yoto', 'Bedtime Songs Card')]),
    },
    catalog: memoryCatalog(bakeoffCatalog()),
    takeTurn: async () => s.allow,
    spendToday: async () => s.spend,
    logUsage: async (row) => void s.usage.push(row),
    markAlert: async (level, spend) => void s.alerts.push({ level, spend }),
    loadPage: async (slug) => (slug === 'millers' ? s.page : null),
    ...over,
  }
  return s
}

let store, provider
const handler = (over = {}) =>
  createHandler({
    enabled: true,
    apiKey: 'test-key',
    makeProvider: () => provider,
    store,
    limiter: new MemoryLimiter(),
    ipSalt: 'test',
    now: () => TODAY,
    ...over,
  })

const post = (body, { origin = ORIGIN, ip = '203.0.113.7' } = {}) =>
  new Request('https://x.supabase.co/functions/v1/gift-advisor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })

const finder = (text, history = []) => ({ mode: 'finder', history, turn: { role: 'user', content: text } })

async function events(res) {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const ev = block.match(/^event: (.*)$/m)[1]
      const data = JSON.parse(block.match(/^data: (.*)$/m)[1])
      return { ev, data }
    })
}

beforeEach(() => {
  store = mockStore()
  provider = mockProvider()
})

describe('flag (advisor_enabled) — the kill switch', () => {
  it('OFF: every method gets the platform 404 shape and nothing runs', async () => {
    const h = handler({ enabled: false })
    for (const req of [
      post(finder('A gift for a 4-year-old')),
      new Request('https://x/functions/v1/gift-advisor', { method: 'GET', headers: { origin: ORIGIN } }),
      new Request('https://x/functions/v1/gift-advisor', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    ]) {
      const res = await h(req)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)
    }
    expect(provider.calls).toHaveLength(0)
    expect(store.usage).toHaveLength(0)
  })

  it('ON: the GET status probe answers enabled', async () => {
    const res = await handler()(new Request('https://x/f', { method: 'GET', headers: { origin: ORIGIN } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
  })
})

describe('CORS: apex + *.toylibrary.store only', () => {
  it.each([
    ['https://toylibrary.store', true],
    ['https://www.toylibrary.store', true],
    ['https://millers.toylibrary.store', true],
    ['http://toylibrary.store', false],
    ['https://toylibrary.store.evil.com', false],
    ['https://eviltoylibrary.store', false],
    ['https://toylibrary.store:8443', false],
    ['https://toy-library.fly.dev', false],
    ['null', false],
  ])('%s -> %s', (origin, ok) => {
    expect(isAllowedOrigin(origin)).toBe(ok)
  })

  it('allowed origin: preflight and POST carry the echoing ACAO header', async () => {
    const pre = await handler()(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: ORIGIN } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const res = await handler()(post(finder('hi')))
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('foreign origin: 403, no ACAO, model never called', async () => {
    const res = await handler()(post(finder('A gift for a 4-year-old'), { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe(null)
    expect(provider.calls).toHaveLength(0)
  })
})

describe('SSE response', () => {
  it('ONE metadata event first, carrying {id, name, product_url} per candidate; then text; then done', async () => {
    const res = await handler()(post(finder("A gift for my granddaughter, she just turned 3 and loves dinosaurs")))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
    const evs = await events(res)
    expect(evs[0].ev).toBe('meta')
    expect(evs.filter((e) => e.ev === 'meta')).toHaveLength(1)
    const cands = evs[0].data.candidates
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) expect(Object.keys(c).sort()).toEqual(['id', 'name', 'product_url'])
    expect(cands.map((c) => c.name)).not.toContain('Super-Fun Marble Run Master Set')
    expect(evs.filter((e) => e.ev === 'delta').map((e) => e.data.text).join('')).toBe('Hello from the shelves.')
    expect(evs.at(-1)).toEqual({ ev: 'done', data: { ok: true } })
  })

  it('sends the model history + turn and a system prompt with the fenced candidates', async () => {
    const history = [
      { role: 'user', content: 'Shopping for a 3-year-old' },
      { role: 'assistant', content: 'Lovely! What does she enjoy?' },
    ]
    await (await handler()(post(finder('Dinosaurs!', history)))).text()
    const call = provider.calls[0]
    expect(call.messages).toEqual([...history, { role: 'user', content: 'Dinosaurs!' }])
    expect(call.system).toContain('Wooden Dinosaur Puzzle')
    expect(call.system).toContain('DO NOT RECOMMEND')
  })

  it('logs usage with counts, cost, mode and candidate ids only (no transcript)', async () => {
    await (await handler()(post(finder('she is 3 and loves dinosaurs')))).text()
    expect(store.usage).toHaveLength(1)
    const u = store.usage[0]
    expect(Object.keys(u).sort()).toEqual(
      ['candidate_ids', 'day', 'est_cost', 'mode', 'model', 'provider', 'tokens_in', 'tokens_out'].sort(),
    )
    expect(u).toMatchObject({ day: '2026-11-13', provider: 'anthropic', mode: 'finder', tokens_in: 1500, tokens_out: 700 })
    expect(u.est_cost).toBeCloseTo((1500 * 0.1 + 700 * 0.5) / 1e6, 9)
    expect(JSON.stringify(u)).not.toMatch(/dinosaurs|shelves/i)
  })

  it('page mode: the page fences apply (owned item excluded, page age used)', async () => {
    const res = await handler()(
      post({ mode: 'page', slug: 'millers', history: [], turn: { role: 'user', content: 'What does she still need?' } }),
    )
    const cands = (await events(res))[0].data.candidates.map((c) => c.name)
    expect(cands).toContain('Dinosaur Stomp Card')
    expect(cands).not.toContain('Bedtime Songs Card') // owned
    expect(cands).not.toContain('Super-Fun Marble Run Master Set') // age 8+
    expect(provider.calls[0].system).toMatch(/"age_years": 3/)
    expect(store.usage[0].mode).toBe('page')
  })

  it('page mode: an unknown slug is a friendly 404, no model call', async () => {
    const res = await handler()(post({ mode: 'page', slug: 'nobody', history: [], turn: { role: 'user', content: 'hi' } }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe(COPY.noPage)
    expect(provider.calls).toHaveLength(0)
  })

  it('an empty model reply still yields a non-empty Librarian line', async () => {
    provider = mockProvider([])
    const evs = await events(await handler()(post(finder('hi'))))
    expect(evs.filter((e) => e.ev === 'delta').map((e) => e.data.text).join('')).toBe(COPY.lostPlace)
  })

  it('a provider failure becomes the resting-voice line, never internals', async () => {
    provider = mockProvider([], undefined, Object.assign(new Error('HTTP 400 temperature deprecated'), { status: 400 }))
    const res = await handler()(post(finder('hi')))
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    expect(text).toContain(COPY.resting)
    expect(text).not.toMatch(/temperature|400|Error/)
  })
})

describe('cost breaker ($15/day) and soft alert ($5/day)', () => {
  it('just under the line: the model is called', async () => {
    store.spend = BREAKER_USD - 0.01
    await (await handler()(post(finder('hi')))).text()
    expect(provider.calls).toHaveLength(1)
  })

  it('at the line: no model call, resting-voice reply, hard marker written', async () => {
    store.spend = BREAKER_USD
    const res = await handler()(post(finder('hi')))
    expect(res.status).toBe(200)
    const evs = await events(res)
    expect(evs[0]).toEqual({ ev: 'meta', data: { candidates: [] } })
    expect(evs[1]).toEqual({ ev: 'delta', data: { text: COPY.resting } })
    expect(provider.calls).toHaveLength(0)
    expect(store.alerts.map((a) => a.level)).toContain('hard')
    expect(store.usage).toHaveLength(0)
  })

  it('unreadable spend fails closed (resting voice, no model call)', async () => {
    store.spendToday = async () => {
      throw new Error('db down')
    }
    const text = await (await handler()(post(finder('hi')))).text()
    expect(text).toContain(COPY.resting)
    expect(provider.calls).toHaveLength(0)
  })

  it('crossing $5 writes the soft marker', async () => {
    store.spend = 4.9999999
    await (await handler()(post(finder('hi')))).text()
    expect(store.alerts.map((a) => a.level)).toEqual(['soft'])
  })

  it('missing ANTHROPIC_API_KEY: graceful resting voice, 200, no stack trace', async () => {
    const res = await handler({ apiKey: '' })(post(finder('hi')))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(COPY.resting)
    expect(text).not.toMatch(/ANTHROPIC|stack|Error/)
  })
})

describe('per-IP caps (30/hour, 120/day), no oracle', () => {
  it('the 31st turn in an hour is refused; other IPs are unaffected', async () => {
    const h = handler()
    for (let i = 0; i < 30; i++) expect((await h(post(finder('hi')))).status).toBe(200)
    const refused = await h(post(finder('hi')))
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: COPY.busy, code: 'busy' })
    expect((await h(post(finder('hi'), { ip: '198.51.100.9' }))).status).toBe(200)
  })

  it('the day cap refuses with the identical body and no headers that name a window or value', async () => {
    let t = TODAY.getTime()
    const h = handler({ now: () => new Date(t) })
    for (let i = 0; i < 120; i++) {
      t += 3 * 60 * 1000 // 20 an hour: under the hourly cap
      expect((await h(post(finder('hi')))).status).toBe(200)
    }
    t += 3 * 60 * 1000
    const refused = await h(post(finder('hi')))
    expect(refused.status).toBe(429)
    const body = await refused.text()
    expect(body).toBe(JSON.stringify({ error: COPY.busy, code: 'busy' }))
    expect(body).not.toMatch(/\d/)
    expect(refused.headers.get('retry-after')).toBe(null)
  })

  it('the shared counters table is authoritative (refusal there = same 429)', async () => {
    store.allow = false
    const res = await handler()(post(finder('hi')))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: COPY.busy, code: 'busy' })
    expect(provider.calls).toHaveLength(0)
  })
})

describe('history caps (rejected, never truncated)', () => {
  const longHistory = (shopperTurns) =>
    Array.from({ length: (shopperTurns - 1) * 2 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: i % 2 ? 'ok' : 'more',
    }))

  it('12 shopper turns pass; the 13th is a friendly 400', async () => {
    expect((await handler()(post(finder('hi', longHistory(12))))).status).toBe(200)
    const res = await handler()(post(finder('hi', longHistory(13))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: COPY.tooManyTurns, code: 'history_limit' })
  })

  it(`${MAX_SHOPPER_CHARS} chars pass; ${MAX_SHOPPER_CHARS + 1} is a friendly 400 (turn or history)`, async () => {
    expect((await handler()(post(finder('a'.repeat(MAX_SHOPPER_CHARS))))).status).toBe(200)
    const res = await handler()(post(finder('a'.repeat(MAX_SHOPPER_CHARS + 1))))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('message_too_long')
    const hist = [{ role: 'user', content: 'b'.repeat(MAX_SHOPPER_CHARS + 1) }, { role: 'assistant', content: 'ok' }]
    expect((await handler()(post(finder('hi', hist)))).status).toBe(400)
    expect(provider.calls.every((c) => c.messages.every((m) => m.content.length <= MAX_SHOPPER_CHARS))).toBe(true)
  })

  it('rejects broken role order and unknown modes', async () => {
    const bad = [
      { mode: 'finder', history: [{ role: 'assistant', content: 'hi' }], turn: { role: 'user', content: 'x' } },
      { mode: 'finder', history: [], turn: { role: 'assistant', content: 'x' } },
      { mode: 'dashboard', history: [], turn: { role: 'user', content: 'x' } },
      { mode: 'page', slug: '../etc', history: [], turn: { role: 'user', content: 'x' } },
    ]
    for (const b of bad) expect((await handler()(post(b))).status).toBe(400)
    expect(provider.calls).toHaveLength(0)
  })
})
