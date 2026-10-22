// Suggested-age helpers for catalog items. age_min_years /
// age_max_years live on catalog_items (migration 0016) —
// editorial ranges from manufacturer age grades by platform
// and, for books, by format band. Half years are allowed
// (0.5 = 6 months). NULL means "no guidance", and every helper
// here treats that as neutral rather than a mismatch.

export const AGE_BANDS = [
  { key: '0-2', label: 'Ages 0–2', min: 0, max: 2.99 },
  { key: '3-4', label: 'Ages 3–4', min: 3, max: 4.99 },
  { key: '5-6', label: 'Ages 5–6', min: 5, max: 6.99 },
  { key: '7-9', label: 'Ages 7–9', min: 7, max: 9.99 },
  { key: '10+', label: 'Ages 10+', min: 10, max: 99 },
]

const fmtAge = (y) => {
  if (y == null) return ''
  if (y === 0) return '0'
  if (y < 1) return `${Math.round(y * 12)} mo`
  return Number.isInteger(y) ? String(y) : String(y)
}

// "Ages 3–6" / "Ages 6 mo–3" / "" when there's no guidance.
export function ageLabelFor(entry) {
  const min = entry?.age_min_years
  const max = entry?.age_max_years
  if (min == null && max == null) return ''
  if (min != null && max != null) return `Ages ${fmtAge(min)}–${fmtAge(max)}`
  if (min != null) return `Ages ${fmtAge(min)}+`
  return `Up to ${fmtAge(max)}`
}

// Does the item's suggested range cover this age (in years)?
// No guidance → false (it's "unknown", not a fit).
export function ageFits(entry, ageYears) {
  if (ageYears == null) return false
  const min = entry?.age_min_years
  const max = entry?.age_max_years
  if (min == null && max == null) return false
  if (min != null && ageYears < min) return false
  if (max != null && ageYears > max) return false
  return true
}

// Does the item's range overlap a filter band (AGE_BANDS keys)?
export function inAgeBand(entry, bandKey) {
  const band = AGE_BANDS.find((b) => b.key === bandKey)
  if (!band) return true
  const min = entry?.age_min_years
  const max = entry?.age_max_years
  if (min == null && max == null) return false
  const lo = min ?? 0
  const hi = max ?? 99
  return lo <= band.max && hi >= band.min
}
