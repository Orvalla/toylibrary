// First-party analytics tracker (migration 0040). Privacy-
// light by design: a random visitor id in local storage, a
// session id that rolls over after 30 idle minutes, page
// paths, and a 30-second heartbeat while the tab is visible
// (that heartbeat is what makes session durations and the
// admin page's "live now" view honest). No third-party
// tracker, no IPs, no user agents — the server side stores
// only what analytics_touch is handed here.

import { supabase } from '../supabaseClient'

const VISITOR_KEY = 'tl-visitor-id'
const SESSION_KEY = 'tl-session'
const IDLE_MS = 30 * 60 * 1000
const BEAT_MS = 30 * 1000

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return uuid()
  }
}

export function sessionId(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s?.id && now - (s.last ?? 0) < IDLE_MS) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: s.id, last: now }))
        return s.id
      }
    }
    const s = { id: uuid(), last: now }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    return s.id
  } catch {
    return uuid()
  }
}

let started = false

export function startAnalytics() {
  if (started || typeof window === 'undefined') return
  started = true
  const send = (kind) => {
    try {
      Promise.resolve(
        supabase.rpc('analytics_touch', {
          p_session: sessionId(),
          p_visitor: visitorId(),
          p_host: window.location.hostname,
          p_path: window.location.pathname,
          p_kind: kind,
        })
      ).catch(() => {})
    } catch {
      // Analytics must never break the page.
    }
  }
  send('view')
  // SPA navigations don't reload the page — watch the history
  // API the router uses.
  let lastPath = window.location.pathname
  const onNav = () => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname
      send('view')
    }
  }
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = (...args) => {
    origPush(...args)
    onNav()
  }
  history.replaceState = (...args) => {
    origReplace(...args)
    onNav()
  }
  window.addEventListener('popstate', onNav)
  setInterval(() => {
    if (document.visibilityState === 'visible') send('beat')
  }, BEAT_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send('beat')
  })
}
