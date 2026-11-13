// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_MODEL,
  MAX_TOKENS,
  ProviderError,
  buildAnthropicRequest,
  createAnthropicProvider,
  estimateCost,
} from '../../supabase/functions/gift-advisor/anthropic.js'

// WS7 spec §4 hard requirements on the model call.

const sseBody = (events) =>
  new ReadableStream({
    start(c) {
      const enc = new TextEncoder()
      for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
      c.close()
    },
  })

describe('request builder', () => {
  const body = buildAnthropicRequest({ system: 'S', messages: [{ role: 'user', content: 'hi', extra: 1 }] })

  it('claude-haiku-5-5, max_tokens 2000 (REQUIRED), streaming', () => {
    expect(ANTHROPIC_MODEL).toBe('claude-haiku-5-5')
    expect(MAX_TOKENS).toBe(2000)
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2000, stream: true, system: 'S' })
  })

  it('never sends temperature (the model 400s on it)', () => {
    expect(body).not.toHaveProperty('temperature')
    expect(JSON.stringify(body)).not.toMatch(/temperature/)
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'system'])
  })

  it('passes only role and content per message', () => {
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('streaming adapter', () => {
  it('yields text deltas and usage; drops thinking; sends the key as a header only', async () => {
    let seen
    const fetchImpl = async (url, init) => {
      seen = { url, init }
      return new Response(
        sseBody([
          { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret plan' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello ' } },
          { type: 'ping' },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'there.' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 640 } },
          { type: 'message_stop' },
        ]),
        { status: 200 },
      )
    }
    const p = createAnthropicProvider({ apiKey: 'test-key', fetchImpl })
    const out = []
    for await (const ev of p.stream({ system: 'S', messages: [{ role: 'user', content: 'hi' }] })) out.push(ev)
    expect(out.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Hello there.')
    expect(JSON.stringify(out)).not.toContain('secret plan')
    expect(out).toContainEqual({ type: 'usage', input_tokens: 1200, output_tokens: 1 })
    expect(out).toContainEqual({ type: 'usage', output_tokens: 640 })
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages')
    expect(seen.init.headers['x-api-key']).toBe('test-key')
    expect(seen.init.headers['anthropic-version']).toBe('2023-06-01')
    expect(JSON.parse(seen.init.body)).not.toHaveProperty('temperature')
    expect(JSON.parse(seen.init.body).max_tokens).toBe(2000)
  })

  it('upstream errors become a bare ProviderError (no upstream body)', async () => {
    const fetchImpl = async () =>
      new Response('{"error":{"message":"temperature is deprecated for this model"}}', { status: 400 })
    const p = createAnthropicProvider({ apiKey: 'k', fetchImpl })
    const it = p.stream({ system: 'S', messages: [] })
    const err = await it.next().catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.status).toBe(400)
    expect(err.message).not.toMatch(/temperature/)
  })

  it('a missing key fails before any network call', async () => {
    let called = false
    const p = createAnthropicProvider({ apiKey: '', fetchImpl: async () => ((called = true), new Response('')) })
    await expect(p.stream({ system: 'S', messages: [] }).next()).rejects.toBeInstanceOf(ProviderError)
    expect(called).toBe(false)
  })

  it('estimates cost from the bake-off rate card', () => {
    expect(estimateCost({ inPerM: 0.1, outPerM: 0.5 }, 1_000_000, 1_000_000)).toBeCloseTo(0.6, 10)
  })
})
