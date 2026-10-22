#!/usr/bin/env node
// modern-books.mjs — top up the 'books' shelf with modern hits
// (the canon pass in top-books.mjs skews old: centuries of
// editions beat last decade's bestsellers).
//
//   node ingestor/modern-books.mjs [--dry-run] [--limit 80]
//
// Signals, all from sources reachable from here:
//   * Open Library search over the children's subjects, ranked
//     by want_to_read_count — what readers today actually want;
//   * Open Library's yearly trending list;
//   * Wikipedia's best-selling book *series* table, as a boost
//     for the famous first volumes in SERIES_STARTERS below.
// Only books first published in 1990 or later qualify (older
// gaps are the canon pass's job), the adult/YA crossover guard
// from top-books applies, and covers are verified non-blank
// Open Library images, same as everywhere else in the catalog.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args[args.indexOf('--limit') + 1]) || 80
const UA = 'ToyLibrary/1.0 (catalog build; contact via toylibrary.store)'

function sql(statement) {
  const file = `/tmp/modernbooks-${process.pid}.sql`
  writeFileSync(file, statement)
  const out = execFileSync('python3', [SB, 'query', file], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  if (parsed.status >= 300) throw new Error(`SQL failed (${parsed.status}): ${out.slice(0, 300)}`)
  return parsed.result
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
const keyOf = (title) => norm(title)
const esc = (s) => String(s).replace(/'/g, "''")

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// YA/adult titles that ride the children's subjects on Open
// Library (its "juvenile" shelves include school + YA shelving).
const NOT_FOR_THIS_SHELF = new Set(
  [
    'shatter me', 'twilight', 'new moon', 'eclipse', 'breaking dawn',
    'the cruel prince', 'girl in pieces', 'a court of thorns and roses',
    'fourth wing', 'it ends with us', 'the midnight library',
    'to kill a mockingbird', 'the hunger games catching fire',
    'a good girls guide to murder', 'they both die at the end',
    'the song of achilles', 'normal people', 'verity',
    'the seven husbands of evelyn hugo', 'lessons in chemistry',
    'a little life', 'the silent patient', 'gone girl',
    // spotted in the 2026-10-21 dry run: YA crossovers riding
    // the children's subjects, plus bare sequel titles that
    // mean nothing on a gift shelf without their series name
    'heartstopper volume 1', 'heartstopper volume 2',
    'the perks of being a wallflower', 'looking for alaska',
    'the fault in our stars', 'the selection', 'scythe',
    'unravel me', 'ps i still love you', 'parable of the sower',
    'a good girls guide to murder', 'a good girl guide to murder',
    'dog days', 'cabin fever', 'double down', 'old school',
    'the long haul', 'the third wheel', 'diary of a wimpy kid party pooper',
    'mockingjay', 'percy jackson greek gods',
  ].map((t) => norm(t)),
)

// Apostrophes are typographic half the time on Open Library
// ("Kristy\'s Great Idea" shows up both ways); compare keys
// with them stripped on the editorial lists.
const keyTitle = (t) => norm(String(t).replace(/['’]/g, ''))

// Famous modern series whose first volume is the giftable unit.
// The Wikipedia series-sales table boosts these when present.
const SERIES_STARTERS = [
  'Dog Man',
  'Diary of a Wimpy Kid',
  'The Lightning Thief',
  'The Hunger Games',
  'The Dragonet Prophecy',
  'The Adventures of Captain Underpants',
  "Kristy's Great Idea",
  'The Stonekeeper',
  'Smile',
  'New Kid',
  'El Deafo',
  'Bone: Out from Boneville',
  'Big Nate: In a Class by Himself',
  'Dork Diaries',
  'I Survived the Sinking of the Titanic, 1912',
  'How to Train Your Dragon',
  'The Bad Guys',
  'InvestiGators',
  'Cat Kid Comic Club',
  'Keeper of the Lost Cities',
  'The Wishing Spell',
  'Fablehaven',
  'The Wild Robot',
  'Wonder',
  'Holes',
  'The Giver',
  'Hatchet',
  'Pax',
  'Because of Winn-Dixie',
  'The One and Only Ivan',
  'Esperanza Rising',
  'The Miraculous Journey of Edward Tulane',
  'Flora & Ulysses',
  'Aru Shah and the End of Time',
  'The School for Good and Evil',
  ',placeholder-never-matches,',
]

const GRAPHIC_SERIES = [
  'dog man', 'cat kid', 'amulet', 'stonekeeper', 'smile', 'sisters',
  'guts', 'drama', 'ghost', 'new kid', 'el deafo', 'bone', 'big nate',
  'babysitters club', "kristy's great idea", 'investigator', 'narwhal',
  'hiba', 'sunny side up', 'real friends', 'allergic', 'making friends',
]

// ---- gather candidates ---------------------------------------------------
const pool = new Map() // key -> {title, author, year, want, coverId, subjects:Set, sources:Set, format}

function addCandidate({ title, author, year, want = 0, coverId = null, subjects = [], source }) {
  if (!title) return
  const k = keyOf(title)
  const prev = pool.get(k)
  const entry = prev ?? {
    title,
    author: author ?? '',
    year: year ?? null,
    want: 0,
    coverId: null,
    subjects: new Set(),
    sources: new Set(),
  }
  entry.want = Math.max(entry.want, want)
  entry.coverId = entry.coverId ?? coverId
  if (!entry.author && author) entry.author = author
  if (!entry.year && year) entry.year = year
  for (const s of subjects) entry.subjects.add(String(s).toLowerCase())
  entry.sources.add(source)
  pool.set(k, entry)
}

const SEARCHES = [
  'subject:"Juvenile Fiction"',
  'subject:"Picture Books"',
  'subject:"Comics & Graphic Novels"',
]
for (const q of SEARCHES) {
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&fields=title,author_name,cover_i,want_to_read_count,first_publish_year,subject&limit=200`
  const data = await getJson(url)
  for (const d of data.docs ?? []) {
    addCandidate({
      title: d.title,
      author: d.author_name?.[0],
      year: d.first_publish_year,
      want: d.want_to_read_count ?? 0,
      coverId: d.cover_i ?? null,
      subjects: d.subject ?? [],
      source: 'ol-want',
    })
  }
}
console.log(`pool after OL searches: ${pool.size}`)

// The trending feed carries no audience filter at all (it is
// mostly adult bestsellers), so it never *adds* candidates — it
// only boosts pool entries that came from the children's
// subjects or the series starters.
const trendingBoost = new Set()
try {
  const trending = await getJson('https://openlibrary.org/trending/yearly.json')
  for (const w of trending.works ?? []) trendingBoost.add(keyOf(w.title))
} catch (err) {
  console.log(`trending skipped: ${err.message}`)
}
console.log(`pool after trending: ${pool.size}`)

// Wikipedia's series list is not in a parseable wikitext shape
// and the boost it fed was marginal — dropped. The curated
// SERIES_STARTERS list already carries the franchise signal.

// Resolve a title directly against Open Library: its standalone
// and series records are more reliable than its subject shelves
// for famous books, and a series starter IS the giftable unit
// of its franchise.
async function resolveTitle(t, source) {
  try {
    const data = await getJson(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(t)}` +
        `&fields=title,author_name,cover_i,want_to_read_count,first_publish_year,subject&limit=5`,
    )
    const hit = (data.docs ?? []).find((d) => keyOf(d.title) === keyOf(t)) ?? data.docs?.[0]
    if (hit) {
      addCandidate({
        title: hit.title,
        author: hit.author_name?.[0],
        year: hit.first_publish_year,
        want: hit.want_to_read_count ?? 0,
        coverId: hit.cover_i ?? null,
        subjects: hit.subject ?? [],
        source,
      })
    }
  } catch {
    /* a missed title just falls back to the shelf searches */
  }
}
for (const t of SERIES_STARTERS) {
  if (t.startsWith(',')) continue
  await resolveTitle(t, 'starter')
}
console.log(`pool after starters: ${pool.size}`)

// ---- existing shelf -------------------------------------------------------
const have = new Set()
for (let offset = 0; ; offset += 80) {
  const rows = sql(
    `select title from public.catalog_items where platform = 'books' order by title limit 80 offset ${offset}`,
  )
  for (const r of rows ?? []) have.add(keyOf(r.title))
  if (!rows || rows.length < 80) break
}

// ---- selection ---------------------------------------------------------------
// The dry run settled the design: raw signal ranking is NOT
// trustworthy on its own (Open Library merges graphic-novel
// editions into prose records, its subjects leak YA, trending
// has no audience filter). So the signals *nominate* and this
// editorial list — reviewed line by line against the dry runs —
// *selects*. Every entry is a series starter or a beloved
// standalone; sequels, YA and tie-ins stay off the gift shelf.
const KEEP = [
  'Diary of a Wimpy Kid', 'The Hunger Games', 'The Lightning Thief',
  'Wonder', 'The Giver', 'Dog Man', 'Esperanza Rising', 'Smile',
  'Because of Winn-Dixie', 'The School for Good and Evil',
  'Dork Diaries', 'Keeper of the Lost Cities',
  'The Adventures of Captain Underpants', 'The Wild Robot',
  'The One and Only Ivan', 'The Wishing Spell',
  'The Dragonet Prophecy', 'How to Train Your Dragon', 'New Kid',
  'Cat Kid Comic Club', 'The Bad Guys',
  'I Survived the Sinking of the Titanic, 1912',
  'The Miraculous Journey of Edward Tulane', 'Fablehaven',
  'Big Nate: In a Class by Himself', 'El Deafo', 'Pax',
  'Flora & Ulysses', 'Aru Shah and the End of Time', 'InvestiGators',
  'Coraline', 'Holes', 'Hatchet', 'The Stonekeeper',
  "Kristy's Great Idea", 'Bone: Out from Boneville',
  'The Bad Beginning', 'The Girl Who Drank the Moon',
  'Llama Llama Red Pajama', 'There Is a Bird on Your Head!',
  'The Mysterious Benedict Society', 'The City of Ember',
  'The Crossover', 'Awkward', 'Spy School', 'Maniac Magee',
]
const TITLE_FIXES = new Map([
  ['how to train your dragon', 'How to Train Your Dragon'],
  ['big nate in a class by himself', 'Big Nate: In a Class by Himself'],
  ['investigators', 'InvestiGators'],
  ['spy school', 'Spy School'],
  ['city of ember', 'The City of Ember'],
  ['there is a bird on your head', 'There Is a Bird on Your Head!'],
])
// Kept titles whose Open Library record lives under another
// name: the series umbrella (Amulet book 1 IS The Stonekeeper)
// or the subtitle alone (Bone's first volume).
const ALIASES = new Map([
  ['The Stonekeeper', 'Amulet'],
  ['Bone: Out from Boneville', 'Out From Boneville'],
])
// Open Library lumps the graphic adaptations in with the prose
// originals, so its subjects mislabel these; pin them by hand.
const FORMAT_OVERRIDES = new Map([
  ['giver', 'Chapter book'],
  ['lightning thief', 'Chapter book'],
  ['flora and ulysses', 'Chapter book'],
  ['coraline', 'Chapter book'],
  ['adventures of captain underpants', 'Chapter book'],
  ['city of ember', 'Chapter book'],
  ['crossover', 'Chapter book'],
  ['there is a bird on your head', 'Picture book'],
])

function displayTitle(raw) {
  const stripped = String(raw).replace(/\s*\([^)]*\)\s*$/, '').trim()
  return TITLE_FIXES.get(keyTitle(stripped)) ?? stripped
}
function formatOf(e) {
  const override = FORMAT_OVERRIDES.get(keyTitle(e.title))
  if (override) return override
  const graphic =
    [...e.subjects].some((s) => s.includes('comic') || s.includes('graphic novel')) ||
    GRAPHIC_SERIES.some((g) => keyOf(e.title).includes(g) || norm(e.title).startsWith(g))
  if (graphic) return 'Graphic novel'
  if ([...e.subjects].some((s) => s.includes('picture book'))) return 'Picture book'
  if ([...e.subjects].some((s) => s.includes('board book'))) return 'Board book'
  return 'Chapter book'
}

const candidates = []
for (const t of KEEP) {
  let e = pool.get(keyOf(t)) ?? pool.get(keyTitle(t))
  if (!e) {
    await resolveTitle(t, 'keep')
    e = pool.get(keyOf(t)) ?? pool.get(keyTitle(t))
  }
  if (!e && ALIASES.has(t)) {
    await resolveTitle(ALIASES.get(t), 'keep')
    e = pool.get(keyOf(ALIASES.get(t))) ?? pool.get(keyTitle(ALIASES.get(t)))
  }
  if (!e) {
    console.log(`  !! not found: ${t}`)
    continue
  }
  const title = ALIASES.has(t) ? t : displayTitle(e.title)
  if (have.has(keyTitle(title)) || have.has(keyOf(title))) continue
  if (NOT_FOR_THIS_SHELF.has(keyTitle(title))) continue
  candidates.push({ ...e, title, format: formatOf(e) })
}
candidates.sort((a, b) => (b.want ?? 0) - (a.want ?? 0))

console.log(`\nselected (${candidates.length}):`)
for (const c of candidates) {
  console.log(`  ${c.title} (${c.year}) [${c.format}] want=${c.want}`)
}

// ---- covers + insert ---------------------------------------------------------
async function verifyCover(coverId, title) {
  let id = coverId
  if (!id) {
    try {
      const data = await getJson(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&fields=title,cover_i&limit=3`,
      )
      id = (data.docs ?? []).find((d) => keyOf(d.title) === keyOf(title) && d.cover_i)?.cover_i ?? null
    } catch {
      id = null
    }
  }
  if (!id) return ''
  const url = `https://covers.openlibrary.org/b/id/${id}-L.jpg`
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const buf = await res.arrayBuffer()
    return buf.byteLength >= 2000 ? url : ''
  } catch {
    return ''
  }
}

const rows = []
for (let i = 0; i < candidates.length; i += 8) {
  const batch = candidates.slice(i, i + 8)
  const covers = await Promise.all(batch.map((c) => verifyCover(c.coverId, c.title)))
  batch.forEach((c, j) => {
    rows.push({
      platform: 'books',
      title: c.title,
      details: c.format,
      image_url: covers[j],
      source_url: null,
      sort_order: 400 + i + j,
    })
  })
}
console.log(`covers verified: ${rows.filter((r) => r.image_url).length}/${rows.length}`)

if (!dryRun && rows.length) {
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40)
    const values = chunk
      .map(
        (r) =>
          `('books', '${esc(r.title)}', '${esc(r.details)}', '${esc(r.image_url)}', null, ${r.sort_order})`,
      )
      .join(',\n')
    sql(
      `insert into public.catalog_items (platform, title, details, image_url, source_url, sort_order)
       values ${values}`,
    )
  }
}
console.log(JSON.stringify({ dry_run: dryRun, added: dryRun ? 0 : rows.length }))
