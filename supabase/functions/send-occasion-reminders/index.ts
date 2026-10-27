// Occasion reminder emails.
//
// A daily caller (GitHub Actions cron) hits this function with
// the shared REMINDER_CRON_SECRET header. For every family
// with reminders on and sharing enabled, it finds occasions
// whose next occurrence falls within the send window, and emails:
//
//   1. the account owner ONE digest covering all of them, and
//   2. each gift-circle relative (migration 0020) who has an
//      email and hasn't unsubscribed — one email covering the
//      occasions of the kids they're linked to (all the
//      family's kids when they have no specific links).
//   3. each gift-list subscriber (migration 0034) — a visitor
//      who left their email on the public list. Their signup's
//      scope decides the reach: one child, or the whole family
//      when the parent enabled family scope. An address that
//      already got the gift-circle email for an occasion isn't
//      sent a second copy as a subscriber.
//
// Every message carries the child's public wishlist link.
// Relatives' emails end with a token unsubscribe link
// (public.unsubscribe_relative RPC + the /unsubscribe page).
//
// Sends go through Resend (RESEND_API_KEY). Without that
// secret the function is dormant: it reports what WOULD be
// due and sends/logs nothing, so the whole pipeline can be
// verified before the mail account exists. Sent occasions are
// recorded in occasion_reminder_log — owner sends with a NULL
// relative_id, relative sends with theirs (partial unique
// indexes keep the two dedupe streams separate). `?dry=1`
// returns the composed digests without sending or logging.
//
// Send spread (2026-10-25): clustered occasions (Christmas
// above all) would otherwise fire every family's reminder on
// the single day the occasion enters the 14-day window. Each
// family instead has a stable slot (hash of the profile id,
// SPREAD_DAYS slots): a family's occasions become sendable at
// 17, 16, 15 or 14 days out depending on its slot, so a
// cluster spreads across four days while every reminder still
// lands at least 14 days ahead (the extra lead is deliberate
// insurance against holiday shipping delays). The spread is
// adaptive: it holds the peak day near 100 firing families, so
// once the sender count passes 400 the window gains a fifth
// day (sends start a day earlier), then a sixth past 500, and
// so on up to a 14-day spread — the last slot always lands
// exactly 14 days out, so nobody's reminder is ever later than
// two weeks ahead. All of a family's channels
// (owner digest, relatives, subscribers) share the slot, and
// the dedupe log still guarantees one send per recipient per
// occurrence — a missed day simply sends on the next run, and
// an occasion created inside the window sends immediately.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  esc,
  isSendableToday,
  nextOccurrence,
  spreadDaysFor,
  spreadSlot,
  windowDaysFor,
} from './dates.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET = Deno.env.get('REMINDER_CRON_SECRET') ?? ''
const FROM = Deno.env.get('REMINDER_FROM') ?? 'Toy Library <reminders@toylibrary.store>'
const SITE = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://toylibrary.store'
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

const dateKey = (d: Date) => d.toISOString().slice(0, 10)
const pretty = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
const when = (daysAway: number) =>
  daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`
const entryLine = (e: any) =>
  `• ${e.kid.name} — ${e.occasion.label}, ${pretty(e.date)} (${when(e.daysAway)}${e.daysAway === 0 ? '!' : ''})`

async function sendViaResend(to: string, subject: string, text: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  })
  if (!res.ok) {
    console.error('resend failed', res.status, await res.text())
    return false
  }
  return true
}

// Read a whole table (or filtered slice) in pages of 1,000, in a
// stable order so no row is skipped or repeated between pages.
async function fetchAll(
  admin: ReturnType<typeof createClient>,
  table: string,
  columns: string,
  orderBy: string[],
  filter?: (query: any) => any,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let query: any = admin.from(table).select(columns)
    if (filter) query = filter(query)
    for (const column of orderBy) query = query.order(column)
    const { data, error } = await query.range(from, from + 999)
    if (error) throw new Error(`read ${table} failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
      return json({ error: 'Missing or wrong cron secret.' }, 401)
    }
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // PostgREST caps every response at 1,000 rows (supabase/config.toml
    // max_rows). Unpaged reads here used to truncate silently — and a
    // truncated dedupe log means the same email goes out again every
    // day — so every table is read page by page, and a failed read
    // aborts the run instead of looking like "no rows".
    const today = new Date()
    const logSince = dateKey(new Date(today.getTime() - 2 * 86400000))
    const [profiles, children, occasions, sent, relatives, relLinks, subscribers] =
      await Promise.all([
        fetchAll(admin, 'profiles', 'id, display_name, share_slug, share_enabled, occasion_reminders', ['id']),
        fetchAll(admin, 'children', 'id, owner_id, name', ['id']),
        fetchAll(admin, 'occasions', 'id, child_id, label, month, day', ['id']),
        // Only recent occurrences can still matter for dedupe.
        fetchAll(
          admin,
          'occasion_reminder_log',
          'occasion_id, occurrence_date, relative_id, subscriber_id',
          ['id'],
          (q: any) => q.gte('occurrence_date', logSince),
        ),
        fetchAll(admin, 'relatives', 'id, owner_id, name, email, notify_email, unsubscribe_token', ['id']),
        fetchAll(admin, 'relative_children', 'relative_id, child_id', ['relative_id', 'child_id']),
        fetchAll(admin, 'gift_subscribers', 'id, profile_id, child_id, email, scope, unsubscribe_token', ['id']),
      ])

    // Two dedupe streams: owner digests (relative_id NULL) and
    // per-relative emails.
    const ownerSent = new Set(
      sent.filter((r: any) => !r.relative_id).map((r: any) => `${r.occasion_id}|${r.occurrence_date}`)
    )
    const relativeSent = new Set(
      sent
        .filter((r: any) => r.relative_id)
        .map((r: any) => `${r.occasion_id}|${r.occurrence_date}|${r.relative_id}`)
    )
    const kidById = new Map(children.map((c: any) => [c.id, c]))
    const linksByRelative = new Map<string, Set<string>>()
    for (const row of relLinks) {
      const set = linksByRelative.get(row.relative_id) ?? new Set<string>()
      set.add(row.child_id)
      linksByRelative.set(row.relative_id, set)
    }
    const relativesByOwner = new Map<string, any[]>()
    for (const rel of relatives) {
      relativesByOwner.set(rel.owner_id, [...(relativesByOwner.get(rel.owner_id) ?? []), rel])
    }
    const subscriberSent = new Set(
      sent
        .filter((r: any) => r.subscriber_id)
        .map((r: any) => `${r.occasion_id}|${r.occurrence_date}|${r.subscriber_id}`)
    )
    const subscribersByProfile = new Map<string, any[]>()
    for (const sub of subscribers) {
      subscribersByProfile.set(sub.profile_id, [
        ...(subscribersByProfile.get(sub.profile_id) ?? []),
        sub,
      ])
    }

    // Adaptive spread (see dates.js): one slot day per 100 senders
    // beyond the base, and the last slot always lands exactly 14 days
    // before the occasion.
    const senderCount = profiles.filter((p: any) => p.occasion_reminders && p.share_enabled).length
    const spreadDays = spreadDaysFor(senderCount)
    const windowDays = windowDaysFor(spreadDays)

    const now = new Date()
    const horizon = new Date(now.getTime() + windowDays * 86400000)
    // Calendar-day distance (UTC midnights), so daysAway is the
    // exact number of days until the occasion — the send-spread
    // thresholds below are written in those terms.
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

    // profile id -> [{ occasion, kid, date, daysAway }] — all
    // due entries; unsent filtering happens per recipient below.
    const due = new Map<string, any[]>()
    for (const occ of occasions) {
      const kid = kidById.get(occ.child_id)
      if (!kid) continue
      const date = nextOccurrence(occ.month, occ.day, now)
      if (date > horizon) continue
      const daysAway = Math.round((date.getTime() - startOfToday) / 86400000)
      const entry = { occasion: occ, kid, date, daysAway }
      due.set(kid.owner_id, [...(due.get(kid.owner_id) ?? []), entry])
    }

    const digests: any[] = []
    let sentCount = 0
    for (const profile of profiles) {
      // Send spread: only occasions at or inside this family's
      // slot threshold are sendable today (see header). The
      // per-recipient dedupe below does the rest.
      const slot = spreadSlot(profile.id, spreadDays)
      const allEntries = (due.get(profile.id) ?? []).filter((e: any) =>
        isSendableToday(e.daysAway, windowDays, slot),
      )
      if (!allEntries.length) continue
      if (!profile.occasion_reminders || !profile.share_enabled) continue
      const link = `https://${profile.share_slug}.toylibrary.store`
      const ownerName = profile.display_name || 'A Toy Library parent'

      // ------------------------------------------ owner digest
      const entries = allEntries
        .filter((e) => !ownerSent.has(`${e.occasion.id}|${dateKey(e.date)}`))
        .sort((a: any, b: any) => a.date - b.date)
      if (entries.length) {
        const lines = entries.map(entryLine)
        const htmlLines = entries.map((e: any) => esc(entryLine(e)))
        const text = [
          `Hi ${profile.display_name || 'there'},`,
          '',
          'A gift occasion is coming up:',
          ...lines,
          '',
          'Share the wishlist before family starts shopping:',
          link,
          '',
          'Anyone with the link can see the wishlist and claim a gift, so nothing gets bought twice.',
          '',
          '— Toy Library',
          '(You can turn these reminders off in Settings.)',
        ].join('\n')
        const html = `<div style="font-family:system-ui,sans-serif;color:#2E2A55;max-width:560px">
        <h2 style="margin:0 0 8px">A gift occasion is coming up 🎁</h2>
        <p style="margin:0 0 12px">${htmlLines.join('<br>')}</p>
        <p style="margin:0 0 16px">Share the wishlist before family starts shopping:</p>
        <p style="margin:0 0 16px"><a href="${link}" style="background:#FF5A5F;color:#fff;padding:11px 22px;border-radius:999px;text-decoration:none;font-weight:700">Open the wishlist</a></p>
        <p style="color:#6f6a94;font-size:13px">Anyone with the link can claim a gift so nothing gets bought twice. Turn these reminders off any time in Settings.</p>
      </div>`
        const subject =
          entries.length === 1
            ? `🎁 ${entries[0].kid.name}'s ${entries[0].occasion.label} is ${when(entries[0].daysAway)} — share the wishlist`
            : `🎁 ${entries.length} gift occasions coming up — share the wishlist`

        if (dry || !RESEND_API_KEY) {
          digests.push({ channel: 'owner', profile: profile.id, subject, entries: entries.length, link })
        } else {
          const { data: userData } = await admin.auth.admin.getUserById(profile.id)
          const email = userData?.user?.email
          if (email && (await sendViaResend(email, subject, text, html))) {
            sentCount += 1
            await admin.from('occasion_reminder_log').insert(
              entries.map((e: any) => ({
                profile_id: profile.id,
                occasion_id: e.occasion.id,
                occurrence_date: dateKey(e.date),
              }))
            )
          }
        }
      }

      // --------------------------------------- relative emails
      const emailedEmails = new Set<string>()
      for (const rel of relativesByOwner.get(profile.id) ?? []) {
        if (!rel.email || !rel.notify_email) continue
        const linked = linksByRelative.get(rel.id)
        const relEntries = allEntries
          .filter((e) => !linked || linked.has(e.kid.id))
          .filter((e) => !relativeSent.has(`${e.occasion.id}|${dateKey(e.date)}|${rel.id}`))
          .sort((a: any, b: any) => a.date - b.date)
        if (!relEntries.length) continue
        const lines = relEntries.map(entryLine)
        const htmlLines = relEntries.map((e: any) => esc(entryLine(e)))
        const unsub = `${SITE}/unsubscribe?t=${rel.unsubscribe_token}`
        const text = [
          `Hi ${rel.name},`,
          '',
          `${ownerName} shares the kids' wishlists on Toy Library so family never buys the same gift twice. Coming up:`,
          ...lines,
          '',
          'See the wishlist — and claim anything you buy, so it is marked as taken for everyone else:',
          link,
          '',
          '— Toy Library',
          `You are getting this because ${ownerName} added you to their gift circle. Don't want these emails? Unsubscribe: ${unsub}`,
        ].join('\n')
        const html = `<div style="font-family:system-ui,sans-serif;color:#2E2A55;max-width:560px">
        <h2 style="margin:0 0 8px">A gift occasion is coming up 🎁</h2>
        <p style="margin:0 0 12px">${esc(ownerName)} shares the kids' wishlists on Toy Library so family never buys the same gift twice. Coming up:</p>
        <p style="margin:0 0 12px">${htmlLines.join('<br>')}</p>
        <p style="margin:0 0 16px"><a href="${link}" style="background:#FF5A5F;color:#fff;padding:11px 22px;border-radius:999px;text-decoration:none;font-weight:700">Open the wishlist</a></p>
        <p style="color:#6f6a94;font-size:13px">Claim anything you buy on the list and it is marked as taken for everyone else. You are getting this because ${esc(ownerName)} added you to their gift circle. <a href="${unsub}">Unsubscribe</a>.</p>
      </div>`
        const subject =
          relEntries.length === 1
            ? `🎁 ${relEntries[0].kid.name}'s ${relEntries[0].occasion.label} is ${when(relEntries[0].daysAway)} — here's the wishlist`
            : `🎁 ${relEntries.length} gift occasions coming up — here are the wishlists`

        emailedEmails.add(rel.email.toLowerCase())
        if (dry || !RESEND_API_KEY) {
          digests.push({
            channel: 'relative',
            profile: profile.id,
            relative: rel.name,
            subject,
            entries: relEntries.length,
            link,
          })
          continue
        }
        if (await sendViaResend(rel.email, subject, text, html)) {
          emailedEmails.add(rel.email.toLowerCase())
          sentCount += 1
          await admin.from('occasion_reminder_log').insert(
            relEntries.map((e: any) => ({
              profile_id: profile.id,
              occasion_id: e.occasion.id,
              occurrence_date: dateKey(e.date),
              relative_id: rel.id,
            }))
          )
        }
      }

      // ------------------------------------- subscriber emails
      for (const sub of subscribersByProfile.get(profile.id) ?? []) {
        const subEntries = allEntries
          .filter((e) => sub.scope === 'family' || sub.child_id === e.kid.id)
          .filter((e) => !subscriberSent.has(`${e.occasion.id}|${dateKey(e.date)}|${sub.id}`))
          .sort((a: any, b: any) => a.date - b.date)
        if (!subEntries.length) continue
        // One copy per address per occasion: if the gift-circle
        // email already went to this address, skip the duplicate.
        if (emailedEmails.has(sub.email.toLowerCase())) continue
        const lines = subEntries.map(entryLine)
        const htmlLines = subEntries.map((e: any) => esc(entryLine(e)))
        const unsub = `${SITE}/unsubscribe?t=${sub.unsubscribe_token}`
        const text = [
          'Hi there,',
          '',
          `You asked for a heads-up before the big days on ${ownerName}'s Toy Library wishlist. Coming up:`,
          ...lines,
          '',
          'See the wishlist — and claim anything you buy, so it is marked as taken for everyone else:',
          link,
          '',
          '— Toy Library',
          `Don't want these emails? Unsubscribe: ${unsub}`,
        ].join('\n')
        const html = `<div style="font-family:system-ui,sans-serif;color:#2E2A55;max-width:560px">
        <h2 style="margin:0 0 8px">A gift occasion is coming up 🎁</h2>
        <p style="margin:0 0 12px">You asked for a heads-up before the big days on ${esc(ownerName)}'s Toy Library wishlist. Coming up:</p>
        <p style="margin:0 0 12px">${htmlLines.join('<br>')}</p>
        <p style="margin:0 0 16px"><a href="${link}" style="background:#FF5A5F;color:#fff;padding:11px 22px;border-radius:999px;text-decoration:none;font-weight:700">Open the wishlist</a></p>
        <p style="color:#6f6a94;font-size:13px">Claim anything you buy on the list and it is marked as taken for everyone else. <a href="${unsub}">Unsubscribe</a>.</p>
      </div>`
        const subject =
          subEntries.length === 1
            ? `🎁 ${subEntries[0].kid.name}'s ${subEntries[0].occasion.label} is ${when(subEntries[0].daysAway)} — here's the wishlist`
            : `🎁 ${subEntries.length} gift occasions coming up — here are the wishlists`

        if (dry || !RESEND_API_KEY) {
          digests.push({
            channel: 'subscriber',
            profile: profile.id,
            subject,
            entries: subEntries.length,
            link,
          })
          emailedEmails.add(sub.email.toLowerCase())
          continue
        }
        if (await sendViaResend(sub.email, subject, text, html)) {
          emailedEmails.add(sub.email.toLowerCase())
          sentCount += 1
          await admin.from('occasion_reminder_log').insert(
            subEntries.map((e: any) => ({
              profile_id: profile.id,
              occasion_id: e.occasion.id,
              occurrence_date: dateKey(e.date),
              subscriber_id: sub.id,
            }))
          )
        }
      }
    }

    return json({
      configured: Boolean(RESEND_API_KEY),
      dry,
      spread: { senderCount, spreadDays, windowDays },
      dueProfiles: digests.length,
      sent: sentCount,
      digests,
    })
  } catch (e) {
    console.error('send-occasion-reminders failed', e)
    return json({ error: 'Reminder run failed — see function logs.' }, 500)
  }
})
