// send-subscriber-confirmation — the double opt-in email for gift-list
// subscribers (migration 0058).
//
// The share page calls this right after subscribe_gift_list() accepts a
// signup. It is anonymous, so it must be useless as a mail cannon:
//   • it only ever mails an address that has an UNCONFIRMED signup on
//     that family's list (created through the rate-limited RPC);
//   • next_subscriber_confirmation() allows one mail per 10 minutes and
//     three per 24 hours for each such signup;
//   • the answer is always { ok: true }, whether or not a mail went
//     out, so it can't be used to probe which addresses are signed up.
//
// The confirm link opens /confirm?t=<token> on the main site, which calls
// the confirm_gift_subscriber RPC. Sends go through Resend like the
// reminder emails; without RESEND_API_KEY nothing is sent.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('REMINDER_FROM') ?? 'Toy Library <reminders@toylibrary.store>'
const SITE = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://toylibrary.store'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  try {
    let body: any = null
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Send JSON.' }, 400)
    }
    const slug = typeof body?.slug === 'string' ? body.slug.slice(0, 80) : ''
    const email = typeof body?.email === 'string' ? body.email.trim().slice(0, 254) : ''
    if (!slug || !email) return json({ ok: true })

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin.rpc('next_subscriber_confirmation', {
      p_slug: slug,
      p_email: email,
    })
    if (error) {
      console.error('next_subscriber_confirmation failed', error.message)
      return json({ ok: true })
    }
    if (!data?.token || !RESEND_API_KEY) return json({ ok: true })

    const owner = String(data.owner_name ?? 'a family')
    const link = `${SITE}/confirm?t=${encodeURIComponent(String(data.token))}`
    const text = [
      'Hi there,',
      '',
      `Someone (hopefully you) asked for a heads-up before the big days on ${owner}'s Toy Library wishlist.`,
      'Confirm that address and we will start sending them:',
      link,
      '',
      "If that wasn't you, ignore this email — nothing will be sent.",
      '',
      '— Toy Library',
    ].join('\n')
    const html = [
      'Hi there,',
      '',
      `Someone (hopefully you) asked for a heads-up before the big days on ${esc(owner)}'s Toy Library wishlist.`,
      'Confirm that address and we will start sending them:',
      `<a href="${esc(link)}">${esc(link)}</a>`,
      '',
      "If that wasn't you, ignore this email — nothing will be sent.",
      '',
      '— Toy Library',
    ].join('<br>')

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email.toLowerCase()],
        subject: 'Confirm your Toy Library wishlist reminders',
        text,
        html,
      }),
    })
    if (!res.ok) console.error('resend failed', res.status, await res.text())
    return json({ ok: true })
  } catch (e) {
    console.error('send-subscriber-confirmation error', e)
    return json({ ok: true })
  }
})
