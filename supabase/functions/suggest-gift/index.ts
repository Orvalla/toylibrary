// suggest-gift — gift proposals from the public share page.
//
// A gift-giver who finds the wishlist lacking can propose an
// off-list gift by pasting a product link. The proposal lands
// in the parents' dashboard inbox as 'pending'; only an
// approved proposal is shown to other gift-givers (via the
// get_shared_proposals RPC), so two grandparents can't both
// quietly buy the same tricycle.
//
// Modes (all public — the share slug is the capability, the
// same trust model as anonymous claiming):
//   { mode: 'suggest', slug, url, title?, name?, note?, child_id? }
//       Fetch the link (SSRF-guarded), read its product facts,
//       and record a pending proposal. The suggester gets a
//       one-time token (only its SHA-256 hash is stored) to
//       recognise and withdraw their proposal from this browser.
//       A link that's already pending/approved for this family
//       is reported, not duplicated. Best-effort: the parents
//       get an email via Resend when one's configured.
//   { mode: 'mine', slug, tokens } — this browser's proposals
//       and their statuses.
//   { mode: 'withdraw', slug, id, token } — withdraw a pending
//       proposal (token must match).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  cleanText,
  extractProductFacts,
  isBlockedHost,
  isBlockedTitle,
  isSafeFetchUrl,
  normalizeGiftUrl,
} from './extract.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

const UA = 'ToyLibraryIngestor/1.0 (gift suggestions for Toy Library)'
const FETCH_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
// One family's daily intake cap — generous for grandparents,
// useless for spam.
const DAILY_CAP = 30

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

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Fetch a URL's text with the safety rails applied (same shape
// as ingest-catalog): redirects re-validated hop by hop, body
// capped, upstream failures become plain 502s.
async function fetchTextCapped(startUrl: string): Promise<string> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response
    try {
      res = await fetch(current, {
        headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      throw new HttpError(502, "That page didn't respond — check the link and try again.")
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      await res.body?.cancel()
      if (!location || hop === MAX_REDIRECTS) {
        throw new HttpError(502, 'That link redirects too many times to follow safely.')
      }
      const next = new URL(location, current).toString()
      if (!isSafeFetchUrl(next)) {
        throw new HttpError(400, "That link redirects somewhere we can't follow.")
      }
      current = next
      continue
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new HttpError(502, `That page returned an error (HTTP ${res.status}).`)
    }
    if (!res.body) return ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new HttpError(502, 'That page is too large to read.')
      }
    }
    return text
  }
  throw new HttpError(502, 'That link redirects too many times to follow safely.')
}

async function profileForSlug(
  admin: ReturnType<typeof createClient>,
  slug: string,
): Promise<{ id: string; display_name: string | null; child_name: string | null }> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, display_name, child_name')
    .eq('share_slug', slug)
    .eq('share_enabled', true)
    .maybeSingle()
  if (error) throw new HttpError(500, 'Something went wrong — try again.')
  if (!data) throw new HttpError(404, "That share link isn't available.")
  return data as { id: string; display_name: string | null; child_name: string | null }
}

async function childrenOf(
  admin: ReturnType<typeof createClient>,
  ownerId: string,
): Promise<Map<string, string>> {
  const { data } = await admin.from('children').select('id, name').eq('owner_id', ownerId)
  return new Map((data ?? []).map((c: any) => [c.id as string, c.name as string]))
}

// Best-effort heads-up to the parents — a proposal nobody hears
// about waits forever. Uses the same verified sending domain as
// the occasion reminders; silently skipped when no key is set.
async function notifyParents(
  admin: ReturnType<typeof createClient>,
  profile: { id: string },
  proposal: { title: string; suggester_name: string; note: string },
  childName: string | null,
): Promise<void> {
  if (!RESEND_API_KEY) return
  try {
    const { data } = await admin.auth.admin.getUserById(profile.id)
    const email = data?.user?.email
    if (!email) return
    const who = proposal.suggester_name || 'Someone'
    const forWhom = childName ? ` for ${childName}` : ''
    const esc = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Toy Library <reminders@toylibrary.store>',
        to: [email],
        subject: `🎁 ${who} suggested a gift${forWhom}: ${proposal.title}`,
        html: [
          `<p><strong>${esc(who)}</strong> suggested a gift${forWhom}:</p>`,
          `<p style="font-size:18px"><strong>${esc(proposal.title)}</strong></p>`,
          proposal.note ? `<p>“${esc(proposal.note)}”</p>` : '',
          `<p>Approve or deny it in your dashboard — approved suggestions are shown to other gift-givers so nobody buys the same gift twice.</p>`,
          `<p><a href="https://toylibrary.store/dashboard">Review the suggestion</a></p>`,
        ].join(''),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    // A failed notification never fails the proposal.
  }
}

async function handleSuggest(admin: ReturnType<typeof createClient>, body: any) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug) throw new HttpError(400, 'Missing the share link.')
  const profile = await profileForSlug(admin, slug)

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || !isSafeFetchUrl(url)) {
    throw new HttpError(400, "That link doesn't look like a public product page.")
  }
  if (isBlockedHost(url)) {
    throw new HttpError(
      422,
      "That link doesn't look like a kids' gift — suggestions have to be toys, games or books for the kids.",
    )
  }
  const urlKey = normalizeGiftUrl(url)

  // Already suggested? Say so instead of stacking duplicates.
  const { data: open } = await admin
    .from('gift_proposals')
    .select('title, url, status')
    .eq('owner_id', profile.id)
    .in('status', ['pending', 'approved'])
  const dupe = (open ?? []).find((p: any) => normalizeGiftUrl(p.url) === urlKey)
  if (dupe) {
    return json({ ok: false, reason: 'already_proposed', status: dupe.status, title: dupe.title })
  }

  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await admin
    .from('gift_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', profile.id)
    .gte('created_at', since.toISOString())
  if ((count ?? 0) >= DAILY_CAP) {
    throw new HttpError(429, "That's a lot of suggestions for one day — try again tomorrow.")
  }

  // Read the product page for its facts. Failure is NOT fatal:
  // some stores won't talk to a fetcher at all (Amazon), and the
  // suggester's own words still make a workable proposal.
  let facts: { title: string; image_url: string | null; price: number | null; currency: string | null } | null = null
  try {
    facts = extractProductFacts(await fetchTextCapped(url))
  } catch {
    facts = null
  }

  const givenTitle = cleanText(typeof body.title === 'string' ? body.title : '').slice(0, 120)
  let fallbackTitle = ''
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    fallbackTitle = cleanText(seg.replace(/[-_]+/g, ' '))
    if (fallbackTitle.length > 60) fallbackTitle = ''
  } catch {
    fallbackTitle = ''
  }
  const title = givenTitle || facts?.title || fallbackTitle || 'Gift idea'
  if (isBlockedTitle(title)) {
    throw new HttpError(
      422,
      "That doesn't look like a kids' gift — suggestions have to be toys, games or books for the kids.",
    )
  }
  const name = cleanText(typeof body.name === 'string' ? body.name : '').slice(0, 60)
  const note = cleanText(typeof body.note === 'string' ? body.note : '').slice(0, 300)

  const kids = await childrenOf(admin, profile.id)
  const childId =
    typeof body.child_id === 'string' && kids.has(body.child_id) ? body.child_id : null

  const token = crypto.randomUUID()
  const { data: inserted, error } = await admin
    .from('gift_proposals')
    .insert({
      owner_id: profile.id,
      child_id: childId,
      title,
      url,
      image_url: facts?.image_url ?? '',
      price: facts?.price ?? null,
      currency: facts?.currency ?? null,
      suggester_name: name,
      note,
      token_hash: await sha256Hex(token),
    })
    .select('id, title, image_url, status')
    .single()
  if (error || !inserted) throw new HttpError(500, 'Something went wrong saving that — try again.')

  await notifyParents(
    admin,
    profile,
    { title, suggester_name: name, note },
    childId ? (kids.get(childId) ?? null) : null,
  )
  return json({ ok: true, proposal: inserted, token })
}

async function handleMine(admin: ReturnType<typeof createClient>, body: any) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug) throw new HttpError(400, 'Missing the share link.')
  const profile = await profileForSlug(admin, slug)
  const tokens = Array.isArray(body.tokens) ? body.tokens.filter((t: any) => typeof t === 'string').slice(0, 50) : []
  if (!tokens.length) return json({ proposals: [] })
  const hashes = await Promise.all(tokens.map((t: string) => sha256Hex(t)))
  const { data, error } = await admin
    .from('gift_proposals')
    .select('id, title, url, image_url, status, child_id, created_at')
    .eq('owner_id', profile.id)
    .in('token_hash', hashes)
    .order('created_at', { ascending: false })
  if (error) throw new HttpError(500, 'Something went wrong — try again.')
  const kids = await childrenOf(admin, profile.id)
  return json({
    proposals: (data ?? []).map((p: any) => ({
      ...p,
      child_name: p.child_id ? (kids.get(p.child_id) ?? null) : null,
    })),
  })
}

async function handleWithdraw(admin: ReturnType<typeof createClient>, body: any) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug) throw new HttpError(400, 'Missing the share link.')
  const profile = await profileForSlug(admin, slug)
  const id = typeof body.id === 'string' ? body.id : ''
  const token = typeof body.token === 'string' ? body.token : ''
  if (!id || !token) throw new HttpError(400, 'Missing the proposal.')
  const { data, error } = await admin
    .from('gift_proposals')
    .update({ status: 'withdrawn' })
    .eq('id', id)
    .eq('owner_id', profile.id)
    .eq('token_hash', await sha256Hex(token))
    .eq('status', 'pending')
    .select('id')
  if (error) throw new HttpError(500, 'Something went wrong — try again.')
  return json({ ok: (data ?? []).length > 0 })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  try {
    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Expected a JSON request body.' }, 400)
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    switch (body?.mode) {
      case 'suggest':
        return await handleSuggest(admin, body)
      case 'mine':
        return await handleMine(admin, body)
      case 'withdraw':
        return await handleWithdraw(admin, body)
      default:
        return json({ error: "Unknown mode — expected 'suggest', 'mine' or 'withdraw'." }, 400)
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    return json({ error: 'Something went wrong — try again.' }, 500)
  }
})
