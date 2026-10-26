import { getJson } from './http.mjs'
import { cleanTitle, stripPrefix, stripSuffix } from './normalize.mjs'
import { isBundleRow } from './sources.mjs'

// Shopify adapter: walks the public /products.json feed (250/page)
// and maps the products a source config asks for into catalog rows:
//   { platform, title, details, image_url, source_url }
//
// A source config picks its products declaratively:
//   includeTypes    product_type allow-list (omit to accept all types —
//                   some stores' types are too generic to filter on)
//   excludeTypes    product_type deny-list, for stores whose catalogue
//                   is mostly keepable and easier to trim by type
//   includeTitle    regex the cleaned title must match
//   excludeTitle    regex the cleaned title must not match
//   excludeTags     product tags that disqualify a product
//   stripTitlePrefix / stripTitleSuffix  branding removed from titles
//   detailsByType   details text per product_type
//   detailsByTitle  [{ match, details }] — first matching rule wins,
//                   tested against the final title
//   details         fallback details text
//   bundleTypes / bundleDetails / bundleTitle — the bundle signal
//                   (lib/sources.mjs isBundleRow): the mapped row
//                   carries is_bundle so inserts stock packs as
//                   bundles, never as plain singles.

export function mapShopifyProduct(source, p) {
  if (source.includeTypes && !source.includeTypes.includes(p.product_type ?? '')) return null
  if (source.excludeTypes?.includes(p.product_type ?? '')) return null

  let title = cleanTitle(p.title)
  if (!title) return null
  if (source.includeTitle && !source.includeTitle.test(title)) return null
  if (source.excludeTitle?.test(title)) return null
  if (source.excludeTags && (p.tags ?? []).some((t) => source.excludeTags.includes(t))) return null

  if (source.stripTitlePrefix) title = stripPrefix(title, source.stripTitlePrefix)
  if (source.stripTitleSuffix) title = stripSuffix(title, source.stripTitleSuffix)
  if (!title) return null

  let details = source.detailsByType?.[p.product_type] ?? source.details ?? p.product_type ?? ''
  for (const rule of source.detailsByTitle ?? []) {
    if (rule.match.test(title)) {
      details = rule.details
      break
    }
  }

  return {
    platform: source.platform,
    title,
    details,
    image_url: p.images?.[0]?.src ?? '',
    source_url: `${source.base}/products/${p.handle}`,
    is_bundle: isBundleRow(source, { product_type: p.product_type ?? '', title, details }),
  }
}

export async function ingestShopify(source, log = console.log) {
  const rows = []
  let page = 1
  for (;;) {
    const data = await getJson(`${source.base}/products.json?limit=250&page=${page}`)
    const products = data.products ?? []
    if (!products.length) break
    for (const p of products) {
      const row = mapShopifyProduct(source, p)
      if (row) rows.push(row)
    }
    log(`  ${source.id}: page ${page} — ${products.length} products, ${rows.length} kept so far`)
    page++
    if (page > 20) throw new Error(`${source.id}: pagination runaway`)
  }
  return rows
}
