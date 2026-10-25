#!/usr/bin/env node
// backfill-ratings-books.mjs — fill catalog_items.rating /
// rating_count for the 'books' shelf from Open Library, the
// same source the shelf was built from.
//
//   node ingestor/backfill-ratings-books.mjs [--dry-run]
//
// Two paths per row:
//   * Rows the canon pass (top-books.mjs) added carry their
//     Open Library work link in source_url — the rating is a
//     direct fetch of /works/<OLID>/ratings.json.
//   * Rows without a link (the modern-books batch and the hand
//     seeds) are matched through the OL search API, accepting
//     ONLY an exact normalized-title hit — the same folding the
//     ingestors use (case/punctuation folded, leading "the"
//     dropped, plus the subtitle after a colon tried as its own
//     title, e.g. "Bone: Out from Boneville" → "Out from
//     Boneville"). An accepted search match also records the
//     work link into source_url so the match is auditable and
//     future runs take the direct path.
// A rating is written only when Open Library reports both an
// average and at least one rating behind it. Rows whose work
// has never been rated stay null — no number is better than a
// made-up one. Prints a JSON summary plus the unmatched list.
//
// Transport (since the 2026-10-24 full-enrichment run): reads
// and writes go over PostgREST with SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, writes through the set_ratings
// RPC (migration 0050) — so the crawl runs as a GitHub
// Actions job (enrich.yml). The old local sbq.py write path
// is gone; run locally only with --dry-run.

import { readFileSync } from 'node:fs'
import { getJson } from './lib/http.mjs'

const dryRun = process.argv.slice(2).includes('--dry-run')
const DELAY_MS = 350 // Open Library is a public good — stay leisurely.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}
async function rest(path, options = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...options, headers })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}
async function fetchUnratedBookRows() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `catalog_items?select=id,title,source_url` +
        `&rating=is.null&platform=eq.books&order=title&limit=1000&offset=${from}`,
    )
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}
async function applyRatingUpdates(chunk) {
  await rest('rpc/set_ratings', {
    method: 'POST',
    body: JSON.stringify({ p_updates: chunk }),
  })
}

// Same title folding as top-books.mjs keyOf (minus its alias map).
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')

async function ratingForWork(olKey) {
  // olKey: "/works/OL123W"
  const data = await getJson(`https://openlibrary.org${olKey}/ratings.json`)
  const avg = Number(data?.summary?.average)
  const count = Number(data?.summary?.count)
  if (!Number.isFinite(avg) || !Number.isFinite(count)) return null
  if (avg <= 0 || avg > 5 || count < 1) return null
  return { rating: Math.round(avg * 10) / 10, rating_count: Math.floor(count) }
}

async function findWorkByTitle(title) {
  const queries = [title]
  const colon = title.indexOf(':')
  if (colon > 0) queries.push(title.slice(colon + 1).trim())
  for (const q of queries) {
    if (!q) continue
    const data = await getJson(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}&fields=title,key&limit=5`,
    )
    await sleep(DELAY_MS)
    for (const doc of data.docs ?? []) {
      if (norm(doc.title) === norm(title) || norm(doc.title) === norm(q)) {
        return doc.key // "/works/OL..."
      }
    }
  }
  return null
}

// BOOKS_RATINGS_SNAPSHOT: real unrated-book list dumped via a
// verified channel; BOOKS_RATINGS_START/LIMIT slice the run so
// each invocation fits one foreground window.
const allRows = process.env.BOOKS_RATINGS_SNAPSHOT
  ? JSON.parse(readFileSync(process.env.BOOKS_RATINGS_SNAPSHOT, 'utf8'))
  : await fetchUnratedBookRows()
const sliceStart = Number(process.env.BOOKS_RATINGS_START ?? 0)
const sliceLimit = Number(process.env.BOOKS_RATINGS_LIMIT ?? allRows.length)
const rows = allRows.slice(sliceStart, sliceStart + sliceLimit)
console.log(`books without a rating: ${allRows.length} (this run: ${rows.length} from ${sliceStart})`)

const updates = [] // {id, rating, rating_count, source_url?}
const stats = { direct: 0, via_search: 0, unrated_works: 0, unmatched: [] }
let appliedCount = 0

// Flush-as-you-go: apply in chunks of 20 during the loop so
// a stopped run keeps the progress it already made. Dry runs
// keep the updates in memory and report them instead.
async function flushUpdates(final = false) {
  if (!updates.length || (!final && updates.length < 20)) return
  if (dryRun) return
  const chunk = updates.splice(0, updates.length)
  await applyRatingUpdates(chunk)
  appliedCount += chunk.length
}

for (const row of rows) {
  try {
    const link = /openlibrary\.org(\/works\/OL\d+W)/.exec(row.source_url ?? '')
    if (link) {
      const r = await ratingForWork(link[1])
      await sleep(DELAY_MS)
      if (r) {
        updates.push({ id: row.id, ...r })
        stats.direct++
        await flushUpdates()
      } else stats.unrated_works++
      continue
    }
    const key = await findWorkByTitle(row.title)
    if (!key) {
      stats.unmatched.push(row.title)
      continue
    }
    const r = await ratingForWork(key)
    await sleep(DELAY_MS)
    if (r) {
      updates.push({ id: row.id, ...r, source_url: `https://openlibrary.org${key}` })
      stats.via_search++
      await flushUpdates()
    } else stats.unrated_works++
  } catch (err) {
    console.log(`  ! ${row.title}: ${err.message}`)
    stats.unmatched.push(row.title)
  }
}

console.log(
  `updates ready: ${appliedCount + updates.length} (direct ${stats.direct}, via search ${stats.via_search})`,
)
console.log(`works with no ratings on Open Library: ${stats.unrated_works}`)
console.log(`unmatched titles: ${stats.unmatched.length}`)
for (const t of stats.unmatched) console.log(`  ? ${t}`)

if (!dryRun) await flushUpdates(true)
console.log(
  JSON.stringify({
    dry_run: dryRun,
    books_considered: rows.length,
    updated: dryRun ? 0 : appliedCount,
    direct: stats.direct,
    via_search: stats.via_search,
    unrated_works: stats.unrated_works,
    unmatched: stats.unmatched.length,
  }),
)
