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
//
// Fetch transport (Phase 3): both the static-HTML path below
// and the Yoto spec path go through specall's caller
// (ingestor/lib/specall.mjs) — one implementation of the
// discipline above. Its canonical UA applies to every fetch:
// the UA string unifies to specall's CANONICAL_UA
// ('ToyLibraryIngestor/1.0 (contact via toylibrary.store)'),
// replacing this script's former ratings-backfill UA variant.
//
// Transport (since the 2026-10-24 full-enrichment run): reads
// and writes go over PostgREST with SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, writes through the set_ratings
// RPC (migration 0050) — the same shape as popularity.mjs,
// so the crawl runs as a GitHub Actions job (enrich.yml).
// The old local sbq.py write path is gone; run locally only
// with --dry-run (reads work with the publishable key).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractAggregateRating } from '../supabase/functions/ingest-catalog/extract.js'
import { createSpecCaller, loadSpec, verifySpec } from './lib/specall.mjs'
import { rateYotoRows } from './lib/yoto-spec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyPlatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null
const yotoLimit = args.includes('--yoto-limit') ? Number(args[args.indexOf('--yoto-limit') + 1]) : 500

// --verify-specs: pre-flight for the spec-driven paths (today:
// the Yoto/Trustpilot spec). Replays the spec's verified samples
// live and exits 0/1 — the teach/reteach loop and the
// yoto-ratings workflow run this before any crawl. Needs no
// Supabase env: it only talks to the spec's own hosts.
if (args.includes('--verify-specs')) {
  const spec = loadSpec(join(HERE, 'specs', 'yoto-trustpilot-rating.json'))
  const out = await verifySpec(createSpecCaller({}), spec)
  for (const s of out.samples) {
    console.log(
      `${s.pass ? 'PASS' : 'FAIL'}  ${s.name}: observed=${JSON.stringify(s.observed)} expect=${JSON.stringify(s.expect)}`,
    )
  }
  console.log(JSON.stringify({ spec: spec.id, ok: out.ok, stats: out.stats }))
  process.exit(out.ok ? 0 : 1)
}

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
async function fetchUnratedStoreRows() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `catalog_items?select=id,platform,title,source_url,sort_order` +
        `&rating=is.null&platform=neq.books&order=platform,sort_order,title&limit=1000&offset=${from}`,
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
  : await fetchUnratedStoreRows()
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
// §8.1: Yoto rows leave the static-HTML queue entirely — Yoto
// publishes no rating in HTML (Trustpilot widget, client-side).
// They are rated through the learned spec instead (crawlYotoSpec
// below): per-variant SKUs via the Storefront GraphQL, then the
// Trustpilot aggregate. The HTML path remains the fallback for
// every other platform.
const htmlQueue = queue.filter((i) => i.platform !== 'yoto')
const yotoQueue = queue.filter((i) => i.platform === 'yoto')

// ---- crawl ---------------------------------------------------------------
const updates = []
const idToPlatform = new Map()
async function flushStoreUpdates(final = false) {
  if (!updates.length || (!final && updates.length < 20)) return
  if (dryRun) return // counted at the end from the queue stats; nothing written
  const chunk = updates.splice(0, updates.length)
  for (const u of chunk) {
    const pf = idToPlatform.get(u.id)
    if (pf) stat(pf).updated++
  }
  await applyRatingUpdates(chunk)
}
// The static-HTML transport is specall's caller (Phase 3): the
// per-host serialization, ≥350ms spacing and 3-strike drop live
// there now, under the canonical UA. The 30s per-request timeout
// this script's own fetch used to carry is preserved via the
// fetchImpl wrapper.
const htmlCaller = createSpecCaller({
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
})

async function crawlHtmlHost(items) {
  for (const item of items) {
    const s = stat(item.platform)
    const res = await htmlCaller.request(item.url, { headers: { accept: 'text/html' } })
    if (res.skipped) {
      // Host was dropped after 3 strikes — the caller sent
      // nothing; abandon the rest of its queue rather than
      // hammering it (the remaining items each report skipped).
      s.skipped_stopped++
      s.stopped = true
      continue
    }
    if (res.blocked) {
      s.http_blocked++
      continue
    }
    if (!res.ok) {
      s.fetch_failed++
      continue
    }
    s.fetched++
    const found = extractAggregateRating(res.text)
    if (!found) continue
    if (!found.rating_count) {
      s.rating_no_count++
      continue
    }
    s.with_rating++
    updates.push({ id: item.id, rating: found.rating, rating_count: found.rating_count })
    await flushStoreUpdates()
  }
}

// ---- Yoto via the Trustpilot spec (§8.1) --------------------------------
// Thin adapter over lib/yoto-spec.mjs's rateYotoRows (the spec
// runner itself — US-store resolution by handle, the .js fallback
// on a GraphQL miss — lives there, Phase 3). This adapter keeps
// the consumer accounting: each returned row outcome maps onto
// stat('yoto') exactly as the inline runner used to count it,
// and rated rows arrive through onRating so the update buffer +
// flush behave as before.
let yotoSpecError = null
async function crawlYotoSpec(items) {
  if (!items.length) return
  const s = stat('yoto')
  Object.assign(s, {
    spec_calls: 0, spec_resolved: 0, spec_unresolved: 0,
    spec_honest_zero: 0, spec_fallback: 0, spec_shape_drift: 0,
  })
  const result = await rateYotoRows({
    items: items.map((item) => ({ id: item.id, url: item.url })),
    onRating: async ({ id, rating, rating_count }) => {
      updates.push({ id, rating, rating_count })
      await flushStoreUpdates()
    },
  })
  if (result.error) {
    yotoSpecError = result.error
    console.error(`yoto spec failed to load: ${result.error.message}`)
    s.fetch_failed += items.length
    return
  }
  for (const r of result.rows) {
    s.spec_calls += r.calls
    s.http_blocked += r.http_blocked
    s.fetch_failed += r.fetch_failed
    s.skipped_stopped += r.skipped_stopped
    s.spec_shape_drift += r.shape_drift
    if (r.skipped_stopped > 0 && !r.ok) s.stopped = true
    if (r.calls - r.http_blocked - r.fetch_failed > 0) s.fetched++
    if (r.usedFallback) s.spec_fallback++
    if (r.outcome === 'rated') {
      s.spec_resolved++
      s.with_rating++
    } else if (r.outcome === 'honest_zero') {
      s.spec_resolved++
      s.spec_honest_zero++
      s.rating_no_count++
    } else {
      s.spec_unresolved++
    }
  }
  const t = result.totals
  console.log(
    `yoto spec: rows=${t.rows} resolved=${t.resolved} rated=${t.rated} ` +
      `honest_zero=${t.honest_zero} unresolved=${t.unresolved} js_fallback=${t.usedFallback} ` +
      `calls=${t.calls} blocked=${t.http_blocked} failed=${t.fetch_failed} skipped_stopped=${t.skipped_stopped}`,
  )
}

const byHost = new Map()
for (const item of htmlQueue) {
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
await Promise.all([...byHost.entries()].map(([, items]) => crawlHtmlHost(items)))
await crawlYotoSpec(yotoQueue)
if (yotoSpecError) process.exitCode = 1

// ---- write ----
if (!dryRun) await flushStoreUpdates(true)

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
