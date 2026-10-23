import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { platformLabel } from '../lib/platforms'

// Site admin (migration 0031): the owner's moderation desk for
// the user-grown catalog. Everything here runs through
// SECURITY DEFINER RPCs that check profiles.is_admin server-side
// — a non-admin account gets an error from every call and sees
// the "owner only" note instead of data.
//
//   * the addition log: who added what catalog row, when;
//   * one-click Remove (deletes the catalog row; families' own
//     list copies are separate rows and are untouched);
//   * Make private: the row leaves everyone else's catalog but
//     stays in the adder's;
//   * review queue: when the content screen blocks an add, all
//     of that account's additions are flagged needs_review and
//     the attempt lands in the flags list below.

function fmtDate(iso) {
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

export default function AdminPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [flags, setFlags] = useState([])
  const [denied, setDenied] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const [additions, flagRows] = await Promise.all([
      supabase.rpc('admin_additions', {
        p_limit: 200,
        p_offset: 0,
        p_flagged_only: flaggedOnly,
      }),
      supabase.rpc('admin_flags'),
    ])
    if (additions.error) {
      setDenied(true)
      setRows([])
      return
    }
    setRows(additions.data ?? [])
    if (!flagRows.error) setFlags(flagRows.data ?? [])
  }, [flaggedOnly])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  async function act(key, fn, done) {
    setBusy(key)
    setMessage('')
    const { error } = await fn()
    setBusy('')
    if (error) {
      setMessage(`That didn't save: ${error.message}`)
      return
    }
    if (done) done()
    load()
  }

  if (!user) return null
  if (denied) {
    return (
      <main className="page narrow">
        <h1>Site admin</h1>
        <p>This page is for the site owner only.</p>
      </main>
    )
  }

  const openFlags = flags.filter((f) => !f.resolved_at)

  return (
    <main className="page">
      <h1>🛡️ Site admin</h1>
      <p className="muted">
        Every catalog row a parent added, newest first. Remove takes the row out of
        the catalog for everyone (their own lists keep their copies). Private keeps
        it in the adder's catalog only.
      </p>

      {openFlags.length > 0 && (
        <section className="card">
          <h2>🚩 Flagged attempts</h2>
          <p className="muted">
            The content screen blocked these adds — and flagged everything those
            accounts ever added for review below.
          </p>
          <ul className="admin-list">
            {openFlags.map((f) => (
              <li key={f.flag_id}>
                <div>
                  <strong>{f.user_name || 'A parent'}</strong>{' '}
                  <span className="muted">· {fmtDate(f.created_at)}</span>
                  <br />
                  <span>{f.detail}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy === f.flag_id}
                  onClick={() =>
                    act(
                      f.flag_id,
                      () => supabase.rpc('admin_clear_user_review', { p_user_id: f.user_id }),
                      () => setMessage('Cleared — their additions left the review queue.'),
                    )
                  }
                >
                  Mark {f.user_name || 'them'} reviewed
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Catalog additions</h2>
        <label className="checkline">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
          />{' '}
          Needs review only
        </label>
        {rows === null && <p>Loading…</p>}
        {rows !== null && rows.length === 0 && (
          <p className="muted">Nothing here{flaggedOnly ? ' needs review' : ' yet'}.</p>
        )}
        <ul className="admin-list">
          {(rows ?? []).map((r) => (
            <li key={r.addition_id}>
              {r.image_url ? (
                <img className="admin-thumb" src={r.image_url} alt="" loading="lazy" />
              ) : (
                <span className="admin-thumb admin-thumb-empty" aria-hidden="true">🧸</span>
              )}
              <div className="admin-main">
                <strong>{r.title}</strong>{' '}
                <span className="muted">
                  · {platformLabel(r.platform)} · added by {r.user_name || 'a parent'} ·{' '}
                  {fmtDate(r.created_at)}
                </span>
                <br />
                {r.needs_review && <span className="badge badge-flag">🚩 needs review</span>}
                {r.hidden && <span className="badge">🔒 private</span>}
                {r.item_gone && <span className="badge">removed from catalog</span>}
                {r.source_url && (
                  <a href={r.source_url} target="_blank" rel="noopener" className="muted">
                    source ↗
                  </a>
                )}
              </div>
              {!r.item_gone && r.catalog_item_id && (
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy === r.addition_id}
                    onClick={() =>
                      act(
                        r.addition_id,
                        () =>
                          supabase.rpc('admin_set_catalog_private', {
                            p_item_id: r.catalog_item_id,
                            p_private: !r.hidden,
                          }),
                        () => setMessage(r.hidden ? 'Back in the shared catalog.' : 'Made private.'),
                      )
                    }
                  >
                    {r.hidden ? 'Make public' : 'Make private'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={busy === r.addition_id}
                    onClick={() => {
                      if (!window.confirm(`Remove "${r.title}" from the catalog for everyone?`)) return
                      act(
                        r.addition_id,
                        () => supabase.rpc('admin_remove_catalog_item', { p_item_id: r.catalog_item_id }),
                        () => setMessage('Removed from the catalog.'),
                      )
                    }}
                  >
                    Remove
                  </button>
                  {r.needs_review && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy === r.addition_id}
                      onClick={() =>
                        act(
                          r.addition_id,
                          () =>
                            supabase.rpc('admin_set_addition_review', {
                              p_addition_id: r.addition_id,
                              p_needs_review: false,
                            }),
                          () => setMessage('Cleared from the review queue.'),
                        )
                      }
                    >
                      Reviewed ✓
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {message && <p className="notice">{message}</p>}
      </section>
    </main>
  )
}
