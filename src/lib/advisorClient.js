// Client side of the gift advisor ("the Toy Librarian", WS7).
//
// The function is stateless: this module holds the conversation and
// resends it each turn (spec §2). Replies stream back as SSE: one
// `meta` event (the turn's candidates: id, name, product_url), then
// `delta` text chunks, then `done`.
//
// Flag (spec §8): the UI renders only when the build enables it
// (VITE_ADVISOR_ENABLED=true) AND the function's status probe says
// it is on. The function-side ADVISOR_ENABLED secret is the kill
// switch: flip it off and the probe 404s, so the UI disappears on
// the next page load without a rebuild. On top of that sits the
// rollout gate (advisorVisible below): until the advisor_public
// feature flag is on, only admin accounts see her.

export const ADVISOR_FUNCTION = 'gift-advisor'
export const MASCOT_SRC = '/toy-library-mascot-storytime.webp'
export const LIBRARIAN_NAME = 'The Toy Librarian'
export const MAX_SHOPPER_CHARS = 500

export function advisorBuildEnabled(env = import.meta.env) {
  return String(env?.VITE_ADVISOR_ENABLED ?? '').trim().toLowerCase() === 'true'
}

export function advisorEndpoint(env = import.meta.env) {
  const base = String(env?.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/functions/v1/${ADVISOR_FUNCTION}` : ''
}

function authHeaders(env = import.meta.env) {
  const key = env?.VITE_SUPABASE_ANON_KEY
  return key ? { apikey: key, Authorization: `Bearer ${key}` } : {}
}

// ------------------------------------------------------------ copy

export function introText(mode, childName) {
  if (mode === 'page') {
    const who = String(childName ?? '').trim().split(/\s+/)[0] || 'this young reader'
    return `Hi, I'm the Toy Librarian. Shopping for ${who}? Tell me what you have in mind and I'll search my shelves.`
  }
  return "Hi, I'm the Toy Librarian. Tell me who you're shopping for and I'll search my shelves."
}

export function starterChips(mode) {
  return mode === 'page'
    ? ['What does she still need?', 'Something for the car', 'Under $30']
    : ['A gift for a 4-year-old', 'She loves dinosaurs', 'Under $30, please']
}

export const FALLBACK_ERROR = "Sorry, I couldn't reach my shelves just now. Please try again in a moment."

// ------------------------------------------------------------- SSE

// Incremental SSE parser: feed() text chunks, get {event, data}
// objects back (data JSON-parsed; malformed blocks are skipped).
export function createSSEParser() {
  let buf = ''
  return {
    feed(chunk) {
      buf += chunk
      const out = []
      let idx
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
        let event = 'message'
        const data = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        }
        if (!data.length) continue
        try {
          out.push({ event, data: JSON.parse(data.join('\n')) })
        } catch {
          // skip
        }
      }
      return out
    },
  }
}

// ------------------------------------------------------- transport

// Is the advisor on? Build flag first (no request when off), then
// the function's status probe.
export async function probeAdvisor({ fetchImpl = globalThis.fetch, env = import.meta.env } = {}) {
  if (!advisorBuildEnabled(env)) return false
  const url = advisorEndpoint(env)
  if (!url || !fetchImpl) return false
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: authHeaders(env) })
    if (!res.ok) return false
    const body = await res.json()
    return body?.enabled === true
  } catch {
    return false
  }
}

// ------------------------------------------------ rollout flag

// The public-rollout flag (migration 0067, owner ruling
// 2026-11-13): the Librarian ships visible to admin accounts
// only; the admin panel flips feature_flags.advisor_public to
// open her to everyone. The table is world-readable on purpose
// — it names who may SEE the advisor, nothing more — and every
// failure here reads as "not public".
export const ADVISOR_PUBLIC_KEY = 'advisor_public'

export async function fetchAdvisorPublic(fetchImpl = globalThis.fetch, env = import.meta.env) {
  const base = String(env?.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  if (!base || !fetchImpl) return false
  try {
    const res = await fetchImpl(
      `${base}/rest/v1/feature_flags?key=eq.${ADVISOR_PUBLIC_KEY}&select=enabled`,
      { method: 'GET', headers: authHeaders(env) },
    )
    if (!res.ok) return false
    const rows = await res.json()
    return Array.isArray(rows) && rows[0]?.enabled === true
  } catch {
    return false
  }
}

// Who sees the advisor: the function must be on (probe), and
// either the public flag is on or the viewer is an admin
// previewing her. Anonymous viewers are never admins.
export function advisorVisible({ probeOn, publicOn, isAdmin }) {
  return Boolean(probeOn) && (Boolean(publicOn) || Boolean(isAdmin))
}

// Send one turn. Calls onMeta(candidates) once, onDelta(text) per
// chunk. Resolves { ok: true } or { ok: false, error, code }.
export async function sendTurn({
  mode,
  slug,
  childId,
  history,
  text,
  onMeta,
  onDelta,
  fetchImpl = globalThis.fetch,
  env = import.meta.env,
  signal,
}) {
  const body = { mode, history, turn: { role: 'user', content: text } }
  if (mode === 'page') {
    body.slug = slug
    if (childId) body.child_id = childId
  }
  let res
  try {
    res = await fetchImpl(advisorEndpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(env) },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    return { ok: false, error: FALLBACK_ERROR, code: 'network' }
  }
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.includes('text/event-stream') || !res.body) {
    let payload = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const error = typeof payload?.error === 'string' ? payload.error : FALLBACK_ERROR
    return { ok: false, error, code: payload?.code ?? `http_${res.status}` }
  }
  const parser = createSSEParser()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sawText = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        if (ev.event === 'meta') onMeta?.(Array.isArray(ev.data?.candidates) ? ev.data.candidates : [])
        else if (ev.event === 'delta' && typeof ev.data?.text === 'string') {
          sawText = true
          onDelta?.(ev.data.text)
        }
      }
    }
    for (const ev of parser.feed(decoder.decode() + '\n\n')) {
      if (ev.event === 'delta' && typeof ev.data?.text === 'string') {
        sawText = true
        onDelta?.(ev.data.text)
      }
    }
  } catch {
    if (!sawText) return { ok: false, error: FALLBACK_ERROR, code: 'stream' }
  }
  return sawText ? { ok: true } : { ok: false, error: FALLBACK_ERROR, code: 'empty' }
}

// ------------------------------------------------- light markdown

const safeHref = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

// Inline tokens for one line: **bold**, *italic*, and candidate
// names turned into links to their product_url. Plain data only:
// the component maps tokens to React elements (no innerHTML).
export function inlineTokens(text, candidates = []) {
  const links = candidates
    .filter((c) => c?.name && safeHref(c.product_url))
    .sort((a, b) => b.name.length - a.name.length)
  const out = []
  const pushText = (t, style) => {
    if (!t) return
    if (!links.length) {
      out.push({ type: style ?? 'text', text: t })
      return
    }
    const re = new RegExp(links.map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    let last = 0
    for (const m of t.matchAll(re)) {
      if (m.index > last) out.push({ type: style ?? 'text', text: t.slice(last, m.index) })
      const c = links.find((l) => l.name === m[0])
      out.push({ type: 'link', text: m[0], href: safeHref(c.product_url), style: style ?? null })
      last = m.index + m[0].length
    }
    if (last < t.length) out.push({ type: style ?? 'text', text: t.slice(last) })
  }
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
  let last = 0
  for (const m of String(text).matchAll(re)) {
    pushText(text.slice(last, m.index))
    pushText(m[1] ?? m[2], m[1] != null ? 'bold' : 'italic')
    last = m.index + m[0].length
  }
  pushText(String(text).slice(last))
  return out
}

// Blocks: paragraphs and bullet / numbered lists.
export function replyBlocks(text, candidates = []) {
  const blocks = []
  let list = null
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (item) {
      if (!list) {
        list = { type: 'list', items: [] }
        blocks.push(list)
      }
      list.items.push(inlineTokens(item[1].replace(/^#+\s*/, ''), candidates))
      continue
    }
    list = null
    if (!line.trim()) continue
    blocks.push({ type: 'p', tokens: inlineTokens(line.replace(/^#+\s*/, ''), candidates) })
  }
  return blocks
}
