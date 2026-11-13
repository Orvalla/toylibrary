// gift-advisor retrieval: the fence layer (spec §3).
//
// Everything that keeps the Toy Librarian honest happens HERE,
// server-side, before any model call. The model only ever sees the
// candidate set this module builds, so it cannot recommend what the
// fences removed:
//
//   1. Age floor (hard): age_min_years <= the child's age in whole
//      years. A row with no age_min_years is NOT eligible (unknown is
//      not "fits"). No age known yet = no candidates at all.
//   2. Exclusions (hard): items the child (or the family) owns and
//      wishlist items already claimed (gift-page mode).
//   3. Ranking: owned-player content first, then interest-keyword
//      matches, then rated before unrated, rating desc, rating_count
//      desc. (Plus one tier above those: items the shopper named by
//      title; see NAMED_FIRST.)
//   4. Cap: 10.
//   5. Payload: exactly the §3.5 field set.
//   6. also_known: up to 3 rows that failed ONLY the age floor, sent
//      under a DO-NOT-RECOMMEND marker.
//
// Pure apart from the injected `source` (the SQL queries live in
// store.js), so vitest can pin every fence with an in-memory
// catalog. Deno imports this file as-is; it must stay plain JS with
// no Node or Deno APIs.

export const CANDIDATE_CAP = 10
export const ALSO_KNOWN_CAP = 3

// Items the shopper asks about by name rank above the §3.3 tiers so
// that "How much is the Carry Around Robot Town?" finds it on the
// shelf even when ten other rows outrank it. Fences still apply in
// full. This is an addition to the spec's ranking: the WS7 report
// flags it for a ruling, and flipping this constant restores the
// plain §3.3 order.
export const NAMED_FIRST = true

// Players whose content needs the device (spec rule 5). Words the
// shopper might use for each, for finder-mode parsing.
export const PLAYER_PLATFORMS = {
  tonies: ['toniebox', 'tonieboxes', 'tonie', 'tonies'],
  yoto: ['yoto'],
  storypod: ['storypod'],
  leapfrog: ['leappad', 'leapfrog', 'leapstart'],
  lunii: ['lunii'],
  osmo: ['osmo'],
  vtech: ['vtech'],
}

// Copy of src/lib/onboarding.js INTERESTS (keys + keywords). Edge
// Functions cannot import the app bundle; advisorRetrieval.test.js
// fails if the two drift apart.
export const INTERESTS = [
  { key: 'animals', label: 'Animals', keywords: ['animal', 'dog', 'cat', 'bear', 'bunny', 'rabbit', 'duck', 'frog', 'pig', 'cow', 'horse', 'monkey', 'elephant', 'lion', 'mouse', 'bird', 'puppy', 'kitten'] },
  { key: 'dinosaurs', label: 'Dinosaurs', keywords: ['dinosaur', 'dino', 'jurassic', 'triceratops'] },
  { key: 'space', label: 'Space', keywords: ['space', 'rocket', 'astronaut', 'planet', 'solar system', 'galaxy', 'mars'] },
  { key: 'ocean', label: 'Ocean & sea', keywords: ['ocean', 'sea', 'mermaid', 'shark', 'whale', 'underwater', 'pirate', 'nemo'] },
  { key: 'princess', label: 'Princesses & fairies', keywords: ['princess', 'fairy', 'fairies', 'unicorn', 'cinderella', 'rapunzel', 'elsa'] },
  { key: 'superheroes', label: 'Superheroes', keywords: ['hero', 'heroes', 'marvel', 'spider', 'batman', 'superman', 'avengers', 'incredibles'] },
  { key: 'cars', label: 'Cars & trucks', keywords: ['car', 'cars', 'truck', 'trucks', 'race', 'racing', 'tractor', 'construction', 'digger', 'diggers'] },
  { key: 'trains', label: 'Trains', keywords: ['train', 'trains', 'thomas', 'railway'] },
  { key: 'music', label: 'Music & songs', keywords: ['song', 'songs', 'music', 'musical', 'sing', 'dance', 'rhyme', 'rhymes'] },
  { key: 'bedtime', label: 'Bedtime stories', keywords: ['bedtime', 'goodnight', 'sleepy', 'sleep', 'dream', 'dreams', 'lullaby', 'lullabies'] },
  { key: 'learning', label: 'Learning & numbers', keywords: ['learn', 'learning', 'abc', 'alphabet', 'count', 'counting', 'numbers', 'phonics', 'math', 'science'] },
  { key: 'disney', label: 'Disney favorites', keywords: ['disney', 'pixar', 'mickey', 'minnie', 'frozen', 'moana', 'encanto', 'lion king', 'toy story'] },
  { key: 'funny', label: 'Funny stories', keywords: ['funny', 'silly', 'giggle', 'laugh', 'hilarious', 'underpants', 'stink'] },
  { key: 'sports', label: 'Sports', keywords: ['soccer', 'baseball', 'basketball', 'football', 'sport', 'sports'] },
  { key: 'art', label: 'Art & crafts', keywords: ['art', 'draw', 'drawing', 'paint', 'color', 'craft', 'create'] },
  { key: 'nature', label: 'Nature & bugs', keywords: ['nature', 'garden', 'bug', 'bugs', 'butterfly', 'forest', 'flower', 'weather'] },
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole-word hit, allowing a plain plural ("dinosaurs" hits
// "dinosaur", "trucks" hits "truck").
export function keywordHit(text, keyword) {
  return new RegExp(`\\b${escapeRe(keyword)}(?:s|es)?\\b`, 'i').test(String(text ?? ''))
}

export function keywordsFor(interestKeys) {
  const keys = new Set(interestKeys ?? [])
  return INTERESTS.filter((i) => keys.has(i.key)).flatMap((i) => i.keywords)
}

export function interestLabels(interestKeys) {
  const keys = new Set(interestKeys ?? [])
  return INTERESTS.filter((i) => keys.has(i.key)).map((i) => i.label)
}

// ------------------------------------------------ conversation parsing

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
}
const SUBJECTS =
  "she|he|they|child|kid|son|daughter|granddaughter|grandson|nephew|niece|girl|boy|baby|toddler|grandkid|grandchild"
const NOT_MONEY = '(?!\\s*(?:dollars?|bucks|usd|%|\\.\\d))'
const AGE_PATTERNS = [
  new RegExp(`\\b(\\d{1,2})\\s*-?\\s*(?:years?|yrs?)\\s*-?\\s*old\\b`, 'g'),
  new RegExp(`\\b(\\d{1,2})\\s*-?\\s*(?:yo|y/o)\\b`, 'g'),
  new RegExp(`\\b(?:turned|turns|turning|aged|age)\\s+(\\d{1,2})\\b${NOT_MONEY}`, 'g'),
  new RegExp(
    `\\b(?:${SUBJECTS})(?:'s|’s|'re|’re|\\s+is|\\s+are|\\s+was)\\s+(?:now\\s+|just\\s+|only\\s+|almost\\s+|nearly\\s+)?(\\d{1,2})\\b${NOT_MONEY}`,
    'g',
  ),
]

// The child's age (whole years) stated in one shopper message, or
// null. Several ages in one message (siblings, "3 or 4") resolve to
// the YOUNGEST: a wrong low age only narrows the shelves, a wrong
// high age would loosen the hard fence.
export function ageFromText(text) {
  let t = ` ${String(text ?? '').toLowerCase()} `
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\b/g, (w) =>
    String(WORD_NUMBERS[w]),
  )
  t = t.replace(/\$\s*\d+(?:\.\d+)?/g, ' ')
  const ages = []
  for (const re of AGE_PATTERNS) {
    re.lastIndex = 0
    for (const m of t.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n >= 0 && n <= 17) ages.push(n)
    }
  }
  return ages.length ? Math.min(...ages) : null
}

export function interestsFromText(text) {
  return INTERESTS.filter((i) => i.keywords.some((k) => keywordHit(text, k))).map((i) => i.key)
}

export function playersFromText(text) {
  return Object.entries(PLAYER_PLATFORMS)
    .filter(([, words]) => words.some((w) => keywordHit(text, w)))
    .map(([platform]) => platform)
}

// What the shopper's own messages say about the child. The most
// recent message that states an age wins (a correction overrides);
// interests and players accumulate.
export function childFromConversation(shopperTexts) {
  let age = null
  const interests = new Set()
  const players = new Set()
  for (const text of shopperTexts ?? []) {
    const a = ageFromText(text)
    if (a != null) age = a
    for (const k of interestsFromText(text)) interests.add(k)
    for (const p of playersFromText(text)) players.add(p)
  }
  return { age, interests: [...interests], players: [...players] }
}

// ----------------------------------------------------- named titles

const STOP = new Set(
  'the and for with set from that this what which your you how much about price cost does have they them there their his her she him its are was were will would could should can any some into onto just like also only one ones toy toys gift gifts one'.split(
    ' ',
  ),
)

const tokens = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const distinctive = (text) => tokens(text).filter((w) => w.length >= 3 && !STOP.has(w))

// Words from the shopper's messages worth a title search: the
// longest distinctive ones, latest message first. Only [a-z0-9]
// survive, so they are safe inside a PostgREST filter.
export function titleSearchWords(shopperTexts, max = 8) {
  const out = []
  for (const text of [...(shopperTexts ?? [])].reverse()) {
    const words = [...new Set(distinctive(text))].sort((a, b) => b.length - a.length)
    for (const w of words) {
      if (w.length < 4 || /^\d+$/.test(w) || out.includes(w)) continue
      out.push(w)
      if (out.length >= max) return out
    }
  }
  return out
}

// Did the shopper name this catalog title? Every distinctive word
// of the title (at least two of them) must appear in what they
// wrote, or the whole normalized title must.
export function isNamed(title, shopperTexts) {
  const said = new Set((shopperTexts ?? []).flatMap((t) => tokens(t)))
  const joined = ` ${(shopperTexts ?? []).map((t) => tokens(t).join(' ')).join(' ')} `
  const words = distinctive(title)
  if (tokens(title).length && joined.includes(` ${tokens(title).join(' ')} `)) return true
  return words.length >= 2 && words.every((w) => said.has(w))
}

// Whole years old on `today` (UTC calendar), from a 'YYYY-MM-DD'
// birth date, or null. Same rule as src/lib/onboarding.js ageYears.
export function ageOn(birthDate, today) {
  if (!birthDate) return null
  const [y, m, d] = String(birthDate).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  let age = today.getUTCFullYear() - y
  const month = today.getUTCMonth() + 1
  if (month < m || (month === m && today.getUTCDate() < d)) age--
  return age >= 0 ? age : null
}

// --------------------------------------------------------- payload

export const itemKey = (platform, title) => `${platform}|${String(title ?? '').trim().toLowerCase()}`

export function soldAt(productUrl) {
  if (!productUrl) return null
  try {
    const u = new URL(productUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const dateOrNull = (v) => (v ? String(v).slice(0, 10) : null)

// Spec §3.5: exactly these fields, nulls passed through as null.
export const PAYLOAD_FIELDS = [
  'name',
  'maker',
  'age_min_years',
  'rating',
  'rating_count',
  'price_usd',
  'price_checked_at',
  'sold_at',
  'product_url',
]

export function toPayload(row) {
  const price = numOrNull(row.base_price_usd)
  return {
    name: row.title,
    maker: row.platform,
    age_min_years: numOrNull(row.age_min_years),
    rating: numOrNull(row.rating),
    rating_count: numOrNull(row.rating_count),
    price_usd: price,
    price_checked_at: price == null ? null : dateOrNull(row.base_price_checked_at),
    sold_at: soldAt(row.product_url),
    product_url: row.product_url || null,
  }
}

// ---------------------------------------------------------- fences

export function passesAgeFloor(row, age) {
  if (age == null) return false
  const min = numOrNull(row.age_min_years)
  return min != null && min <= age
}

// Rank key per spec §3.3 (lower sorts first).
export function rankKey(row, ctx) {
  const named = NAMED_FIRST && isNamed(row.title, ctx.shopperTexts) ? 0 : 1
  const owned = (ctx.players ?? []).includes(row.platform) && row.item_type !== 'device' ? 0 : 1
  const kws = ctx.keywords ?? []
  const interest = kws.some((k) => keywordHit(`${row.title} ${row.details ?? ''}`, k)) ? 0 : 1
  const rating = numOrNull(row.rating)
  return [named, owned, interest, rating == null ? 1 : 0, -(rating ?? 0), -(numOrNull(row.rating_count) ?? 0)]
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

export function rankRows(rows, ctx) {
  return rows
    .map((row) => ({ row, key: rankKey(row, ctx) }))
    .sort((x, y) => compareKeys(x.key, y.key) || String(x.row.title).localeCompare(String(y.row.title)))
    .map((x) => x.row)
}

const uniqueById = (rows) => {
  const seen = new Map()
  for (const r of rows) if (r && r.id != null && !seen.has(r.id)) seen.set(r.id, r)
  return [...seen.values()]
}

// The whole fence, re-run on every turn.
//
// ctx: { age, interests: [interest keys], players: [platforms],
//        excludeKeys: Set(itemKey), shopperTexts: [string] }
// source: { eligible(q), olderThan(q) } where q = { age, platforms?,
//   keywords?, titleWords?, limit } and every row carries id,
//   platform, title, details, item_type, age_min_years, rating,
//   rating_count, base_price_usd, base_price_checked_at, product_url.
//
// Returns { candidates (payload rows), rows (the raw rows, same
// order, for ids), alsoKnown ([{name, age_min_years}]) }.
export async function retrieve(source, ctx) {
  const age = ctx.age
  if (age == null) return { candidates: [], rows: [], alsoKnown: [] }
  const keywords = keywordsFor(ctx.interests)
  const players = ctx.players ?? []
  const shopperTexts = ctx.shopperTexts ?? []
  const titleWords = titleSearchWords(shopperTexts)
  const exclude = ctx.excludeKeys ?? new Set()
  const rankCtx = { players, keywords, shopperTexts }

  const queries = [source.eligible({ age, limit: 40 })]
  if (players.length) queries.push(source.eligible({ age, platforms: players, limit: 40 }))
  if (keywords.length) queries.push(source.eligible({ age, keywords, limit: 60 }))
  if (players.length && keywords.length) {
    queries.push(source.eligible({ age, platforms: players, keywords, limit: 40 }))
  }
  if (titleWords.length) queries.push(source.eligible({ age, titleWords, limit: 60 }))
  const pool = uniqueById((await Promise.all(queries)).flat())

  // Defense in depth: the SQL already applied the floor; the fence
  // is re-applied here so a query bug can never widen it.
  const eligible = pool
    .filter((r) => passesAgeFloor(r, age))
    .filter((r) => !exclude.has(itemKey(r.platform, r.title)))
  const rows = rankRows(eligible, rankCtx).slice(0, CANDIDATE_CAP)

  // also_known: failed ONLY the age floor (so: not owned, not
  // claimed, age_min_years known and above the child's age),
  // matching the child's interests or named by the shopper.
  const olderQueries = []
  if (keywords.length) olderQueries.push(source.olderThan({ age, keywords, limit: 20 }))
  if (titleWords.length) olderQueries.push(source.olderThan({ age, titleWords, limit: 40 }))
  const older = uniqueById((await Promise.all(olderQueries)).flat())
    .filter((r) => {
      const min = numOrNull(r.age_min_years)
      return min != null && min > age
    })
    .filter((r) => !exclude.has(itemKey(r.platform, r.title)))
    .filter(
      (r) =>
        isNamed(r.title, shopperTexts) ||
        keywords.some((k) => keywordHit(`${r.title} ${r.details ?? ''}`, k)),
    )
  const alsoKnown = older
    .map((r) => ({ r, named: isNamed(r.title, shopperTexts) ? 0 : 1, rating: numOrNull(r.rating) }))
    .sort(
      (a, b) =>
        a.named - b.named ||
        (a.rating == null ? 1 : 0) - (b.rating == null ? 1 : 0) ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        String(a.r.title).localeCompare(String(b.r.title)),
    )
    .slice(0, ALSO_KNOWN_CAP)
    .map(({ r }) => ({ name: r.title, age_min_years: numOrNull(r.age_min_years) }))

  return { candidates: rows.map(toPayload), rows, alsoKnown }
}
