// gift-advisor request handler (spec §2, §6, §8), runtime-neutral.
//
// index.ts wires the real dependencies (env, Supabase, Anthropic);
// the vitest suite wires mocks. Order of checks, cheapest first:
//
//   flag OFF            -> 404 shape (the kill switch, spec §8)
//   foreign Origin      -> 403, no CORS headers
//   OPTIONS / GET       -> preflight / status probe
//   body + history caps -> 400 friendly (never truncated)
//   per-IP caps         -> 429, one message for both windows
//   breaker / no key    -> SSE: the resting-voice reply, model not called
//   retrieval (fences)  -> SSE: metadata event, then streamed text
//
// SSE events, in order: exactly one `meta` (candidates: [{id, name,
// product_url}]), zero or more `delta` ({text}), one `done`.

import { buildSystemPrompt } from './prompt.js'
import { estimateCost } from './anthropic.js'
import { childFromConversation, interestLabels, retrieve } from './retrieval.js'
import {
  BREAKER_USD,
  COPY,
  MAX_BODY_BYTES,
  SOFT_ALERT_USD,
  clientIp,
  corsHeaders,
  hashIp,
  validateRequest,
} from './controls.js'

// Same body and status the platform gives for a function that does
// not exist, so a disabled advisor is indistinguishable from none.
export const NOT_FOUND_BODY = { code: 'NOT_FOUND', message: 'Requested function was not found' }

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...extra, 'Content-Type': 'application/json' },
  })

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const utcDay = (d) => d.toISOString().slice(0, 10)

// deps:
//   enabled: boolean                 advisor_enabled
//   apiKey: string                   ANTHROPIC_API_KEY ('' = missing)
//   makeProvider(apiKey) -> AdvisorProvider
//   store: {
//     takeTurn(ipHash) -> Promise<boolean>
//     spendToday() -> Promise<number>
//     logUsage(row) -> Promise<void>
//     markAlert(level, spend) -> Promise<void>
//     loadPage(slug, childId) -> Promise<null | { age, interests, players, excludeKeys }>
//     catalog: retrieval source (eligible / olderThan)
//   }
//   limiter: MemoryLimiter
//   ipSalt: string
//   now(): Date
//   log(level, msg)                  operational log line (no shopper text)
export function createHandler(deps) {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})

  return async function handle(req) {
    const origin = req.headers.get('origin')
    const cors = corsHeaders(origin)

    if (!deps.enabled) return json(NOT_FOUND_BODY, 404, cors)
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'Not allowed.' }, 403)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method === 'GET') return json({ enabled: true }, 200, cors)
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, cors)

    let body
    try {
      const raw = await req.text()
      if (raw.length > MAX_BODY_BYTES) return json({ error: COPY.badRequest, code: 'bad_request' }, 413, cors)
      body = JSON.parse(raw)
    } catch {
      return json({ error: COPY.badRequest, code: 'bad_request' }, 400, cors)
    }
    const checked = validateRequest(body)
    if (!checked.ok) return json({ error: checked.error, code: checked.code }, checked.status, cors)
    const { mode, slug, childId, messages, shopperTexts } = checked.value

    // Per-IP caps. Same 429 and copy whichever window refused.
    const ipHash = await hashIp(clientIp(req) || 'unknown', deps.ipSalt ?? '')
    let allowed = deps.limiter ? deps.limiter.take(ipHash, now().getTime()) : true
    if (allowed) {
      try {
        allowed = await deps.store.takeTurn(ipHash)
      } catch {
        // Counters table unreachable: the in-memory cap still holds.
        log('warn', 'advisor: counter store unavailable, in-memory cap only')
      }
    }
    if (!allowed) return json({ error: COPY.busy, code: 'busy' }, 429, cors)

    const stream = (producer) =>
      new Response(
        new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder()
            // A shopper who closes the tab mid-reply cancels the
            // stream; sends become no-ops so the producer still
            // finishes and the usage row (the breaker's input) is
            // still written.
            let open = true
            const send = (event, data) => {
              if (!open) return
              try {
                controller.enqueue(enc.encode(sse(event, data)))
              } catch {
                open = false
              }
            }
            try {
              await producer(send)
            } catch {
              // Never leak internals into the stream.
              send('done', { ok: false })
            }
            try {
              controller.close()
            } catch {
              // already closed by the client
            }
          },
        }),
        {
          status: 200,
          headers: {
            ...cors,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-store',
          },
        },
      )
    const resting = () =>
      stream(async (send) => {
        send('meta', { candidates: [] })
        send('delta', { text: COPY.resting })
        send('done', { ok: true, resting: true })
      })

    // Breaker: fail CLOSED when spend cannot be read.
    let spend
    try {
      spend = Number(await deps.store.spendToday())
      if (!Number.isFinite(spend)) throw new Error('bad spend')
    } catch {
      log('error', 'advisor: spend unreadable, breaker held open')
      return resting()
    }
    if (spend >= BREAKER_USD) {
      try {
        await deps.store.markAlert('hard', spend)
      } catch {
        // marker is best-effort
      }
      log('error', 'ADVISOR_BREAKER_OPEN daily spend at or above hard line')
      return resting()
    }
    if (!deps.apiKey) {
      log('error', 'advisor: ANTHROPIC_API_KEY not set')
      return resting()
    }

    // Child context: the gift page's own data (page mode) and/or
    // what the shopper has said (both modes). On a gift page the
    // page's birth date wins over anything typed.
    const said = childFromConversation(shopperTexts)
    let ctx
    if (mode === 'page') {
      let page
      try {
        page = await deps.store.loadPage(slug, childId)
      } catch {
        return json({ error: COPY.badRequest, code: 'bad_request' }, 503, cors)
      }
      if (!page) return json({ error: COPY.noPage, code: 'no_page' }, 404, cors)
      ctx = {
        age: page.age ?? said.age,
        interests: [...new Set([...(page.interests ?? []), ...said.interests])],
        players: [...new Set([...(page.players ?? []), ...said.players])],
        excludeKeys: page.excludeKeys ?? new Set(),
      }
    } else {
      ctx = { ...said, excludeKeys: new Set() }
    }
    ctx.shopperTexts = shopperTexts

    let found
    try {
      found = await retrieve(deps.store.catalog, ctx)
    } catch {
      log('error', 'advisor: retrieval failed')
      return resting()
    }

    const system = buildSystemPrompt({
      candidates: found.candidates,
      alsoKnown: found.alsoKnown,
      child: {
        age_years: ctx.age ?? null,
        interests: interestLabels(ctx.interests),
        players_owned: ctx.players,
      },
    })
    const candidateMeta = found.rows.map((r) => ({ id: r.id, name: r.title, product_url: r.product_url || null }))
    const provider = deps.makeProvider(deps.apiKey)

    return stream(async (send) => {
      send('meta', { candidates: candidateMeta })
      let tokensIn = 0
      let tokensOut = 0
      let text = ''
      let failed = false
      try {
        for await (const ev of provider.stream({ system, messages })) {
          if (ev.type === 'text' && ev.text) {
            text += ev.text
            send('delta', { text: ev.text })
          } else if (ev.type === 'usage') {
            if (ev.input_tokens != null) tokensIn = Math.max(tokensIn, ev.input_tokens)
            if (ev.output_tokens != null) tokensOut = Math.max(tokensOut, ev.output_tokens)
          }
        }
      } catch (err) {
        failed = true
        log('error', `advisor: provider failed (status ${err?.status ?? 'n/a'})`)
      }
      if (!text) send('delta', { text: failed ? COPY.resting : COPY.lostPlace })
      send('done', { ok: !failed })

      // Usage log: counts, cost, mode, candidate ids. No transcript.
      const cost = estimateCost(provider.price, tokensIn, tokensOut)
      try {
        await deps.store.logUsage({
          day: utcDay(now()),
          provider: provider.name,
          model: provider.model,
          mode,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          est_cost: Number(cost.toFixed(6)),
          candidate_ids: found.rows.map((r) => r.id),
        })
      } catch {
        log('error', 'advisor: usage log write failed')
      }
      const after = spend + cost
      try {
        if (after >= SOFT_ALERT_USD) await deps.store.markAlert('soft', after)
        if (after >= BREAKER_USD) await deps.store.markAlert('hard', after)
      } catch {
        // marker is best-effort
      }
      if (spend < SOFT_ALERT_USD && after >= SOFT_ALERT_USD) {
        log('warn', 'ADVISOR_SOFT_ALERT daily spend crossed the soft line')
      }
    })
  }
}
