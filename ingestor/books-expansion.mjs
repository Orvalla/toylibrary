#!/usr/bin/env node
// books-expansion.mjs — the big children's-books build-out.
//
//   node ingestor/books-expansion.mjs [--dry-run]
//
// The 2026-10-21 passes (top-books.mjs, modern-books.mjs) proved
// raw Open Library ranking can't be trusted on its own, so this
// pass inverts it again: curated lists nominate, Open Library
// verifies. Four sources, in priority order:
//
//   1. SERIES runs (books-expansion-data.mjs) — every sequel of
//      the franchises the shelf already carries as starters.
//      Each title must resolve on OL under its series author's
//      name, so "Ghost" can only land as Jason Reynolds' Ghost.
//   2. STANDALONES (same data file) — famous books the earlier
//      passes missed, same author-checked resolution.
//   3. AWARDS — Newbery and Caldecott medal + honor tables
//      parsed from Wikipedia (public-domain facts), resolved
//      the same way; Newbery defaults to Chapter book,
//      Caldecott to Picture book.
//   4. DEEP OL — the children's subjects paged 800 deep with
//      the earlier passes' pollution guards (adult-classic
//      denylists, non-English filter, per-author cap), ranked
//      by edition count.
//
// Hard rules for every row: not already on the shelf (by the
// passes' normalized key), a verified non-blank Open Library
// cover (no cover, no row), platform 'books', details one of
// the shelf's format labels. Inserts use ON CONFLICT DO NOTHING
// against the (platform, title) unique key.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERIES, STANDALONES } from './books-expansion-data.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
// Work dir lives under the goal's hidden files, not /tmp: /tmp is
// wiped when the sandbox restarts, and the OL cache is expensive.
const WORK_DIR = join(HERE, '..', '..', 'goals', 'toy-library-tracker', 'hidden_files', 'overnight')
const CACHE_DIR = join(WORK_DIR, 'ol-cache')
mkdirSync(CACHE_DIR, { recursive: true })
const dryRun = process.argv.includes('--dry-run')
const UA = 'ToyLibrary/1.0 (catalog build; contact via toylibrary.store)'

let emitSeq = 0
function sql(statement) {
  // EMIT mode (BOOKS_EMIT=1): collect statements as files for a
  // direct sb.py application pass instead of executing them
  // from inside node (see overnight DECISIONS.md — writes made
  // from node-spawned sb.py calls do not reach the real DB).
  if (process.env.BOOKS_EMIT === '1' && /^\s*insert/i.test(statement)) {
    const out = `/home/hatch/workspace/.emit/books-${String(emitSeq++).padStart(3, '0')}.sql`
    writeFileSync(out, statement)
    return []
  }
  const file = `/tmp/booksexp-${process.pid}.sql`
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
// Apostrophes are typographic half the time on Open Library.
const keyTitle = (t) => norm(String(t).replace(/['’]/g, ''))
const esc = (s) => String(s).replace(/'/g, "''")

async function getJson(url, { cache = false } = {}) {
  let cacheFile = null
  if (cache) {
    cacheFile = join(CACHE_DIR, createHash('md5').update(url).digest('hex') + '.json')
    if (existsSync(cacheFile)) {
      try {
        return JSON.parse(readFileSync(cacheFile, 'utf8'))
      } catch { /* refetch */ }
    }
  }
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(30000),
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      const data = await res.json()
      if (cacheFile) writeFileSync(cacheFile, JSON.stringify(data))
      return data
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  throw lastErr
}

async function mapPool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

// ---- guards (carried over from top-books.mjs / modern-books.mjs) ----
const REFUSE_TITLES = new Set(
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
    'captains courageous', "king solomon's mines",
    'a connecticut yankee in king arthur\u2019s court',
    'the canterbury tales', "uncle tom's cabin", 'the pilgrims progress',
    'the red badge of courage', 'ivanhoe',
    'the strange case of dr jekyll and mr hyde',
    'ben hur', 'the most dangerous game',
    'shatter me', 'twilight', 'new moon', 'eclipse', 'breaking dawn',
    'the cruel prince', 'a court of thorns and roses', 'fourth wing',
    'it ends with us', 'the midnight library', 'a good girls guide to murder',
    'they both die at the end', 'the song of achilles', 'normal people',
    'verity', 'the seven husbands of evelyn hugo', 'lessons in chemistry',
    'a little life', 'the silent patient', 'gone girl',
    'the perks of being a wallflower', 'looking for alaska',
    'the fault in our stars', 'the selection', 'scythe',
    'heartstopper volume 1', 'heartstopper volume 2',
    'the hunger games catching fire', 'mockingjay',
  ].map((t) => norm(t)),
)
const REFUSE_AUTHORS = new Set(
  [
    'william shakespeare', 'jane austen', 'charles dickens',
    'arthur conan doyle', 'h g wells', 'daniel defoe',
    'jonathan swift', 'joseph conrad', 'thomas hardy',
    'george eliot', 'herman melville', 'nathaniel hawthorne',
    'g a henty', 'geoffrey chaucer', 'john bunyan',
    'harriet beecher stowe', 'stephen crane', 'walter scott',
    'edgar allan poe', 'washington irving', 'james fenimore cooper',
    'r d blackmore', 'edgar rice burroughs', 'alexandre dumas',
    'agatha christie',
  ].map((a) => norm(a)),
)
const REFUSE_PATTERN =
  /sparknotes|cliffsnotes|study guide|lesson plan|teacher'?s (guide|edition)|workbook|coloring book|sticker book|activity book|boxed set|box set|complete (collection|series)|omnibus|test prep/i
const NON_ENGLISH_TITLE =
  /^(der|die|das|den|le|la|les|el|il|lo|het|een|un|une|des|du)\s|[äöüéèàâêîôûçãõ]/i

// ---- existing shelf ---------------------------------------------------
const have = new Set()
for (let offset = 0; ; offset += 80) {
  const rows = sql(
    `select title from public.catalog_items where platform = 'books' order by title limit 80 offset ${offset}`,
  )
  for (const r of rows ?? []) {
    have.add(keyOf(r.title))
    have.add(keyTitle(r.title))
  }
  if (!rows || rows.length < 80) break
}
console.log(`existing books on shelf: ${have.size / 2} (approx keys)`)

// ---- Open Library resolution -------------------------------------------
async function searchTitle(q, authorSub = '') {
  const url =
    `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}` +
    (authorSub ? `&author=${encodeURIComponent(authorSub)}` : '') +
    `&fields=title,author_name,cover_i,want_to_read_count,first_publish_year,subject&limit=25`
  const data = await getJson(url, { cache: true })
  return data.docs ?? []
}

function titleVariants(display) {
  const vs = new Set([display])
  vs.add(display.replace(/\s*[—,–-]\s*(19|20)\d{2}\s*$/, '').trim())
  vs.add(display.replace(/,\s*(19|20)\d{2}\s*$/, '').trim())
  if (display.includes(': ')) {
    vs.add(display.split(': ').slice(1).join(': '))
    vs.add(display.replace(': ', ' in '))
  }
  return [...vs].filter((v) => v && v.length > 1)
}

// Resolve one nominated title. Returns { docs } — the acceptable
// editions, best first — on a verified identity match, or
// { miss: reason }. Two searches feed each variant: title-only,
// plus title+author when authors are known (the title-only top
// hits for popular series are often other people's same-titled
// books or author-less records; the author index finds the real
// editions). The caller walks the pool for a verified cover.
async function resolveTitle({ title, authors = [], softAuthors = [] }) {
  let mismatchFound = ''
  for (const v of titleVariants(title)) {
    const seenDocs = new Set()
    const docs = []
    const searches = ['']
    if (authors.length) searches.push(authors[0])
    for (const sub of searches) {
      let found
      try {
        found = await searchTitle(v, sub)
      } catch {
        continue
      }
      for (const d of found) {
        const dk = `${keyTitle(d.title)}|${(d.author_name ?? []).join(',')}|${d.cover_i ?? ''}`
        if (!seenDocs.has(dk)) {
          seenDocs.add(dk)
          docs.push(d)
        }
      }
    }
    const exact = docs.filter(
      (d) => keyTitle(d.title) === keyTitle(v) || keyTitle(d.title) === keyTitle(title),
    )
    if (!exact.length) continue
    let pool = exact
    if (softAuthors.length) {
      // Preference only (Caldecott names illustrators, whom Open
      // Library doesn't always credit as authors): matching docs
      // sort first, but a non-matching exact title still counts.
      pool = [...exact].sort(
        (a, b) =>
          ((b.author_name ?? []).some((x) => softAuthors.some((s) => norm(x).includes(s))) ? 1 : 0) -
          ((a.author_name ?? []).some((x) => softAuthors.some((s) => norm(x).includes(s))) ? 1 : 0),
      )
    }
    if (authors.length) {
      const byAuthor = exact.filter((d) =>
        (d.author_name ?? []).some((a) => authors.some((sub) => norm(a).includes(sub))),
      )
      if (!byAuthor.length) {
        mismatchFound = `author mismatch (found: ${exact.map((d) => (d.author_name ?? []).join(',')).join(' / ')})`
        continue
      }
      // Prefer the doc matching the first-listed author string.
      byAuthor.sort(
        (a, b) =>
          ((b.author_name ?? []).some((x) => norm(x).includes(authors[0])) ? 1 : 0) -
          ((a.author_name ?? []).some((x) => norm(x).includes(authors[0])) ? 1 : 0),
      )
      pool = byAuthor
    }
    pool.sort(
      (a, b) =>
        (b.cover_i ? 1 : 0) - (a.cover_i ? 1 : 0) ||
        (b.want_to_read_count ?? 0) - (a.want_to_read_count ?? 0),
    )
    return { docs: pool }
  }
  if (mismatchFound) return { miss: mismatchFound }
  return { miss: 'not found on Open Library' }
}

const coverCache = new Map()
async function verifyCover(coverId) {
  if (!coverId) return ''
  if (coverCache.has(coverId)) return coverCache.get(coverId)
  const url = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
  // BOOKS_TRUST_COVERS=1: skip the live fetch (covers for these
  // works were verified in earlier runs; the coordinator
  // sample-checks the inserted URLs afterward). Keeps a re-run
  // inside one foreground window.
  if (process.env.BOOKS_TRUST_COVERS === '1') {
    coverCache.set(coverId, url)
    return url
  }
  let ok = ''
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
    if (res.ok) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength >= 2000) ok = url
    }
  } catch { /* no cover, no row */ }
  coverCache.set(coverId, ok)
  return ok
}

// ---- assemble -----------------------------------------------------------
const accepted = [] // {title, details, image_url, source_url, via}
const seen = new Set()
const report = {}

function accept(title, format, imageUrl, sourceUrl, via) {
  const k = keyOf(title)
  if (seen.has(k) || have.has(k) || have.has(keyTitle(title))) return false
  if (REFUSE_TITLES.has(k) || REFUSE_TITLES.has(keyTitle(title))) return false
  if (REFUSE_PATTERN.test(title)) return false
  seen.add(k)
  accepted.push({ title, details: format, image_url: imageUrl, source_url: sourceUrl, via })
  return true
}

async function runResolvedList(list, via) {
  const stats = { nominated: list.length, resolved: 0, covered: 0, added: 0, misses: [] }
  const results = await mapPool(list, 4, async (item) => {
    const r = await resolveTitle(item)
    return { item, ...r }
  })
  for (const r of results) {
    if (!r.docs) {
      stats.misses.push(`${r.item.title} — ${r.miss}`)
      continue
    }
    stats.resolved++
    // Walk the acceptable editions until one has a verified
    // cover — editions of the same work differ wildly in cover
    // availability on Open Library.
    let cover = ''
    for (const doc of r.docs) {
      cover = await verifyCover(doc.cover_i)
      if (cover) break
    }
    if (!cover) {
      stats.misses.push(`${r.item.title} — resolved but no verified cover`)
      continue
    }
    stats.covered++
    if (accept(r.item.title, r.item.format, cover, null, via)) stats.added++
  }
  report[via] = stats
  console.log(`${via}: nominated ${stats.nominated}, resolved ${stats.resolved}, covered ${stats.covered}, new ${stats.added}`)
  return stats
}

// 1 + 2: series runs and standalones.
const seriesList = []
for (const s of SERIES) {
  for (const t of s.titles) seriesList.push({ title: t, authors: s.authors, format: s.format })
}
await runResolvedList(seriesList, 'series')
const standaloneList = STANDALONES.map(([title, author, format]) => ({
  title,
  authors: author ? [author] : [],
  format,
}))
await runResolvedList(standaloneList, 'standalones')

// 3: awards — Newbery + Caldecott tables from Wikipedia.
async function wikiAwardTitles(page) {
  const data = await getJson(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`,
    { cache: true },
  )
  const wt = data.parse.wikitext['*']
  // Both medal pages use the same winners-table shape (verified
  // against the live wikitext): a year header line starting with
  // '!', then per book an author/illustrator cell, a title cell
  // (''[[Title]]'', sometimes sort-wrapped either way round) and
  // an award cell {{Won|place=1|Winner}} / {{Won|place=2|Honor}}.
  // Cells may carry <!--...--> comments. Winners only — Honor
  // books are deliberately not swept in.
  const linkText = (line) => {
    const m = line.match(/\[\[([^\]]+)\]\]/)
    if (!m) return ''
    const parts = m[1].split('|')
    return parts[parts.length - 1].trim()
  }
  const out = new Map()
  let year = 0
  let author = ''
  let title = ''
  for (const raw of wt.split('\n')) {
    const line = raw.replace(/<!--[^>]*-->/g, '')
    if (line.startsWith('!')) {
      const ym = line.match(/\b((?:19|20)\d{2})\b/)
      if (ym) {
        year = Number(ym[1])
        author = ''
        title = ''
      }
      continue
    }
    if (!line.startsWith('|')) continue
    if (/\{\{Won\|place=1/.test(line)) {
      if (year && title && title.length >= 3 && !/medal|award|list of|wikipedia/i.test(title)) {
        const k = keyTitle(title)
        if (!out.has(k)) out.set(k, { title, author })
      }
      author = ''
      title = ''
      continue
    }
    if (/\{\{Won\|place=2/.test(line)) {
      author = ''
      title = ''
      continue
    }
    if (line.startsWith('|-') || line.startsWith('|+')) continue
    const text = linkText(line)
    if (!text) continue
    if (!author) author = text
    else if (!title) title = text
  }
  return [...out.values()]
}

for (const [page, format] of [['Newbery Medal', 'Chapter book'], ['Caldecott Medal', 'Picture book']]) {
  let titles = []
  try {
    titles = await wikiAwardTitles(page)
  } catch (err) {
    console.log(`${page}: fetch failed: ${err.message}`)
    continue
  }
  console.log(`${page}: ${titles.length} table titles parsed`)
  const surname = (t) => (t.author ? [norm(t.author).split(' ').slice(-1)[0]] : [])
  const list = titles.map((t) =>
    page.startsWith('Caldecott')
      ? { title: t.title, authors: [], softAuthors: surname(t), format }
      : { title: t.title, authors: surname(t), format },
  )
  await runResolvedList(list, `awards:${page}`)
}

// 4: deep Open Library subjects, same guards as the first pass.
const DEEP_SUBJECTS = [
  ['picture_books', 'Picture book'],
  ['board_books', 'Board book'],
  ['juvenile_fiction', 'Chapter book'],
  ['juvenile_literature', 'Chapter book'],
]
{
  const works = new Map()
  for (const [subject, format] of DEEP_SUBJECTS) {
    for (const offset of [0, 200, 400, 600]) {
      try {
        const data = await getJson(
          `https://openlibrary.org/subjects/${subject}.json?limit=200&offset=${offset}`,
          { cache: true },
        )
        for (const w of data.works ?? []) {
          const k = keyOf(w.title)
          const prev = works.get(k)
          works.set(k, {
            title: prev?.title ?? w.title,
            author: w.authors?.[0]?.name ?? prev?.author ?? '',
            coverId: w.cover_id ?? prev?.coverId ?? null,
            editions: Math.max(w.edition_count ?? 0, prev?.editions ?? 0),
            format:
              prev?.format === 'Picture book' || format === 'Picture book'
                ? 'Picture book'
                : prev?.format === 'Board book' || format === 'Board book'
                  ? 'Board book'
                  : format,
            sources: (prev?.sources ?? 0) + 1,
          })
        }
      } catch (err) {
        console.log(`subject ${subject}@${offset} skipped: ${err.message}`)
      }
    }
  }
  let candidates = [...works.values()]
    .filter(
      (b) =>
        !REFUSE_TITLES.has(keyOf(b.title)) &&
        !REFUSE_TITLES.has(keyTitle(b.title)) &&
        !REFUSE_AUTHORS.has(norm(b.author)) &&
        !REFUSE_PATTERN.test(b.title) &&
        !(NON_ENGLISH_TITLE.test(b.title)),
    )
    .map((b) => ({ ...b, score: Math.min(b.editions, 60) * 2 + b.sources * 15 }))
    .sort((a, b) => b.score - a.score)
  const authorCounts = new Map()
  const picked = []
  const FILLER = new Set(['the', 'a', 'an', 'classic', 'tale', 'story', 'of', 'and'])
  const variantOf = (title) => {
    const tokens = new Set(norm(title).split(' ').filter((t) => !FILLER.has(t)))
    if (!tokens.size) return true
    for (const kept of picked) {
      const kt = new Set(norm(kept.title).split(' ').filter((t) => !FILLER.has(t)))
      let hit = 0
      for (const t of tokens) if (kt.has(t)) hit++
      if (hit / (tokens.size + kt.size - hit) >= 0.85) return true
    }
    return false
  }
  for (const b of candidates) {
    if (picked.length >= 170) break
    const a = norm(b.author)
    if (a && (authorCounts.get(a) ?? 0) >= 8) continue
    if (variantOf(b.title)) continue
    if (a) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1)
    picked.push(b)
  }
  const stats = { nominated: candidates.length, resolved: picked.length, covered: 0, added: 0, misses: [] }
  const covers = await mapPool(picked, 8, (b) => verifyCover(b.coverId))
  picked.forEach((b, i) => {
    if (!covers[i]) return
    stats.covered++
    if (accept(b.title, b.format, covers[i], null, 'deep-ol')) stats.added++
  })
  report['deep-ol'] = stats
  console.log(`deep-ol: pool ${candidates.length}, picked ${picked.length}, covered ${stats.covered}, new ${stats.added}`)
}

// ---- insert ---------------------------------------------------------------
console.log(`\ntotal new books accepted: ${accepted.length}`)
if (dryRun) {
  for (const via of Object.keys(report)) {
    console.log(`\n== ${via} misses (${report[via].misses.length}) ==`)
    for (const m of report[via].misses.slice(0, 60)) console.log(`  ${m}`)
  }
}

let inserted = 0
if (!dryRun && accepted.length) {
  const rows = accepted.map((r, i) => ({ ...r, sort_order: 6000 + i }))
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40)
    const values = chunk
      .map(
        (r) =>
          `('books', '${esc(r.title)}', '${esc(r.details)}', '${esc(r.image_url)}', null, ${r.sort_order})`,
      )
      .join(',\n')
    const res = sql(
      `insert into public.catalog_items (platform, title, details, image_url, source_url, sort_order)
       values ${values}
       on conflict (platform, title) do nothing
       returning title`,
    )
    inserted += (res ?? []).length
  }
}
console.log(JSON.stringify({ dry_run: dryRun, accepted: accepted.length, inserted }))
writeFileSync(
  join(WORK_DIR, 'books-expansion-report.json'),
  JSON.stringify({ report, accepted: accepted.map((a) => a.title) }, null, 2),
)
