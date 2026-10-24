import { useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'

// Footer support link (owner request 2026-10-23): file a bug
// report or a feature suggestion. For a bug, clicking the
// link FIRST captures a screenshot of the page exactly as it
// looks at that moment — before this dialog opens over it —
// and attaches it to the report. Reports land in the admin
// inbox (migration 0041); screenshots live in a private
// bucket only the admin can open.
export default function SupportWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [shot, setShot] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const pageUrl = useRef('')

  async function handleOpen() {
    pageUrl.current = window.location.href
    setSent(false)
    setError('')
    setShot(null)
    setCapturing(true)
    let blob = null
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        scale: 0.6,
      })
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    } catch {
      blob = null // a report without a screenshot still helps
    }
    setCapturing(false)
    if (blob) setShot({ blob, url: URL.createObjectURL(blob) })
    setOpen(true)
  }

  async function submit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    setError('')
    let screenshotPath = null
    if (kind === 'bug' && shot?.blob) {
      const path = `${crypto.randomUUID()}.png`
      const { error: upErr } = await supabase.storage
        .from('support-shots')
        .upload(path, shot.blob, { contentType: 'image/png' })
      if (!upErr) screenshotPath = path
    }
    const { data: filed, error: insErr } = await supabase
      .from('support_reports')
      .insert({
        user_id: user?.id ?? null,
        email: email.trim() || user?.email || null,
        kind,
        message: message.trim(),
        page_url: pageUrl.current,
        screenshot_path: screenshotPath,
        user_agent: navigator.userAgent.slice(0, 300),
      })
      .select('id')
      .single()
    setSending(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    // Best-effort: also email the ticket to support@ so it
    // can be worked from a mail app. A failed ping never
    // un-files the report — it still sits in the admin inbox.
    if (filed?.id) {
      try {
        await supabase.functions.invoke('notify-support', {
          body: { report_id: filed.id },
        })
      } catch {
        // The admin inbox remains the source of truth.
      }
    }
    setSent(true)
    setMessage('')
  }

  return (
    <>
      <button type="button" className="footer-link" onClick={handleOpen} disabled={capturing}>
        {capturing ? 'Opening…' : 'Support'}
      </button>
      {open && (
        <div className="support-overlay" role="dialog" aria-modal="true" aria-label="Support">
          <div className="support-card">
            <button
              type="button"
              className="support-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
            {sent ? (
              <>
                <h3>Thanks — it's on its way 💌</h3>
                <p>
                  Your {kind === 'bug' ? 'bug report' : 'suggestion'} was filed and will be
                  read by a human (the site's owner).{' '}
                  {kind === 'bug' && shot
                    ? 'The screenshot of the page was attached.'
                    : ''}
                </p>
                <button type="button" className="btn" onClick={() => setOpen(false)}>
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={submit} className="form">
                <h3>Support</h3>
                <div className="tabs" aria-label="Kind of report">
                  <button
                    type="button"
                    className={kind === 'bug' ? 'active' : ''}
                    onClick={() => setKind('bug')}
                  >
                    🐛 Report a bug
                  </button>
                  <button
                    type="button"
                    className={kind === 'feature' ? 'active' : ''}
                    onClick={() => setKind('feature')}
                  >
                    💡 Suggest a feature
                  </button>
                </div>
                {kind === 'bug' &&
                  (shot ? (
                    <figure className="support-shot">
                      <img src={shot.url} alt="Screenshot of this page, taken just now" />
                      <figcaption>
                        We'll attach this screenshot of the page as it looked when you
                        clicked Support.
                      </figcaption>
                    </figure>
                  ) : (
                    <p className="muted">
                      We couldn't capture a screenshot of the page — your description
                      below matters even more.
                    </p>
                  ))}
                <label>
                  {kind === 'bug' ? 'What went wrong?' : 'What would you love to see?'}
                  <textarea
                    required
                    rows={5}
                    maxLength={4000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      kind === 'bug'
                        ? 'What did you tap, and what happened instead?'
                        : 'Tell us the idea — who is it for, and what would it make easier?'
                    }
                  />
                </label>
                <label>
                  Email (optional — only if you'd like a reply)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={user?.email ?? 'you@example.com'}
                  />
                </label>
                {error && <p className="error">{error}</p>}
                <button type="submit" className="btn" disabled={sending}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
