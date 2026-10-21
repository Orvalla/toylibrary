#!/usr/bin/env node
// backfill-images.mjs — find fresh images for catalog items that
// have none, and write them back.
//
//   node ingestor/backfill-images.mjs [--dry-run] [--limit 100]
//
// Sources, in order (first hit wins):
//   1. The ingestor's own catalog (ingestor/out/catalog.json) —
//      most imageless rows are hand-seeded duplicates of ingested
//      products under slightly different titles, so a fuzzy title
//      match usually finds the very image the store crawl captured.
//   2. The item's own source_url page (JSON-LD / Open Graph image),
//      when it has one.
//   3. The platform store's live suggest search (Shopify stores).
//   4. LeapFrog's own store search, for leapfrog items.
//   5. Whole-store products.json feeds (Moonlite; global Tonies).
//   6. Open Library covers, for the books platform.
//
// Prints a JSON summary: { checked, updated, still_missing:
// [{ title, platform }] }. Exits non-zero only if the database
// round-trip itself fails, so a scheduled run can report honestly.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractFromJsonLd,
  extractFromOpenGraph,
  extractProductLinks,
  fixImageUrl,
  normalizeSuggestResult,
} from '../supabase/functions/ingest-catalog/extract.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args[args.indexOf('--limit') + 1]) || 100
const UA = 'ToyLibraryIngestor/1.0 (image backfill)'

function sql(statement) {
  const out = execFileSync('python3', [SB, 'query', '-'], {
    input: statement,
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
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function titleVariants(title) {
  const variants = new Set([norm(title)])
  const afterColon = String(title).split(':').slice(1).join(':')
  if (afterColon.trim()) variants.add(norm(afterColon))
  return [...variants].filter(Boolean)
}

function tokenScore(a, b) {
  const ta = new Set(a.split(' '))
  const tb = new Set(b.split(' '))
  if (ta.size === 0 || tb.size === 0) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / (ta.size + tb.size - hit)
}

async function fetchText(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchJson(url, timeoutMs = 12000) {
  const text = await fetchText(url, timeoutMs)
  return JSON.parse(text)
}

// ---- source 1: the local ingested catalog -------------------------
let localCatalog = []
try {
  localCatalog = JSON.parse(readFileSync(join(HERE, 'out', 'catalog.json'), 'utf8'))
} catch {
  localCatalog = []
}
const localWithImages = localCatalog.filter((r) => r.image_url)

function fromLocalCatalog(item) {
  const variants = titleVariants(item.title)
  let best = null
  for (const row of localWithImages) {
    if (row.platform !== item.platform) continue
    const score = Math.max(...variants.map((v) => tokenScore(v, norm(row.title))))
    if (score >= 0.6 && (!best || score > best.score)) best = { score, image: row.image_url }
  }
  return best?.image ?? null
}

// ---- source 2: the item's own source page --------------------------
async function fromSourcePage(item) {
  if (!item.source_url) return null
  const html = await fetchText(item.source_url)
  const found = extractFromJsonLd(html) ?? extractFromOpenGraph(html)
  return found?.image_url || null
}

// ---- source 3: live store suggest (Shopify stores) ------------------
const SUGGEST_STORES = {
  tonies: [{ origin: 'https://us.tonies.com', platform: 'tonies' }],
  yoto: [{ origin: 'https://us.yotoplay.com', platform: 'yoto' }],
  storypod: [{ origin: 'https://storypod.com', platform: 'storypod' }],
  osmo: [{ origin: 'https://www.playosmo.com', platform: 'osmo' }],
  projector: [
    { origin: 'https://www.littletikes.com', platform: 'projector' },
    { origin: 'https://www.mymoonlite.com', platform: 'projector' },
  ],
}

async function fromStoreSuggest(item) {
  const stores = SUGGEST_STORES[item.platform]
  if (!stores) return null
  const variants = titleVariants(item.title)
  for (const store of stores) {
    const url =
      `${store.origin}/search/suggest.json?q=${encodeURIComponent(item.title)}` +
      `&resources[type]=product&resources[limit]=6&resources[options][unavailable_products]=last`
    let json
    try {
      json = await fetchJson(url)
    } catch {
      continue
    }
    const products = json?.resources?.results?.products ?? []
    for (const p of products) {
      const candidate = normalizeSuggestResult(store, p)
      if (!candidate?.image_url) continue
      const score = Math.max(...variants.map((v) => tokenScore(v, norm(candidate.title))))
      if (score >= 0.6) return candidate.image_url
    }
  }
  return null
}

// ---- source 4: LeapFrog's own store search ---------------------------
// Server-rendered results full of /store/p/ links: follow the best
// few, read each product page's image, keep the one whose title
// genuinely matches.
async function fromLeapfrogSearch(item) {
  if (item.platform !== 'leapfrog') return null
  const searchUrl = `https://store.leapfrog.com/en-us/search?q=${encodeURIComponent(item.title)}`
  const html = await fetchText(searchUrl)
  const links = extractProductLinks(html, searchUrl).slice(0, 5)
  const variants = titleVariants(item.title)
  for (const link of links) {
    const page = await fetchText(link)
    const found = extractFromJsonLd(page) ?? extractFromOpenGraph(page)
    if (!found?.image_url) continue
    const score = Math.max(...variants.map((v) => tokenScore(v, norm(found.title))))
    if (score >= 0.5) return found.image_url
  }
  return null
}

// ---- source 5: whole-store Shopify feeds (small stores / regions) ----
// Moonlite's suggest endpoint answers empty from some networks and
// the global Tonies store carries figures the US store doesn't; both
// publish a complete products.json, which is small enough to match
// against directly.
const FEED_ORIGINS = {
  tonies: ['https://tonies.com'],
  projector: ['https://www.mymoonlite.com'],
}

async function fromStoreFeed(item) {
  const origins = FEED_ORIGINS[item.platform]
  if (!origins) return null
  const variants = titleVariants(item.title)
  for (const origin of origins) {
    for (let page = 1; page <= 4; page++) {
      let json
      try {
        json = await fetchJson(`${origin}/products.json?limit=250&page=${page}`)
      } catch {
        break
      }
      const products = json?.products ?? []
      if (products.length === 0) break
      for (const p of products) {
        const img = p.images?.[0]?.src
        if (!img) continue
        const score = Math.max(...variants.map((v) => tokenScore(v, norm(p.title))))
        if (score >= 0.6) return fixImageUrl(img)
      }
      if (products.length < 250) break
    }
  }
  return null
}

// ---- source 6: Open Library (books) ---------------------------------
async function fromOpenLibrary(item) {
  if (item.platform !== 'books') return null
  const json = await fetchJson(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(item.title)}&limit=3`,
  )
  const cover = (json?.docs ?? []).find((d) => d.cover_i)?.cover_i
  if (!cover) return null
  const url = `https://covers.openlibrary.org/b/id/${cover}-L.jpg`
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
  return res.ok ? url : null
}

// ---- main -------------------------------------------------------------
const missing = sql(
  `select id, platform, title, source_url from public.catalog_items
   where image_url is null or image_url = ''
   order by platform, title
   limit ${Math.max(1, Math.floor(limit))}`,
)

let updated = 0
const stillMissing = []
for (const item of missing) {
  let image = null
  let via = ''
  const attempts = [
    ['local-catalog', () => fromLocalCatalog(item)],
    ['source-page', () => fromSourcePage(item)],
    ['store-search', () => fromStoreSuggest(item)],
    ['leapfrog-search', () => fromLeapfrogSearch(item)],
    ['store-feed', () => fromStoreFeed(item)],
    ['open-library', () => fromOpenLibrary(item)],
  ]
  for (const [name, fn] of attempts) {
    try {
      image = await fn()
    } catch {
      image = null
    }
    if (image) {
      via = name
      break
    }
  }
  if (!image) {
    stillMissing.push({ title: item.title, platform: item.platform })
    continue
  }
  console.log(`image via ${via}: [${item.platform}] ${item.title}`)
  if (!dryRun) {
    const escaped = String(image).replace(/'/g, "''")
    sql(
      `update public.catalog_items set image_url = '${escaped}'
       where id = '${item.id}' and (image_url is null or image_url = '')`,
    )
  }
  updated++
}

console.log(
  JSON.stringify(
    { dry_run: dryRun, checked: missing.length, updated, still_missing: stillMissing },
    null,
    2,
  ),
)
