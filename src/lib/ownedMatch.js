// "Check before you buy" matching for the public share page.
//
// The first version was a raw lowercase substring test, so
// "Paw Patrol Chase" never found "Paw Patrol — Chase" and the page
// answered "✅ you're clear" — the one wrong answer this product
// can't afford. Matching now ignores case, accents, punctuation and
// word order: every word the visitor typed must appear somewhere in
// the item's title or details.

export function normalizeForMatch(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents: "é" -> "e"
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// The have-list items that match what the visitor typed, or null when
// the query is too short to say anything useful (empty, or a single
// letter — "a" would match half the shelf).
export function findOwned(have, query) {
  const words = normalizeForMatch(query).split(' ').filter(Boolean)
  if (words.length === 0) return null
  if (words.length === 1 && words[0].length < 2) return null
  return (have ?? []).filter((item) => {
    const hay = normalizeForMatch(`${item.title ?? ''} ${item.details ?? ''}`)
    return words.every((word) => hay.includes(word))
  })
}

// The sentence for a non-empty match: names whose shelf it is on, so a
// grandparent buying for one child isn't told to skip a gift that only
// a sibling already has.
export function ownedAdvice(matches) {
  const kids = [...new Set(matches.map((m) => m.child_name).filter(Boolean))]
  return kids.length ? `best pick something else for ${kids.join(' / ')}.` : 'best pick something else.'
}
