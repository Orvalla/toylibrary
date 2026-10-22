#!/usr/bin/env node
// backfill-ratings-stores.mjs — fill catalog_items.rating /
// rating_count for product platforms from the stores' own
// product pages: the aggregateRating a store publishes in its
// JSON-LD (extracted by the same helper the ingest-catalog
// Edge Function uses, supabase/functions/ingest-catalog/
// extract.js → extractAggregateRating).
//
//   node ingestor/backfill-ratings-stores.mjs [--dry-run]
//        [--platform tonies] [--yoto-limit 500]
//
// Reality check (probed 2026-10-21): most stores never put the
// number in static HTML — Tonies renders reviews through
// Bazaarvoice, Yoto through Trustpilot, Storypod through
// Okendo, all client-side. Osmo's JSON-LD carries it today.
// This crawl therefore fills what is verifiably published and
// reports the rest as gaps; it never guesses.
//
// Page URLs come from the row's source_url when present, else
// from the ingestor's own output map (ingestor/out/catalog.json)
// matched on platform + normalized title — the same URL the
// original crawl stored. Rows with no recoverable URL are
// counted and skipped.
//
// Politeness: one request at a time per host with ≥350ms
// between requests (hosts run in parallel with each other), a
// real identifying UA, and a host is abandoned after 3
// consecutive 403/429 responses. Rows already carrying a
// rating are skipped, so a rerun resumes where a stopped one
// left off. A rating is written only with a count behind it.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractAggregateRating } from '../supabase/functions/ingest-catalog/extract.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SBQ = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sbq.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyPlatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null
const yotoLimit = args.includes('--yoto-limit') ? Number(args[args.indexOf('--yoto-limit') + 1]) : 500
const UA = 'ToyLibraryIngestor/1.0 (ratings backfill; contact via toylibrary.store)'
const DELAY_MS = 350
const MAX_STRIKES = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let emitSeq = 0
function sql(statement) {
  // EMIT mode (RATINGS_EMIT=1): write statements are collected
  // as files for direct application — writes made from inside
  // node via sbq.py do not reach the real database (see the
  // overnight DECISIONS.md incident note). Reads still execute.
  if (process.env.RATINGS_EMIT === '1' && /^\s*update/i.test(statement)) {
    const out = `/home/hatch/workspace/.emit/ratings-${String(emitSeq++).padStart(3, '0')}.sql`
    writeFileSync(out, statement)
    return [{ ok: 1 }]
  }
  const file = `/tmp/ratings-stores-${process.pid}.sql`
  writeFileSync(file, statement)
  const out = execFileSync('python3', [SBQ, file], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  if (parsed.status >= 300) throw new Error(`SQL failed (${parsed.status}): ${out.slice(0, 300)}`)
  return parsed.result
}

const normTitle = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ---- work list ---------------------------------------------------------
const ingested = JSON.parse(readFileSync(join(HERE, 'out', 'catalog.json'), 'utf8'))
const urlByKey = new Map()
for (const r of ingested) {
  if (r.source_url) urlByKey.set(`${r.platform}|${normTitle(r.title)}`, r.source_url)
}

// STORES_SNAPSHOT: real unrated-product list from a verified
// channel; STORES_START/LIMIT slice the queue per run.
const rows = process.env.STORES_SNAPSHOT
  ? JSON.parse(readFileSync(process.env.STORES_SNAPSHOT, 'utf8'))
  : sql(
      `select id, platform, title, source_url, sort_order from public.catalog_items
       where platform <> 'books' and rating is null
       order by platform, sort_order, title`,
    )
const PLATFORM_ORDER = ['tonies', 'yoto', 'storypod', 'osmo', 'lunii', 'projector', 'leapfrog', 'vtech', 'other']
const work = []
const stats = new Map()
function stat(platform) {
  if (!stats.has(platform))
    stats.set(platform, {
      rows: 0, with_url: 0, no_url: 0, fetched: 0, http_blocked: 0, fetch_failed: 0,
      with_rating: 0, rating_no_count: 0, updated: 0, stopped: false, skipped_stopped: 0,
    })
  return stats.get(platform)
}

for (const row of rows) {
  if (onlyPlatform && row.platform !== onlyPlatform) continue
  const s = stat(row.platform)
  s.rows++
  const url = row.source_url || urlByKey.get(`${row.platform}|${normTitle(row.title)}`) || null
  if (!url) {
    s.no_url++
    continue
  }
  s.with_url++
  work.push({ ...row, url })
}
// Yoto is huge; the brief is its first ~500 pages by catalog order.
const yotoWork = work.filter((w) => w.platform === 'yoto')
const fullQueue = [
  ...work.filter((w) => w.platform !== 'yoto'),
  ...yotoWork.slice(0, yotoLimit),
]
const qStart = Number(process.env.STORES_START ?? 0)
const qLimit = Number(process.env.STORES_LIMIT ?? fullQueue.length)
const queue = fullQueue.slice(qStart, qStart + qLimit)
// (Yoto rows beyond the limit are simply not queued.)
console.log(
  `rows to crawl: ${queue.length} (of ${rows.length} unrated product rows; yoto queued ${Math.min(yotoWork.length, yotoLimit)}/${yotoWork.length} with URLs)`,
)

// ---- crawl ---------------------------------------------------------------
const updates = []
const idToPlatform = new Map()
function flushStoreUpdates(final = false) {
  if (!updates.length || (!final && updates.length < 20)) return
  const chunk = updates.splice(0, updates.length)
  for (const u of chunk) {
    const pf = idToPlatform.get(u.id)
    if (pf) stat(pf).updated++
  }
  sql(
    chunk
      .map(
        (u) =>
          `update public.catalog_items set rating = ${u.rating}, rating_count = ${u.rating_count} where id = '${u.id}';`,
      )
      .join('\n'),
  )
}
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  })
  if (res.status === 403 || res.status === 429) return { blocked: res.status }
  if (!res.ok) return { failed: res.status }
  return { html: await res.text() }
}

async function crawlHost(host, items) {
  let strikes = 0
  let lastStart = 0
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    const s = stat(item.platform)
    if (strikes >= MAX_STRIKES) {
      // Host is refusing us — abandon the rest of its queue
      // rather than hammering it.
      s.stopped = true
      s.skipped_stopped += items.length - idx
      break
    }
    const wait = DELAY_MS - (Date.now() - lastStart)
    if (wait > 0) await sleep(wait)
    lastStart = Date.now()
    let res
    try {
      res = await fetchPage(item.url)
    } catch {
      res = { failed: 'network' }
    }
    if (res.blocked) {
      strikes++
      s.http_blocked++
      continue
    }
    if (res.failed) {
      s.fetch_failed++
      continue
    }
    strikes = 0
    s.fetched++
    const found = extractAggregateRating(res.html)
    if (!found) continue
    if (!found.rating_count) {
      s.rating_no_count++
      continue
    }
    s.with_rating++
    updates.push({ id: item.id, rating: found.rating, rating_count: found.rating_count })
    flushStoreUpdates()
  }
}

const byHost = new Map()
for (const item of queue) {
  const host = new URL(item.url).host
  if (!byHost.has(host)) byHost.set(host, [])
  byHost.get(host).push(item)
}
// Deterministic platform order inside each host queue (the
// plan's priority: Tonies before the long tail).
for (const items of byHost.values()) {
  items.sort(
    (a, b) =>
      PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) ||
      a.sort_order - b.sort_order,
  )
}
for (const item of queue) idToPlatform.set(item.id, item.platform)
console.log(`hosts: ${[...byHost.entries()].map(([h, v]) => `${h}×${v.length}`).join(', ')}`)
await Promise.all([...byHost.entries()].map(([host, items]) => crawlHost(host, items)))

// ---- write ----
if (!dryRun) flushStoreUpdates(true)

const summary = {}
for (const [platform, s] of [...stats.entries()].sort(
  (a, b) => PLATFORM_ORDER.indexOf(a[0]) - PLATFORM_ORDER.indexOf(b[0]),
)) {
  summary[platform] = s
  console.log(
    `${platform}: rows=${s.rows} urls=${s.with_url} no_url=${s.no_url} fetched=${s.fetched} ` +
      `blocked=${s.http_blocked} failed=${s.fetch_failed} rated=${s.with_rating} ` +
      `rating_no_count=${s.rating_no_count} updated=${s.updated}${s.stopped ? ' STOPPED(host blocked)' : ''}`,
  )
}
console.log(JSON.stringify({ dry_run: dryRun, queued: queue.length, updates: updates.length, summary }))
