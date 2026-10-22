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

import { TOY_PLATFORMS } from './platforms'

export const CATEGORIES = ['Figures', 'Books', 'Cards', 'Games', 'Devices', 'Toys', 'Audio & more']

export function categoryOf(item) {
  if (!item) return 'Audio & more'
  if (item.item_type === 'device') return 'Devices'
  if (item.platform === 'books') return 'Books'
  const details = String(item.details ?? '').toLowerCase()
  if (details.includes('figure')) return 'Figures'
  if (details.includes('book')) return 'Books'
  if (details.includes('card')) return 'Cards'
  if (details.includes('game')) return 'Games'
  // Physical toys (HABA, Magna-Tiles, SmartGames, Lovevery —
  // migration 0021) that aren't games/books by their details
  // are toys, not audio.
  if (TOY_PLATFORMS.includes(item.platform)) return 'Toys'
  return 'Audio & more'
}
