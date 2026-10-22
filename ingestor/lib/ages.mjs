// Suggested-age defaults for catalog rows, mirroring the
// backfill in supabase/migrations/0016_catalog_ages.sql —
// manufacturer age grades by platform, format bands for
// books. Used by ingestor/weekly.mjs so newly ingested
// products arrive with ages attached. A store-stated age for
// a specific product should override these defaults.
// Returns { age_min_years, age_max_years } (numbers, years).

const BOOK_BANDS = [
  [/board/i, 0, 3],
  [/picture/i, 3, 6],
  [/early reader|beginning reader|first reader/i, 4, 7],
  [/graphic/i, 6, 11],
  [/chapter/i, 7, 10],
]

const PLATFORM_DEFAULTS = {
  tonies: [3, 8],
  yoto: [3, 9],
  leapfrog: [2, 7],
  storypod: [2, 6],
  lunii: [3, 8],
  projector: [3, 6],
  osmo: [3, 10],
  vtech: [1, 5],
  other: [3, 8],
}

export function ageForRow(row) {
  const platform = row.platform
  const details = row.details ?? ''
  if (platform === 'books') {
    for (const [re, min, max] of BOOK_BANDS) {
      if (re.test(details)) return { age_min_years: min, age_max_years: max }
    }
    return { age_min_years: 3, age_max_years: 8 }
  }
  if (row.item_type === 'device') {
    if (platform === 'yoto') return { age_min_years: 3, age_max_years: 12 }
    if (platform === 'tonies' || platform === 'leapfrog')
      return { age_min_years: 3, age_max_years: 10 }
    if (platform === 'projector' && /moonlite/i.test(row.title ?? ''))
      return { age_min_years: 1, age_max_years: 6 }
  }
  const [min, max] = PLATFORM_DEFAULTS[platform] ?? [3, 8]
  return { age_min_years: min, age_max_years: max }
}
