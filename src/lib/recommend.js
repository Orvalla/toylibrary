// Tailored gift ideas for one child, from the data the
// onboarding questionnaire collects: the devices they have
// (only content for those platforms can actually be played),
// their interest tags, and their age (for book formats).
//
// Pure and deterministic — same inputs, same list — so it can
// be unit-tested and reasoned about. Scoring:
//   +3 per interest keyword hit in the title/details
//   +2 when a book's format fits the child's age band
//   +1 for bundles (an easy one-box gift)
// Ties break by catalog order. When nothing matches an interest,
// the top-up is simply the front of the catalog for their
// platforms — better a solid classic than an empty shelf.

import { INTERESTS, ageYears } from './onboarding'
import { itemKey } from './bundles'

function keywordHit(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

function bookAgeFit(details, age) {
  if (age == null) return false
  const d = String(details ?? '').toLowerCase()
  if (age < 3) return d.includes('board')
  if (age <= 6) return d.includes('picture')
  return d.includes('chapter')
}

export function recommendForChild({
  catalog,
  child,
  ownedPlatforms,
  ownedKeys,
  wishlistKeys,
  limit = 8,
  today = new Date(),
}) {
  const allowed = new Set([...(ownedPlatforms ?? []), 'books', 'projector'])
  const age = ageYears(child?.birth_date, today)
  const interests = INTERESTS.filter((i) => (child?.interests ?? []).includes(i.key))

  const scored = []
  for (const entry of catalog ?? []) {
    if (entry.item_type === 'device') continue
    if (!allowed.has(entry.platform)) continue
    const k = itemKey(entry.platform, entry.title)
    if (ownedKeys?.has(k) || wishlistKeys?.has(k)) continue
    const text = `${entry.title} ${entry.details ?? ''}`
    let score = 0
    for (const interest of interests) {
      if (interest.keywords.some((kw) => keywordHit(text, kw))) score += 3
    }
    if (entry.platform === 'books' && bookAgeFit(entry.details, age)) score += 2
    if (entry.is_bundle) score += 1
    scored.push({ entry, score })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.sort_order ?? 0) - (b.entry.sort_order ?? 0) ||
      a.entry.title.localeCompare(b.entry.title)
  )
  return scored.slice(0, limit).map((s) => s.entry)
}
