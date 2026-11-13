// gift-advisor abuse and cost controls (spec §6) + request checks
// (spec §2). Pure: no Deno, no Node, no network.

export const HOUR_CAP = 30
export const DAY_CAP = 120
export const SOFT_ALERT_USD = 5
export const BREAKER_USD = 15

export const MAX_SHOPPER_TURNS = 12 // shopper messages, including this turn
export const MAX_SHOPPER_CHARS = 500
// Librarian replies come back from the client too; cap them so a
// forged history cannot stuff the prompt.
export const MAX_LIBRARIAN_CHARS = 6000
export const MAX_BODY_BYTES = 128 * 1024

// ------------------------------------------------------------ copy
// The advisor is introduced as "the Toy Librarian", never by any
// other name. None of these strings may reveal which control fired
// or any counter value (A-2 lesson).
export const COPY = {
  resting:
    "I'm resting my voice for a little while. Please browse the shelves in the meantime, and come back to chat with me later.",
  busy: 'The Toy Librarian is taking a short break. Please try again a little later.',
  tooLong: `That's a long message! Could you say it in ${MAX_SHOPPER_CHARS} characters or fewer?`,
  tooManyTurns:
    "We've covered a lot of ground! Start a fresh conversation and I'll search my shelves again.",
  empty: 'Ask me anything about finding a gift.',
  badRequest: "Sorry, I couldn't read that. Please try again.",
  lostPlace: "Sorry, I lost my place for a moment. Could you ask me that again?",
  noPage: "That gift page isn't available.",
}

// ------------------------------------------------------------ CORS
// Apex + *.toylibrary.store, https only. Nothing else.
export function isAllowedOrigin(origin) {
  if (!origin) return false
  let u
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false
  if (u.pathname !== '/' || u.search || u.hash) return false
  if (origin.endsWith('/')) return false
  const host = u.hostname.toLowerCase()
  return host === 'toylibrary.store' || /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+toylibrary\.store$/.test(host)
}

export function corsHeaders(origin) {
  if (!isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

// --------------------------------------------------------- request
// Returns { ok: true, value } or { ok: false, status, error, code }.
// Over-limit history is REJECTED with a friendly message, never
// silently truncated (spec §2).
export function validateRequest(body) {
  const fail = (status, error, code) => ({ ok: false, status, error, code })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, COPY.badRequest, 'bad_request')
  const mode = body.mode
  if (mode !== 'page' && mode !== 'finder') return fail(400, COPY.badRequest, 'bad_request')

  let slug = null
  if (mode === 'page') {
    slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return fail(400, COPY.badRequest, 'bad_request')
  }
  let childId = null
  if (mode === 'page' && body.child_id != null) {
    if (typeof body.child_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.child_id)) {
      return fail(400, COPY.badRequest, 'bad_request')
    }
    childId = body.child_id
  }

  const history = body.history ?? []
  if (!Array.isArray(history)) return fail(400, COPY.badRequest, 'bad_request')
  const turn = body.turn
  if (!turn || typeof turn !== 'object' || turn.role !== 'user' || typeof turn.content !== 'string') {
    return fail(400, COPY.badRequest, 'bad_request')
  }
  const messages = [...history, turn]
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m || typeof m !== 'object' || typeof m.content !== 'string') return fail(400, COPY.badRequest, 'bad_request')
    // Strict alternation, shopper first: user, assistant, user, ...
    const expected = i % 2 === 0 ? 'user' : 'assistant'
    if (m.role !== expected) return fail(400, COPY.badRequest, 'bad_request')
    if (m.role === 'user' && m.content.length > MAX_SHOPPER_CHARS) return fail(400, COPY.tooLong, 'message_too_long')
    if (m.role === 'assistant' && m.content.length > MAX_LIBRARIAN_CHARS) {
      return fail(400, COPY.badRequest, 'bad_request')
    }
  }
  if (!turn.content.trim()) return fail(400, COPY.empty, 'empty')
  const shopperTurns = messages.filter((m) => m.role === 'user').length
  if (shopperTurns > MAX_SHOPPER_TURNS) return fail(400, COPY.tooManyTurns, 'history_limit')

  return {
    ok: true,
    value: {
      mode,
      slug,
      childId,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      shopperTexts: messages.filter((m) => m.role === 'user').map((m) => m.content),
    },
  }
}

// ------------------------------------------------------ rate limit
// In-memory first line (per isolate); the counters table behind it
// is authoritative across isolates. One answer for both windows.
export class MemoryLimiter {
  constructor({ hourCap = HOUR_CAP, dayCap = DAY_CAP } = {}) {
    this.hourCap = hourCap
    this.dayCap = dayCap
    this.hits = new Map() // key -> array of epoch ms
  }

  take(key, nowMs = Date.now()) {
    const dayAgo = nowMs - 24 * 3600 * 1000
    const hourAgo = nowMs - 3600 * 1000
    const list = (this.hits.get(key) ?? []).filter((t) => t > dayAgo)
    const inHour = list.filter((t) => t > hourAgo).length
    if (inHour >= this.hourCap || list.length >= this.dayCap) {
      this.hits.set(key, list)
      return false
    }
    list.push(nowMs)
    this.hits.set(key, list)
    if (this.hits.size > 5000) this.prune(nowMs)
    return true
  }

  prune(nowMs = Date.now()) {
    const dayAgo = nowMs - 24 * 3600 * 1000
    for (const [k, v] of this.hits) {
      const kept = v.filter((t) => t > dayAgo)
      if (kept.length) this.hits.set(k, kept)
      else this.hits.delete(k)
    }
  }
}

// The caller's IP from the edge proxy headers (first hop), or ''.
export function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const first = xff.split(',')[0].trim()
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || ''
}

export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}|${ip}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
