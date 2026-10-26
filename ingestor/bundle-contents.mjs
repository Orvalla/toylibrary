#!/usr/bin/env node
// bundle-contents.mjs — dry-run bundle-contents manifests for
// the completeness sweep (RECON Part B). For one or more
// platforms it takes the unmapped-bundle queue (is_bundle rows
// with no bundle_contents pairs), fetches each bundle's store
// page under the estate discipline, and runs the shared
// extractor (lib/bundle-contents.mjs) at the exact-count bar.
//
//   node ingestor/bundle-contents.mjs [--platform thamesandkosmos,kiwico,eeboo]
//        [--out <dir>] [--limit n]
//
// MANIFESTS ONLY — this script never writes to the database.
// A 'pass' manifest is the apply list for a later, separate
// step (the parent applies; the sweep workflow uploads these
// as its report). 'excluded' verdicts and dead source pages are
// listed as bundle_contents_no_data candidates (migration
// 0054) with their reasons; partial extractions are failures,
// never mappings.
//
// Reads go over PostgREST with SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (the publishable key works too —
// catalog reads are public; there are no writes to authorize).

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSpecCaller } from './lib/specall.mjs'
import { extractBundleContents, normTitle } from './lib/bundle-contents.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const platforms = (
  args.includes('--platform') ? args[args.indexOf('--platform') + 1] : 'thamesandkosmos,kiwico,eeboo'
).split(',').map((s) => s.trim()).filter(Boolean)
const outDir = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(HERE, 'out', 'bundle-contents')
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (reads only)')
  process.exit(1)
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function rest(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function allRows(path) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const page = await rest(`${path}&limit=1000&offset=${from}`)
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// A slice of stored source_urls lost their leading characters in
// an old ingest (they read 'w.eeboo.com/...', 'm/us/store/...').
// The handle / product path survives in all of them, so rebuild
// the canonical URL from the platform's origin + the surviving
// path instead of trusting the stored string.
const SHOPIFY_ORIGINS = {
  thamesandkosmos: 'https://www.thamesandkosmos.com',
  eeboo: 'https://www.eeboo.com',
}
function repairUrl(platform, url) {
  const s = String(url ?? '')
  if (platform === 'kiwico') {
    const m = s.match(/(us\/store\/dp\/[^\s"'?]+)/)
    return m ? `https://www.kiwico.com/${m[1]}` : null
  }
  const m = s.match(/products\/([a-z0-9][a-z0-9-]*)/i)
  if (!m) return null
  const origin = SHOPIFY_ORIGINS[platform]
  return origin ? `${origin}/products/${m[1]}` : null
}
const handleOf = (url) => String(url ?? '').match(/products\/([a-z0-9][a-z0-9-]*)/i)?.[1]?.toLowerCase() ?? null

const caller = createSpecCaller({
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
})

async function fetchBundlePage(platform, bundle) {
  const url = repairUrl(platform, bundle.source_url)
  if (!url) return { error: 'no recoverable product URL from source_url' }
  if (SHOPIFY_ORIGINS[platform]) {
    const js = await caller.request(`${url}.js`, { headers: { accept: 'application/json' } })
    if (js.ok) {
      try {
        const product = JSON.parse(js.text)
        return { bodyHtml: product.description ?? '', url, productTitle: product.title ?? null }
      } catch {
        // fall through to the page itself
      }
    }
    if (js.status === 404) return { status: 404, url }
    const page = await caller.request(url, { headers: { accept: 'text/html' } })
    if (page.status === 404) return { status: 404, url }
    if (page.ok) return { bodyHtml: page.text, url }
    return { error: `page fetch failed (${js.status ?? page.status ?? 'network'})`, url }
  }
  const page = await caller.request(url, { headers: { accept: 'text/html' } })
  if (page.status === 404) return { status: 404, url }
  if (page.ok) return { pageText: page.text, url }
  return { error: `page fetch failed (${page.status ?? 'network'})`, url }
}

await mkdir(outDir, { recursive: true })

const mappedIds = new Set(
  (await allRows('bundle_contents?select=bundle_id&order=bundle_id')).map((r) => r.bundle_id),
)

for (const platform of platforms) {
  const rows = await allRows(
    `catalog_items?select=id,title,source_url,is_bundle,item_type&platform=eq.${platform}&order=title`,
  )
  const pool = rows.filter((r) => !r.is_bundle && r.item_type !== 'device')
  const poolHandles = new Set(pool.map((r) => handleOf(r.source_url)).filter(Boolean))
  let queue = rows.filter((r) => r.is_bundle && r.item_type !== 'device' && !mappedIds.has(r.id))
  if (limit > 0) queue = queue.slice(0, limit)

  const entries = []
  const noDataCandidates = []
  const tally = { scanned: 0, pass: 0, fail: 0, excluded: 0, resolved: 0, unresolved_names: 0 }
  for (const bundle of queue) {
    tally.scanned += 1
    const fetched = await fetchBundlePage(platform, bundle)
    let entry
    if (fetched.status === 404) {
      entry = {
        bundle_id: bundle.id,
        title: bundle.title,
        source_url: bundle.source_url,
        verdict: 'fail',
        failure_class: 'fetch',
        reason: 'source page returned 404 at the maker — reported, not forced',
        stated_count: null,
        contents: [],
        unresolved_names: [],
      }
      noDataCandidates.push({
        bundle_id: bundle.id,
        title: bundle.title,
        reason: 'source_url dead at the maker (404) — exclusion until a live handle is found',
      })
    } else if (fetched.error) {
      entry = {
        bundle_id: bundle.id,
        title: bundle.title,
        source_url: bundle.source_url,
        verdict: 'fail',
        failure_class: 'fetch',
        reason: fetched.error,
        stated_count: null,
        contents: [],
        unresolved_names: [],
      }
    } else {
      const out = extractBundleContents(
        {
          platform,
          title: bundle.title,
          bodyHtml: fetched.bodyHtml ?? '',
          pageText: fetched.pageText ?? fetched.bodyHtml ?? '',
        },
        pool,
      )
      entry = {
        bundle_id: bundle.id,
        title: bundle.title,
        source_url: bundle.source_url,
        verdict: out.verdict,
        failure_class: out.failure_class ?? null,
        reason: out.reason,
        stated_count: out.statedCount,
        contents: out.contents,
        unresolved_names: out.unresolved,
      }
      // A stored source_url can point at a DIFFERENT product's
      // page (observed on T&K: a Season 6 row whose handle is the
      // beginner bundle's -copy page). When the fetched page is
      // another product, flag it on the entry — the verdict then
      // describes that page, not this bundle.
      if (fetched.productTitle) {
        const a = normTitle(fetched.productTitle)
        const b = normTitle(bundle.title)
        if (a !== b && !a.includes(b) && !b.includes(a)) {
          entry.fetch_note = `source_url resolves to a different product page ("${fetched.productTitle}") — the catalog source_url points elsewhere`
        }
      }
      if (out.verdict === 'excluded') {
        noDataCandidates.push({ bundle_id: bundle.id, title: bundle.title, reason: out.reason })
      } else if (out.verdict === 'fail') {
        // A "bundle" whose source page IS a single product's page
        // is a quantity/display set of that product — a no-data
        // candidate, not an extraction failure to retry forever.
        const h = handleOf(bundle.source_url)
        if (h && poolHandles.has(h)) {
          noDataCandidates.push({
            bundle_id: bundle.id,
            title: bundle.title,
            reason: 'source page is the single product\u2019s own page — a quantity/display set of one item, not a multi-product bundle',
          })
        } else if (/(gift set|\bdisplay\b)/i.test(bundle.title)) {
          noDataCandidates.push({
            bundle_id: bundle.id,
            title: bundle.title,
            reason: 'titled as a gift/display set and no distinct contents could be enumerated — a quantity set of one product line, not mapped contents',
          })
        }
      }
      tally.resolved += out.contents.length
      tally.unresolved_names += out.unresolved.length
    }
    tally[entry.verdict] += 1
    entries.push(entry)
    console.log(`  ${platform} · ${bundle.title.slice(0, 64)} -> ${entry.verdict}${entry.reason ? ` (${entry.reason.slice(0, 90)})` : ''}`)
  }

  const manifest = {
    platform,
    generated_at: new Date().toISOString(),
    dry_run: true,
    summary: { ...tally, no_data_candidates: noDataCandidates.length },
    bundles: entries,
    no_data_candidates: noDataCandidates,
  }
  await writeFile(join(outDir, `${platform}.json`), JSON.stringify(manifest, null, 2))
  console.log(
    `▸ ${platform}: scanned=${tally.scanned} pass=${tally.pass} fail=${tally.fail} excluded=${tally.excluded} ` +
      `contents_resolved=${tally.resolved} names_unresolved=${tally.unresolved_names} no_data_candidates=${noDataCandidates.length}`,
  )
}
