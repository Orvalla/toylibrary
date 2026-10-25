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
import { createSpecCaller, loadSpec, callSpec, verifySpec } from './lib/specall.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyPlatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null
const yotoLimit = args.includes('--yoto-limit') ? Number(args[args.indexOf('--yoto-limit') + 1]) : 500
const UA = 'ToyLibraryIngestor/1.0 (ratings backfill; contact via toylibrary.store)'
const DELAY_MS = 350
const MAX_STRIKES = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    await flushStoreUpdates()
  }
}

// ---- Yoto via the Trustpilot spec (§8.1) --------------------------------
// Resolution is always against the US store by handle (the last
// path segment of the row's URL, whatever host the URL names):
// SKUs are global product identifiers, so a UK-listed row
// resolves through the US storefront when the handle exists
// there. GraphQL product:null (retired / not published to the
// Storefront channel) falls back to the same store's
// /products/<handle>.js — identical per-variant SKU data. A
// double miss leaves the row unresolved and unrated, counted.
let yotoSpecError = null
async function crawlYotoSpec(items) {
  if (!items.length) return
  const s = stat('yoto')
  Object.assign(s, {
    spec_calls: 0, spec_resolved: 0, spec_unresolved: 0,
    spec_honest_zero: 0, spec_fallback: 0, spec_shape_drift: 0,
  })
  let spec
  try {
    spec = loadSpec(join(HERE, 'specs', 'yoto-trustpilot-rating.json'))
  } catch (err) {
    yotoSpecError = err
    console.error(`yoto spec failed to load: ${err.message}`)
    s.fetch_failed += items.length
    return
  }
  const caller = createSpecCaller({})
  const ratingStep = spec.steps.find((st) => st.name === 'rating')
  const jsResolveSpec = {
    spec_version: 1, id: 'yoto-shopify-js-resolve', platform: 'yoto',
    purpose: 'detail', status: 'active',
    steps: [{
      name: 'resolve-skus-js',
      request: {
        method: 'GET',
        url: 'https://yoto-usa.myshopify.com/products/{handle}.js',
        headers: {},
      },
      params: [{ name: 'handle', bind: { from: 'row.source_url', take: 'last_path_segment' } }],
      extract: { format: 'json', path: 'variants', pick: { skus: '[].sku' } },
    }],
    fields: { skus: 'skus' },
  }
  const ratingOnlySpec = (csv) => ({
    spec_version: 1, id: 'yoto-trustpilot-rating#step', platform: 'yoto',
    purpose: 'ratings', status: 'active',
    steps: [{
      ...ratingStep,
      params: [{ name: 'skus', bind: { from: 'const', value: csv } }],
    }],
    fields: spec.fields,
    write_rule: spec.write_rule,
  })

  await Promise.all(
    items.map(async (item) => {
      const row = { source_url: item.url }
      let res = await callSpec(caller, spec, row)
      let st = res.stats
      if (!res.ok && st.empty_extract > 0 && !st.http_blocked && !st.fetch_failed && !st.skipped_stopped) {
        // GraphQL could not see the product — try the .js shape
        // of the same store before calling the row unresolved.
        const js = await callSpec(caller, jsResolveSpec, row)
        const skus = (js.values?.skus ?? []).filter((x) => typeof x === 'string' && x.trim())
        if (!js.ok || !skus.length) {
          // The fallback also missed — keep its transport
          // failures visible in the row's accounting.
          st = {
            ...st,
            calls: st.calls + js.stats.calls,
            http_blocked: st.http_blocked + js.stats.http_blocked,
            fetch_failed: st.fetch_failed + js.stats.fetch_failed,
            skipped_stopped: st.skipped_stopped + js.stats.skipped_stopped,
          }
        }
        if (js.ok && skus.length) {
          s.spec_fallback++
          res = await callSpec(caller, ratingOnlySpec(skus.join(',')), {})
          st = {
            ...res.stats,
            calls: st.calls + js.stats.calls + res.stats.calls,
            http_blocked: st.http_blocked + js.stats.http_blocked + res.stats.http_blocked,
            fetch_failed: st.fetch_failed + js.stats.fetch_failed + res.stats.fetch_failed,
            skipped_stopped: st.skipped_stopped + js.stats.skipped_stopped + res.stats.skipped_stopped,
            shape_drift: st.shape_drift + js.stats.shape_drift + res.stats.shape_drift,
            honest_zero: res.stats.honest_zero,
          }
        }
      }
      s.spec_calls += st.calls
      s.http_blocked += st.http_blocked
      s.fetch_failed += st.fetch_failed
      s.skipped_stopped += st.skipped_stopped
      s.spec_shape_drift += st.shape_drift
      if (st.skipped_stopped > 0 && !res.ok) s.stopped = true
      if (st.calls - st.http_blocked - st.fetch_failed > 0) s.fetched++
      if (res.ok && res.values?.rating != null && res.values?.rating_count > 0) {
        s.spec_resolved++
        s.with_rating++
        updates.push({ id: item.id, rating: res.values.rating, rating_count: res.values.rating_count })
        await flushStoreUpdates()
      } else if (st.honest_zero) {
        s.spec_resolved++
        s.spec_honest_zero++
        s.rating_no_count++
      } else {
        s.spec_unresolved++
      }
    }),
  )
  const t = caller.totals()
  console.log(
    `yoto spec: rows=${items.length} resolved=${s.spec_resolved} rated=${s.with_rating} ` +
      `honest_zero=${s.spec_honest_zero} unresolved=${s.spec_unresolved} js_fallback=${s.spec_fallback} ` +
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
await Promise.all([...byHost.entries()].map(([host, items]) => crawlHost(host, items)))
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
