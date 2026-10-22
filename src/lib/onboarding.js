// Onboarding questionnaire data (migration 0014): the gift
// occasions a family can pick, the interest tags a child can
// have, and small date helpers. The interest keywords double as
// the recommendation vocabulary (lib/recommend.js) — a keyword
// only counts on a word boundary, so 'cat' finds the Cat in the
// Hat but not a catcher.

export const GENDERS = [
  { value: 'girl', label: 'Girl' },
  { value: 'boy', label: 'Boy' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: '', label: 'Prefer not to say' },
]

// Pickable gift-giving occasions. month/day are the defaults
// seeded into the occasions table; the ones marked `shifts`
// move a little each year, and parents can adjust the exact
// date later in Settings.
export const HOLIDAYS = [
  { key: 'christmas', label: 'Christmas', emoji: '🎄', month: 12, day: 25 },
  { key: 'hanukkah', label: 'Hanukkah', emoji: '🕎', month: 12, day: 14, shifts: true },
  { key: 'eid', label: 'Eid al-Fitr', emoji: '🌙', month: 3, day: 30, shifts: true },
  { key: 'diwali', label: 'Diwali', emoji: '🪔', month: 10, day: 20, shifts: true },
  { key: 'easter', label: 'Easter', emoji: '🐣', month: 4, day: 5, shifts: true },
  { key: 'valentines', label: "Valentine's Day", emoji: '💌', month: 2, day: 14 },
  { key: 'halloween', label: 'Halloween', emoji: '🎃', month: 10, day: 31 },
  { key: 'mothers-day', label: "Mother's Day", emoji: '💐', month: 5, day: 10, shifts: true },
  { key: 'fathers-day', label: "Father's Day", emoji: '🧦', month: 6, day: 15, shifts: true },
  { key: 'three-kings', label: 'Three Kings Day', emoji: '👑', month: 1, day: 6 },
  { key: 'st-nicholas', label: 'St. Nicholas Day', emoji: '🥾', month: 12, day: 6 },
]

export const INTERESTS = [
  { key: 'animals', label: 'Animals', emoji: '🐾', keywords: ['animal', 'dog', 'cat', 'bear', 'bunny', 'rabbit', 'duck', 'frog', 'pig', 'cow', 'horse', 'monkey', 'elephant', 'lion', 'mouse', 'bird', 'puppy', 'kitten'] },
  { key: 'dinosaurs', label: 'Dinosaurs', emoji: '🦕', keywords: ['dinosaur', 'dino', 'jurassic', 'triceratops'] },
  { key: 'space', label: 'Space', emoji: '🚀', keywords: ['space', 'rocket', 'astronaut', 'planet', 'solar system', 'galaxy', 'mars'] },
  { key: 'ocean', label: 'Ocean & sea', emoji: '🌊', keywords: ['ocean', 'sea', 'mermaid', 'shark', 'whale', 'underwater', 'pirate', 'nemo'] },
  { key: 'princess', label: 'Princesses & fairies', emoji: '👸', keywords: ['princess', 'fairy', 'fairies', 'unicorn', 'cinderella', 'rapunzel', 'elsa'] },
  { key: 'superheroes', label: 'Superheroes', emoji: '🦸', keywords: ['hero', 'heroes', 'marvel', 'spider', 'batman', 'superman', 'avengers', 'incredibles'] },
  { key: 'cars', label: 'Cars & trucks', emoji: '🚗', keywords: ['car', 'cars', 'truck', 'trucks', 'race', 'racing', 'tractor', 'construction', 'digger', 'diggers'] },
  { key: 'trains', label: 'Trains', emoji: '🚂', keywords: ['train', 'trains', 'thomas', 'railway'] },
  { key: 'music', label: 'Music & songs', emoji: '🎵', keywords: ['song', 'songs', 'music', 'musical', 'sing', 'dance', 'rhyme', 'rhymes'] },
  { key: 'bedtime', label: 'Bedtime stories', emoji: '🌙', keywords: ['bedtime', 'goodnight', 'sleepy', 'sleep', 'dream', 'dreams', 'lullaby', 'lullabies'] },
  { key: 'learning', label: 'Learning & numbers', emoji: '🔢', keywords: ['learn', 'learning', 'abc', 'alphabet', 'count', 'counting', 'numbers', 'phonics', 'math', 'science'] },
  { key: 'disney', label: 'Disney favorites', emoji: '✨', keywords: ['disney', 'pixar', 'mickey', 'minnie', 'frozen', 'moana', 'encanto', 'lion king', 'toy story'] },
  { key: 'funny', label: 'Funny stories', emoji: '😂', keywords: ['funny', 'silly', 'giggle', 'laugh', 'hilarious', 'underpants', 'stink'] },
  { key: 'sports', label: 'Sports', emoji: '⚽', keywords: ['soccer', 'baseball', 'basketball', 'football', 'sport', 'sports'] },
  { key: 'art', label: 'Art & crafts', emoji: '🎨', keywords: ['art', 'draw', 'drawing', 'paint', 'color', 'craft', 'create'] },
  { key: 'nature', label: 'Nature & bugs', emoji: '🐛', keywords: ['nature', 'garden', 'bug', 'bugs', 'butterfly', 'forest', 'flower', 'weather'] },
]

export function interestByKey(key) {
  return INTERESTS.find((i) => i.key === key) ?? null
}

// Whole years old on `today` (a Date), or null without a birth
// date. Accepts the 'YYYY-MM-DD' strings the date input and the
// database both use.
export function ageYears(birthDate, today = new Date()) {
  if (!birthDate) return null
  const [y, m, d] = String(birthDate).split('-').map(Number)
  if (!y || !m || !d) return null
  let age = today.getFullYear() - y
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)
  if (beforeBirthday) age--
  return age >= 0 ? age : null
}

export function ageLabel(birthDate, today = new Date()) {
  const age = ageYears(birthDate, today)
  if (age == null) return ''
  if (age === 0) return 'under 1 year old'
  return age === 1 ? '1 year old' : `${age} years old`
}

// Which catalog platform a device feeds. Devices are catalog
// rows on their content's own platform (a Toniebox is a 'tonies'
// device), so this is the identity for everything we stock —
// kept as a function so a future platform can remap in one place.
export function contentPlatformForDevice(device) {
  return device?.platform ?? null
}
