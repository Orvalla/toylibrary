import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// Support inbox for the admin page (migration 0041): bug
// reports and feature suggestions filed from the footer
// link. Screenshots sit in a private bucket — the "View
// screenshot" button mints a short-lived signed URL on
// demand. Reads and actions run through admin-gated RPCs.

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

export default function SupportInbox() {
  const [reports, setReports] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('support_list')
    if (err) setError(err.message)
    else setReports(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function viewScreenshot(path) {
    const { data } = await supabase.storage
      .from('support-shots')
      .createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function setStatus(r, status) {
    const { error: err } = await supabase.rpc('support_set_status', {
      p_id: r.id,
      p_status: status,
    })
    if (err) setError(err.message)
    else load()
  }

  async function remove(r) {
    const { error: err } = await supabase.rpc('support_delete', { p_id: r.id })
    if (err) {
      setError(err.message)
      return
    }
    if (r.screenshot_path) {
      await supabase.storage.from('support-shots').remove([r.screenshot_path])
    }
    load()
  }

  const open = reports.filter((r) => r.status === 'new')

  return (
    <section className="card">
      <h2>📬 Support inbox</h2>
      <p className="muted">
        Bug reports and feature suggestions from the footer Support link.
        Bug reports carry a screenshot of the page as it looked when the
        link was clicked.
      </p>
      {error && <p className="error">{error}</p>}
      {reports.length === 0 && <p className="muted">Nothing here yet.</p>}
      {reports.map((r) => (
        <article key={r.id} className="support-report">
          <p>
            <strong>{r.kind === 'bug' ? '🐛 Bug' : '💡 Feature'}</strong> ·{' '}
            {fmtWhen(r.created_at)} ·{' '}
            {r.email ?? (r.signed_in ? 'signed-in parent' : 'guest')}
            {r.status === 'done' ? ' · ✅ done' : ''}
          </p>
          <p>{r.message}</p>
          <p className="muted">
            {r.page_url && (
              <>
                Page: <a href={r.page_url}>{r.page_url}</a>{' '}
              </>
            )}
            {r.screenshot_path && (
              <button type="button" onClick={() => viewScreenshot(r.screenshot_path)}>
                🖼️ View screenshot
              </button>
            )}{' '}
            {r.status === 'new' ? (
              <button type="button" onClick={() => setStatus(r, 'done')}>
                Mark done
              </button>
            ) : (
              <button type="button" onClick={() => setStatus(r, 'new')}>
                Reopen
              </button>
            )}{' '}
            <button type="button" onClick={() => remove(r)}>
              Delete
            </button>
          </p>
        </article>
      ))}
      {open.length === 0 && reports.length > 0 && (
        <p className="muted">All caught up 🎉</p>
      )}
    </section>
  )
}
