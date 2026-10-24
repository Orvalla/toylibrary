// Shopping themes (owner request 2026-10-23): a second way to
// slice the catalog, by what a parent is shopping FOR rather
// than the shelf format (lib/categories.js) — "puzzle games",
// "learning toys", "train stuff". Derived from what the
// catalog already knows (platform focus + title/details words),
// computed at browse time; no data to maintain.
//
// Deliberate exclusions:
//   * devices get no themes (you shop for a player by brand),
//   * pure-audio platforms (Tonies/Yoto/Storypod/Lunii/
//     projector) get none — a Paw Patrol Tonie is not a
//     "vehicle toy"; the Audio category already shelves those.
// Books DO take themes from their titles: a dinosaur
// nonfiction book is exactly what "animals & nature" is for.

export const THEMES = [
  { key: 'puzzles', label: 'Puzzles & brain games', emoji: '🧩' },
  { key: 'science', label: 'Science & STEM', emoji: '🔬' },
  { key: 'building', label: 'Building & making', emoji: '🏗️' },
  { key: 'arts', label: 'Arts & crafts', emoji: '🎨' },
  { key: 'words-numbers', label: 'Words & numbers', emoji: '🔢' },
  { key: 'pretend', label: 'Pretend play', emoji: '🎭' },
  { key: 'vehicles', label: 'Trains & vehicles', emoji: '🚂' },
  { key: 'animals', label: 'Animals & nature', emoji: '🐾' },
  { key: 'active', label: 'Active & outdoor', emoji: '🏃' },
  { key: 'music', label: 'Music makers', emoji: '🎵' },
]

const AUDIO_PLATFORMS = new Set(['tonies', 'yoto', 'storypod', 'lunii', 'projector'])

// Focused brands whose whole line is one theme. Broad-line
// brands (Melissa & Doug, Hape, Lakeshore…) are deliberately
// absent — keywords judge their items one by one. The audit
// also evicted Thames & Kosmos (its EXIT games filed as
// "science"), KiwiCo (a tote bag filed as STEM) and the
// classroom/electronic brands (a plush puppy is not a
// numbers toy just because LeapFrog made it).
const PLATFORM_THEMES = {
  smartgames: ['puzzles'],
  thinkfun: ['puzzles'],
  magnatiles: ['building'],
  tegu: ['building'],
  sphero: ['science'],
  unclegoose: ['building', 'words-numbers'],
}

// Word-level patterns over "title details". Kept concrete —
// a word earns its theme, no stemming tricks.
const KEYWORDS = {
  puzzles: [
    'puzzle', 'jigsaw', 'brain teaser', 'logic game', 'sudoku', 'riddle',
    'gravity maze', 'laser maze', 'iq fit', 'iq twist', 'rush hour',
  ],
  science: [
    'science', 'experiment', 'chemistry', 'physics', 'circuit', 'robot',
    'coding', 'volcano', 'crystal', 'telescope', 'microscope', 'solar',
    'electric', 'stem', 'fossil', 'astronomy', 'space', 'weather',
    'human body', 'anatomy', 'geology', 'slime', 'rocket', 'globe',
  ],
  building: [
    'blocks', 'building', 'construction', 'marble run', 'gravitrax',
    'bricks', 'gears', 'stacking', 'magnet tiles', 'magnetic tiles',
    'magformers', 'track builder', 'engineering', 'train set', 'railway',
  ],
  arts: [
    'art', 'craft', 'paint', 'painting', 'drawing', 'coloring', 'colouring',
    'clay', 'beads', 'jewelry', 'jewellery', 'sewing', 'knitting', 'origami',
    'doodle', 'sketch', 'watercolor', 'watercolour', 'crayon', 'sticker',
    'dough', 'pottery', 'weaving',
  ],
  'words-numbers': [
    'alphabet', 'letters', 'phonics', 'counting', 'math', 'numbers',
    'number', 'spelling', 'vocabulary', 'telling time', 'abc', '123',
    'addition', 'multiplication', 'word game', 'reading readiness',
    'learn', 'learning', 'leapstart',
  ],
  pretend: [
    'pretend', 'dress up', 'dress-up', 'costume', 'play kitchen',
    'play food', 'dollhouse', 'doll house', 'puppet', 'doctor', 'vet',
    'cash register', 'workbench', 'tool bench', 'tea set', 'playset',
    'play set', 'princess', 'cleaning set', 'baby doll', 'picnic',
  ],
  vehicles: [
    'train', 'railway', 'railroad', 'vehicle', 'truck', 'airplane',
    'helicopter', 'boat', 'tractor', 'excavator', 'fire truck', 'bus',
    'airport', 'garage', 'race car', 'race cars', 'hot wheels', 'dump truck',
    'cement mixer', 'steam engine', 'car carrier',
  ],
  animals: [
    'animal', 'dinosaur', 'dino', 'safari', 'ocean', 'butterfly',
    'insect', 'horse', 'wildlife', 'nature', 'garden', 'bird', 'whale',
    'shark', 'zoo', 'pets', 'puppy', 'kitten', 'farm animals', 'bug',
    'caterpillar', 'bear', 'elephant', 'lion', 'tiger', 'monkey',
    'penguin', 'owl', 'frog', 'turtle', 'fish', 'duck', 'bunny',
    'rabbit', 'mouse', 'fox', 'wolf', 'pig', 'cow', 'sheep', 'deer',
  ],
  active: [
    'soccer', 'football', 'basketball', 'baseball', 'bowling', 'golf',
    'scooter', 'bicycle', 'tricycle', 'ride-on', 'ride on', 'bean bag',
    'obstacle', 'outdoor', 'sports set', 'water table', 'splash',
    'sand table', 'toss game',
  ],
  music: [
    'musical', 'music', 'instrument', 'piano', 'guitar', 'drum',
    'xylophone', 'ukulele', 'harmonica', 'trumpet', 'violin',
    'microphone', 'tambourine', 'maracas',
  ],
}

// Whole-word matching: without \b, "art" fires inside
// Smart/Starter/Party and the themes turn to noise. Every
// keyword starts and ends with a word character, so one \b
// at each end of the alternation is enough. A trailing s?
// tolerates plurals ("Dinosaurs") without a stemmer.
const esc = (w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATTERNS = Object.fromEntries(
  Object.entries(KEYWORDS).map(([key, words]) => [
    key,
    new RegExp(
      `\\b(?:${words.map((w) => esc(w) + (/[a-z]$/i.test(w.trim()) ? 's?' : '')).join('|')})\\b`,
      'i'
    ),
  ])
)

// Every theme an item belongs to (possibly several, possibly
// none). Order follows THEMES.
export function themesOf(item) {
  if (!item || item.item_type === 'device') return []
  if (AUDIO_PLATFORMS.has(item.platform)) return []
  const found = new Set(PLATFORM_THEMES[item.platform] ?? [])
  const text = `${item.title ?? ''} ${item.details ?? ''}`
  for (const [key, re] of Object.entries(PATTERNS)) {
    if (re.test(text)) found.add(key)
  }
  return THEMES.map((t) => t.key).filter((k) => found.has(k))
}

export function themeLabel(key) {
  return THEMES.find((t) => t.key === key)?.label ?? key
}
