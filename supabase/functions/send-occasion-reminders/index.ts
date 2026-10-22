// Occasion reminder emails.
//
// A daily caller (GitHub Actions cron) hits this function with
// the shared REMINDER_CRON_SECRET header. For every family
// with reminders on and sharing enabled, it finds occasions
// whose next occurrence falls within 14 days, and emails the
// account owner ONE message covering all of them — each with
// the child's public wishlist link, ready to forward to
// grandparents and family before they shop.
//
// Sends go through Resend (RESEND_API_KEY). Without that
// secret the function is dormant: it reports what WOULD be
// due and sends/logs nothing, so the whole pipeline can be
// verified before the mail account exists. Sent occasions are
// recorded in occasion_reminder_log (unique per occurrence)
// so nobody gets the same reminder twice. `?dry=1` returns the
// composed digests without sending or logging.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET = Deno.env.get('REMINDER_CRON_SECRET') ?? ''
const FROM = Deno.env.get('REMINDER_FROM') ?? 'Toy Library <reminders@toylibrary.store>'
const SITE = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://toylibrary.store'
const WINDOW_DAYS = 14

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Next occurrence of a month/day on or after `from` (local
// dates as UTC to keep it timezone-simple), Feb 29 → Feb 28.
function nextOccurrence(month: number, day: number, from: Date): Date {
  const y = from.getUTCFullYear()
  const clamped = month === 2 && day === 29 ? 28 : day
  let d = new Date(Date.UTC(y, month - 1, clamped))
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  if (d < start) d = new Date(Date.UTC(y + 1, month - 1, clamped))
  return d
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10)
const pretty = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
      return json({ error: 'Missing or wrong cron secret.' }, 401)
    }
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const [{ data: profiles }, { data: children }, { data: occasions }, { data: sent }] =
      await Promise.all([
        admin.from('profiles').select('id, display_name, share_slug, share_enabled, occasion_reminders'),
        admin.from('children').select('id, owner_id, name'),
        admin.from('occasions').select('id, child_id, label, month, day'),
        admin.from('occasion_reminder_log').select('occasion_id, occurrence_date'),
      ])
    const sentKeys = new Set((sent ?? []).map((r: any) => `${r.occasion_id}|${r.occurrence_date}`))
    const kidById = new Map((children ?? []).map((c: any) => [c.id, c]))
    const now = new Date()
    const horizon = new Date(now.getTime() + WINDOW_DAYS * 86400000)

    // profile id -> [{ occasion, kid, date, daysAway }]
    const due = new Map<string, any[]>()
    for (const occ of occasions ?? []) {
      const kid = kidById.get(occ.child_id)
      if (!kid) continue
      const date = nextOccurrence(occ.month, occ.day, now)
      if (date > horizon) continue
      if (sentKeys.has(`${occ.id}|${dateKey(date)}`)) continue
      const daysAway = Math.round((date.getTime() - now.getTime()) / 86400000)
      const entry = { occasion: occ, kid, date, daysAway }
      due.set(kid.owner_id, [...(due.get(kid.owner_id) ?? []), entry])
    }

    const digests: any[] = []
    let sentCount = 0
    for (const profile of profiles ?? []) {
      const entries = due.get(profile.id)
      if (!entries?.length) continue
      if (!profile.occasion_reminders || !profile.share_enabled) continue
      entries.sort((a, b) => a.date - b.date)
      const link = `${SITE}/s/${profile.share_slug}`
      const lines = entries.map(
        (e) =>
          `• ${e.kid.name} — ${e.occasion.label}, ${pretty(e.date)} (${e.daysAway === 0 ? 'today!' : e.daysAway === 1 ? 'tomorrow' : `in ${e.daysAway} days`})`
      )
      const text = [
        `Hi ${profile.display_name || 'there'},`,
        '',
        'A gift occasion is coming up:',
        ...lines,
        '',
        `Share ${entries.length > 1 ? 'the wishlist' : "the wishlist"} before family starts shopping:`,
        link,
        '',
        'Anyone with the link can see the wishlist and claim a gift, so nothing gets bought twice.',
        '',
        '— Toy Library',
        '(You can turn these reminders off in Settings.)',
      ].join('\n')
      const html = `<div style="font-family:system-ui,sans-serif;color:#2E2A55;max-width:560px">
        <h2 style="margin:0 0 8px">A gift occasion is coming up 🎁</h2>
        <p style="margin:0 0 12px">${lines.join('<br>')}</p>
        <p style="margin:0 0 16px">Share the wishlist before family starts shopping:</p>
        <p style="margin:0 0 16px"><a href="${link}" style="background:#FF5A5F;color:#fff;padding:11px 22px;border-radius:999px;text-decoration:none;font-weight:700">Open the wishlist</a></p>
        <p style="color:#6f6a94;font-size:13px">Anyone with the link can claim a gift so nothing gets bought twice. Turn these reminders off any time in Settings.</p>
      </div>`
      const subject =
        entries.length === 1
          ? `🎁 ${entries[0].kid.name}'s ${entries[0].occasion.label} is ${entries[0].daysAway === 0 ? 'today' : entries[0].daysAway === 1 ? 'tomorrow' : `in ${entries[0].daysAway} days`} — share the wishlist`
          : `🎁 ${entries.length} gift occasions coming up — share the wishlist`

      if (dry || !RESEND_API_KEY) {
        digests.push({ profile: profile.id, subject, entries: entries.length, link })
        continue
      }
      const { data: userData } = await admin.auth.admin.getUserById(profile.id)
      const email = userData?.user?.email
      if (!email) continue
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [email], subject, text, html }),
      })
      if (!res.ok) {
        console.error('resend failed', profile.id, res.status, await res.text())
        continue
      }
      sentCount += 1
      await admin.from('occasion_reminder_log').insert(
        entries.map((e) => ({
          profile_id: profile.id,
          occasion_id: e.occasion.id,
          occurrence_date: dateKey(e.date),
        }))
      )
    }

    return json({
      configured: Boolean(RESEND_API_KEY),
      dry,
      dueProfiles: digests.length,
      sent: sentCount,
      digests,
    })
  } catch (e) {
    console.error('send-occasion-reminders failed', e)
    return json({ error: 'Reminder run failed — see function logs.' }, 500)
  }
})
