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
//
// One hard age rule on top of the scoring: an item whose
// suggested range ends below the child's age is never
// recommended — no baby toys for toddlers, however many
// interest keywords they hit. Items aimed a bit ABOVE their
// age stay eligible; they'll grow into them.
// Ties break by catalog order. When nothing matches an interest,
// the top-up is simply the front of the catalog for their
// platforms — better a solid classic than an empty shelf.

import { INTERESTS, ageYears } from './onboarding'
import { itemKey } from './bundles'
import { agedOutOf, ageFits } from './ages'
import { ALWAYS_PLAYABLE } from './platforms'
import { titleWords } from './photoMatch'

// Affinity derived from the child's own library (owner
// request 2026-10-22): what they already have is the best
// signal for what they'd want next — the next book in a
// series, another set in a system they collect. Built from
// have-list items: the distinctive words across their titles
// (series and world names live there) and how deep they are
// in each platform.
export function affinityFromItems(items) {
  const words = new Set()
  const platformCounts = new Map()
  for (const i of items ?? []) {
    if (i.list_type && i.list_type !== 'have') continue
    for (const w of titleWords(i.title)) words.add(w)
    platformCounts.set(i.platform, (platformCounts.get(i.platform) ?? 0) + 1)
  }
  return { words, platformCounts }
}

// +4 when a candidate shares two or more distinctive words
// with the library (same series/world), +1 for a single
// shared word (a franchise hint), +1 when the child already
// collects the candidate's platform (3+ items). An item they
// already own scores nothing — it's theirs, not a suggestion.
export function affinityScore(entry, affinity, ownedKeys) {
  if (!affinity) return 0
  if (ownedKeys?.has(itemKey(entry.platform, entry.title))) return 0
  let score = 0
  let shared = 0
  for (const w of titleWords(entry.title)) if (affinity.words.has(w)) shared++
  if (shared >= 2) score += 4
  else if (shared === 1) score += 1
  if ((affinity.platformCounts.get(entry.platform) ?? 0) >= 3) score += 1
  return score
}

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

// Suggestion score for SORTING the catalog (not a filtered
// recommendation list): everything stays visible, the most
// relevant floats up. Same signals as recommendForChild, plus
// a platform-fit term — content for a player the child owns
// (or the always-playable books/projector) outranks content
// for players they don't have.
export function suggestionScore(
  entry,
  { child, ownedPlatforms, affinity, ownedKeys, today = new Date() } = {}
) {
  const allowed = new Set([...(ownedPlatforms ?? []), ...ALWAYS_PLAYABLE])
  const age = ageYears(child?.birth_date, today)
  const interests = INTERESTS.filter((i) => (child?.interests ?? []).includes(i.key))
  const text = `${entry.title} ${entry.details ?? ''}`
  let score = 0
  score += affinityScore(entry, affinity, ownedKeys)
  if (allowed.has(entry.platform)) score += 4
  for (const interest of interests) {
    if (interest.keywords.some((kw) => keywordHit(text, kw))) score += 3
  }
  if (entry.platform === 'books' && bookAgeFit(entry.details, age)) score += 2
  // Catalog age guidance (migration 0016): the child's age
  // inside the product's suggested range is a fit signal on
  // every platform, not just books.
  if (ageFits(entry, age)) score += 2
  if (entry.is_bundle) score += 1
  // A sort keeps everything visible (a parent may be hunting
  // a specific title), but an aged-out item sinks below even
  // the zero-score neutrals — it should never read as a
  // suggestion for this child.
  if (agedOutOf(entry, age)) score -= 10
  // The family's grow-into window (Settings, per child):
  // anything aimed further above their age than the window
  // sinks the same way — visible when browsed for on purpose,
  // never floated as a suggestion.
  if (
    age != null &&
    entry.age_min_years != null &&
    entry.age_min_years > age + growIntoYearsFor(child)
  )
    score -= 10
  return score
}

export function sortBySuggestions(entries, ctx) {
  return [...(entries ?? [])]
    .map((entry) => ({ entry, score: suggestionScore(entry, ctx) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.entry.sort_order ?? 0) - (b.entry.sort_order ?? 0) ||
        a.entry.title.localeCompare(b.entry.title)
    )
    .map((s) => s.entry)
}

// How far above a child's age suggestions may aim before an
// item stops counting as "they'll grow into it". Set per
// child in Settings (children.grow_into_years, migration
// 0029); unset means the long-standing default of 3. 0 means
// only items for the child's age right now.
export const DEFAULT_GROW_INTO_YEARS = 3

export function growIntoYearsFor(child) {
  const v = child?.grow_into_years
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? v
    : DEFAULT_GROW_INTO_YEARS
}

export function recommendForChild({
  catalog,
  child,
  ownedPlatforms,
  ownedKeys,
  wishlistKeys,
  affinity,
  limit = 8,
  today = new Date(),
  growIntoYears,
}) {
  // An explicit argument wins (tests, one-off callers); the
  // child's own setting is next; then the default.
  const windowYears = growIntoYears ?? growIntoYearsFor(child)
  const allowed = new Set([...(ownedPlatforms ?? []), ...ALWAYS_PLAYABLE])
  const age = ageYears(child?.birth_date, today)
  const interests = INTERESTS.filter((i) => (child?.interests ?? []).includes(i.key))

  const scored = []
  for (const entry of catalog ?? []) {
    if (entry.item_type === 'device') continue
    if (!allowed.has(entry.platform)) continue
    // Aged out is a hard exclusion here (unlike the catalog
    // sort): a recommendations list must not contain it at all.
    if (agedOutOf(entry, age)) continue
    // Grow-into window: items aimed a little above the child's
    // age stay eligible (they'll age into them), but a
    // recommendation list is gift advice — a YA novel for a
    // toddler is not "a little above". More than the family's
    // window over their age is out; a window of 0 keeps only
    // items for their age right now. (The catalog sort keeps
    // everything visible but sinks beyond-window items; this
    // exclusion shapes the shortlist.)
    if (age != null && entry.age_min_years != null && entry.age_min_years > age + windowYears)
      continue
    const k = itemKey(entry.platform, entry.title)
    if (ownedKeys?.has(k) || wishlistKeys?.has(k)) continue
    const text = `${entry.title} ${entry.details ?? ''}`
    let score = 0
    score += affinityScore(entry, affinity, ownedKeys)
    for (const interest of interests) {
      if (interest.keywords.some((kw) => keywordHit(text, kw))) score += 3
    }
    if (entry.platform === 'books' && bookAgeFit(entry.details, age)) score += 2
    if (ageFits(entry, age)) score += 2
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
