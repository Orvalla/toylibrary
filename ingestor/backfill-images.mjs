#!/usr/bin/env node
// backfill-images.mjs — find fresh images for catalog items that
// have none, and write them back.
//
//   node ingestor/backfill-images.mjs [--dry-run] [--limit 100]
//
// Runs in two transports: with SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in the env (GitHub Actions, as a
// step of the weekly scan) it reads/writes over PostgREST with
// the service key, like weekly.mjs; without them it shells out
// to the local sb.py helper. WEEKLY_DRY=1 means --dry-run, the
// same convention as weekly.mjs. Either way an update only
// ever fills a row whose image_url is still blank — the guard
// is in the update filter itself, never in the caller's care.
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
//   6. Open Library covers, for the books platform — only
//      with --allow-open-library (attended runs; see below).
//
// Prints a JSON summary: { checked, updated, found:
// [{ id, platform, title, image_url, source }], still_missing:
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
const dryRun = args.includes('--dry-run') || process.env.WEEKLY_DRY === '1'
// Open Library covers are opt-in (--allow-open-library) and
// attended-only: title search happily returns a DIFFERENT
// book that shares the title (the 2026-10-24 pass produced
// three wrong books for four lookups — every one caught only
// by eyeballing the covers). A scheduled run must never
// apply one unseen.
const allowOpenLibrary = args.includes('--allow-open-library')
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

// ---- database transport ----------------------------------------------
// Service-key PostgREST when the weekly-scan env is present
// (the weekly.mjs pattern), the local sb.py helper otherwise.
const REST_URL = process.env.SUPABASE_URL
const REST_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const USE_REST = Boolean(REST_URL && REST_KEY)

async function rest(path, options = {}, extraHeaders = {}) {
  const res = await fetch(`${REST_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: REST_KEY,
      Authorization: `Bearer ${REST_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

// Rows whose image_url is blank ('' in practice; the column is
// NOT NULL, but the null arm costs nothing and keeps both
// transports asking the same question).
const BLANK_FILTER = 'or=(image_url.is.null,image_url.eq.)'

async function fetchMissing(rowLimit) {
  if (USE_REST) {
    return rest(
      `catalog_items?select=id,platform,title,source_url&${BLANK_FILTER}` +
        `&order=platform,title&limit=${Math.max(1, Math.floor(rowLimit))}`,
    )
  }
  // The sb.py bridge truncates long replies (at ~4 KB), so
  // page the read: 15 rows including their source_urls stay
  // safely under the cap, and (platform, title) is a stable
  // order to page across.
  const PAGE = 15
  const cap = Math.max(1, Math.floor(rowLimit))
  const rows = []
  for (let offset = 0; rows.length < cap; offset += PAGE) {
    const page = sql(
      `select id, platform, title, source_url from public.catalog_items
       where image_url is null or image_url = ''
       order by platform, title
       limit ${PAGE} offset ${offset}`,
    )
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows.slice(0, cap)
}

// Fill one row's image. The blank-only guard lives in the
// update filter itself (the PATCH query / the UPDATE's WHERE),
// so a row that gained an image since the read is never
// overwritten. Resolves true when a row actually changed; the
// sb.py path cannot report a rowcount, so it resolves true
// once the guarded UPDATE has run, as the script always did.
async function applyImage(item, image) {
  if (USE_REST) {
    const rows = await rest(
      `catalog_items?id=eq.${item.id}&${BLANK_FILTER}`,
      { method: 'PATCH', body: JSON.stringify({ image_url: image }) },
      { Prefer: 'return=representation' },
    )
    return Array.isArray(rows) && rows.length > 0
  }
  const escaped = String(image).replace(/'/g, "''")
  sql(
    `update public.catalog_items set image_url = '${escaped}'
     where id = '${item.id}' and (image_url is null or image_url = '')`,
  )
  return true
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
  if (!allowOpenLibrary) return null
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
const missing = await fetchMissing(limit)

let updated = 0
const found = []
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
    // A publisher's fallback art is worse than a blank tile:
    // source pages sometimes hand back the site logo, an
    // "image not found" box, or a no-image placeholder (all
    // three seen in the 2026-10-24 pass). Never let one
    // through as if it were the product's photo.
    if (image && /logo|image-not-found|noimage|no-image|placeholder|favicon/i.test(image)) {
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
  found.push({ id: item.id, platform: item.platform, title: item.title, image_url: image, source: via })
  if (dryRun) {
    updated++
  } else if (await applyImage(item, image)) {
    updated++
  }
}

console.log(
  JSON.stringify(
    { dry_run: dryRun, checked: missing.length, updated, found, still_missing: stillMissing },
    null,
    2,
  ),
)
