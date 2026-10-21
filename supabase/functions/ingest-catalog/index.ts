// ingest-catalog — parents grow the shared catalog themselves.
//
// The catalog page's "Grow the catalog" section calls this function
// (supabase.functions.invoke) in three modes:
//
//   { mode: 'search', query }     — ask the known Shopify stores for
//                                   matching products; returns
//                                   candidates, inserts nothing.
//   { mode: 'add', candidate }    — add one search candidate.
//   { mode: 'url', url }          — fetch a pasted product link
//                                   server-side, extract the product,
//                                   add it.
//
// Every mode requires a signed-in user: the caller's JWT is validated
// first, and writes happen with the service role (catalog_items has
// no client write policies). Additions are logged to
// catalog_additions with the user's id, and catalog rows record
// added_by + source_url — community data with provenance.
//
// Fetches are guarded (see extract.js isSafeFetchUrl): http(s) only,
// no localhost / private IPs, redirects re-validated hop by hop, an
// 8s timeout and a ~2MB body cap. Pure parsing/mapping lives in
// extract.js, which vitest covers from src/lib/ingestExtract.test.js.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  candidateKey,
  cleanText,
  extractFromJsonLd,
  extractFromOpenGraph,
  isSafeFetchUrl,
  normalizeShopifyProduct,
  normalizeSuggestResult,
  platformForUrl,
} from './extract.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const UA = 'ToyLibraryIngestor/1.0 (catalog sync for Toy Library)'
const FETCH_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const TITLE_CAP = 300

// Platform keys the database CHECK allows (0007). Add-mode candidates
// must name one of these.
const PLATFORM_KEYS = [
  'tonies',
  'yoto',
  'leapfrog',
  'projector',
  'vtech',
  'books',
  'other',
  'storypod',
  'osmo',
  'lunii',
]

// The stores live search can ask. All are Shopify stores with a
// public /search/suggest.json. LeapFrog and Lunii are crawl-based in
// the ingestor (no suggest endpoint worth trusting), so they're
// link-paste only.
const STORES = [
  { id: 'tonies', origin: 'https://us.tonies.com', platform: 'tonies' },
  { id: 'yoto', origin: 'https://us.yotoplay.com', platform: 'yoto' },
  { id: 'storypod', origin: 'https://storypod.com', platform: 'storypod' },
  { id: 'osmo', origin: 'https://www.playosmo.com', platform: 'osmo' },
  { id: 'littletikes', origin: 'https://www.littletikes.com', platform: 'projector' },
  { id: 'moonlite', origin: 'https://www.mymoonlite.com', platform: 'projector' },
]

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

// Fetch a URL's text with the safety rails applied: every redirect
// hop is re-validated, the body is capped, and upstream failures
// become plain 502s. Returns the final URL after redirects.
async function fetchTextCapped(startUrl: string): Promise<{ text: string; finalUrl: string }> {
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
    if (!res.body) return { text: '', finalUrl: current }
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
    return { text, finalUrl: current }
  }
  throw new HttpError(502, 'That link redirects too many times to follow safely.')
}

// Insert a catalog row unless (platform, title) already exists, and
// report which happened. Only a genuine insert is logged — the
// additions log is a record of who grew the catalog, not of attempts.
async function upsertCatalogItem(
  admin: ReturnType<typeof createClient>,
  userId: string,
  row: { platform: string; title: string; details: string; image_url: string | null; source_url: string | null },
): Promise<{ status: 'added' | 'exists'; item: Record<string, unknown> }> {
  const { data: existing, error: findError } = await admin
    .from('catalog_items')
    .select('*')
    .eq('platform', row.platform)
    .eq('title', row.title)
    .maybeSingle()
  if (findError) throw new HttpError(500, 'Something went wrong saving that — try again.')
  if (existing) return { status: 'exists', item: existing }

  const { data: inserted, error: insertError } = await admin
    .from('catalog_items')
    .upsert(
      {
        platform: row.platform,
        title: row.title,
        details: row.details ?? '',
        // catalog_items.image_url is NOT NULL; '' is its "no photo"
        // value and the tiles fall back to platform art for it.
        image_url: row.image_url ?? '',
        source_url: row.source_url,
        added_by: userId,
      },
      { onConflict: 'platform,title', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()
  if (insertError) throw new HttpError(500, 'Something went wrong saving that — try again.')
  if (!inserted) {
    // Lost a race with another parent adding the same title.
    const { data: raced } = await admin
      .from('catalog_items')
      .select('*')
      .eq('platform', row.platform)
      .eq('title', row.title)
      .maybeSingle()
    if (raced) return { status: 'exists', item: raced }
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }

  await admin.from('catalog_additions').insert({
    user_id: userId,
    platform: row.platform,
    title: row.title,
    source_url: row.source_url,
  })
  return { status: 'added', item: inserted }
}

// ------------------------------------------------------------ mode: url
async function handleUrl(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || !isSafeFetchUrl(url)) {
    throw new HttpError(400, "That link doesn't look like a public product page.")
  }
  const platform = platformForUrl(url)
  const parsed = new URL(url)

  // Shopify product pages expose clean JSON at /products/<handle>.json
  // — prefer it over scraping the HTML whenever the link has that shape.
  const handleMatch = parsed.pathname.match(/\/products\/([^/?#]+)/)
  if (handleMatch) {
    const jsonUrl = `${parsed.origin}/products/${handleMatch[1]}.json`
    if (isSafeFetchUrl(jsonUrl)) {
      try {
        const { text } = await fetchTextCapped(jsonUrl)
        const row = normalizeShopifyProduct(JSON.parse(text), platform)
        if (row?.title) {
          return json(
            await upsertCatalogItem(admin, userId, {
              ...row,
              title: row.title.slice(0, TITLE_CAP),
              source_url: url,
            }),
          )
        }
      } catch (err) {
        // A 404 / non-JSON .json just means "not a Shopify product
        // page" — fall through to HTML extraction. Anything else
        // (couldn't reach the store at all) is a real failure.
        if (err instanceof HttpError && err.status !== 502) throw err
      }
    }
  }

  const { text: html } = await fetchTextCapped(url)
  const extracted = extractFromJsonLd(html) ?? extractFromOpenGraph(html)
  if (!extracted?.title) {
    throw new HttpError(
      422,
      "We couldn't find a product on that page. Try a link that goes straight to one product.",
    )
  }
  return json(
    await upsertCatalogItem(admin, userId, {
      platform,
      title: extracted.title.slice(0, TITLE_CAP),
      details: extracted.details ?? '',
      image_url: extracted.image_url,
      source_url: url,
    }),
  )
}

// --------------------------------------------------------- mode: search
async function handleSearch(body: any) {
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : ''
  if (!query) throw new HttpError(400, 'Type something to search for first.')

  const perStore = await Promise.all(
    STORES.map(async (store) => {
      try {
        const params = new URLSearchParams()
        params.set('q', query)
        params.set('resources[type]', 'product')
        params.set('resources[limit]', '4')
        params.set('resources[options][unavailable_products]', 'hide')
        const res = await fetch(`${store.origin}/search/suggest.json?${params}`, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) return []
        const data = await res.json()
        const products = data?.resources?.results?.products ?? []
        return products
          .map((p: unknown) => normalizeSuggestResult(store, p))
          .filter(Boolean)
          // Little Tikes is a general toy store sharing the projector
          // platform — only its Dream Machine line belongs here (the
          // same title rule the ingestor applies to that feed).
          .filter((c: any) => store.id !== 'littletikes' || /dream machine/i.test(c.title))
      } catch {
        return [] // one store being down shouldn't sink the search
      }
    }),
  )

  const seen = new Set<string>()
  const results: unknown[] = []
  for (const candidate of perStore.flat()) {
    const key = candidateKey(candidate as any)
    if (seen.has(key)) continue
    seen.add(key)
    results.push(candidate)
    if (results.length >= 20) break
  }
  return json({ results })
}

// ------------------------------------------------------------ mode: add
async function handleAdd(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const c = body.candidate
  if (!c || typeof c !== 'object') {
    throw new HttpError(400, 'Pick a product to add first.')
  }
  if (!PLATFORM_KEYS.includes(c.platform)) {
    throw new HttpError(400, "That product's platform isn't one the catalog knows.")
  }
  const title = cleanText(typeof c.title === 'string' ? c.title : '').slice(0, TITLE_CAP)
  if (!title) throw new HttpError(400, 'That product needs a title.')

  const optionalUrl = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || !isSafeFetchUrl(value.trim())) {
      throw new HttpError(400, "One of that product's links doesn't look safe.")
    }
    return value.trim()
  }

  return json(
    await upsertCatalogItem(admin, userId, {
      platform: c.platform,
      title,
      details: cleanText(typeof c.details === 'string' ? c.details : '').slice(0, TITLE_CAP),
      image_url: optionalUrl(c.image_url),
      source_url: optionalUrl(c.source_url),
    }),
  )
}

// ------------------------------------------------------------------ main
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    // ---- who's calling? The anon client + caller's JWT answers that;
    // an absent/invalid token stops everything here.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Please sign in before adding to the catalog.' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Your session has expired — sign in again.' }, 401)
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Expected a JSON request body.' }, 400)
    }

    // Writes go through the service role: catalog_items deliberately
    // has no client-side insert policy.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    switch (body?.mode) {
      case 'url':
        return await handleUrl(admin, user.id, body)
      case 'search':
        return await handleSearch(body)
      case 'add':
        return await handleAdd(admin, user.id, body)
      default:
        return json({ error: "Unknown mode — expected 'search', 'add' or 'url'." }, 400)
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    return json({ error: 'Something went wrong — try again.' }, 500)
  }
})
