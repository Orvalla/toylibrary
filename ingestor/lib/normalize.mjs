// Title handling shared by every source adapter.
//
// Two different jobs, kept separate on purpose:
//   cleanTitle() — the display title that lands in catalog_items and,
//     from there, in parents' item lists. Store-canonical, lightly
//     tidied (entities decoded, ®/™ dropped, whitespace collapsed).
//   matchKey() — the aggressive comparison key used to dedupe the
//     catalog itself. The app's owned-checkmark compares titles the
//     same spirit (lowercase, trimmed) via items.normalized_title.

const ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&reg;': '',
  '&trade;': '',
}

export function decodeEntities(s) {
  return Object.entries(ENTITIES).reduce(
    (acc, [from, to]) => acc.split(from).join(to),
    String(s ?? '')
  )
}

export function cleanTitle(raw) {
  return decodeEntities(raw)
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchKey(title) {
  return cleanTitle(title)
    .toLowerCase()
    .replace(/[—–-]/g, ' ')
    .replace(/['':.,!®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Removes a trailing suffix (e.g. " Tonie") when present, so the title
// names the character/story and the format lives in `details` instead —
// the same convention as the hand-seeded catalog.
export function stripSuffix(title, suffix) {
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

// Removes a leading prefix (e.g. "Story Dream Machine ") when present —
// the mirror of stripSuffix for stores that brand every product title
// with the line name. The line identity survives in `details`.
export function stripPrefix(title, prefix) {
  return title.startsWith(prefix) ? title.slice(prefix.length).trim() : title
}
