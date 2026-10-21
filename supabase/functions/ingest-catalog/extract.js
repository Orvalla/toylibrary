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
  // Little Tikes and Moonlite both feed the shared projector platform;
  // the Dream Machine line is told apart by its details text.
  ['www.littletikes.com', 'projector'],
  ['littletikes.com', 'projector'],
  ['www.mymoonlite.com', 'projector'],
  ['mymoonlite.com', 'projector'],
  ['store.leapfrog.com', 'leapfrog'],
  ['www.leapfrog.com', 'leapfrog'],
  ['leapfrog.com', 'leapfrog'],
  ['lunii.com', 'lunii'],
  ['www.lunii.com', 'lunii'],
]

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
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb'))
    return true // link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local fc00::/7
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped — judge the embedded IPv4 address.
    return ipv4IsPrivate(h.slice('::ffff:'.length)) ?? true
  }
  return false
}

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
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local')) return false
  const v4 = ipv4IsPrivate(host)
  if (v4 !== null) return v4 === false
  if (host.includes(':')) return !ipv6IsPrivate(host)
  return true
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
// without a Shopify feed).
export function extractAllFromJsonLd(html) {
  if (!html) return []
  const out = []
  for (const doc of jsonLdBlocks(html)) {
    for (const product of productNodes(doc)) {
      const title = cleanText(product.name)
      if (!title) continue
      const image = Array.isArray(product.image) ? product.image[0] : product.image
      const imageUrl = typeof image === 'string' ? fixImageUrl(image) : null
      out.push({ title, image_url: imageUrl, details: jsonLdDetails(product) })
    }
  }
  return out
}

export function extractFromJsonLd(html) {
  return extractAllFromJsonLd(html)[0] ?? null
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

// One product from a Shopify /products/<handle>.json response
// ({ product: {...} } — or the product object itself) → catalog row.
// No filtering here, unlike the bulk ingestor: the user asked for
// this specific product.
export function normalizeShopifyProduct(json, platform) {
  const p = json && typeof json === 'object' && json.product ? json.product : json
  if (!p || typeof p !== 'object') return null
  const title = cleanText(p.title)
  if (!title) return null
  const type = cleanText(p.product_type)
  const image =
    (typeof p.image === 'string' ? p.image : p.image?.src) ??
    (Array.isArray(p.images) ? (typeof p.images[0] === 'string' ? p.images[0] : p.images[0]?.src) : null)
  return {
    platform,
    title,
    details: DETAILS_BY_TYPE[type] ?? type,
    image_url: fixImageUrl(image),
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

// ------------------------------------------------- store content rules
//
// The keep/drop rules the offline ingestor applies per store
// (ingestor/lib/sources.mjs), ported so a bulk collection import
// stocks the same catalog a feed run would: content only, never
// players, bundles that duplicate singles, or accessories. The
// ingestor's config is declarative; this is the same data in the
// shape the checks below need.

function productTags(p) {
  if (Array.isArray(p?.tags)) return p.tags.map((t) => String(t).trim())
  if (typeof p?.tags === 'string')
    return p.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  return []
}

const STORE_FILTERS = {
  tonies: {
    // Content figures only — Toniebox players, bundles/sets,
    // accessories and Tonieplay games never reach the allow-list.
    includeTypes: ['Tonie', 'Creative Tonie', 'Clever Tonie', 'My First Tonie', 'Audiobook'],
    excludeTitle: /\b\d+\s*pack\b|\bbundle\b/i,
  },
  yoto: {
    includeTypes: ['single-card', 'bundle', 'soft-bundle'],
    excludeTitle: /\(Digital\)\s*$/i,
    excludeTags: ['flag:Digital Card'],
  },
  storypod: {
    excludeTypes: ['Sleeves', 'Plush'],
    excludeTitle: /charging cable|subscription buy out|\beddi\b/i,
  },
  osmo: {
    includeTitle:
      /^(Detective Agency|Genius Numbers|Genius Words|Genius Tangram|Little Genius Costume Pieces|Little Genius Sticks & Rings|Math Wizard and the|Monster|Pizza Co)/i,
    excludeTitle: /starter kit|\bbase\b|reflector|\bcase\b|bundle|series|mystery gift/i,
  },
}

// The projector platform is fed by two stores with different rules,
// told apart the same way their feeds present: Moonlite marks its
// stories with the 'Single Story' type; Little Tikes' Dream Machine
// line is recognised by title (its product types are generic).
function passesProjectorFilter(title, type) {
  if (type === 'Single Story') return !/\bpack\b|\bset\b/i.test(title)
  if (!/^Story Dream Machine/i.test(title)) return false
  return !/^Story Dream Pals\b|\bPlush\b|Starter Pack|Special Edition Pack|\bCase\b|^Build Your Own\b/i.test(
    title,
  )
}

// Would the ingestor keep this product for this platform? Platforms
// without a rule set here (leapfrog, lunii, other, …) keep
// everything with a title — they have no Shopify feed rules to
// mirror.
export function passesStoreFilter(platform, product) {
  if (!product || typeof product !== 'object') return false
  const title = cleanText(product.title)
  if (!title) return false
  const type = cleanText(product.product_type)
  if (platform === 'projector') return passesProjectorFilter(title, type)
  const rules = STORE_FILTERS[platform]
  if (!rules) return true
  if (rules.includeTypes && !rules.includeTypes.includes(type)) return false
  if (rules.excludeTypes?.includes(type)) return false
  if (rules.includeTitle && !rules.includeTitle.test(title)) return false
  if (rules.excludeTitle?.test(title)) return false
  if (rules.excludeTags && productTags(product).some((t) => rules.excludeTags.includes(t)))
    return false
  return true
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

// Plan a bulk import: filter a collection's products by the store's
// rules, normalise the survivors, and split them against the titles
// already in the catalog. Pure — the function does the fetching and
// inserting, this decides what goes where, and the tallies always
// reconcile: toAdd + alreadyPresent + skippedFiltered = products in.
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
  for (const product of products ?? []) {
    if (!passesStoreFilter(platform, product)) {
      skippedFiltered++
      continue
    }
    const normalised = normalizeShopifyProduct(product, platform)
    if (!normalised) {
      skippedFiltered++
      continue
    }
    const row = applyCollectionTitleRules(platform, { ...normalised })
    const key = row.title.toLowerCase()
    if (existing.has(key) || seen.has(key)) {
      alreadyPresent++
      continue
    }
    seen.add(key)
    if (origin && product.handle) row.source_url = `${origin}/products/${product.handle}`
    toAdd.push(row)
  }
  return { toAdd, alreadyPresent, skippedFiltered }
}
