// gift-advisor model provider (spec §4).
//
// AdvisorProvider interface (one implementation in v1):
//
//   {
//     name: string,            // 'anthropic' — logged to advisor_usage
//     model: string,
//     price: { inPerM, outPerM },  // USD per 1M tokens, for est_cost
//     stream({ system, messages }): AsyncIterable<
//       { type: 'text', text } | { type: 'usage', input_tokens?, output_tokens? }
//     >,
//   }
//
// stream() throws ProviderError on any upstream failure. The error
// carries an HTTP status only; upstream bodies are never read into
// it, so nothing the provider says can leak to a shopper.
//
// Swapping provider (Gemini 3.1 Flash-Lite is the designated
// fallback) = a second adapter with the same shape + a config line
// in index.ts. v1 ships this adapter only.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'
export const ANTHROPIC_MODEL = 'claude-haiku-5-5'

// REQUIRED, not a default (spec §4): Haiku 5.5 spends output tokens
// on thinking by default; the bake-off saw a 700 cap return EMPTY
// replies and 2000 complete cleanly. Do not lower without re-running
// the bake-off.
export const MAX_TOKENS = 2000

// Bake-off rate card (2026-11-12), USD per 1M tokens.
export const ANTHROPIC_PRICE = { inPerM: 0.1, outPerM: 0.5 }

export class ProviderError extends Error {
  constructor(status, message = 'provider error') {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

// The request body. No `temperature`: the model rejects it ("deprecated
// for this model", HTTP 400, verified 2026-11-12), and
// advisorProvider.test.js asserts the key is absent. Nothing here
// takes sampling parameters from the caller, on purpose.
export function buildAnthropicRequest({ system, messages }) {
  return {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  }
}

// Minimal SSE reader: yields { event, data } for each block.
export async function* readSSE(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const flush = function* (block) {
    let event = 'message'
    const data = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) yield { event, data: data.join('\n') }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
      yield* flush(block)
    }
  }
  buf += decoder.decode()
  if (buf.trim()) yield* flush(buf)
}

export function createAnthropicProvider({ apiKey, fetchImpl = fetch, timeoutMs = 60000 }) {
  return {
    name: 'anthropic',
    model: ANTHROPIC_MODEL,
    price: ANTHROPIC_PRICE,
    async *stream({ system, messages }) {
      if (!apiKey) throw new ProviderError(0, 'no key')
      let res
      try {
        res = await fetchImpl(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildAnthropicRequest({ system, messages })),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        throw new ProviderError(0, 'unreachable')
      }
      if (!res.ok || !res.body) {
        try {
          await res.body?.cancel()
        } catch {
          // ignore
        }
        throw new ProviderError(res.status || 0)
      }
      for await (const { event, data } of readSSE(res.body)) {
        let msg
        try {
          msg = JSON.parse(data)
        } catch {
          continue
        }
        const type = msg?.type ?? event
        if (type === 'message_start') {
          const u = msg.message?.usage ?? {}
          yield { type: 'usage', input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 }
        } else if (type === 'content_block_delta' && msg.delta?.type === 'text_delta') {
          if (msg.delta.text) yield { type: 'text', text: msg.delta.text }
        } else if (type === 'message_delta') {
          const u = msg.usage ?? {}
          yield { type: 'usage', output_tokens: u.output_tokens }
        } else if (type === 'error') {
          throw new ProviderError(502, 'stream error')
        }
        // thinking / signature deltas and pings are dropped.
      }
    },
  }
}

export function estimateCost(price, tokensIn, tokensOut) {
  return (tokensIn / 1e6) * price.inPerM + (tokensOut / 1e6) * price.outPerM
}
