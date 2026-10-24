// Match vision detections from a shelf photo against catalog
// rows. The vision model returns titles as printed ("Paw Patrol
// — Chase", "The Very Hungry Caterpillar"), which rarely equal
// the catalog's exact strings, so matching is word-based: how
// much of the detection's distinctive words appear in the
// catalog title, with a small bonus when the guessed platform
// agrees. Pure and deterministic — same inputs, same match.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'with', 'in', 'on', 'to', 'for',
  'tonie', 'tonies', 'yoto', 'card', 'cards', 'figure', 'figures',
  'book', 'books', 'collection', 'story', 'stories', 'set',
])

export function titleWords(title) {
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w))
  )
}

export function matchScore(detection, entry) {
  const d = titleWords(detection?.title)
  const e = titleWords(entry?.title)
  if (!d.size || !e.size) return 0
  let hits = 0
  for (const w of d) if (e.has(w)) hits++
  let score = hits / d.size
  // Full mutual containment (same distinctive words both ways)
  // is an exact match in everything but punctuation/branding.
  if (hits === d.size && e.size === d.size) score = 1
  if (
    detection?.platform &&
    detection.platform !== 'other' &&
    detection.platform === entry.platform
  ) {
    score += 0.1
  }
  return score
}

function pickBest(detection, rows) {
  let best = null
  let bestScore = 0
  for (const entry of rows) {
    const s = matchScore(detection, entry)
    if (s > bestScore) {
      best = entry
      bestScore = s
    }
  }
  return bestScore >= 0.6 ? { entry: best, score: bestScore } : null
}

// The best catalog row for one detection, or null when nothing
// is close enough to suggest (the detection is then offered as
// a manual add under its printed title).
//
// The platform guess is decisive, not a tiebreaker: when the
// vision pass names a real platform, only that platform's rows
// may match. Story titles repeat across shelves by design —
// "Elmo Goes to School" is a picture book AND a Dream Machine
// cartridge — and a cross-platform title match used to offer
// the book as a confident hit for the cartridge in the photo.
// A wrong-platform "found in the catalog" is worse than an
// honest not-in-the-catalog: it files the wrong product on the
// child's shelf. Detections with no platform ('other') still
// search the whole catalog.
//
// One exception, by design: rows that carry NO platform at
// all stay eligible. bestMatch is also the scorer for
// candidate lists that aren't catalog rows — Open Library
// search docs have no platform field, and confining those to
// the detection's shelf would empty the list and break book
// cover lookups.
export function bestMatch(detection, catalog) {
  const rows = catalog ?? []
  const dp = detection?.platform
  if (dp && dp !== 'other') {
    return pickBest(detection, rows.filter((e) => !e.platform || e.platform === dp))
  }
  return pickBest(detection, rows)
}
