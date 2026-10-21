// Catalog categories: the shelf an item belongs on, derived from
// what the catalog already knows about it — no new data to maintain.
//
//   * devices are their own category (catalog_items.item_type),
//   * everything on the books platform is a book,
//   * otherwise the details text the stores/ingestor already wrote
//     decides: "Tonie figure" is a figure, "LeapStart book" is a
//     book, "Yoto Card" is a card, "Game cartridge" is a game.
//   * anything else is audio-first content — stories, songs, albums,
//     tokens, reels — and lands in 'Audio & more'.

export const CATEGORIES = ['Figures', 'Books', 'Cards', 'Games', 'Devices', 'Audio & more']

export function categoryOf(item) {
  if (!item) return 'Audio & more'
  if (item.item_type === 'device') return 'Devices'
  if (item.platform === 'books') return 'Books'
  const details = String(item.details ?? '').toLowerCase()
  if (details.includes('figure')) return 'Figures'
  if (details.includes('book')) return 'Books'
  if (details.includes('card')) return 'Cards'
  if (details.includes('game')) return 'Games'
  return 'Audio & more'
}
