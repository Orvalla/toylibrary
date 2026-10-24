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
  { key: '10-12', label: 'Ages 10–12', min: 10, max: 12.99 },
  { key: '13+', label: 'Ages 13+', min: 13, max: 99 },
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

// Has this child aged OUT of the item — its suggested range
// ends below their age, so it's a baby toy for a toddler?
// Only a stated max can age a child out: "Ages 3+" items and
// no-guidance items never do, and neither does an unknown age.
// The mirror case (range starts above their age) is fine —
// they'll grow into it.
export function agedOutOf(entry, ageYears) {
  if (ageYears == null) return false
  const max = entry?.age_max_years
  return max != null && ageYears > max
}

// Does the item belong in a filter band (AGE_BANDS keys)?
// An item with a stated range matches every band it overlaps.
// An open-ended item ("Ages 8+", no max — how nearly all board
// games are graded) matches its starting band and the one band
// above it: a printed starting age reaches a little way up, but
// treating no-max as "to 99" flooded the 13+ shelf with every
// "Ages 2+" toddler game in the catalog.
export function inAgeBand(entry, bandKey) {
  const bandIdx = AGE_BANDS.findIndex((b) => b.key === bandKey)
  if (bandIdx === -1) return true
  const band = AGE_BANDS[bandIdx]
  const min = entry?.age_min_years
  const max = entry?.age_max_years
  if (min == null && max == null) return false
  if (max != null) {
    const lo = min ?? 0
    return lo <= band.max && max >= band.min
  }
  const startIdx = AGE_BANDS.findIndex((b) => min <= b.max)
  const start = startIdx === -1 ? AGE_BANDS.length - 1 : startIdx
  return bandIdx === start || bandIdx === start + 1
}
