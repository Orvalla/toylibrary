#!/usr/bin/env node
// backfill-asins.mjs — resolve Amazon ASINs for catalog items that
// don't have one yet, so their "Buy on Amazon" links can go
// straight to the product page (amazon.com/dp/<ASIN>) instead of a
// search.
//
//   node ingestor/backfill-asins.mjs [--dry-run] [--limit 25]
//
// Order of work: devices first (few, giftable), then catalog rows
// that appear on a family's list, then the rest of the catalog.
// Each item is resolved with ONE web search
// (site:amazon.com <brand> <title> via DuckDuckGo's HTML results);
// a result only counts when its own title genuinely matches the
// item — a wrong direct link is worse than a search link, so the
// bar is deliberate and unresolved items simply stay on search
// links until a later run (or a better source, e.g. PA-API).
//
// Amazon's own pages are never fetched — the search result's title
// and /dp/ URL are the evidence, which keeps the sweep light and
// out of Amazon's bot walls. If the search endpoint starts
// refusing (403/202), the run stops early and reports `blocked`
// with whatever it already resolved still written.
//
// Also propagates fresh ASINs onto family list items by
// (platform, title) match, like migration 0011 does.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sb.py')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args[args.indexOf('--limit') + 1]) || 25
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
// The search endpoint rate-limits datacenter IPs quickly even at
// this spacing; a blocked run is a normal outcome — resolved items
// are written as it goes, and the next run picks up where it left.
const SLEEP_MS = 4000

const BRAND = {
  tonies: 'Tonies',
  yoto: 'Yoto',
  leapfrog: 'LeapFrog',
  storypod: 'Storypod',
  lunii: 'Lunii',
  osmo: 'Osmo',
  projector: 'Moonlite',
  books: '',
  other: '',
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class BlockedError extends Error {}

async function searchAmazon(item) {
  const brand = BRAND[item.platform] ?? ''
  const q = `site:amazon.com ${brand} ${item.title}`.replace(/\s+/g, ' ').trim()
  // The lite endpoint answers from networks the full HTML endpoint
  // refuses outright; its results use class 'result-link'.
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 403 || res.status === 202 || res.status === 429) {
    throw new BlockedError(`search refused (HTTP ${res.status})`)
  }
  if (!res.ok) throw new Error(`search HTTP ${res.status}`)
  const html = await res.text()
  if (/anomaly-modal|captcha|bots use duckduckgo/i.test(html)) {
    throw new BlockedError('search captcha')
  }

  const want = norm(`${brand} ${item.title}`)
  let best = null
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    if (!/class=["']result-link["']/.test(m[1])) continue
    const hrefMatch = m[1].match(/href="([^"]+)"/)
    if (!hrefMatch) continue
    const href = hrefMatch[1].replace(/&amp;/g, '&')
    let target = href
    try {
      const u = new URL(href, 'https://duckduckgo.com')
      target = u.searchParams.get('uddg') ?? href
    } catch {
      continue
    }
    const asinMatch = String(target).match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/)
    if (!asinMatch) continue
    const resultTitle = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const score = tokenScore(want, norm(resultTitle))
    const brandOk =
      !brand || norm(resultTitle).includes(norm(brand)) || norm(resultTitle).includes('leap frog')
    if ((score >= 0.5 && brandOk) || score >= 0.75) {
      if (!best || score > best.score) best = { asin: asinMatch[1], score, resultTitle }
    }
  }
  return best
}

// ---- targets, in priority order ------------------------------------
function loadTargets() {
  const byId = new Map()
  const push = (rows) => {
    for (const r of rows ?? []) if (!byId.has(r.id)) byId.set(r.id, r)
  }
  push(
    sql(
      `select id, platform, title from public.catalog_items
       where asin is null and item_type = 'device' order by title`,
    ),
  )
  push(
    sql(
      `select c.id, c.platform, c.title from public.catalog_items c
       where c.asin is null and exists (
         select 1 from public.items i
         where i.platform = c.platform and lower(i.title) = lower(c.title)
       ) order by c.title`,
    ),
  )
  push(
    sql(
      `select id, platform, title from public.catalog_items
       where asin is null order by platform, title
       limit ${Math.max(1, Math.floor(limit))}`,
    ),
  )
  return [...byId.values()].slice(0, Math.max(1, Math.floor(limit)))
}

// ---- main -------------------------------------------------------------
const targets = loadTargets()
let resolved = 0
let blocked = false
const unresolved = []
for (const item of targets) {
  let hit = null
  try {
    hit = await searchAmazon(item)
  } catch (err) {
    if (err instanceof BlockedError) {
      blocked = true
      console.log(`blocked while resolving: [${item.platform}] ${item.title} — stopping early`)
      break
    }
    hit = null
  }
  if (!hit) {
    unresolved.push({ title: item.title, platform: item.platform })
  } else {
    console.log(`asin ${hit.asin} (score ${hit.score.toFixed(2)}): [${item.platform}] ${item.title}`)
    if (!dryRun) {
      sql(
        `update public.catalog_items set asin = '${hit.asin}'
         where id = '${item.id}' and asin is null`,
      )
    }
    resolved++
  }
  if (item !== targets[targets.length - 1]) await sleep(SLEEP_MS)
}

let propagated = 0
if (!dryRun && resolved > 0) {
  const before = sql(`select count(*) as n from public.items where asin is not null`)[0].n
  sql(
    `update public.items i set asin = c.asin
     from public.catalog_items c
     where i.asin is null and c.asin is not null
       and i.platform = c.platform and lower(i.title) = lower(c.title)`,
  )
  const after = sql(`select count(*) as n from public.items where asin is not null`)[0].n
  propagated = after - before
}

console.log(
  JSON.stringify(
    { dry_run: dryRun, checked: targets.length, resolved, blocked, propagated_to_items: propagated, unresolved },
    null,
    2,
  ),
)
