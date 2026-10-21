import { getText, mapPool } from './http.mjs'
import { cleanTitle } from './normalize.mjs'
import { extractOg } from './leapfrog.mjs'

// Lunii adapter. lunii.com is a Next.js storefront (the us.lunii.com
// subdomain doesn't resolve) and there is no product feed, but:
//   * https://lunii.com/api/products-sitemap.xml lists every product
//     page per locale — the US store is the /en-us/ tree (544 URLs),
//   * each product page carries og:title / og:image, and content
//     products are titled "<Title> | Audiobooks | Lunii" while the
//     hardware lines (Storyteller/FLAM device bundles, rentals, gift
//     subscriptions, headphones) carry plain titles.
// So: read the sitemap, keep the /en-us/products/ URLs, fetch the
// pages, and keep only the Audiobooks line.
//
// Store choice: the en-us storefront IS the US store and its content
// line is ~535 albums — far past the point of needing the French
// store. The two are never mixed: this adapter only ever reads the
// one locale path in the source config. (Like Yoto's US store, the
// en-us storefront also sells some French/Spanish-language albums.)

const CONTENT_TITLE = /^(.+?)\s*\|\s*Audiobooks\s*\|\s*Lunii\s*$/

export function extractSitemapUrls(xml, pathPart) {
  const urls = []
  for (const m of String(xml ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = m[1].trim()
    if (url.includes(pathPart)) urls.push(url)
  }
  return [...new Set(urls)]
}

// og titles arrive with numeric entities (&#x27; etc.) that the shared
// decodeEntities map doesn't cover; resolve them before matching.
export function decodeNumericEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

export function mapLuniiPage(url, og) {
  const m = decodeNumericEntities(og.title).match(CONTENT_TITLE)
  if (!m) return null
  const title = cleanTitle(m[1])
  if (!title) return null
  return {
    platform: 'lunii',
    title,
    details: 'Story album',
    image_url: og.image ?? '',
    source_url: url,
  }
}

export async function ingestLunii(source, log = console.log) {
  const maxProducts = source.maxProducts ?? 800
  const xml = await getText(source.sitemap)
  const urls = extractSitemapUrls(xml, source.localePath).slice(0, maxProducts)
  log(`  lunii: sitemap → ${urls.length} ${source.localePath} product pages`)

  const byTitle = new Map()
  const pages = await mapPool(urls, 6, async (url) => {
    try {
      return { url, html: await getText(url, { retries: 1, timeoutMs: 25000 }) }
    } catch {
      return null
    }
  })
  let fetched = 0
  for (const page of pages) {
    if (!page) continue
    fetched++
    const row = mapLuniiPage(page.url, extractOg(page.html))
    if (row && !byTitle.has(row.title.toLowerCase())) {
      byTitle.set(row.title.toLowerCase(), row)
    }
  }
  log(`  lunii: fetched ${fetched}/${urls.length} pages, ${byTitle.size} albums kept`)
  return [...byTitle.values()]
}
