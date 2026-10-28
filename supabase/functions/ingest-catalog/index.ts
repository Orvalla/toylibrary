// ingest-catalog — parents grow the shared catalog themselves.
//
// The catalog page's "Grow the catalog" section calls this function
// (supabase.functions.invoke) in three modes:
//
//   { mode: 'search', query }     — ask the known Shopify stores for
//                                   matching products; returns
//                                   candidates, inserts nothing.
//   { mode: 'add', candidate }    — add one search candidate. The
//                                   candidate is a claim, not data:
//                                   the server re-fetches its store
//                                   link and writes what the page
//                                   itself says (title, details,
//                                   photo), after checking the
//                                   fetched title corresponds to
//                                   the claimed one.
//                                   Capped at ADD_DAILY_CAP genuine
//                                   creations per user per UTC day.
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
//                                   Url-mode rows land hidden until
//                                   an admin publishes them, capped
//                                   at URL_DAILY_CAP creations per
//                                   parent per UTC day.
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
  faviconUrlFor,
  platformForUrl,
  chargeOne,
  shapeItem,
  titlesMatch,
  addFetchStrategy,
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
// Link-paste (mode 'url') additions land hidden (pending_review) until
// an admin publishes them from /admin (see handleUrl), and each parent
// gets at most this many url-mode creations per UTC day — a pasted
// collection counts per row it creates. The count lives in its own
// table (migration 0060: url_add_quota), taken and refunded
// atomically in the database: counting rows in catalog_additions
// afterwards let parallel requests all read the same "left" figure,
// and a failed log insert silently under-counted. Add-mode (store
// search candidates, re-fetched from the store itself) does not
// draw on this budget.
const URL_DAILY_CAP = 25
// Add-mode (store-search adds) has its own budget, separate from the
// url-mode one above: 100 genuine creations per user per UTC day,
// enforced in the database (migration 0062: add_quota). Only a row
// that is actually created uses a unit — an "exists" answer, a blocked
// title or a failed insert gives it back.
const ADD_DAILY_CAP = 100

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

// The sort_order a brand-new row for this platform should
// carry: one past the platform's current maximum. sort_order
// is the platform's own ordering (the maker's store order at
// ingest time), and the column default of 0 would put a
// parent-added item ahead of the brand's whole line — under
// the Popular sort's within-brand ranking it would become
// the brand's #1. New arrivals join the end of the line.
// Gaps are fine; only the order matters.
async function nextSortOrder(
  admin: ReturnType<typeof createClient>,
  platform: string,
): Promise<number> {
  const { data } = await admin
    .from('catalog_items')
    .select('sort_order')
    .eq('platform', platform)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sort_order ?? 0) + 1
}

// Rule 3: a rating is only stored with a positive review count
// behind it. Anything else is stored as "no rating" (the database
// trigger from migration 0057 enforces the same thing).
function ratingPair(
  rating: unknown,
  count: unknown,
): { rating: number | null; rating_count: number | null } {
  const r = typeof rating === 'number' && Number.isFinite(rating) ? rating : null
  const c = typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null
  return r !== null && c !== null ? { rating: r, rating_count: c } : { rating: null, rating_count: null }
}

// Daily url-mode quota (migration 0060). take is atomic per user —
// concurrent requests serialise on the quota row — and returns how
// many of `want` were granted; refund hands back what an insert
// didn't use (duplicates skipped by the upsert, a link that was
// already in the catalog).
async function urlQuotaLeft(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('url_quota_left', {
    p_user: userId,
    p_cap: URL_DAILY_CAP,
  })
  if (error || typeof data !== 'number') {
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }
  return data
}

async function takeUrlQuota(
  admin: ReturnType<typeof createClient>,
  userId: string,
  want: number,
): Promise<number> {
  if (want <= 0) return 0
  const { data, error } = await admin.rpc('take_url_quota', {
    p_user: userId,
    p_want: want,
    p_cap: URL_DAILY_CAP,
  })
  if (error || typeof data !== 'number') {
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }
  return data
}

async function refundUrlQuota(
  admin: ReturnType<typeof createClient>,
  userId: string,
  n: number,
): Promise<void> {
  if (n <= 0) return
  // Best effort: a failed refund only costs the parent a unit of today's allowance.
  await admin.rpc('refund_url_quota', { p_user: userId, p_n: n }).then(
    () => undefined,
    () => undefined,
  )
}

// One url-mode creation: take 1 from the quota, create, and give it
// back if nothing was actually created.
async function chargeUrlAddition(
  admin: ReturnType<typeof createClient>,
  userId: string,
  create: () => Promise<{ status: string; [k: string]: unknown }>,
) {
  if ((await takeUrlQuota(admin, userId, 1)) < 1) throw new HttpError(429, URL_CAP_MESSAGE)
  let result
  try {
    result = await create()
  } catch (err) {
    await refundUrlQuota(admin, userId, 1)
    throw err
  }
  if (result.status !== 'added') await refundUrlQuota(admin, userId, 1)
  return result
}

// Daily add-mode quota (migration 0062) — same atomic take/refund
// pattern as the url-mode quota above, separate counter.
async function addQuotaLeft(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('add_quota_left', {
    p_user: userId,
    p_cap: ADD_DAILY_CAP,
  })
  if (error || typeof data !== 'number') {
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }
  return data
}

async function takeAddQuota(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('take_add_quota', {
    p_user: userId,
    p_want: 1,
    p_cap: ADD_DAILY_CAP,
  })
  if (error || typeof data !== 'number') {
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }
  return data
}

async function refundAddQuota(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  // Best effort: a failed refund only costs one unit of today's allowance.
  await admin.rpc('refund_add_quota', { p_user: userId, p_n: 1 }).then(
    () => undefined,
    () => undefined,
  )
}

// One add-mode creation: take 1, create, give it back unless a row was
// really created (see chargeOne in extract.js, which has the tests).
async function chargeAddAddition(
  admin: ReturnType<typeof createClient>,
  userId: string,
  create: () => Promise<{ status: string; [k: string]: unknown }>,
) {
  return chargeOne({
    take: () => takeAddQuota(admin, userId),
    refund: () => refundAddQuota(admin, userId),
    create,
    capError: () => new HttpError(429, ADD_CAP_MESSAGE),
  })
}

const ADD_CAP_MESSAGE =
  "You've reached today's limit of " +
  ADD_DAILY_CAP +
  ' products added from the stores — it resets at midnight (UTC). Try again tomorrow.'

const URL_CAP_MESSAGE =
  "You've reached today's limit of " +
  URL_DAILY_CAP +
  ' products added by link — it resets at midnight (UTC). Try again tomorrow.'

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
    is_bundle?: boolean
    hidden?: boolean
    pending_review?: boolean
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
  if (existing) return { status: 'exists', item: shapeItem(existing, userId) }

  const { data: inserted, error: insertError } = await admin
    .from('catalog_items')
    .upsert(
      {
        platform: row.platform,
        title: row.title,
        details: row.details ?? '',
        // The bundle flag the normaliser computed from the
        // product's type (extract.js) — a pasted pack link must
        // stock the pack as a bundle, not a plain single.
        // Contents stay unmapped here; the completeness sweep
        // picks the row up from the gaps view (migration 0054).
        is_bundle: row.is_bundle === true,
        // Url-mode creations land hidden until an admin
        // publishes them (migration 0031's hidden flag keeps
        // them out of everyone else's catalog reads; the adder
        // still sees their own). Search-adds pass no flag and
        // stay visible immediately.
        hidden: row.hidden === true,
        pending_review: row.pending_review === true,
        // catalog_items.image_url is NOT NULL; '' is its "no photo"
        // value and the tiles fall back to platform art for it.
        image_url: row.image_url ?? '',
        age_min_years: row.age_min_years ?? null,
        age_max_years: row.age_max_years ?? null,
        ...ratingPair(row.rating, row.rating_count),
        product_url: row.source_url ?? null,
        source_url: row.source_url,
        logo_url: faviconUrlFor(row.source_url),
        added_by: userId,
        sort_order: await nextSortOrder(admin, row.platform),
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
    if (raced) return { status: 'exists', item: shapeItem(raced, userId) }
    throw new HttpError(500, 'Something went wrong saving that — try again.')
  }

  await admin.from('catalog_additions').insert({
    user_id: userId,
    platform: row.platform,
    title: row.title,
    source_url: row.source_url,
    catalog_item_id: inserted.id,
  })
  return { status: 'added', item: shapeItem(inserted, userId) }
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
  // The whole haul joins the end of the platform's line, in
  // plan order (see nextSortOrder). Duplicates the upsert
  // skips leave harmless gaps in the numbering.
  const firstOrder = await nextSortOrder(admin, platform)
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((row: any, j: number) => ({
      platform,
      title: row.title.slice(0, TITLE_CAP),
      details: row.details ?? '',
      // Same bundle signal as the single-add path: the planners
      // in extract.js stamp is_bundle from the product type /
      // details evidence, and the insert must not drop it.
      // Contents are the sweep's job, never the request path's.
      is_bundle: row.is_bundle === true,
      // Bulk imports only ever run for mode 'url' (collection
      // and listing pastes), so every row lands hidden until an
      // admin publishes it — same rule as the single-add path.
      hidden: true,
      pending_review: true,
      image_url: row.image_url ?? '',
      age_min_years: row.age_min_years ?? null,
      age_max_years: row.age_max_years ?? null,
      ...ratingPair(row.rating, row.rating_count),
      product_url: row.source_url ?? sourceUrl ?? null,
      source_url: row.source_url ?? sourceUrl,
      logo_url: faviconUrlFor(row.source_url ?? sourceUrl),
      added_by: userId,
      sort_order: firstOrder + i + j,
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
  // Daily url-mode cap (see URL_DAILY_CAP): trim the plan to
  // the allowance left. The count is read fresh here so a
  // multi-platform collection, whose groups insert one after
  // another, stays honest; a plan with no allowance left is a
  // plain 429 rather than an all-zero tally.
  const granted = await takeUrlQuota(admin, userId, plan.toAdd.length)
  if (granted === 0 && plan.toAdd.length > 0) {
    throw new HttpError(429, URL_CAP_MESSAGE)
  }
  const skippedCap = plan.toAdd.length - granted
  if (skippedCap > 0) plan.toAdd = plan.toAdd.slice(0, granted)
  await enrichRatings(plan.toAdd)
  const added = await insertCatalogRows(admin, userId, plan.toAdd, platform, sourceUrl)
  // Rows the upsert skipped as duplicates didn't use the allowance.
  // (If the insert throws, the grant stays spent — the safe side.)
  await refundUrlQuota(admin, userId, granted - added)
  return {
    status: 'collection',
    platform,
    total_found: products.length,
    added,
    already_present:
      products.length - plan.skippedFiltered - plan.blockedContent - added - skippedCap,
    skipped_filtered: plan.skippedFiltered,
    skipped_cap: skippedCap,
    blocked_content: plan.blockedContent,
    pending_review: added > 0,
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
  // Same daily url-mode cap trim as insertPlannedCollection.
  const granted = await takeUrlQuota(admin, userId, plan.toAdd.length)
  if (granted === 0 && plan.toAdd.length > 0) {
    throw new HttpError(429, URL_CAP_MESSAGE)
  }
  const skippedCap = plan.toAdd.length - granted
  if (skippedCap > 0) plan.toAdd = plan.toAdd.slice(0, granted)
  const added = await insertCatalogRows(admin, userId, plan.toAdd, platform, sourceUrl)
  await refundUrlQuota(admin, userId, granted - added)
  return {
    status: 'collection',
    platform,
    total_found: totalFound,
    added,
    already_present: totalFound - skipped - plan.blockedContent - added - skippedCap,
    skipped_filtered: skipped,
    skipped_cap: skippedCap,
    blocked_content: plan.blockedContent,
    pending_review: added > 0,
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
      merged.skipped_cap =
        ((merged.skipped_cap as number) ?? 0) + ((result.skipped_cap as number) ?? 0)
      merged.blocked_content =
        ((merged.blocked_content as number) ?? 0) + ((result.blocked_content as number) ?? 0)
      merged.pending_review = Boolean(merged.pending_review) || Boolean(result.pending_review)
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
// opts.requireFinalHost (add-mode's Yoto branch): the fetch that
// produces the row must END on this host — a redirect elsewhere
// voids the row instead of letting off-store content in.
async function fetchProductRow(
  link: string,
  platform: string,
  opts?: { requireFinalHost?: string },
): Promise<any | null> {
  const finalHostOk = (finalUrl: string) =>
    !opts?.requireFinalHost ||
    new URL(finalUrl).hostname.toLowerCase().replace(/\.+$/, '') === opts.requireFinalHost
  const path = parseShopifyPath(link)
  if (path.kind === 'product') {
    const parsed = new URL(link)
    const jsonUrl = `${parsed.origin}/products/${path.handle}.json`
    if (isSafeFetchUrl(jsonUrl)) {
      try {
        const { text, finalUrl } = await fetchTextCapped(jsonUrl)
        if (!finalHostOk(finalUrl)) return null
        const row = normalizeShopifyProduct(JSON.parse(text), platform)
        if (row?.title) return { ...row, source_url: link }
      } catch {
        // Not a Shopify product after all — scrape the page below.
      }
    }
  }
  const { text: html, finalUrl } = await fetchTextCapped(link)
  if (!finalHostOk(finalUrl)) return null
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
  // Daily url-mode cap (see URL_DAILY_CAP): past it, a link
  // paste creates nothing. Collections re-check their exact
  // remaining allowance at insert time; this stops single
  // adds — and wasted collection fetches — up front.
  if ((await urlQuotaLeft(admin, userId)) <= 0) {
    throw new HttpError(429, URL_CAP_MESSAGE)
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
          const result = await chargeUrlAddition(admin, userId, () =>
            upsertCatalogItem(admin, userId, {
              ...row,
              title: row.title.slice(0, TITLE_CAP),
              source_url: url,
              hidden: true,
              pending_review: true,
            }),
          )
          return json(
            result.status === 'added' ? { ...result, pending_review: true } : result,
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
  const result = await chargeUrlAddition(admin, userId, () =>
    upsertCatalogItem(admin, userId, {
      platform: platformForProduct(platform, extracted.title),
      title: extracted.title.slice(0, TITLE_CAP),
      details: extracted.details ?? '',
      image_url: extracted.image_url,
      rating: extracted.rating ?? agg?.rating ?? null,
      rating_count: extracted.rating_count ?? agg?.rating_count ?? null,
      source_url: url,
      hidden: true,
      pending_review: true,
    }),
  )
  return json(result.status === 'added' ? { ...result, pending_review: true } : result)
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
  // Daily add-mode cap (see ADD_DAILY_CAP): once spent, stop before the
  // outbound store fetch. The unit itself is taken only around the
  // insert, so rejected and "exists" requests never use one.
  if ((await addQuotaLeft(admin, userId)) <= 0) {
    throw new HttpError(429, ADD_CAP_MESSAGE)
  }

  const optionalUrl = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || !isSafeFetchUrl(value.trim())) {
      throw new HttpError(400, "One of that product's links doesn't look safe.")
    }
    return value.trim()
  }

  // The product link becomes the public "manufacturer link" every
  // gift-giver sees (Rule 4), so it must point at one of the stores
  // live search actually queries — never at a host the client picked.
  // A candidate that came from search always satisfies this.
  const storeHosts = new Set(STORES.map((store) => new URL(store.origin).hostname))
  const storeUrl = (value: unknown): string | null => {
    const url = optionalUrl(value)
    if (url === null) return null
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '')
    if (!storeHosts.has(host)) {
      throw new HttpError(400, "That product's link isn't on a store the catalog adds from.")
    }
    return url
  }

  // Server-side re-fetch: the row written is built from the store's own
  // product data, never from fields the client sent. Everything the
  // client names is only a claim to be checked:
  //   * the link must be a /products/<handle> page on one of STORES
  //     (not a policy page, blog post or collection), and the fetch
  //     must END on that same store host (no off-store redirect);
  //   * the platform comes from the store the link is on — a Tonies
  //     link can't be filed under another maker's shelf;
  //   * the claimed title must correspond to the fetched one.
  // Any failure is a 422; there is no fallback to client-sent fields.
  const link = storeUrl(c.source_url)
  if (!link) {
    throw new HttpError(
      422,
      "That product doesn't carry a store link we can check — try the link tab instead.",
    )
  }
  const linkHost = new URL(link).hostname.toLowerCase().replace(/\.+$/, '')
  const store = STORES.find((st) => new URL(st.origin).hostname === linkHost)
  const path = parseShopifyPath(link)
  if (!store || path.kind !== 'product') {
    throw new HttpError(422, "That link isn't a product page on one of our stores.")
  }
  let fetched: any = null
  try {
    if (addFetchStrategy(store.id) === 'html') {
      // Yoto carve-out (owner-approved, the one deviation from the
      // round-2 patch): us.yotoplay.com does not serve Shopify
      // product JSON — /products/<handle>.json 404s on every handle
      // (see addFetchStrategy in extract.js) — so Yoto keeps the
      // page scrape, with the guards above applied to it: /products/
      // only (checked just above), the fetch must end on the store
      // host (requireFinalHost), the platform comes from the STORES
      // entry (store.platform), and titlesMatch still gates below.
      fetched = await fetchProductRow(link, store.platform, { requireFinalHost: linkHost })
    } else {
      const jsonUrl = `${store.origin}/products/${encodeURIComponent(path.handle)}.json`
      const { text, finalUrl } = await fetchTextCapped(jsonUrl)
      if (new URL(finalUrl).hostname.toLowerCase() !== new URL(store.origin).hostname) {
        throw new Error('left the store')
      }
      fetched = normalizeShopifyProduct(JSON.parse(text), store.platform)
    }
  } catch {
    fetched = null
  }
  if (!fetched?.title) {
    throw new HttpError(
      422,
      "We couldn't read that product's page to check it — try again in a moment.",
    )
  }
  if (!titlesMatch(title, fetched.title)) {
    throw new HttpError(422, "That product doesn't match the page at that link.")
  }

  return json(
    await chargeAddAddition(admin, userId, () =>
      upsertCatalogItem(admin, userId, {
        platform: platformForProduct(store.platform, fetched.title),
        title: cleanText(fetched.title).slice(0, TITLE_CAP),
        details: cleanText(fetched.details ?? '').slice(0, TITLE_CAP),
        image_url: fetched.image_url || null,
        source_url: link,
        is_bundle: fetched.is_bundle === true,
        age_min_years: fetched.age_min_years ?? null,
        age_max_years: fetched.age_max_years ?? null,
        rating: fetched.rating ?? null,
        rating_count: fetched.rating_count ?? null,
      }),
    ),
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
