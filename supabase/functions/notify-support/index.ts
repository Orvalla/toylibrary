// notify-support — email each new support report to
// support@toylibrary.store so a ticket can be worked from a
// mail app, not only from the admin inbox.
//
// Called by the support widget right after it files a report
// (the report itself is inserted by the client under the
// 0041 INSERT-only policy — this function never creates
// reports). Body: { report_id }
//
// Guarantees exactly one email per report:
//   - the row must exist and be fresh (filed < 15 min ago),
//   - notified_at is claimed atomically before sending and
//     released again if Resend refuses, so a retry can send
//     but a repeat can never duplicate.
// The mail goes From support@ on the verified domain, with
// Reply-To set to the reporter's email when they gave one —
// hitting Reply answers the parent directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''

const SUPPORT_INBOX = 'support@toylibrary.store'
const FRESH_WINDOW_MS = 15 * 60 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON request body.' }, 400)
  }
  const reportId = typeof body?.report_id === 'string' ? body.report_id : ''
  if (!reportId) return json({ error: 'Missing report_id.' }, 400)
  if (!resendKey) return json({ ok: false, skipped: 'email not configured' })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: report, error } = await admin
    .from('support_reports')
    .select('id, created_at, email, kind, message, page_url, screenshot_path, user_id, notified_at')
    .eq('id', reportId)
    .maybeSingle()
  if (error) return json({ error: 'Could not load that report.' }, 500)
  if (!report) return json({ error: 'No such report.' }, 404)
  if (report.notified_at) return json({ ok: true, already_notified: true })
  if (Date.now() - new Date(report.created_at).getTime() > FRESH_WINDOW_MS) {
    return json({ ok: false, skipped: 'report is no longer fresh' })
  }

  // Claim the notification slot atomically — a second caller
  // racing us updates zero rows and backs off.
  const { data: claimed } = await admin
    .from('support_reports')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', reportId)
    .is('notified_at', null)
    .select('id')
  if (!claimed?.length) return json({ ok: true, already_notified: true })

  const isBug = report.kind === 'bug'
  const kindLabel = isBug ? '🐛 Bug report' : '💡 Feature suggestion'
  const fromLine = report.email
    ? `${report.email}${report.user_id ? ' (signed-in parent)' : ''}`
    : report.user_id
      ? 'A signed-in parent (no reply email given)'
      : 'Anonymous visitor (no reply email given)'
  const excerpt = report.message.replace(/\s+/g, ' ').slice(0, 60)
  const text = [
    `${kindLabel} — Toy Library support ticket`,
    '',
    `From: ${fromLine}`,
    `Page: ${report.page_url ?? '(not recorded)'}`,
    report.screenshot_path
      ? 'Screenshot: attached to the report — open it in the admin Support inbox.'
      : 'Screenshot: none.',
    '',
    report.message,
    '',
    'Filed just now. Reply to this email to answer them (if they left an address),',
    'or work the ticket in the admin Support inbox: https://toylibrary.store/admin',
  ].join('\n')
  const html = [
    `<h2>${kindLabel} — new Toy Library support ticket</h2>`,
    `<p><strong>From:</strong> ${esc(fromLine)}<br>`,
    `<strong>Page:</strong> ${report.page_url ? `<a href="${esc(report.page_url)}">${esc(report.page_url)}</a>` : '(not recorded)'}<br>`,
    `<strong>Screenshot:</strong> ${report.screenshot_path ? 'attached to the report — open it in the admin Support inbox' : 'none'}</p>`,
    `<blockquote style="border-left:3px solid #FF5A5F;margin:0;padding:4px 12px;white-space:pre-wrap">${esc(report.message)}</blockquote>`,
    `<p>Reply to this email to answer them${report.email ? '' : ' — no reply address was left, so work it in the inbox instead'}.</p>`,
    `<p><a href="https://toylibrary.store/admin">Open the admin Support inbox</a></p>`,
  ].join('')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Toy Library Support <${SUPPORT_INBOX}>`,
        to: [SUPPORT_INBOX],
        ...(report.email ? { reply_to: report.email } : {}),
        subject: `${kindLabel} — ${excerpt}`,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`)
  } catch (err) {
    // Release the claim so the next ping can retry the send.
    await admin
      .from('support_reports')
      .update({ notified_at: null })
      .eq('id', reportId)
    console.error('notify-support send failed', err)
    return json({ error: 'Email send failed — a retry can re-send.' }, 502)
  }

  return json({ ok: true, notified: SUPPORT_INBOX })
})
