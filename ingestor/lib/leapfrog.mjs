import { getText, mapPool } from './http.mjs'
import { cleanTitle, decodeEntities } from './normalize.mjs'

// LeapFrog adapter. store.leapfrog.com (Magento) has no product feed
// and its sitemap omits products, but:
//   * storefront pages link every product as /en-us/store/p/<slug>/...
//     (the header nav alone lists most of the range), and
//   * each product page carries og:title and og:image.
// So: discover product URLs from seed pages, then read the og tags.

const PRODUCT_PATH = /\/en-us\/store\/p\/[A-Za-z0-9\-/._]+/g

export function extractProductUrls(html, origin = 'https://store.leapfrog.com') {
  const found = new Set()
  for (const m of html.matchAll(PRODUCT_PATH)) {
    // Normalise: drop anything after the product id segment.
    const path = m[0].split('/_/')[0]
    if (path.split('/').filter(Boolean).length >= 4) {
      found.add(origin + m[0])
    }
  }
  return [...found]
}

export function extractOg(html) {
  const grab = (prop) => {
    const m = html.match(new RegExp(`property="og:${prop}" content="([^"]+)"`))
    return m ? decodeEntities(m[1]) : ''
  }
  return { title: grab('title'), image: grab('image') }
}

const FAMILIES = ['LeapStart', 'LeapPad', 'LeapReader', 'LeapLand', 'LeapMove', 'Learning Friends', 'My Best Pal', "Mr. Pencil's"]

export function mapLeapfrogPage(url, og) {
  let title = cleanTitle(og.title)
  title = title.replace(/^LeapFrog\s+/i, '').trim()
  if (!title || /leapfrog/i.test(title) && title.length < 12) return null
  const lower = title.toLowerCase()
  const family = FAMILIES.find((f) => lower.includes(f.toLowerCase()))
  return {
    platform: 'leapfrog',
    title,
    details: family ?? 'LeapFrog',
    image_url: og.image ?? '',
    source_url: url,
  }
}

// The store's category page embeds catalog JSON in a
// <script id="PAGE_DATA"> block (products + currentPage/totalPages/
// totalItems). Only page 1 is ever embedded, though: every query
// string (?page=2, ?p=2, facet params) returns a bare storefront
// shell with no PAGE_DATA, the pagination API the page config points
// at (storeapi.leapfrog.com) no longer resolves in public DNS, and
// the sitemaps omit products. The remaining products are reached by
// snowball crawl instead: each product page links ~10 others
// (nav + related items) and carries og:title/og:image.
export function parsePageDataBlock(html) {
  const m = html.match(/<script type="application\/json" id="PAGE_DATA">([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1].trim())
  } catch {
    return null
  }
}

export function parsePageData(html) {
  const data = parsePageDataBlock(html)
  return Array.isArray(data?.products) ? data.products : []
}

export function mapPageDataProduct(p) {
  if (!p?.name) return null
  const title = cleanTitle(p.name).replace(/^LeapFrog\s+/i, '').trim()
  if (!title) return null
  const lower = title.toLowerCase()
  const family = FAMILIES.find((f) => lower.includes(f.toLowerCase()))
  return {
    platform: 'leapfrog',
    title,
    details: family ?? 'LeapFrog',
    image_url: p.image_url ?? '',
    source_url: p.url_key
      ? `https://store.leapfrog.com/en-us/store/p/${p.url_key}/_/A-prod${p.sku ?? ''}`
      : '',
  }
}

const STORE_ORIGIN = 'https://store.leapfrog.com'

export async function ingestLeapfrog(source, log = console.log) {
  const maxProducts = source.maxProducts ?? 400
  const byTitle = new Map()
  const addRow = (row) => {
    if (row && !byTitle.has(row.title.toLowerCase())) {
      byTitle.set(row.title.toLowerCase(), row)
    }
  }

  // 1. PAGE_DATA fast path: structured rows for page 1 of the catalog,
  //    plus product URLs (pdp_url) to seed the crawl for the rest.
  const discovered = new Set()
  let sawPageData = false
  for (const seed of source.seeds) {
    try {
      const html = await getText(seed)
      const block = parsePageDataBlock(html)
      if (block && Array.isArray(block.products)) {
        sawPageData = true
        for (const p of block.products) {
          addRow(mapPageDataProduct(p))
          if (p.pdp_url) discovered.add(new URL(p.pdp_url, STORE_ORIGIN).href)
        }
        log(
          `  leapfrog: PAGE_DATA at ${seed} → ${block.products.length} products ` +
            `(page ${block.currentPage}/${block.totalPages}, ${block.totalItems} total items)`
        )
      }
      for (const u of extractProductUrls(html)) discovered.add(u)
    } catch (err) {
      log(`  leapfrog: seed ${seed} failed (${err.message})`)
    }
  }
  if (!sawPageData) {
    log('  leapfrog: no PAGE_DATA found, falling back to page crawl')
  }

  // 2. Snowball crawl: fetch product pages in waves; each page yields
  //    an og-mapped row and links to ~10 more products, until the
  //    frontier runs dry or maxProducts pages have been visited.
  //    (Server-side pagination is unreachable — see note above
  //    parsePageDataBlock — so this is how pages 2..N are covered.)
  const visited = new Set()
  let frontier = [...discovered]
  while (frontier.length && visited.size < maxProducts) {
    const wave = frontier.slice(0, maxProducts - visited.size)
    frontier = []
    const pages = await mapPool(wave, 5, async (url) => {
      visited.add(url)
      try {
        return { url, html: await getText(url, { retries: 1, timeoutMs: 20000 }) }
      } catch {
        return null
      }
    })
    for (const page of pages) {
      if (!page) continue
      addRow(mapLeapfrogPage(page.url, extractOg(page.html)))
      for (const u of extractProductUrls(page.html)) {
        if (!visited.has(u)) frontier.push(u)
      }
    }
    log(
      `  leapfrog: crawl visited ${visited.size} pages, ${byTitle.size} products so far, ${frontier.length} queued`
    )
  }

  return [...byTitle.values()]
}
