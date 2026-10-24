import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { visitorLabel } from '../lib/visitorLabel'

// Visitor analytics for the admin page (migration 0040):
// first-party only — live presence, windowed totals, top
// pages, recent sessions. All reads go through the
// admin-gated RPCs; nothing here is reachable by non-admins.

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function fmtDuration(startIso, endIso) {
  const mins = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60000))
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

function whereLabel(s) {
  const host = s.host ?? ''
  const path = s.current_path ?? '/'
  if (host && host !== 'toylibrary.store' && host !== 'www.toylibrary.store') {
    return `${host}${path === '/' ? '' : path}`
  }
  return path
}

// Who a session belongs to, as far as privacy-light data can
// say (migration 0048): signed-in visits carry the account's
// display name from the server-side join; guests are told
// apart by a stable nickname derived from their browser's
// random visitor id — same browser, same nickname, no IP.
function whoLabel(s) {
  if (s.signed_in) {
    const name = (s.display_name ?? '').trim()
    return name ? `👤 ${name}` : '👤 Signed-in parent'
  }
  return `🧭 Guest ${visitorLabel(s.visitor_id)}`
}

function visitsLabel(s) {
  const n = s.visitor_visits ?? 1
  return n > 1 ? ` · visit #${n}` : ' · first visit'
}

export default function AnalyticsPanel() {
  const [live, setLive] = useState(null)
  const [summary, setSummary] = useState(null)
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')

  const loadLive = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('analytics_live')
    if (!err && data) setLive(data)
  }, [])

  const loadSummary = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('analytics_summary', { p_days: days })
    if (err) setError(err.message)
    else setSummary(data)
  }, [days])

  useEffect(() => {
    loadLive()
    loadSummary()
    const t = setInterval(loadLive, 30000)
    return () => clearInterval(t)
  }, [loadLive, loadSummary])

  return (
    <section className="card">
      <h2>👀 Visitors</h2>
      <p className="muted">
        First-party analytics only — no third-party trackers, no IP addresses
        stored. Signed-in visits show the account name; guests are told apart
        by a nickname hashed from their browser's random id (same browser,
        same nickname). A session ends after 30 quiet minutes.
      </p>
      {error && <p className="error">{error}</p>}

      <p>
        <strong>🟢 {live?.live_count ?? 0} browsing right now</strong>
      </p>
      {live?.sessions?.length > 0 && (
        <ul>
          {live.sessions.map((s, i) => (
            <li key={i}>
              {whoLabel(s)} — {whereLabel(s)} — {s.page_count} page
              {s.page_count === 1 ? '' : 's'}, here for{' '}
              {fmtDuration(s.started_at, s.last_seen_at)}
              {visitsLabel(s)}
            </li>
          ))}
        </ul>
      )}

      <p>
        <label>
          Window{' '}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
      </p>
      {summary && (
        <>
          <p>
            <strong>{summary.visitors}</strong> visitors ·{' '}
            <strong>{summary.sessions}</strong> sessions ·{' '}
            <strong>{summary.pageviews}</strong> pageviews · avg{' '}
            <strong>{summary.avg_pages}</strong> pages/session · avg session{' '}
            <strong>{summary.avg_minutes} min</strong>
          </p>
          {summary.top_pages?.length > 0 && (
            <>
              <h4>Top pages</h4>
              <ul>
                {summary.top_pages.map((t) => (
                  <li key={t.path}>
                    {t.path} — {t.views} view{t.views === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </>
          )}
          {summary.recent_sessions?.length > 0 && (
            <>
              <h4>Recent sessions</h4>
              <ul>
                {summary.recent_sessions.map((s, i) => (
                  <li key={i}>
                    {fmtWhen(s.started_at)} — {whoLabel(s)} · {whereLabel(s)} ·{' '}
                    {s.page_count} page{s.page_count === 1 ? '' : 's'} ·{' '}
                    {fmtDuration(s.started_at, s.last_seen_at)}
                    {visitsLabel(s)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
