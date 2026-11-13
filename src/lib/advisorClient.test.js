import { describe, expect, it } from 'vitest'
import {
  advisorBuildEnabled,
  createSSEParser,
  inlineTokens,
  introText,
  probeAdvisor,
  replyBlocks,
  sendTurn,
  starterChips,
} from './advisorClient'

const ENV_ON = { VITE_ADVISOR_ENABLED: 'true', VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }
const ENV_OFF = { ...ENV_ON, VITE_ADVISOR_ENABLED: '' }

const sseResponse = (events) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

describe('copy (spec §5)', () => {
  it('finder intro and chips', () => {
    expect(introText('finder')).toBe(
      "Hi, I'm the Toy Librarian. Tell me who you're shopping for and I'll search my shelves.",
    )
    expect(starterChips('finder')).toEqual(['A gift for a 4-year-old', 'She loves dinosaurs', 'Under $30, please'])
  })

  it('page intro uses the first name the page shows, else "this young reader"', () => {
    expect(introText('page', 'Emma')).toMatch(/Shopping for Emma\?/)
    expect(introText('page', '')).toMatch(/Shopping for this young reader\?/)
    expect(starterChips('page')).toEqual(['What does she still need?', 'Something for the car', 'Under $30'])
  })

  it('never introduces the advisor by any other name', () => {
    for (const s of [introText('page', 'Emma'), introText('finder'), ...starterChips('page'), ...starterChips('finder')]) {
      expect(s).not.toMatch(/Elise/)
    }
  })
})

describe('flag', () => {
  it('build flag off: no probe request at all', async () => {
    let called = false
    const on = await probeAdvisor({ env: ENV_OFF, fetchImpl: async () => ((called = true), new Response('{}')) })
    expect(on).toBe(false)
    expect(called).toBe(false)
    expect(advisorBuildEnabled({})).toBe(false)
  })

  it('build flag on: the function decides (404 shape = off, {enabled:true} = on)', async () => {
    const off = await probeAdvisor({
      env: ENV_ON,
      fetchImpl: async () => new Response('{"code":"NOT_FOUND"}', { status: 404 }),
    })
    expect(off).toBe(false)
    const on = await probeAdvisor({ env: ENV_ON, fetchImpl: async () => new Response('{"enabled":true}') })
    expect(on).toBe(true)
    const broken = await probeAdvisor({ env: ENV_ON, fetchImpl: async () => Promise.reject(new Error('x')) })
    expect(broken).toBe(false)
  })
})

describe('transport', () => {
  it('parses SSE across chunk boundaries', () => {
    const p = createSSEParser()
    expect(p.feed('event: meta\ndata: {"candid')).toEqual([])
    expect(p.feed('ates":[]}\n\nevent: delta\ndata: {"text":"Hi"}\n\n')).toEqual([
      { event: 'meta', data: { candidates: [] } },
      { event: 'delta', data: { text: 'Hi' } },
    ])
  })

  it('sendTurn posts the page body and streams meta then text', async () => {
    let sent
    const metas = []
    let text = ''
    const res = await sendTurn({
      mode: 'page',
      slug: 'millers',
      childId: 'c1',
      history: [],
      text: 'What does she still need?',
      env: ENV_ON,
      fetchImpl: async (url, init) => {
        sent = { url, init }
        return sseResponse([
          ['meta', { candidates: [{ id: '1', name: 'Wooden Dinosaur Puzzle', product_url: 'https://x.test/p' }] }],
          ['delta', { text: 'Try the ' }],
          ['delta', { text: 'Wooden Dinosaur Puzzle.' }],
          ['done', { ok: true }],
        ])
      },
      onMeta: (c) => metas.push(c),
      onDelta: (t) => (text += t),
    })
    expect(res).toEqual({ ok: true })
    expect(sent.url).toBe('https://ref.supabase.co/functions/v1/gift-advisor')
    expect(JSON.parse(sent.init.body)).toEqual({
      mode: 'page',
      slug: 'millers',
      child_id: 'c1',
      history: [],
      turn: { role: 'user', content: 'What does she still need?' },
    })
    expect(metas).toHaveLength(1)
    expect(text).toBe('Try the Wooden Dinosaur Puzzle.')
  })

  it('surfaces the friendly server error and its code', async () => {
    const res = await sendTurn({
      mode: 'finder',
      history: [],
      text: 'hi',
      env: ENV_ON,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'Start a fresh conversation', code: 'history_limit' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    })
    expect(res).toEqual({ ok: false, error: 'Start a fresh conversation', code: 'history_limit' })
  })
})

describe('light markdown + candidate links', () => {
  const cands = [
    { id: '1', name: 'Wooden Dinosaur Puzzle', product_url: 'https://www.melissaanddoug.com/p' },
    { id: '2', name: 'Bad Link', product_url: 'javascript:alert(1)' },
    { id: '3', name: 'No Link', product_url: null },
  ]

  it('links candidate names to product_url (http/https only)', () => {
    const t = inlineTokens('Try the Wooden Dinosaur Puzzle or Bad Link or No Link.', cands)
    const links = t.filter((x) => x.type === 'link')
    expect(links).toEqual([
      { type: 'link', text: 'Wooden Dinosaur Puzzle', href: 'https://www.melissaanddoug.com/p', style: null },
    ])
  })

  it('bold names still link; lists and paragraphs split', () => {
    const blocks = replyBlocks('Here are two:\n\n- **Wooden Dinosaur Puzzle**: $17.99\n- *a calm pick*\n\nHappy shopping!', cands)
    expect(blocks.map((b) => b.type)).toEqual(['p', 'list', 'p'])
    expect(blocks[1].items[0][0]).toMatchObject({ type: 'link', style: 'bold' })
    expect(blocks[1].items[1][0]).toEqual({ type: 'italic', text: 'a calm pick' })
  })

  it('raw HTML stays text', () => {
    const t = inlineTokens('<img src=x onerror=alert(1)>', [])
    expect(t).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }])
  })
})
