// ingest-catalog — parents grow the shared catalog themselves.
//
// The catalog page's "Grow the catalog" section calls this function
// (supabase.functions.invoke) in three modes:
//
//   { mode: 'search', query }     — ask the known Shopify stores for
//                                   matching products; returns
//                                   candidates, inserts nothing.
//   { mode: 'add', candidate }    — add one search candidate.
//   { mode: 'url', url }          — fetch a pasted link server-side
//                                   and add what it points at: one
//                                   product page → that product; a
//                                   collection page → everything in
//                                   it (no content filtering — the
//                                   parent asked for that page; see
//                                   extract.js "product facts");
//                                   any other listing page (JSON-LD
//                                   ItemList, or a page of product
//                                   links) → everything listed on
//                                   it. A listing is never added as
//                                   a single "product" itself.
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
  collectionPageUrl,
  extractAggregateRating,
  extractAllFromJsonLd,
  extractFromJsonLd,
  extractFromOpenGraph,
  extractOgType,
  extractProductLinks,
  isBlockedHost,
  isBlockedTitle,
  isSafeFetchUrl,
  normalizeShopifyProduct,
  normalizeSuggestResult,
  parseShopifyPath,
  planCollectionImport,
  planRowImport,
  platformForProduct,
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
// Collection imports walk the store's products.json at 250/page;
// a page of full product records (descriptions and all) is much
// bigger than a product page, so it gets a bigger cap.
const COLLECTION_MAX_PAGES = 20
const COLLECTION_PAGE_SIZE = 250
const COLLECTION_PAGE_BYTES = 8 * 1024 * 1024

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
  'haba',
  'magnatiles',
  'smartgames',
  'lovevery',
  'melissaanddoug',
  'littlepeople',
  'brio',
  'fatbrain',
  'lakeshore',
  'learningresources',
  'littletikes',
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
  { id: 'littletikes', origin: 'https://www.littletikes.com', platform: 'littletikes' },
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
async function fetchTextCapped(
  startUrl: string,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ text: string; finalUrl: string }> {
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
      if (text.length > maxBytes) {
        await reader.cancel()
        throw new HttpError(502, 'That page is too large to read.')
      }
    }
    return { text, finalUrl: current }
  }
  throw new HttpError(502, 'That link redirects too many times to follow safely.')
}

// Moderation (migration 0031): when the content screen stops an
// add, log the attempt and flag EVERY addition by this account
// for the owner's review — one blocked paste is a reason to
// sweep their whole history. Best-effort: a flagging failure
// must never change the outcome of the add itself.
async function flagForReview(
  admin: ReturnType<typeof createClient>,
  userId: string,
  detail: string,
): Promise<void> {
  try {
    await admin.from('moderation_flags').insert({ user_id: userId, detail })
    await admin
      .from('catalog_additions')
      .update({ needs_review: true })
      .eq('user_id', userId)
  } catch {
    // The screen's verdict stands either way.
  }
}

// Insert a catalog row unless (platform, title) already exists, and
// report which happened. Only a genuine insert is logged — the
// additions log is a record of who grew the catalog, not of attempts.
async function upsertCatalogItem(
  admin: ReturnType<typeof createClient>,
  userId: string,
  row: {
    platform: string
    title: string
    details: string
    image_url: string | null
    source_url: string | null
    age_min_years?: number | null
    age_max_years?: number | null
    rating?: number | null
    rating_count?: number | null
  },
): Promise<{ status: 'added' | 'exists'; item: Record<string, unknown> }> {
  if (isBlockedTitle(row.title)) {
    await flagForReview(admin, userId, 'Blocked title on add: "' + row.title + '" (' + row.platform + ')')
    throw new HttpError(
      422,
      "That doesn't look like a kids' product, so it can't be added to the catalog.",
    )
  }
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
        age_min_years: row.age_min_years ?? null,
        age_max_years: row.age_max_years ?? null,
        rating: row.rating ?? null,
        rating_count: row.rating_count ?? null,
        product_url: row.source_url ?? null,
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
    catalog_item_id: inserted.id,
  })
  return { status: 'added', item: inserted }
}

// ------------------------------------------- collection bulk imports
//
// A pasted collection link adds everything in it at once. The plan
// (which products, which are new) is pure — planCollectionImport in
// extract.js, unit-tested; this section only fetches and inserts.
//
// Insert counting: the batch upsert runs with ignoreDuplicates, so
// its returned rows are exactly the rows that were inserted (the
// same PostgREST behaviour upsertCatalogItem relies on for one).
// `added` counts those; already_present is whatever was found but
// not inserted, so the three tallies always sum to total_found.
// What's already catalogued for this platform? Titles only, paged
// (PostgREST caps a response at 1,000 rows; Yoto has ~1,600).
async function loadExistingTitles(
  admin: ReturnType<typeof createClient>,
  platform: string,
): Promise<string[]> {
  const titles: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('catalog_items')
      .select('title')
      .eq('platform', platform)
      .order('title')
      .range(from, from + 999)
    if (error) throw new HttpError(500, 'Something went wrong saving those — try again.')
    titles.push(...(data ?? []).map((r: any) => r.title))
    if (!data || data.length < 1000) break
  }
  return titles
}

// Insert planned rows (ignoreDuplicates makes the returned rows
// exactly the rows that landed) and log one additions row per
// genuinely added product, attributed to the link the parent pasted.
async function insertCatalogRows(
  admin: ReturnType<typeof createClient>,
  userId: string,
  rows: any[],
  platform: string,
  sourceUrl: string,
): Promise<number> {
  const inserted: Record<string, unknown>[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((row: any) => ({
      platform,
      title: row.title.slice(0, TITLE_CAP),
      details: row.details ?? '',
      image_url: row.image_url ?? '',
      age_min_years: row.age_min_years ?? null,
      age_max_years: row.age_max_years ?? null,
      rating: row.rating ?? null,
      rating_count: row.rating_count ?? null,
      product_url: row.source_url ?? sourceUrl ?? null,
      source_url: row.source_url ?? sourceUrl,
      added_by: userId,
    }))
    const { data, error } = await admin
      .from('catalog_items')
      .upsert(batch, { onConflict: 'platform,title', ignoreDuplicates: true })
      .select()
    if (error) throw new HttpError(500, 'Something went wrong saving those — try again.')
    inserted.push(...((data ?? []) as Record<string, unknown>[]))
  }
  for (let i = 0; i < inserted.length; i += 500) {
    await admin.from('catalog_additions').insert(
      inserted.slice(i, i + 500).map((r: any) => ({
        user_id: userId,
        platform: r.platform,
        title: r.title,
        source_url: sourceUrl,
        catalog_item_id: r.id,
      })),
    )
  }
  return inserted.length
}

// Ratings live on product pages, not in store feeds — a bulk
// import only goes back for them when the haul is small enough
// that a page fetch per item stays cheap (batched, best-effort:
// a page that won't talk just leaves the rating null, which the
// site already treats as "no rating to show").
const RATING_ENRICH_CAP = 12
const RATING_ENRICH_BATCH = 6

async function enrichRatings(rows: any[]): Promise<void> {
  const targets = rows.filter((r) => r.rating == null && r.source_url)
  if (targets.length === 0 || rows.length > RATING_ENRICH_CAP) return
  for (let i = 0; i < targets.length; i += RATING_ENRICH_BATCH) {
    await Promise.all(
      targets.slice(i, i + RATING_ENRICH_BATCH).map(async (row) => {
        try {
          const { text: html } = await fetchTextCapped(row.source_url)
          const agg = extractAggregateRating(html)
          if (agg) {
            row.rating = agg.rating
            row.rating_count = agg.rating_count
          }
        } catch {
          // Best-effort only.
        }
      }),
    )
  }
}

async function insertPlannedCollection(
  admin: ReturnType<typeof createClient>,
  userId: string,
  products: unknown[],
  platform: string,
  origin: string,
  sourceUrl: string,
): Promise<Record<string, unknown>> {
  const existingTitles = await loadExistingTitles(admin, platform)
  const plan = planCollectionImport(products, existingTitles, platform, origin)
  if (plan.blockedContent > 0) {
    await flagForReview(
      admin,
      userId,
      'Collection add screened out ' + plan.blockedContent + ' inappropriate item(s) (' + platform + ', ' + sourceUrl + ')',
    )
  }
  if (plan.toAdd.length === 0 && plan.blockedContent > 0 && plan.alreadyPresent === 0) {
    throw new HttpError(
      422,
      "Those products aren't kids' products, so they can't be added to the catalog.",
    )
  }
  await enrichRatings(plan.toAdd)
  const added = await insertCatalogRows(admin, userId, plan.toAdd, platform, sourceUrl)
  return {
    status: 'collection',
    platform,
    total_found: products.length,
    added,
    already_present: products.length - plan.skippedFiltered - plan.blockedContent - added,
    skipped_filtered: plan.skippedFiltered,
    blocked_content: plan.blockedContent,
  }
}

// The same tally for imports planned from extracted page rows
// (listing-page crawls): total_found counts the product links the
// crawl attempted, skipped_filtered the ones that yielded nothing.
async function insertPlannedRows(
  admin: ReturnType<typeof createClient>,
  userId: string,
  rows: any[],
  platform: string,
  sourceUrl: string,
  totalFound: number,
  skipped: number,
): Promise<Record<string, unknown>> {
  const existingTitles = await loadExistingTitles(admin, platform)
  const plan = planRowImport(rows, existingTitles, platform)
  if (plan.blockedContent > 0) {
    await flagForReview(
      admin,
      userId,
      'Collection add screened out ' + plan.blockedContent + ' inappropriate item(s) (' + platform + ', ' + sourceUrl + ')',
    )
  }
  if (plan.toAdd.length === 0 && plan.blockedContent > 0 && plan.alreadyPresent === 0) {
    throw new HttpError(
      422,
      "Those products aren't kids' products, so they can't be added to the catalog.",
    )
  }
  const added = await insertCatalogRows(admin, userId, plan.toAdd, platform, sourceUrl)
  return {
    status: 'collection',
    platform,
    total_found: totalFound,
    added,
    already_present: totalFound - skipped - plan.blockedContent - added,
    skipped_filtered: skipped,
    blocked_content: plan.blockedContent,
  }
}

// Walk a Shopify collection's products.json pages. Returns the
// import tally, or null when page 1 couldn't be read as a Shopify
// collection feed at all (the caller decides what that means for
// this store). A failure on a later page just ends the walk —
// what was gathered still imports.
async function importCollection(
  admin: ReturnType<typeof createClient>,
  userId: string,
  sourceUrl: string,
  platform: string,
  origin: string,
  handle: string,
): Promise<Record<string, unknown> | null> {
  const products: unknown[] = []
  for (let page = 1; page <= COLLECTION_MAX_PAGES; page++) {
    let pageProducts: unknown[] | null = null
    try {
      const { text } = await fetchTextCapped(
        collectionPageUrl(origin, handle, page),
        COLLECTION_PAGE_BYTES,
      )
      const parsedJson = JSON.parse(text)
      if (Array.isArray(parsedJson?.products)) pageProducts = parsedJson.products
    } catch {
      pageProducts = null
    }
    if (pageProducts === null) {
      if (page === 1) return null
      break
    }
    products.push(...pageProducts)
    if (pageProducts.length < COLLECTION_PAGE_SIZE) break
  }
  if (products.length === 0) {
    throw new HttpError(
      422,
      "Couldn't read that collection — check the link, or try a single product page.",
    )
  }
  // One pasted collection can span two shelves (Little Tikes:
  // its own platform, with the Dream Machine line filed under
  // projector) — plan and insert per resolved platform, then
  // merge the tallies; the reported platform is the biggest group.
  const groups = new Map<string, unknown[]>()
  for (const product of products) {
    const p = platformForProduct(platform, product)
    const group = groups.get(p) ?? []
    group.push(product)
    groups.set(p, group)
  }
  if (groups.size === 1) {
    return insertPlannedCollection(admin, userId, products, platform, origin, sourceUrl)
  }
  let merged: Record<string, unknown> | null = null
  let biggest = -1
  for (const [groupPlatform, groupProducts] of groups) {
    const result = await insertPlannedCollection(
      admin,
      userId,
      groupProducts,
      groupPlatform,
      origin,
      sourceUrl,
    )
    if (!merged) {
      merged = { ...result }
    } else {
      merged.total_found =
        (merged.total_found as number) + (result.total_found as number)
      merged.added = (merged.added as number) + (result.added as number)
      merged.already_present =
        (merged.already_present as number) + (result.already_present as number)
      merged.skipped_filtered =
        (merged.skipped_filtered as number) + (result.skipped_filtered as number)
      merged.blocked_content =
        ((merged.blocked_content as number) ?? 0) + ((result.blocked_content as number) ?? 0)
    }
    if (groupProducts.length > biggest) {
      biggest = groupProducts.length
      merged.platform = groupPlatform
    }
  }
  return merged
}

// Collection-shaped link on a store with no products.json feed:
// read the page's JSON-LD and bulk-add every Product it lists (some
// non-Shopify stores describe a collection as an ItemList).
async function importItemListCollection(
  admin: ReturnType<typeof createClient>,
  userId: string,
  sourceUrl: string,
  platform: string,
  origin: string,
  knownItems?: any[],
): Promise<Record<string, unknown>> {
  let items = knownItems
  if (!items) {
    const { text: html } = await fetchTextCapped(sourceUrl)
    items = extractAllFromJsonLd(html)
  }
  if (items.length === 0) {
    throw new HttpError(
      422,
      "Couldn't read that collection — check the link, or try a single product page.",
    )
  }
  // planCollectionImport speaks Shopify product shape; the JSON-LD
  // details (brand / category) ride in product_type, which the
  // normaliser passes through as the details text.
  const products = items.map((item) => ({
    title: item.title,
    product_type: item.details,
    tags: [],
    handle: null,
    images: item.image_url ? [{ src: item.image_url }] : [],
    rating: item.rating ?? null,
    rating_count: item.rating_count ?? null,
  }))
  return insertPlannedCollection(admin, userId, products, platform, origin, sourceUrl)
}

// ------------------------------------------------ listing-page crawls
//
// A listing page whose shape isn't /collections/<handle> (Lunii and
// LeapFrog category pages, "all products" pages, a store homepage):
// follow the product links on it and add what they point at. The
// crawl is capped and batched so a huge category can't run the
// function off a cliff.

const LISTING_CRAWL_CAP = 40
const LISTING_CRAWL_BATCH = 6
// Fewer product links than this and the page is treated as a
// (possibly odd) single page, not a listing.
const LISTING_MIN_LINKS = 3

// One product page → one normalised row, Shopify .json first, page
// extraction second. Null when the page yields nothing product-like.
async function fetchProductRow(link: string, platform: string): Promise<any | null> {
  const path = parseShopifyPath(link)
  if (path.kind === 'product') {
    const parsed = new URL(link)
    const jsonUrl = `${parsed.origin}/products/${path.handle}.json`
    if (isSafeFetchUrl(jsonUrl)) {
      try {
        const { text } = await fetchTextCapped(jsonUrl)
        const row = normalizeShopifyProduct(JSON.parse(text), platform)
        if (row?.title) return { ...row, source_url: link }
      } catch {
        // Not a Shopify product after all — scrape the page below.
      }
    }
  }
  const { text: html } = await fetchTextCapped(link)
  const extracted = extractFromJsonLd(html) ?? extractFromOpenGraph(html)
  if (!extracted?.title) return null
  const agg = extractAggregateRating(html)
  return {
    title: extracted.title,
    details: extracted.details ?? '',
    image_url: extracted.image_url ?? '',
    rating: agg?.rating ?? null,
    rating_count: agg?.rating_count ?? null,
    source_url: link,
  }
}

async function importListingByLinks(
  admin: ReturnType<typeof createClient>,
  userId: string,
  pageUrl: string,
  platform: string,
  links: string[],
): Promise<Record<string, unknown> | null> {
  const capped = links.filter((l) => isSafeFetchUrl(l)).slice(0, LISTING_CRAWL_CAP)
  const rows: any[] = []
  for (let i = 0; i < capped.length; i += LISTING_CRAWL_BATCH) {
    const batch = await Promise.all(
      capped.slice(i, i + LISTING_CRAWL_BATCH).map(async (link) => {
        try {
          return await fetchProductRow(link, platform)
        } catch {
          return null
        }
      }),
    )
    rows.push(...batch.filter(Boolean))
  }
  // One readable product does not make a listing import — the
  // caller falls back to its listing error rather than stocking a
  // half-read page.
  if (rows.length < 2) return null
  return insertPlannedRows(
    admin,
    userId,
    rows,
    platform,
    pageUrl,
    capped.length,
    capped.length - rows.length,
  )
}

// ------------------------------------------------------------ mode: url
async function handleUrl(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || !isSafeFetchUrl(url)) {
    throw new HttpError(400, "That link doesn't look like a public product page.")
  }
  if (isBlockedHost(url)) {
    await flagForReview(admin, userId, 'Blocked store on add: ' + url)
    throw new HttpError(
      422,
      "That store isn't one we can add from — Toy Library only stocks kids' products.",
    )
  }
  const platform = platformForUrl(url)
  const parsed = new URL(url)
  const path = parseShopifyPath(url)

  // A collection link bulk-adds everything in it. On a connected
  // store a collection we can't read is a plain 422 — falling
  // through to the single-product scrape would risk adding the
  // collection page itself as a "product". Anywhere else, the
  // page's JSON-LD ItemList gets the same bulk treatment.
  if (path.kind === 'collection') {
    const result = await importCollection(admin, userId, url, platform, parsed.origin, path.handle)
    if (result) return json(result)
    if (platform !== 'other') {
      throw new HttpError(
        422,
        "Couldn't read that collection — check the link, or try a single product page.",
      )
    }
    return json(await importItemListCollection(admin, userId, url, platform, parsed.origin))
  }

  // Shopify product pages expose clean JSON at /products/<handle>.json
  // — prefer it over scraping the HTML whenever the link has that shape.
  if (path.kind === 'product') {
    const jsonUrl = `${parsed.origin}/products/${path.handle}.json`
    if (isSafeFetchUrl(jsonUrl)) {
      try {
        const { text } = await fetchTextCapped(jsonUrl)
        const row = normalizeShopifyProduct(JSON.parse(text), platform)
        if (row?.title) {
          row.platform = platformForProduct(platform, row)
          // The feed publishes no rating; the product page's own
          // structured data may. Best-effort — the product is
          // added either way.
          if (row.rating == null) {
            try {
              const { text: pageHtml } = await fetchTextCapped(url)
              const agg = extractAggregateRating(pageHtml)
              if (agg) {
                row.rating = agg.rating
                row.rating_count = agg.rating_count
              }
            } catch {
              // Keep the product; skip the rating.
            }
          }
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

  const { text: html, finalUrl } = await fetchTextCapped(url)

  // Listing pages in JSON-LD clothing: two or more Products in the
  // page's structured data means the page IS a list, whatever its
  // URL shape — bulk-add them instead of adding the page itself.
  const ldItems = extractAllFromJsonLd(html)
  if (ldItems.length >= 2) {
    return json(
      await importItemListCollection(admin, userId, url, platform, parsed.origin, ldItems),
    )
  }

  // Exactly one structured Product describes the page itself —
  // trust it as a single product page. With none, a page full of
  // product links is a listing: crawl it, and if the crawl can't
  // read the products, say so rather than adding the page itself
  // as a "product" (the reported bug).
  let extracted: any = ldItems[0] ?? null
  if (!extracted) {
    const links = extractProductLinks(html, finalUrl || url)
    if (links.length >= LISTING_MIN_LINKS) {
      const crawled = await importListingByLinks(admin, userId, url, platform, links)
      if (crawled) return json(crawled)
      throw new HttpError(
        422,
        "That looks like a listing page, but we couldn't read the products on it. Try a link that goes straight to one product.",
      )
    }
    const og = extractFromOpenGraph(html)
    // An og:title alone isn't proof of a product: category pages
    // carry their listing name there. Trust it as a single product
    // only when the URL itself has a product shape, the page
    // declares og:type=product, or the host isn't a known store
    // (generic one-product pages elsewhere keep working as before).
    if (
      og?.title &&
      (path.kind === 'product' || extractOgType(html) === 'product' || platform === 'other')
    ) {
      extracted = og
    } else if (og?.title) {
      throw new HttpError(
        422,
        "That link looks like a listing page rather than one product. Try a link that goes straight to one product, or the store's collection page.",
      )
    }
  }
  if (!extracted?.title) {
    throw new HttpError(
      422,
      "We couldn't find a product on that page. Try a link that goes straight to one product.",
    )
  }
  const agg = extractAggregateRating(html)
  return json(
    await upsertCatalogItem(admin, userId, {
      platform: platformForProduct(platform, extracted.title),
      title: extracted.title.slice(0, TITLE_CAP),
      details: extracted.details ?? '',
      image_url: extracted.image_url,
      rating: extracted.rating ?? agg?.rating ?? null,
      rating_count: extracted.rating_count ?? agg?.rating_count ?? null,
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
          // Little Tikes spans two shelves: its Dream Machine
          // line is projector content, everything else is the
          // Little Tikes platform.
          .map((c: any) => ({ ...c, platform: platformForProduct(store.platform, c.title) }))
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
      platform: platformForProduct(c.platform, title),
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
