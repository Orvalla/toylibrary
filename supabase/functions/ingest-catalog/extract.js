// Pure helpers for the ingest-catalog Edge Function.
//
// No Deno APIs, no fetch, no imports — plain ESM so the exact code the
// function runs is also what vitest exercises from
// src/lib/ingestExtract.test.js. Everything here is string/URL work:
// deciding which platform a store link belongs to, refusing unsafe
// fetch targets (SSRF guard), and pulling product facts out of a
// fetched page or a Shopify product JSON.

// ------------------------------------------------------------------ hosts

// Store host → catalog platform. Mirrors ingestor/lib/sources.mjs.
// LeapFrog and Lunii have no simple store feed (the ingestor crawls
// them), so they never appear in live search — but a pasted product
// link from either host still maps here.
const HOST_PLATFORMS = [
  ['us.tonies.com', 'tonies'],
  ['www.tonies.com', 'tonies'],
  ['tonies.com', 'tonies'],
  ['us.yotoplay.com', 'yoto'],
  ['www.yotoplay.com', 'yoto'],
  ['yotoplay.com', 'yoto'],
  ['storypod.com', 'storypod'],
  ['www.storypod.com', 'storypod'],
  ['www.playosmo.com', 'osmo'],
  ['playosmo.com', 'osmo'],
  // Moonlite feeds the shared projector platform. Little Tikes is
  // a general toy store with its own platform — only its Dream
  // Machine line belongs to the projector shelf, and that split
  // happens per product (platformForProduct below).
  ['www.littletikes.com', 'littletikes'],
  ['littletikes.com', 'littletikes'],
  ['www.mymoonlite.com', 'projector'],
  ['mymoonlite.com', 'projector'],
  ['store.leapfrog.com', 'leapfrog'],
  ['www.leapfrog.com', 'leapfrog'],
  ['leapfrog.com', 'leapfrog'],
  ['lunii.com', 'lunii'],
  ['www.lunii.com', 'lunii'],
]

// The store's favicon, via the same public favicon service
// the client falls back to (src/lib/logo.js mirrors this):
// stamped into catalog_items.logo_url so a user-added item
// carries its store's mark even where the platform has no
// logo of its own.
export function faviconUrlFor(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host) return null
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`
}

export function platformForUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return 'other'
  }
  const host = url.hostname.toLowerCase()
  for (const [known, platform] of HOST_PLATFORMS) {
    if (host === known) return platform
  }
  return 'other'
}

// ------------------------------------------------------------- SSRF guard

// The function fetches URLs the user pasted, server-side. Only public
// http(s) pages are fair game: no localhost, no *.local names, and no
// literal IPs in private / reserved ranges (a URL could otherwise be
// pointed at cloud metadata endpoints or the LAN).
function ipv4IsPrivate(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null // not an IPv4 literal
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((o) => Number(o) > 255)) return true // malformed — refuse
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local / metadata
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a >= 240) return true // reserved / broadcast
  if (a >= 224) return true // multicast
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true // 192.0.0.0/24 + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  return false
}

function ipv6IsPrivate(host) {
  const h = host.toLowerCase()
  if (h === '::1' || h === '::') return true
  if (/^fe[89ab]/.test(h)) return true // link-local fe80::/10
  if (/^fe[c-f]/.test(h)) return true // site-local fec0::/10 (deprecated, still routable on some nets)
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local fc00::/7
  if (h.startsWith('ff')) return true // multicast ff00::/8
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped — judge the embedded IPv4 address.
    return ipv4IsPrivate(h.slice('::ffff:'.length)) ?? true
  }
  if (h.startsWith('64:ff9b:')) return true // NAT64 — embeds an IPv4 address
  if (h.startsWith('2002:')) return true // 6to4 — embeds an IPv4 address
  if (h.startsWith('::')) return true // IPv4-compatible forms such as ::7f00:1
  return false
}

// Suffixes that only ever name private / internal hosts.
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa']

export function isSafeFetchUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  // URL keeps IPv6 literals bracketed in .hostname in some runtimes.
  // A trailing dot ("localhost.") is the same host to the resolver,
  // so it is stripped before any comparison.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host) return false
  const v4 = ipv4IsPrivate(host)
  if (v4 !== null) return v4 === false
  if (host.includes(':')) return !ipv6IsPrivate(host)
  // Public sites have a dotted name; single-label hosts ("metadata",
  // "localhost", "intranet") only resolve on private networks.
  if (!host.includes('.')) return false
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  return true
}

// ---------------------------------------------------------- content guard

// This is a kids' catalog (owner request 2026-10-22): pasted
// links are screened before anything is fetched or stored.
// Two signals, host first (highest precision): known adult
// retailers / adult TLDs are refused outright, and product
// titles are screened for explicit terms. Matching is
// word-boundary on tokenised text, so innocent substrings
// never trip it ("Middlesex", "Essex", a breast pump, a police
// costume's accessories all pass). The clinical vocabulary of
// ordinary puberty/anatomy books is deliberately NOT screened.
const ADULT_TLDS = new Set(['xxx', 'adult', 'porn', 'sex', 'tube', 'fans'])

const ADULT_HOSTS = [
  'adamandeve.com',
  'lovehoney.com',
  'lovehoney.co.uk',
  'lelo.com',
  'fleshlight.com',
  'tenga.co',
  'babeland.com',
  'goodvibes.com',
  'hustlerhollywood.com',
  'loverslane.com',
  'bellesa.co',
  'womanizer.com',
  'we-vibe.com',
  'satisfyer.com',
  'docjohnson.com',
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  'onlyfans.com',
]

const ADULT_TERMS = [
  'dildo',
  'dildos',
  'vibrator',
  'vibrators',
  'masturbator',
  'masturbation',
  'fleshlight',
  'butt plug',
  'butt plugs',
  'anal',
  'bdsm',
  'bondage',
  'fetish',
  'erotic',
  'erotica',
  'porn',
  'pornographic',
  'pornography',
  'hentai',
  'sex toy',
  'sex toys',
  'sextoy',
  'sextoys',
  'strap on',
  'strapon',
  'orgasm',
  'condom',
  'condoms',
  'aphrodisiac',
  'dominatrix',
  'edible underwear',
  'love doll',
  'blow up doll',
]

export function isBlockedHost(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  const tld = host.split('.').pop() ?? ''
  if (ADULT_TLDS.has(tld)) return true
  return ADULT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))
}

// True when the text carries an explicit adult term as a whole
// word or phrase. Tokenising first (non-alphanumerics become
// spaces) is what keeps the check honest: "sex" inside
// "Middlesex" is part of a longer token and never matches.
export function screenText(raw) {
  const norm = ` ${String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')} `
  return ADULT_TERMS.some((term) => norm.includes(` ${term} `) || norm.includes(` ${term}s `))
}

export function isBlockedTitle(title) {
  return screenText(title)
}

// -------------------------------------------------------------- text tidy

const ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&reg;': '',
  '&trade;': '',
}

export function decodeEntities(s) {
  let out = String(s ?? '')
  for (const [from, to] of Object.entries(ENTITIES)) out = out.split(from).join(to)
  // Numeric entities (&#8217; / &#x2019;) show up in og titles.
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  out = out.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  return out
}

// The same light tidy the ingestor applies: decode entities, drop
// ®/™, collapse whitespace.
export function cleanText(raw) {
  return decodeEntities(raw)
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fixImageUrl(raw) {
  const s = cleanText(raw)
  if (!s) return null
  if (s.startsWith('//')) return `https:${s}`
  return s
}

// -------------------------------------------------------------- extraction

function* jsonLdBlocks(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      yield JSON.parse(m[1].trim())
    } catch {
      // A malformed block shouldn't sink the others.
    }
  }
}

function productNodes(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) productNodes(item, out)
  } else if (node && typeof node === 'object') {
    const type = node['@type']
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) out.push(node)
    if (node['@graph']) productNodes(node['@graph'], out)
    if (node.itemListElement) productNodes(node.itemListElement, out)
  }
  return out
}

// A brand in JSON-LD is usually { "@type": "Brand", "name": "…" } but
// can be a plain string; category can be a string or list.
function jsonLdDetails(product) {
  const brand = product.brand
  const brandName =
    typeof brand === 'string' ? brand : brand && typeof brand === 'object' ? brand.name : ''
  const category = Array.isArray(product.category) ? product.category[0] : product.category
  return cleanText(brandName || category || '')
}

// Every Product described by a page's JSON-LD, in document order —
// a single product page yields one; a collection page's ItemList
// yields the whole list (the bulk-import fallback for stores
// without a Shopify feed). Each item carries the product's own
// published rating when its block has one (aggRatingOf).
export function extractAllFromJsonLd(html) {
  if (!html) return []
  const out = []
  for (const doc of jsonLdBlocks(html)) {
    for (const product of productNodes(doc)) {
      const title = cleanText(product.name)
      if (!title) continue
      const image = Array.isArray(product.image) ? product.image[0] : product.image
      const imageUrl = typeof image === 'string' ? fixImageUrl(image) : null
      const agg = aggRatingOf(product)
      out.push({
        title,
        image_url: imageUrl,
        details: jsonLdDetails(product),
        rating: agg?.rating ?? null,
        rating_count: agg?.rating_count ?? null,
      })
    }
  }
  return out
}

export function extractFromJsonLd(html) {
  return extractAllFromJsonLd(html)[0] ?? null
}

// A rating count as stores serialize it: a number, a numeric
// string, or a string with thousands separators ("2,648").
// Anything that doesn't reduce to a positive integer is no count.
function parseRatingCount(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(digits)) return null
  const n = Number(digits)
  return n > 0 ? n : null
}

// The store's own rating for the page's Product, from the
// aggregateRating in its JSON-LD — the structured data the store
// publishes for search engines. Returns
// { rating, rating_count } with rating on the usual 0–5 scale
// (rescaled when the block declares a different bestRating),
// rounded to one decimal. Null when the block carries a value but
// no usable count (a rating never travels without the number of
// reviews behind it), and null when no Product on the page
// publishes a sane rating — many stores load their
// reviews through a widget (Bazaarvoice, Trustpilot, Okendo)
// and never put the number in the static HTML at all.
// One Product node's aggregateRating, normalised (see
// extractAggregateRating for the rules), or null.
export function aggRatingOf(product) {
  const agg = Array.isArray(product?.aggregateRating)
    ? product.aggregateRating[0]
    : product?.aggregateRating
  if (!agg || typeof agg !== 'object') return null
  let value = Number(agg.ratingValue)
  if (!Number.isFinite(value) || value <= 0) return null
  const best = Number(agg.bestRating ?? 5)
  if (Number.isFinite(best) && best > 5) value = (value * 5) / best
  if (value > 5) return null
  // Rule 3: a rating is only ever reported with a review count behind
  // it. A bare ratingValue is treated as "no rating published".
  const rating_count = parseRatingCount(agg.ratingCount) ?? parseRatingCount(agg.reviewCount)
  if (rating_count === null) return null
  return {
    rating: Math.round(value * 10) / 10,
    rating_count,
  }
}

export function extractAggregateRating(html) {
  if (!html) return null
  for (const doc of jsonLdBlocks(html)) {
    for (const product of productNodes(doc)) {
      const agg = aggRatingOf(product)
      if (agg) return agg
    }
  }
  return null
}

function metaContent(html, property) {
  // Attribute order varies between stores; check both orders.
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1])
  }
  return ''
}

export function extractFromOpenGraph(html) {
  if (!html) return null
  const title = cleanText(metaContent(html, 'og:title'))
  if (!title) return null
  return {
    title,
    image_url: fixImageUrl(metaContent(html, 'og:image')),
    details: '',
  }
}

// The page's declared Open Graph type ('product', 'website', …),
// lowercased — one of the signals that separates a product page
// from a listing page wearing its category name as og:title.
export function extractOgType(html) {
  if (!html) return ''
  return cleanText(metaContent(html, 'og:type')).toLowerCase()
}

// ------------------------------------------------- Shopify normalisation

// Human-readable details for the product_types the known stores use,
// merged from the ingestor's per-store maps (unambiguous entries only);
// anything else falls back to the store's own type text.
const DETAILS_BY_TYPE = {
  Tonie: 'Tonie figure',
  'Creative Tonie': 'Creative Tonie',
  'Clever Tonie': 'Clever Tonie',
  'My First Tonie': 'My First Tonie',
  Audiobook: 'Audiobook Tonie',
  'Single Story': 'Story reel',
  'single-card': 'Yoto Card',
  bundle: 'Yoto Card pack',
  'soft-bundle': 'Yoto Card pack',
  Crafties: 'Craftie figure',
  Tokens: 'Token',
  'Picture Books': 'Picture book',
  'Board Books': 'Board book',
  'Learning Sets': 'Learning set',
  'Content Bundle': 'Content bundle',
  'Activity Books': 'Activity book',
  'Card Sets': 'Card set',
  Puzzles: 'Puzzle',
  'Trivia Decks': 'Trivia deck',
  game: 'Osmo game',
}

// The bundle signal, from the same type evidence DETAILS_BY_TYPE
// already encodes: these product_types ARE packs (their details
// text says so), and these details strings — however a row
// acquired them, including the title rules in
// applyCollectionTitleRules — mean the row is a bundle. Insert
// paths stamp is_bundle from this so a parent adding a pack can
// never stock it as a plain single (the completeness recon's
// leak: insertCatalogRows never set the flag at all). Contents
// are NOT extracted here — the completeness sweep owns those,
// via the catalog_completeness_gaps queue (migration 0054).
const BUNDLE_TYPES = new Set(['bundle', 'soft-bundle', 'Content Bundle'])
const BUNDLE_DETAILS = new Set(['Yoto Card pack', 'Content bundle', 'Dream Machine story collection'])

export function isBundleType(type) {
  return BUNDLE_TYPES.has(cleanText(type))
}

export function isBundleDetails(details) {
  return BUNDLE_DETAILS.has(cleanText(details))
}

// One product from a Shopify /products/<handle>.json response
// ({ product: {...} } — or the product object itself) → catalog row.
// No filtering here, unlike the bulk ingestor: the user asked for
// this specific product. The row also carries the suggested age
// range read from the product's tags/description (extractAgeRange)
// and a rating only when the source object itself carries one
// (the synthetic products built from JSON-LD do; real Shopify
// feeds don't publish ratings, so theirs stay null — the
// function enriches small imports from the product pages).
export function normalizeShopifyProduct(json, platform) {
  const p = json && typeof json === 'object' && json.product ? json.product : json
  if (!p || typeof p !== 'object') return null
  const title = cleanText(p.title)
  if (!title) return null
  const type = cleanText(p.product_type)
  const image =
    (typeof p.image === 'string' ? p.image : p.image?.src) ??
    (Array.isArray(p.images) ? (typeof p.images[0] === 'string' ? p.images[0] : p.images[0]?.src) : null)
  const ages = extractAgeRange(p)
  return {
    platform,
    title,
    details: DETAILS_BY_TYPE[type] ?? type,
    is_bundle: isBundleType(type),
    image_url: fixImageUrl(image),
    age_min_years: ages?.age_min_years ?? null,
    age_max_years: ages?.age_max_years ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    rating_count: typeof p.rating_count === 'number' ? p.rating_count : null,
  }
}

// One product from a Shopify /search/suggest.json response → search
// candidate. The suggest payload carries a path-only url with
// tracking query params, so only its pathname is kept.
export function normalizeSuggestResult(store, product) {
  if (!product || typeof product !== 'object') return null
  const title = cleanText(product.title)
  if (!title) return null
  let path = ''
  try {
    path = new URL(product.url ?? '', store.origin).pathname
  } catch {
    path = ''
  }
  if (!path.startsWith('/products/')) return null
  const featured = product.featured_image?.url ?? product.featured_image?.src ?? product.image
  return {
    platform: store.platform,
    title,
    details: '',
    image_url: fixImageUrl(featured),
    source_url: `${store.origin}${path}`,
  }
}

// Dedupe key shared by the function's search mode and the tests:
// platform + normalised title (the app's own duplicate rule, in spirit).
export function candidateKey(candidate) {
  return `${candidate.platform}|${cleanText(candidate.title).toLowerCase()}`
}

// ------------------------------------------------------- Shopify paths

// What kind of Shopify page a pasted link points at. Product wins
// over collection: /collections/<h>/products/<p> is a product page
// that happens to be scoped to a collection. Locale prefixes
// (/en-us/…) and trailing segments don't matter — the scan looks for
// the keyword segments anywhere in the path.
export function parseShopifyPath(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { kind: 'other' }
  }
  const segments = url.pathname.split('/').filter((s) => s !== '')
  const handleAfter = (keyword) => {
    const i = segments.indexOf(keyword)
    if (i === -1 || i === segments.length - 1) return null
    const raw = segments[i + 1]
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const product = handleAfter('products')
  if (product) return { kind: 'product', handle: product }
  const collection = handleAfter('collections')
  if (collection) return { kind: 'collection', handle: collection }
  return { kind: 'other' }
}

// One page of a collection's product feed — the same public JSON
// the ingestor walks for whole stores.
export function collectionPageUrl(origin, handle, page) {
  return `${origin}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`
}

// ------------------------------------------------------- product facts
//
// What a pasted collection import keeps: EVERYTHING on the page.
// (The offline ingestor curates whole store feeds with its own
// keep/drop rules in ingestor/lib/sources.mjs; a parent pasting
// one collection link asked for that page's items, so this path
// adds them all — dedupe against the catalog still applies.)
// Each row also picks up the facts the feed itself publishes:
// the picture (normalizeShopifyProduct) and the suggested ages
// (extractAgeRange below).

const AGE_UNIT = '(?:months?|mos\.?|years?|yrs\.?)'
const AGE_RANGE_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${AGE_UNIT})?\\s*(?:[-\u2013\u2014]|\\bto\\b)\\s*(\\d+(?:\\.\\d+)?)\\s*(${AGE_UNIT})?`,
  'i',
)
const AGE_SINGLE_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${AGE_UNIT})?\\s*(?:\\+|and up|& up)`,
  'i',
)

function ageAmount(numStr, unitStr) {
  const n = Number(numStr)
  if (!Number.isFinite(n)) return null
  const u = String(unitStr ?? '').toLowerCase()
  if (u.startsWith('mo')) return n / 12
  return n // years, yrs, or unitless (inherits/resolved by caller)
}

// One age text ("6 - 36 months", "9 months - 3 years", "3+") →
// { age_min_years, age_max_years } in decimal years (one decimal
// place, matching catalog_items numeric(3,1)), or null when the
// text holds nothing sane. A unitless side of a range inherits
// the other side's unit.
function parseAgeText(text) {
  const s = String(text ?? '')
  const range = s.match(AGE_RANGE_RE)
  if (range) {
    const loUnit = range[2] ?? range[4]
    const hiUnit = range[4] ?? range[2]
    let lo = ageAmount(range[1], loUnit)
    let hi = ageAmount(range[3], hiUnit)
    if (lo !== null && hi !== null) {
      lo = Math.round(lo * 10) / 10
      hi = Math.round(hi * 10) / 10
      if (lo >= 0 && hi >= lo && hi <= 18) return { age_min_years: lo, age_max_years: hi }
    }
    return null
  }
  const single = s.match(AGE_SINGLE_RE)
  if (single) {
    const lo = ageAmount(single[1], single[2])
    if (lo !== null && lo >= 0 && lo <= 18) {
      return { age_min_years: Math.round(lo * 10) / 10, age_max_years: null }
    }
  }
  return null
}

// The suggested age range a Shopify product publishes about
// itself: structured tags first (Little Tikes writes
// 'Age:6 - 36 months'; other stores use 'ages 3+' style tags),
// then the description text around the word "age(s)". Stores
// that publish neither simply yield null — no guidance, like
// every other ageless catalog row.
export function extractAgeRange(product) {
  const tags = productTags(product)
  for (const tag of tags) {
    if (!/age/i.test(tag)) continue
    const parsed = parseAgeText(tag)
    if (parsed) return parsed
  }
  const body = cleanText(String(product?.body_html ?? '').replace(/<[^>]*>/g, ' '))
  if (body) {
    const snippets = body.match(/\bages?\b[^.;]{0,40}/gi) ?? []
    for (const snippet of snippets) {
      const parsed = parseAgeText(snippet)
      if (parsed) return parsed
    }
  }
  return null
}

function productTags(p) {
  if (Array.isArray(p?.tags)) return p.tags.map((t) => String(t).trim())
  if (typeof p?.tags === 'string')
    return p.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  return []
}

// Which platform one product from a pasted link belongs to.
// Only Little Tikes splits: it's a general toy store (its own
// platform), but its Dream Machine line is projector content —
// the same title rule the projector shelf has always used.
// Accepts a Shopify product or a bare title (search/add paths).
export function platformForProduct(urlPlatform, product) {
  if (urlPlatform !== 'littletikes') return urlPlatform
  const title = cleanText(
    typeof product === 'string' ? product : (product?.title ?? ''),
  )
  return /^Story Dream Machine/i.test(title) ? 'projector' : 'littletikes'
}

// The ingestor also tidies titles per store (the format/line name
// moves into details). Bulk-added rows must match that convention
// or the (platform, title) dedupe would treat "… Tonie" and "…"
// as different products and stock both.
function applyCollectionTitleRules(platform, row) {
  if (platform === 'tonies' && row.title.endsWith(' Tonie')) {
    row.title = row.title.slice(0, -' Tonie'.length).trim()
  }
  if (platform === 'projector' && row.title.startsWith('Story Dream Machine ')) {
    row.title = row.title.slice('Story Dream Machine '.length).trim()
    row.details = /collection|colección|\bpack\b/i.test(row.title)
      ? 'Dream Machine story collection'
      : 'Dream Machine story cartridge'
  }
  if (platform === 'storypod' && !row.details && /^recordable token$/i.test(row.title)) {
    row.details = 'Token'
  }
  if (platform === 'osmo' && !row.details) {
    row.details = 'Osmo game'
  }
  return row
}

// Plan a bulk import: normalise a collection's products (all of
// them — see "product facts" above), and split them against the
// titles already in the catalog. Pure — the function does the
// fetching and inserting, this decides what goes where, and the
// tallies always reconcile: toAdd + alreadyPresent +
// skippedFiltered = products in.
//
// existingTitles is the catalog's current titles for the platform
// (compared case-insensitively, like the app's duplicate rule).
// A repeat inside the feed itself counts as alreadyPresent — by the
// time the import finishes, it is.
export function planCollectionImport(products, existingTitles, platform, origin = '') {
  const existing = new Set()
  for (const t of existingTitles ?? []) existing.add(cleanText(t).toLowerCase())
  const seen = new Set()
  const toAdd = []
  let alreadyPresent = 0
  let skippedFiltered = 0
  let blockedContent = 0
  for (const product of products ?? []) {
    // No keep/drop rules on this path (see "product facts"
    // above): everything on the page is planned. skippedFiltered
    // now counts only products too broken to normalise (no title).
    const normalised = normalizeShopifyProduct(product, platform)
    if (!normalised) {
      skippedFiltered++
      continue
    }
    const row = applyCollectionTitleRules(platform, { ...normalised })
    // The title rules can mint a bundle details string the raw
    // type never carried (a Dream Machine collection) — the
    // details text is bundle evidence too.
    row.is_bundle = row.is_bundle === true || isBundleDetails(row.details)
    if (isBlockedTitle(row.title)) {
      blockedContent++
      continue
    }
    const key = row.title.toLowerCase()
    if (existing.has(key) || seen.has(key)) {
      alreadyPresent++
      continue
    }
    seen.add(key)
    if (origin && product.handle) row.source_url = `${origin}/products/${product.handle}`
    if (!row.source_url && product.url) row.source_url = product.url
    toAdd.push(row)
  }
  return { toAdd, alreadyPresent, skippedFiltered, blockedContent }
}

// ---------------------------------------------------- listing pages
//
// Not every listing page lives at /collections/<handle>: Lunii and
// LeapFrog category pages (and plenty of "all products" pages) have
// other shapes, and a parent pasting one expects the products on it
// — never the page itself added as a single "product" (the bug this
// section exists to fix). Two pure helpers give the function a
// generic way in: find the product links on the page, and plan an
// import from already-normalised rows.

// Product-page links found in a page's HTML: absolute, same-origin,
// de-duplicated, query/hash dropped (tracking params would splinter
// source_urls). A link counts when its path has a product shape — a
// /products/<handle> segment (every Shopify store, plus Lunii) or
// LeapFrog's Magento shape /store/p/<slug>.
export function extractProductLinks(html, pageUrl, limit = 48) {
  if (!html || !pageUrl) return []
  let base
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  const out = []
  const seen = new Set()
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi
  let m
  while ((m = re.exec(html)) && out.length < limit) {
    let u
    try {
      u = new URL(decodeEntities(m[1]), base)
    } catch {
      continue
    }
    if (u.origin !== base.origin) continue
    const segments = u.pathname.split('/').filter((s) => s !== '')
    const hasProductSegment = segments.some((s, i) => s === 'products' && i < segments.length - 1)
    const hasLeapfrogShape = u.pathname.includes('/store/p/')
    if (!hasProductSegment && !hasLeapfrogShape) continue
    u.search = ''
    u.hash = ''
    if (seen.has(u.href)) continue
    seen.add(u.href)
    out.push(u.href)
  }
  return out
}

// Plan a bulk import from already-normalised rows ({title, details,
// image_url, source_url} — the shape page extraction produces), with
// the same title tidying and duplicate rules planCollectionImport
// applies to Shopify feeds. skippedFiltered is always 0: extraction
// has no store feed rules to filter by, so every titled row either
// adds or was already present.
export function planRowImport(rows, existingTitles, platform) {
  const existing = new Set()
  for (const t of existingTitles ?? []) existing.add(cleanText(t).toLowerCase())
  const seen = new Set()
  const toAdd = []
  let alreadyPresent = 0
  let blockedContent = 0
  for (const raw of rows ?? []) {
    const title = cleanText(raw?.title)
    if (!title) continue
    if (isBlockedTitle(title)) {
      blockedContent++
      continue
    }
    const row = applyCollectionTitleRules(platform, {
      title,
      details: cleanText(raw.details ?? ''),
      is_bundle: raw?.is_bundle === true,
      image_url: fixImageUrl(raw.image_url) ?? '',
      source_url: typeof raw.source_url === 'string' ? raw.source_url : '',
      age_min_years: typeof raw.age_min_years === 'number' ? raw.age_min_years : null,
      age_max_years: typeof raw.age_max_years === 'number' ? raw.age_max_years : null,
      rating: typeof raw.rating === 'number' ? raw.rating : null,
      rating_count: typeof raw.rating_count === 'number' ? raw.rating_count : null,
    })
    row.is_bundle = row.is_bundle || isBundleDetails(row.details)
    const key = row.title.toLowerCase()
    if (!key) continue
    if (existing.has(key) || seen.has(key)) {
      alreadyPresent++
      continue
    }
    seen.add(key)
    toAdd.push(row)
  }
  return { toAdd, alreadyPresent, skippedFiltered: 0, blockedContent }
}
