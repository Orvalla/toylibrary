// Reading stages for the books platform (owner push 2026-10-22:
// books are a headline section now, spanning picture books to
// Young Adult). A stage is an age window; a book belongs to a
// stage when its age range overlaps the window — the same
// overlap rule as the age bands (lib/ages), so a 4–8 early
// reader shows in both Picture books and Early readers, where
// it genuinely belongs in both places.

export const BOOK_STAGES = [
  { key: 'picture', label: 'Picture books', emoji: '📖', min: 0, max: 5.99, blurb: 'Ages 0–5 · read-alouds and first favourites' },
  { key: 'early', label: 'Early readers', emoji: '🔤', min: 4, max: 8.99, blurb: 'Ages 4–8 · learning to read, then reading everything' },
  { key: 'chapter', label: 'Chapter books', emoji: '📗', min: 6, max: 9.99, blurb: 'Ages 6–9 · first series, short chapters' },
  { key: 'middle', label: 'Middle grade', emoji: '📘', min: 8, max: 12.99, blurb: 'Ages 8–12 · big adventures, full novels' },
  { key: 'ya', label: 'Young adult', emoji: '📕', min: 12, max: 99, blurb: 'Ages 12+ · teen fiction up to adult crossover' },
]

export function bookStage(key) {
  return BOOK_STAGES.find((s) => s.key === key) ?? null
}

// Overlap test; a book with no age guidance belongs to no stage
// (it still shows under "All books").
export function bookInStage(book, stageKey) {
  const stage = bookStage(stageKey)
  if (!stage) return true
  const min = book?.age_min_years
  const max = book?.age_max_years
  if (min == null && max == null) return false
  const lo = min ?? 0
  const hi = max ?? 99
  return lo <= stage.max && hi >= stage.min
}

// The single best stage for a book (for badges): the most
// advanced stage whose window contains the book's minimum
// age — a novel starting at 12 is a YA book even though 12
// also overlaps the top of middle grade.
export function primaryStageOf(book) {
  const min = book?.age_min_years
  if (min == null) return null
  return [...BOOK_STAGES].reverse().find((s) => min >= s.min && min <= s.max) ?? null
}
