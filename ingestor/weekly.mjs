#!/usr/bin/env node
// Weekly catalog routine — run by .github/workflows/weekly-ingest.yml
// (and locally: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node
// ingestor/weekly.mjs [--dry]).
//
// DELIBERATELY delta-only: it never updates an existing catalog
// row, so curated data (verified ASINs, backfilled ratings, the
// hand-fixed Dream Machine photo, bundle flags) can never be
// clobbered by a store re-scan. Three steps:
//   1. Re-scan every tracked store (the same adapters as
//      run.mjs) and INSERT only products the catalog lacks,
//      with age guidance attached (lib/ages.mjs).
//   2. Ratings top-up: fetch product pages for rows that still
//      have no rating and pick up JSON-LD aggregateRating —
//      a bounded slice per run, so coverage grows weekly.
//   3. Print a summary (also appended to $GITHUB_STEP_SUMMARY).

import { appendFile } from 'node:fs/promises'
import { SOURCES } from './lib/sources.mjs'
import { ingestShopify } from './lib/shopify.mjs'
import { ingestLeapfrog } from './lib/leapfrog.mjs'
import { ingestLunii } from './lib/lunii.mjs'
import { ageForRow } from './lib/ages.mjs'
import { extractAggregateRating } from '../supabase/functions/ingest-catalog/extract.js'

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY = process.argv.includes('--dry') || process.env.WEEKLY_DRY === '1'
const RATINGS_BUDGET = Number(process.env.WEEKLY_RATINGS_BUDGET ?? 300)
const ADAPTERS = { shopify: ingestShopify, leapfrog: ingestLeapfrog, lunii: ingestLunii }

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

async function allRows(select, extra = '') {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `catalog_items?select=${select}&order=id&limit=1000&offset=${from}${extra}`
    )
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

const summary = []
const say = (line) => {
  console.log(line)
  summary.push(line)
}

async function main() {
  // ---- Step 1: net-new products -------------------------------------------
  const existing = await allRows('platform,title,sort_order')
  const have = new Set(existing.map((r) => `${r.platform}|${r.title.trim().toLowerCase()}`))
  const maxSort = new Map()
  for (const r of existing) {
    maxSort.set(r.platform, Math.max(maxSort.get(r.platform) ?? 0, r.sort_order ?? 0))
  }

  const scanned = []
  for (const source of SOURCES) {
    try {
      const rows = await ADAPTERS[source.kind](source, () => {})
      scanned.push(...rows)
      say(`▸ ${source.id}: ${rows.length} products in store`)
    } catch (err) {
      say(`▸ ${source.id}: FAILED (${err.message}) — skipped, retried next week`)
    }
  }

  const fresh = []
  const seenFresh = new Set()
  for (const row of scanned) {
    const key = `${row.platform}|${row.title.trim().toLowerCase()}`
    if (have.has(key) || seenFresh.has(key) || !row.title?.trim()) continue
    seenFresh.add(key)
    const sort = (maxSort.get(row.platform) ?? 0) + fresh.filter((f) => f.platform === row.platform).length + 1
    fresh.push({
      platform: row.platform,
      title: row.title.trim(),
      details: row.details ?? '',
      image_url: row.image_url ?? '',
      source_url: row.source_url ?? '',
      product_url: row.source_url || null,
      item_type: 'content',
      sort_order: sort,
      ...ageForRow(row),
    })
  }
  say(`✚ ${fresh.length} net-new products${DRY ? ' (dry run — not inserted)' : ''}`)
  if (!DRY && fresh.length) {
    for (let i = 0; i < fresh.length; i += 200) {
      await rest('catalog_items', { method: 'POST', body: JSON.stringify(fresh.slice(i, i + 200)) })
    }
  }

  // ---- Step 2: ratings top-up ---------------------------------------------
  const unrated = await allRows(
    'id,source_url',
    '&rating_count=is.null&item_type=eq.content&source_url=not.is.null'
  )
  // JSON-LD ratings live on the Shopify stores' product pages;
  // other hosts (LeapFrog, Lunii) don't publish them, so spend
  // the page budget where ratings actually exist.
  const RATED_HOSTS = ['tonies.com', 'yotoplay.com', 'storypod.com', 'playosmo.com', 'mymoonlite.com', 'littletikes.com']
  const hostScore = (u) => {
    try {
      const h = new URL(u).host
      return RATED_HOSTS.some((d) => h.endsWith(d)) ? 0 : 1
    } catch {
      return 1
    }
  }
  const queue = unrated
    .filter((r) => /^https:\/\//.test(r.source_url ?? ''))
    .sort((a, b) => hostScore(a.source_url) - hostScore(b.source_url))
    .slice(0, RATINGS_BUDGET)
  let rated = 0
  let lastHost = ''
  for (const row of queue) {
    try {
      const host = new URL(row.source_url).host
      if (host === lastHost) await new Promise((r) => setTimeout(r, 350))
      lastHost = host
      const res = await fetch(row.source_url, {
        headers: { 'User-Agent': 'ToyLibraryBot/1.0 (+https://toylibrary.store)' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const rating = extractAggregateRating(await res.text())
      if (rating && !DRY) {
        await rest(`catalog_items?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ rating: rating.rating, rating_count: rating.count }),
        })
      }
      if (rating) rated += 1
    } catch {
      // one bad page never blocks the run
    }
  }
  say(`★ ratings: ${rated} newly rated of ${queue.length} pages checked (${unrated.length} rows still unrated)`)

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Weekly catalog scan\n\n${summary.map((l) => `- ${l}`).join('\n')}\n`
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
