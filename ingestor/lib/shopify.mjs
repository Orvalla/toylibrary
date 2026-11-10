import { getJson } from './http.mjs'
import { cleanTitle, stripPrefix, stripSuffix } from './normalize.mjs'
import { isBundleRow } from './sources.mjs'

// Language derivation from Shopify `language:` tags. Yoto's feed
// tags every product with its maker's own classification
// (language:French, language:Spanish, language:en, …) — the
// evidence the 2026-10-28 language pass used to correct 244 stored
// rows. Names map onto the catalog's language codes (migrations
// 0039/0042/0061); a product carrying two distinct real languages
// is 'multi'; a tag the catalog has no code for (Various, Chinese,
// Romanian) derives nothing, so the row lands with the column
// default rather than a guessed language. Only sources that opt
// in via `languageTags` get a derived language — the other stores'
// tag vocabularies were never audited for this.
const LANGUAGE_TAG_CODES = {
  english: 'en', en: 'en', 'en-gb': 'en', 'en-us': 'en',
  spanish: 'es', es: 'es',
  french: 'fr', fr: 'fr',
  german: 'de', de: 'de',
  italian: 'it', it: 'it',
  dutch: 'nl', nl: 'nl',
  russian: 'ru', ru: 'ru',
}

export function languageFromTags(tags) {
  const codes = new Set()
  for (const tag of tags ?? []) {
    const m = /^language:\s*(.+)$/i.exec(String(tag))
    if (!m) continue
    // Compound values exist in the feed ('English & Spanish').
    for (const part of m[1].split(/\s*(?:&|,|\/)\s*/)) {
      const code = LANGUAGE_TAG_CODES[part.trim().toLowerCase()]
      if (code) codes.add(code)
    }
  }
  if (codes.size === 0) return undefined
  if (codes.size === 1) return [...codes][0]
  return 'multi'
}

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
//   languageTags    derive the row's catalog language from the
//                   feed's `language:` tags (languageFromTags
//                   above); the mapped row carries `language`
//                   only when a code was actually derived.

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

  const language = source.languageTags ? languageFromTags(p.tags) : undefined

  return {
    platform: source.platform,
    title,
    details,
    image_url: p.images?.[0]?.src ?? '',
    source_url: `${source.base}/products/${p.handle}`,
    is_bundle: isBundleRow(source, { product_type: p.product_type ?? '', title, details }),
    ...(language ? { language } : {}),
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
