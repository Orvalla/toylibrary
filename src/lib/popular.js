// What "Popular" sorts by (owner design, 2026-10-24): the
// unified popularity_score that ingestor/popularity.mjs
// computes weekly — on-site family behavior (have / wish /
// claimed), manufacturer review scores, rankings & lists
// (NYT bestseller weeks for books), all on top of a base
// from the maker's own list order.
//
// Rows the scorer hasn't reached yet (brand-new additions
// between runs) carry no score; for those the client
// derives the same base the scorer would — the within-
// platform percentile of the maker's list order, weighted
// identically (BASE_WEIGHT mirrors W.base in the scorer) —
// so a new item slots into its brand's cohort instead of
// jumping the queue or sinking to the bottom. Ties break
// by within-brand rank, then brand registry order, then
// title: deterministic everywhere.

import { PLATFORMS } from './platforms'

const PLATFORM_INDEX = new Map(PLATFORMS.map((p, i) => [p.key, i]))
const BASE_WEIGHT = 0.4

function byCatalogOrder(a, b) {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.title.localeCompare(b.title) ||
    String(a.id).localeCompare(String(b.id))
  )
}

// Rank (0 = the platform's first item) and size per
// platform, computed over the FULL catalog — never a
// filtered view, so a row keeps one true rank whatever
// shelf it appears on. Rows stream in in catalog order and
// paging is stable, so a row's rank is final the moment it
// has arrived.
export function popularityIndex(catalog) {
  const byPlatform = new Map()
  for (const row of catalog ?? []) {
    const list = byPlatform.get(row.platform)
    if (list) list.push(row)
    else byPlatform.set(row.platform, [row])
  }
  const ranks = new Map()
  const sizes = new Map()
  for (const [platform, rows] of byPlatform) {
    sizes.set(platform, rows.length)
    ;[...rows].sort(byCatalogOrder).forEach((row, i) => ranks.set(row.id, i))
  }
  return { ranks, sizes }
}

// The fallback ranking for an unscored row: the base
// component of the unified score, from list order alone.
export function fallbackScore(entry, index) {
  const rank = index?.ranks.get(entry.id)
  const size = index?.sizes.get(entry.platform)
  if (rank == null || !size) return 0
  return BASE_WEIGHT * ((size - rank) / size)
}

export function effectiveScore(entry, index) {
  return entry.popularity_score != null
    ? Number(entry.popularity_score)
    : fallbackScore(entry, index)
}

export function sortByPopularity(entries, index) {
  const rankOf = (e) => index?.ranks.get(e.id) ?? Number.MAX_SAFE_INTEGER
  const platformOf = (e) => PLATFORM_INDEX.get(e.platform) ?? PLATFORMS.length
  return [...(entries ?? [])].sort(
    (a, b) =>
      effectiveScore(b, index) - effectiveScore(a, index) ||
      rankOf(a) - rankOf(b) ||
      platformOf(a) - platformOf(b) ||
      a.title.localeCompare(b.title)
  )
}
