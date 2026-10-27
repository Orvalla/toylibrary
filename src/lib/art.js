// The Arts & Crafts section (owner-directed 2026-10-27): the
// truly pure art, sequestered to its own shelf — art supplies
// and craft kits, as opposed to STEAM's art-tech (paper
// circuits, conductive dough), which stays on the STEAM shelf.
//
// Membership is derived from data the catalog already has:
//   * Crayola is a pure art-supplies platform — every row is in.
//   * In the mixed toy brands, only the maker's own art lines
//     qualify, matched on the exact category text the maker's
//     store wrote into the row's details (the same details the
//     ingestor already carries). Melissa & Doug's "Colors &
//     Shapes" learning toys, Djeco's toddler puzzles and
//     rattles, and Mudpuppy's jigsaws are NOT art-making and
//     stay out — they live on their own shelves.
const ART_DETAILS = {
  melissaanddoug: new Set([
    'Stickers & Sticker Books',
    'Craft & Stamp Kits',
    'Easels & Art Supplies',
    'Arts & Crafts',
  ]),
  djeco: new Set([
    'Water colouring set',
    'Water colouring folder',
    'Finger paint tubes',
    'First collage kit',
    '6 creative activities box',
  ]),
  eeboo: new Set(['Art set', 'Color pencils']),
  mudpuppy: new Set([
    'Scratch & Sparkle Art Activity Kit',
    'Color By Sticker Activity Kit',
    'Coloring & Activity',
    'Coloring Book',
    'Sticker Tin',
  ]),
}

// Does this catalog row belong on the Arts & Crafts shelf?
export function isArtRow(item) {
  if (!item) return false
  if (item.platform === 'crayola') return true
  const lines = ART_DETAILS[item.platform]
  return !!lines && lines.has(String(item.details ?? '').trim())
}
