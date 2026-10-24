#!/usr/bin/env node
// Unified popularity scoring — computes catalog_items.
// popularity_score (migration 0049), the number the Popular
// sort orders by. Run weekly by weekly-ingest.yml after the
// ingest (fresh rows get scored the same run) and on demand
// via popularity.yml. Locally:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ingestor/popularity.mjs [--dry] [--items-file f]
//
// THE SCORE (0..~1, higher = more popular). Additive, so
// every component is explainable and the ranking degrades
// gracefully to the fallback the owner specified — the
// maker's own list order — when an item has no other data:
//
//   base      0.40 × within-platform percentile of the
//             maker's list order (sort_order). Every item
//             has this; for most of the catalog today it IS
//             the score. (The client's fallback for an
//             unscored row uses this same percentile —
//             keep the two in sync: src/lib/popular.js.)
//   reviews   0.30 × review quality, from the rating /
//             rating_count the stores publish (ingest +
//             the weekly ratings top-up grow coverage).
//             Bayesian-smoothed toward the catalog mean
//             with a 25-review prior, then mapped so 3.5★
//             smoothed → 0 and 5.0★ → 1.
//   on-site   0.20 × family behavior on THIS site, from the
//             items table: E = 2·have + 1.5·wishlist +
//             3·claimed, squashed as E/(E+6). Ownership is
//             the strongest per-unit signal; a claim means
//             a gift-giver committed. Sparse while the user
//             base is small — by design it matters more as
//             the site grows, with no formula change.
//   editorial 0.10 × list presence, log-scaled: for books,
//             NYT bestseller weeks-on-list (the 104-week
//             archive walk, ingestor/data/editorial-books
//             .json; 200+ weeks maxes it). New list sources
//             (BGG rankings when the API lands, award
//             lists) extend this component — add their
//             data file and a lookup here, nothing else
//             changes.
//
// Writes go through the set_popularity_scores RPC in chunks
// (service role only). --dry computes and reports the
// distribution without writing.

import { appendFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY = process.argv.includes('--dry')
const itemsFileArg = process.argv.indexOf('--items-file')
const ITEMS_FILE = itemsFileArg >= 0 ? process.argv[itemsFileArg + 1] : null

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

async function allRows(table, select) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const page = await rest(`${table}?select=${select}&order=id&limit=1000&offset=${from}`)
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// Same normalization the NYT walk used for its pool keys.
export function normalizeTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const W = { base: 0.4, reviews: 0.3, onsite: 0.2, editorial: 0.1 }
const REVIEW_PRIOR_COUNT = 25
const ONSITE_SCALE = 6

export function computeScores(catalog, itemRows, editorial) {
  // Within-platform order (the maker's own listing order).
  const byPlatform = new Map()
  for (const row of catalog) {
    const list = byPlatform.get(row.platform)
    if (list) list.push(row)
    else byPlatform.set(row.platform, [row])
  }
  const rankOf = new Map()
  const sizeOf = new Map()
  for (const [platform, rows] of byPlatform) {
    const ordered = [...rows].sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.title.localeCompare(b.title) ||
        String(a.id).localeCompare(String(b.id))
    )
    sizeOf.set(platform, ordered.length)
    ordered.forEach((row, i) => rankOf.set(row.id, i))
  }

  // Review prior: the live mean of rated rows.
  const rated = catalog.filter((r) => r.rating != null && (r.rating_count ?? 0) > 0)
  const meanRating = rated.length
    ? rated.reduce((sum, r) => sum + Number(r.rating), 0) / rated.length
    : 4.2

  // On-site behavior, keyed like the catalog's unique pair.
  const onsite = new Map()
  for (const it of itemRows) {
    const key = `${it.platform}\n${it.title}`
    const agg = onsite.get(key) ?? { have: 0, wish: 0, claims: 0 }
    if (it.list_type === 'have') agg.have += 1
    else if (it.list_type === 'wishlist') agg.wish += 1
    if (it.claimed_at) agg.claims += 1
    onsite.set(key, agg)
  }

  const stats = { reviews: 0, onsite: 0, editorial: 0 }
  const scores = catalog.map((row) => {
    const size = sizeOf.get(row.platform) ?? 1
    const rank = rankOf.get(row.id) ?? 0
    let score = W.base * ((size - rank) / size)

    if (row.rating != null && (row.rating_count ?? 0) > 0) {
      const count = Number(row.rating_count)
      const bayes =
        (Number(row.rating) * count + meanRating * REVIEW_PRIOR_COUNT) /
        (count + REVIEW_PRIOR_COUNT)
      score += W.reviews * clamp01((bayes - 3.5) / 1.5)
      stats.reviews += 1
    }

    const agg = onsite.get(`${row.platform}\n${row.title}`)
    if (agg) {
      const e = 2 * agg.have + 1.5 * agg.wish + 3 * agg.claims
      if (e > 0) {
        score += W.onsite * (e / (e + ONSITE_SCALE))
        stats.onsite += 1
      }
    }

    if (row.platform === 'books') {
      const ed = editorial[normalizeTitle(row.title)]
      if (ed && ed.weeks > 0) {
        score += W.editorial * clamp01(Math.log(1 + ed.weeks) / Math.log(1 + 200))
        stats.editorial += 1
      }
    }

    return { id: row.id, score: Math.round(score * 10000) / 10000 }
  })
  return { scores, stats, meanRating }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const editorial = JSON.parse(
    await readFile(join(here, 'data', 'editorial-books.json'), 'utf8')
  )
  const catalog = await allRows(
    'catalog_items',
    'id,platform,title,sort_order,rating,rating_count'
  )
  const itemRows = ITEMS_FILE
    ? JSON.parse(await readFile(ITEMS_FILE, 'utf8'))
    : await allRows('items', 'id,platform,title,list_type,claimed_at')

  const { scores, stats, meanRating } = computeScores(catalog, itemRows, editorial)

  const sorted = [...scores].sort((a, b) => b.score - a.score)
  const pct = (q) => sorted[Math.floor(q * (sorted.length - 1))]?.score
  const byId = new Map(catalog.map((r) => [r.id, r]))
  const lines = [
    `Popularity scoring ${DRY ? '(dry run) ' : ''}— ${catalog.length} items`,
    `Components present: reviews ${stats.reviews} · on-site ${stats.onsite} · editorial ${stats.editorial} (rating prior mean ${meanRating.toFixed(3)})`,
    `Score distribution: max ${sorted[0]?.score} · p90 ${pct(0.1)} · median ${pct(0.5)} · min ${sorted[sorted.length - 1]?.score}`,
    'Top 15:',
    ...sorted.slice(0, 15).map((s) => {
      const r = byId.get(s.id)
      return `  ${s.score.toFixed(4)}  [${r.platform}] ${r.title}`
    }),
  ]
  for (const line of lines) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
  }

  if (DRY) return
  let applied = 0
  for (let i = 0; i < scores.length; i += 2000) {
    const n = await rest('rpc/set_popularity_scores', {
      method: 'POST',
      body: JSON.stringify({ p_scores: scores.slice(i, i + 2000) }),
    })
    applied += Number(n) || 0
  }
  console.log(`Wrote popularity_score for ${applied} items`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
