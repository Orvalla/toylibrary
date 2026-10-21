#!/usr/bin/env node
// top-books.mjs — grow the 'books' shelf with the top ~200
// children's books, plus sweep the Tonies best-sellers collection
// for hits the full-store ingest missed.
//
//   node ingestor/top-books.mjs [--dry-run] [--limit 200]
//
// "Top" is a consensus of two public sources (Amazon's own lists
// aren't reachable from here):
//   * Wikipedia "List of best-selling books" — its children's
//     section, ranked by reported sales (single books only, no
//     series rows);
//   * Open Library subject listings (picture_books, board_books,
//     juvenile_fiction, juvenile_literature) ranked by edition
//     count — a durable proxy for how held/loved a book is.
// A title scores for appearing in Wikipedia, for its edition
// count, and for showing up in several sources at once. Covers
// come from Open Library and are only used when the image is
// verifiably not OL's blank placeholder.
//
// Rows land exactly like the hand-seeded books: platform 'books',
// details = 'Picture book' | 'Board book' | 'Chapter book',
// image_url = the OL cover. Titles already in the catalog (any
// spelling the normalizer folds together) are skipped.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args[args.indexOf('--limit') + 1]) || 200
const UA = 'ToyLibrary/1.0 (catalog build; contact via toylibrary.store)'

function sql(statement) {
  const file = `/tmp/topbooks-${process.pid}.sql`
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

// Famous retitling: the US and UK first Harry Potter are one book.
const ALIASES = new Map([
  ['harry potter and the sorcerers stone', 'harry potter and the philosophers stone'],
  ['der regenbogenfisch', 'the rainbow fish'],
  ['voyage au centre de la terre', 'journey to the centre of the earth'],
  ['le petit prince', 'the little prince'],
  ['le avventure di pinocchio', 'the adventures of pinocchio'],
  ['le tour du monde en quatre vingts jours', 'around the world in eighty days'],
  ['vingt mille lieues sous les mers', 'twenty thousand leagues under the seas'],
  ['twas the night before christmas', 'the night before christmas'],
])

// Display titles for aliased works (the English edition's name).
const CANONICAL_DISPLAY = new Map([
  ['the rainbow fish', 'The Rainbow Fish'],
  ['the little prince', 'The Little Prince'],
  ['the adventures of pinocchio', 'The Adventures of Pinocchio'],
  ['around the world in eighty days', 'Around the World in Eighty Days'],
  ['twenty thousand leagues under the seas', 'Twenty Thousand Leagues Under the Seas'],
  ['the night before christmas', 'The Night Before Christmas'],
  ['journey to the centre of the earth', 'Journey to the Centre of the Earth'],
])

const NON_ENGLISH_TITLE =
  /^(der|die|das|den|le|la|les|el|il|lo|het|een|un|une|des|du)\s|[äöüéèàâêîôûçãõ]/i

const keyOf = (title) => ALIASES.get(norm(title)) ?? norm(title)

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// ---- source A: Wikipedia best-selling individual books --------------
// There is no dedicated children's list article; the children's
// mega-sellers (Caterpillar, Charlotte's Web, Harry Potter) sit in
// the main "individual books" table with reported sales figures.
// We parse that whole table and use sales as a BOOST for titles
// that are also in the Open Library children's pool — so nothing
// non-children's can ride in on sales alone.
async function wikipediaBooks() {
  const url =
    "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_best-selling_books&prop=wikitext&format=json"
  const data = await getJson(url)
  const wt = data.parse.wikitext['*']
  const start = wt.indexOf('List of best-selling individual books')
  if (start < 0) return new Map()
  const rest = wt.slice(start)
  const end = rest.slice(100).search(/\n==[^=]/)
  const section = end > 0 ? rest.slice(0, end + 100) : rest
  const books = new Map()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const m = line.match(/''\[\[([^\]|]+)(?:\|[^\]]+)?\]\]''/)
    if (!m) continue
    const sortVal = line.match(/data-sort-value="(\d+)"/)
    const plain = line.match(/(\d+(?:\.\d+)?)\s*million/)
    const sales = sortVal ? Number(sortVal[1]) / 1e6 : plain ? Number(plain[1]) : 0
    if (sales > 0) books.set(keyOf(m[1].trim()), { title: m[1].trim(), sales })
  }
  return books
}

// ---- source B: Open Library subjects by edition count ---------------
const SUBJECT_FORMATS = [
  ['picture_books', 'Picture book'],
  ['board_books', 'Board book'],
  ['juvenile_fiction', 'Chapter book'],
]

// Adult school-assignment classics pollute Open Library's
// juvenile subjects (Dickens is "juvenile literature" there).
// This site is for young kids' story shelves — these never belong,
// however many editions they have.
const ADULT_CROSSOVERS = new Set(
  [
    'a tale of two cities', 'pride and prejudice', 'jane eyre',
    'wuthering heights', 'great expectations', 'the great gatsby',
    'to kill a mockingbird', '1984', 'animal farm',
    'the catcher in the rye', 'lord of the flies', 'moby dick',
    'the scarlet letter', 'of mice and men', 'brave new world',
    'fahrenheit 451', 'the odyssey', 'the iliad',
    'crime and punishment', 'les miserables', 'war and peace',
    'heart of darkness', 'the divine comedy',
    'alex', 'persuasion', 'sense and sensibility', 'mansfield park',
    'northanger abbey', 'the hound of the baskervilles',
    'the sign of four', 'the adventures of sherlock holmes',
    'a study in scarlet', 'the time machine', 'the war of the worlds',
    'the invisible man', 'robinson crusoe', "gulliver's travels",
    'oliver twist', 'david copperfield', 'kim',
    'captains courageous', 'king solomon\u2019s mines',
    "king solomon's mines", 'a connecticut yankee in king arthur\u2019s court',
    "a connecticut yankee in king arthur's court",
    'the canterbury tales', "uncle tom's cabin", 'the pilgrims progress',
    'the red badge of courage', 'ivanhoe',
    'the narrative of arthur gordon pym of nantucket',
    'the strange case of dr jekyll and mr hyde', 'a princess of mars',
    'the alhambra', 'waverley', 'lorna doone', 'the deerslayer',
    'the prairie', 'david balfour', 'the golden age', 'dream days',
    'the dragon and the raven', 'the young buglers', 'the black arrow',
    'tom sawyer abroad', 'moonfleet', 'kidnapped', 'murder on the orient express',
    'ben hur', 'demian', 'alice adams', 'platero y yo', 'the most dangerous game',
  ].map((t) => norm(t)),
)

// Authors whose catalogues are adult canon that school editions
// drag into juvenile subjects — Shakespeare above all.
const ADULT_AUTHORS = new Set(
  [
    'william shakespeare', 'jane austen', 'charles dickens',
    'arthur conan doyle', 'h g wells', 'daniel defoe',
    'jonathan swift', 'joseph conrad', 'thomas hardy',
    'george eliot', 'herman melville', 'nathaniel hawthorne',
    'g a henty', 'geoffrey chaucer', 'john bunyan',
    'harriet beecher stowe', 'stephen crane', 'walter scott',
    'edgar allan poe', 'washington irving', 'james fenimore cooper',
    'r d blackmore', 'edgar rice burroughs', 'alexandre dumas', 'agatha christie',
    'sir walter scott',
  ].map((a) => norm(a)),
)

// Same work, variant Open Library entries — fold before ranking.
const FILLER_TOKENS = new Set(['the', 'a', 'an', 'classic', 'tale', 'story', 'of', 'and'])
function variantOf(title, keptTitles) {
  const tokens = new Set(norm(title).split(' ').filter((t) => !FILLER_TOKENS.has(t)))
  if (tokens.size === 0) return false
  for (const kept of keptTitles) {
    const kt = new Set(norm(kept).split(' ').filter((t) => !FILLER_TOKENS.has(t)))
    let hit = 0
    for (const t of tokens) if (kt.has(t)) hit++
    const jaccard = hit / (tokens.size + kt.size - hit)
    if (jaccard >= 0.8) return true
  }
  return false
}

async function openLibraryWorks() {
  const works = new Map()
  for (const [subject, format] of SUBJECT_FORMATS) {
    try {
      const data = await getJson(`https://openlibrary.org/subjects/${subject}.json?limit=200`)
      for (const w of data.works ?? []) {
        const k = keyOf(w.title)
        const prev = works.get(k)
        // Display title: the canonical English name for aliased
        // works; otherwise a spelling whose normalized form IS the
        // key beats a foreign/variant spelling of the same work.
        const display = CANONICAL_DISPLAY.get(k)
          ?? (norm(w.title) === k ? w.title : prev?.title ?? w.title)
        works.set(k, {
          title: display,
          author: w.authors?.[0]?.name ?? prev?.author ?? '',
          coverId: w.cover_id ?? prev?.coverId ?? null,
          editions: Math.max(w.edition_count ?? 0, prev?.editions ?? 0),
          format: prev?.format === 'Picture book' || format === 'Picture book' ? 'Picture book' : format,
          olKey: w.key,
          sources: (prev?.sources ?? 0) + 1,
        })
      }
    } catch (err) {
      console.log(`subject ${subject} skipped: ${err.message}`)
    }
  }
  return works
}

async function coverFor(entry) {
  let coverId = entry.coverId
  if (!coverId) {
    try {
      const data = await getJson(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(entry.title)}&fields=title,cover_i&limit=3`,
      )
      const hit = (data.docs ?? []).find((d) => keyOf(d.title) === keyOf(entry.title) && d.cover_i)
      coverId = hit?.cover_i ?? null
    } catch {
      coverId = null
    }
  }
  if (!coverId) return ''
  const url = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const buf = await res.arrayBuffer()
    return buf.byteLength >= 2000 ? url : '' // smaller = OL's blank placeholder
  } catch {
    return ''
  }
}

// ---- assemble the top list -------------------------------------------
const esc = (s) => String(s).replace(/'/g, "''")

async function existingTitles(platform) {
  const titles = new Set()
  let offset = 0
  for (;;) {
    const rows = sql(
      `select title from public.catalog_items where platform = '${platform}'
       order by title limit 80 offset ${offset}`,
    )
    for (const r of rows ?? []) titles.add(keyOf(r.title))
    if (!rows || rows.length < 80) break
    offset += 80
  }
  return titles
}

function insertRows(rows) {
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40)
    const values = chunk
      .map(
        (r) =>
          `('${r.platform}', '${esc(r.title)}', '${esc(r.details)}', '${esc(r.image_url)}', ` +
          `${r.source_url ? `'${esc(r.source_url)}'` : 'null'}, ${r.sort_order})`,
      )
      .join(',\n')
    sql(
      `insert into public.catalog_items (platform, title, details, image_url, source_url, sort_order)
       values ${values}`,
    )
  }
}

const wiki = await wikipediaBooks()
console.log(`wikipedia individual best-sellers parsed: ${wiki.size}`)
const ol = await openLibraryWorks()
console.log(`open library works collected: ${ol.size}`)

const have = await existingTitles('books')
const byKey = new Map()
for (const [k, w] of ol) {
  const salesBoost = wiki.has(k) ? Math.min(wiki.get(k).sales, 150) * 3 : 0
  byKey.set(k, {
    title: w.title,
    author: w.author,
    score: Math.min(w.editions, 45) * 4 + w.sources * 15 + salesBoost,
    editions: w.editions,
    format: w.format,
    coverId: w.coverId,
    olKey: w.olKey,
  })
}

const candidates = [...byKey.values()]
  .filter(
    (b) =>
      !have.has(keyOf(b.title)) &&
      !ADULT_CROSSOVERS.has(keyOf(b.title)) &&
      !ADULT_AUTHORS.has(norm(b.author)) &&
      !(NON_ENGLISH_TITLE.test(b.title) && !CANONICAL_DISPLAY.has(keyOf(b.title))),
  )
  .sort((a, b) => b.score - a.score)
// No single author floods the shelf (Baum's 14 Oz sequels, six
// Anne sequels): five per author is plenty of any one voice.
const AUTHOR_CAP = 5
const authorCounts = new Map()
const ranked = []
for (const b of candidates) {
  if (ranked.length >= limit) break
  const a = norm(b.author)
  if (a && (authorCounts.get(a) ?? 0) >= AUTHOR_CAP) continue
  if (variantOf(b.title, ranked.map((r) => r.title))) continue
  if (a) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1)
  ranked.push(b)
}
console.log(`new books to add: ${ranked.length}`)
if (dryRun) {
  console.log('top 60:')
  for (const b of ranked.slice(0, 60)) console.log(`  ${Math.round(b.score)}  ${b.title} [${b.format}]`)
  console.log('ranks 61-200:')
  console.log(ranked.slice(60).map((b) => b.title).join(' · '))
}

const bookRows = []
for (let i = 0; i < ranked.length; i += 8) {
  const batch = ranked.slice(i, i + 8)
  const covers = await Promise.all(batch.map((b) => coverFor(b)))
  batch.forEach((b, j) => {
    bookRows.push({
      platform: 'books',
      title: b.title,
      details: b.format,
      image_url: covers[j],
      source_url: b.olKey ? `https://openlibrary.org${b.olKey}` : null,
      sort_order: 100 + (i + j),
    })
  })
}
const withCovers = bookRows.filter((r) => r.image_url).length
console.log(`book covers verified: ${withCovers}/${bookRows.length}`)
if (!dryRun && bookRows.length) insertRows(bookRows)

// ---- Tonies best-sellers gap sweep ------------------------------------
const toniesFeed = await getJson('https://us.tonies.com/collections/tonies-best-sellers/products.json?limit=250')
const toniesHave = await existingTitles('tonies')
// The catalog stores Tonie titles with one trailing " Tonie"
// stripped (feed "Disney Pocahontas Tonie" = catalog "Disney
// Pocahontas"). A product counts as present under either spelling;
// genuinely new ones are stored stripped, like the rest.
const stripTonie = (t) => t.replace(/\s+Tonie$/, '')
const TONIE_DETAILS = { Tonie: 'Tonie figure', 'Creative Tonie': 'Creative Tonie', 'Clever Tonie': 'Clever Tonie', 'My First Tonie': 'My First Tonie', Audiobook: 'Audiobook Tonie' }
const newTonies = (toniesFeed.products ?? [])
  .filter((p) => !/pack|bundle|accessor/i.test(p.title) && !/accessor|bundle/i.test(p.product_type ?? ''))
  .filter((p) => !toniesHave.has(keyOf(p.title)) && !toniesHave.has(keyOf(stripTonie(p.title))))
  .map((p, i) => ({
    platform: 'tonies',
    title: stripTonie(p.title),
    details: TONIE_DETAILS[p.product_type] ?? (p.product_type || 'Tonie figure'),
    image_url: p.images?.[0]?.src ?? '',
    source_url: `https://us.tonies.com/products/${p.handle}`,
    sort_order: 500 + i,
  }))
console.log(`tonies best-sellers net-new: ${newTonies.length}`)
for (const t of newTonies) console.log(`  + ${t.title}`)
if (!dryRun && newTonies.length) insertRows(newTonies)

console.log(JSON.stringify({ dry_run: dryRun, books_added: dryRun ? 0 : bookRows.length, books_covers: withCovers, tonies_added: dryRun ? 0 : newTonies.length }))
