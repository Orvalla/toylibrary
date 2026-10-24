// The main shelves: the first sort a shopper makes, above the
// by-brand chips. Every catalog row belongs to exactly one
// kind, derived from what the catalog already knows:
//
//   Books         — the books platform (the Book Library).
//   Board games   — the board-game publishers (migration
//                   0030), plus anything whose details call it
//                   a game (a HABA board game, a SmartGames
//                   logic game, an eeBoo card game).
//   Story devices — the story-player ecosystems: Tonies,
//                   Yoto, Storypod, Lunii, the storybook
//                   projectors, LeapFrog and Osmo — the
//                   players and everything that plays on them.
//   Toys & play   — everything else: the physical toy brands.
//
// Board games used to be reachable only by picking a publisher
// among ~50 brand chips; as a kind they get a primary button
// next to Books.

export const BOARD_GAME_PLATFORMS = [
  'asmodee',
  'renegade',
  'blueorange',
  'hachette',
  'explodingkittens',
  'goliath',
  'pandasaurus',
  'catan',
  'iello',
  'spinmaster',
  'buffalogames',
  'relatable',
  'floodgate',
  'capstone',
  'devir',
]

export const STORY_PLATFORMS = [
  'tonies',
  'yoto',
  'storypod',
  'lunii',
  'projector',
  'leapfrog',
  'osmo',
]

export const KINDS = [
  { key: 'all', label: 'Everything', emoji: '🛍️' },
  { key: 'books', label: 'Books', emoji: '📚' },
  { key: 'games', label: 'Board games', emoji: '🎲' },
  { key: 'story', label: 'Story devices', emoji: '🎧' },
  { key: 'toys', label: 'Toys & play', emoji: '🧸' },
]

export function kindOf(item) {
  if (!item) return 'toys'
  if (item.platform === 'books') return 'books'
  // A story-platform item stays with its ecosystem even when
  // its details call it a game (a LeapFrog game cartridge is
  // shopped with the LeapPad, not with CATAN).
  if (STORY_PLATFORMS.includes(item.platform)) return 'story'
  if (
    BOARD_GAME_PLATFORMS.includes(item.platform) ||
    String(item.details ?? '').toLowerCase().includes('game')
  ) {
    return 'games'
  }
  return 'toys'
}

export const inKind = (item, kind) => kind === 'all' || kindOf(item) === kind
