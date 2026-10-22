#!/usr/bin/env node
// stores-rescan.mjs — re-run every store adapter from
// lib/sources.mjs against the LIVE catalog and insert only
// net-new products (the 2026-10-21 overnight expansion).
//
//   node ingestor/stores-rescan.mjs [--dry-run] [--only yoto]
//
// Differences from run.mjs (which builds a full snapshot):
//   * diffs against catalog_items as they are now, keyed by
//     (platform, matchKey(title)) — the catalog's own dedupe
//     normalisation — so re-scans never duplicate or rewrite
//     existing rows;
//   * every candidate's image is verified live (HTTP 200, image
//     content type, non-trivial size) before it can land;
//   * bundle rows are flagged is_bundle using the same signals
//     the 0013 bundles pass used (details text from the source
//     configs: Yoto card packs, Storypod content bundles,
//     Dream Machine story collections);
//   * sort_order continues each platform's own current range.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCES } from './lib/sources.mjs'
import { ingestShopify } from './lib/shopify.mjs'
import { ingestLeapfrog } from './lib/leapfrog.mjs'
import { ingestLunii } from './lib/lunii.mjs'
import { matchKey } from './lib/normalize.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
const SBQ = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sbq.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const UA = 'ToyLibrary/1.0 (catalog build; contact via toylibrary.store)'
// Feeds/reports live under the goal's hidden files, not /tmp:
// /tmp is wiped when the sandbox restarts.
const WORK = join(HERE, '..', '..', 'goals', 'toy-library-tracker', 'hidden_files', 'overnight')
mkdirSync(join(WORK, 'feeds'), { recursive: true })

const ADAPTERS = { shopify: ingestShopify, leapfrog: ingestLeapfrog, lunii: ingestLunii }
const esc = (s) => String(s ?? '').replace(/'/g, "''")

let emitSeq = 0
function sql(statement) {
  // EMIT mode (RESCAN_EMIT=1): inserts are collected as files
  // for direct application — writes from inside node via sb.py
  // do not reach the real database (overnight incident note).
  if (process.env.RESCAN_EMIT === '1' && /^\s*insert/i.test(statement)) {
    const out = `/home/hatch/workspace/.emit/rescan-${String(emitSeq++).padStart(3, '0')}.sql`
    writeFileSync(out, statement)
    return []
  }
  const file = `/tmp/rescan-${process.pid}.sql`
  writeFileSync(file, statement)
  const out = execFileSync('python3', [SB, 'query', file], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  if (parsed.status >= 300) throw new Error(`SQL failed (${parsed.status}): ${out.slice(0, 300)}`)
  return parsed.result
}

// Live catalog keys + per-platform sort_order ceilings. Read via
// sbq.py: sb.py truncates its printed output at 4000 chars, which
// corrupts wide rows; sbq prints the full JSON result set.
function sqlRead(statement) {
  const file = `/tmp/rescan-read-${process.pid}.sql`
  writeFileSync(file, statement)
  const out = execFileSync('python3', [SBQ, file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  if (parsed.status >= 300) throw new Error(`SQL read failed (${parsed.status}): ${out.slice(0, 300)}`)
  return parsed.result
}

const existing = new Set()
const maxSort = new Map()
// RESCAN_SNAPSHOT: load the live-catalog baseline from a JSON
// file dumped through a verified channel instead of querying
// from inside node (see the overnight incident note — reads
// from node-spawned helpers can come from a stale mirror).
if (process.env.RESCAN_SNAPSHOT) {
  const rows = JSON.parse(readFileSync(process.env.RESCAN_SNAPSHOT, 'utf8'))
  for (const r of rows) {
    existing.add(`${r.platform}|${matchKey(r.title)}`)
    maxSort.set(r.platform, Math.max(maxSort.get(r.platform) ?? 0, r.sort_order ?? 0))
  }
} else {
  for (let offset = 0; ; offset += 60) {
    const rows = sqlRead(
      `select platform, title, sort_order from public.catalog_items order by platform, title limit 60 offset ${offset}`,
    )
    for (const r of rows ?? []) {
      existing.add(`${r.platform}|${matchKey(r.title)}`)
      maxSort.set(r.platform, Math.max(maxSort.get(r.platform) ?? 0, r.sort_order ?? 0))
    }
    if (!rows || rows.length < 60) break
  }
}
console.log(`live catalog: ${existing.size} keys`)

function isBundle(row) {
  if (row.details === 'Yoto Card pack') return true
  if (row.details === 'Content bundle') return true
  if (row.details === 'Dream Machine story collection') return true
  return false
}

async function verifyImage(url) {
  if (!url) return false
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return false
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return false
    const buf = await res.arrayBuffer()
    return buf.byteLength >= 1000
  } catch {
    return false
  }
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

const summary = {}
for (const source of SOURCES) {
  if (only && source.id !== only) continue
  console.log(`▸ ${source.id}`)
  let feed
  try {
    feed = await ADAPTERS[source.kind](source)
  } catch (err) {
    summary[source.id] = { error: err.message }
    console.log(`  ✗ adapter failed: ${err.message}`)
    continue
  }
  writeFileSync(join(WORK, 'feeds', `${source.id}.json`), JSON.stringify(feed, null, 2))
  // In-feed dedupe on the catalog key, then diff against live.
  const inFeed = new Map()
  for (const row of feed) {
    const k = `${row.platform}|${matchKey(row.title)}`
    if (!inFeed.has(k)) inFeed.set(k, row)
  }
  const fresh = [...inFeed.values()].filter(
    (row) => !existing.has(`${row.platform}|${matchKey(row.title)}`),
  )
  console.log(`  feed ${feed.length} rows → ${inFeed.size} unique → ${fresh.length} net-new candidates`)
  const checks = await mapPool(fresh, 6, (row) => verifyImage(row.image_url))
  const ready = fresh.filter((_, i) => checks[i])
  const noImage = fresh.filter((_, i) => !checks[i])
  for (const row of noImage) console.log(`  ✗ no verified image: ${row.title}`)
  let inserted = 0
  if (!dryRun && ready.length) {
    let sort = (maxSort.get(source.platform) ?? 0) + 1
    const rows = ready.map((row) => ({ ...row, is_bundle: isBundle(row), sort_order: sort++ }))
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40)
      const values = chunk
        .map(
          (r) =>
            `('${r.platform}', '${esc(r.title)}', '${esc(r.details)}', '${esc(r.image_url)}', ` +
            `${r.source_url ? `'${esc(r.source_url)}'` : 'null'}, ${r.is_bundle}, ${r.sort_order})`,
        )
        .join(',\n')
      const res = sql(
        `insert into public.catalog_items (platform, title, details, image_url, source_url, is_bundle, sort_order)
         values ${values}
         on conflict (platform, title) do nothing
         returning title`,
      )
      inserted += (res ?? []).length
    }
  }
  summary[source.id] = {
    feed: feed.length,
    candidates: fresh.length,
    noImage: noImage.map((r) => r.title),
    inserted: dryRun ? 0 : inserted,
    titles: ready.map((r) => r.title),
  }
  console.log(`  ✓ ${dryRun ? ready.length + ' ready (dry run)' : inserted + ' inserted'}`)
}
writeFileSync(join(WORK, 'rescan-report.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.error ?? v.inserted]))))
