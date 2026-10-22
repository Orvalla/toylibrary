#!/usr/bin/env node
// bundles.mjs — stock bundles as catalog items in their own right
// and map what is inside them (migration 0013).
//
//   node ingestor/bundles.mjs [--dry-run]
//
// Two halves:
//   1. Rows that are already in the catalog but are really
//      bundles (Yoto card packs, Storypod content bundles, Dream
//      Machine story collections) get is_bundle = true.
//   2. Bundle products the store ingests deliberately skipped
//      (Tonies packs, Moonlite reel packs, the two Osmo series
//      bundles) are inserted as new is_bundle rows. Hardware
//      bundles stay out — a "starter set" with a player in it is
//      a device purchase, not story content.
// Contents are mapped by scanning each bundle's store description
// for the catalog titles it names (the stores list the contents
// in the description), with a series-prefix fallback for the
// Tonies book/pocket packs. Anything unmapped stays a plain
// bundle row — it just shows no coverage line until it's mapped.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = join(HERE, '..', '..', 'custom-connectors', 'custom.supabase', 'bin', 'sbq.py')
const dryRun = process.argv.includes('--dry-run')
const UA = 'ToyLibrary/1.0 (catalog build; contact via toylibrary.store)'

function sql(statement) {
  const file = `/tmp/bundles-${process.pid}.sql`
  writeFileSync(file, statement)
  const out = execFileSync('python3', [SB, file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  if (parsed.status >= 300) throw new Error(`SQL failed (${parsed.status}): ${out.slice(0, 300)}`)
  return parsed.result
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const keyOf = (platform, title) => `${platform}|${norm(title)}`
const esc = (s) => String(s).replace(/'/g, "''")
const stripTags = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

async function feed(base) {
  const products = []
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(40000),
    })
    if (!res.ok) throw new Error(`feed HTTP ${res.status} at ${base} page ${page}`)
    const data = await res.json()
    products.push(...(data.products ?? []))
    if (!data.products || data.products.length < 250) break
  }
  return products
}

// ---- catalog snapshot -------------------------------------------------
const catalog = []
for (let offset = 0; ; offset += 300) {
  const rows = sql(
    `select id, platform, title, details, item_type, is_bundle from public.catalog_items
     order by platform, title limit 300 offset ${offset}`,
  )
  catalog.push(...(rows ?? []))
  if (!rows || rows.length < 300) break
}
const byKey = new Map(catalog.map((r) => [keyOf(r.platform, r.title), r]))
const contentsByPlatform = new Map()
for (const r of catalog) {
  if (r.item_type === 'device') continue
  if (!contentsByPlatform.has(r.platform)) contentsByPlatform.set(r.platform, [])
  contentsByPlatform.get(r.platform).push(r)
}
console.log(`catalog rows loaded: ${catalog.length}`)

// ---- which store products are bundles ---------------------------------
const TONIE_TYPES = ['Tonie', 'Creative Tonie', 'Clever Tonie', 'My First Tonie', 'Audiobook']
const found = [] // {platform, title, details, image_url, source_url, body, storeTitle}

function consider(platform, title, details, product, base) {
  found.push({
    platform,
    title,
    details,
    image_url: product.images?.[0]?.src ?? '',
    source_url: `${base}/products/${product.handle}`,
    body: stripTags(product.body_html),
    rawHtml: product.body_html ?? '',
  })
}

const tonies = await feed('https://us.tonies.com')
for (const p of tonies) {
  if (!TONIE_TYPES.includes(p.product_type)) continue
  if (!/\b\d+\s*pack\b|\bbundle\b/i.test(p.title)) continue
  consider('tonies', p.title, 'Tonie bundle', p, 'https://us.tonies.com')
}

const moonlite = await feed('https://www.mymoonlite.com')
for (const p of moonlite) {
  if (!/\bpack\b|\bset\b/i.test(p.title)) continue
  if (/starter|projector|gift card/i.test(p.title)) continue // hardware bundles stay out
  consider('projector', p.title, 'Story reel bundle', p, 'https://www.mymoonlite.com')
}

const osmo = await feed('https://www.playosmo.com')
for (const p of osmo) {
  if (!/bundle|series/i.test(p.title)) continue
  if (/mystery/i.test(p.title)) continue
  consider('osmo', p.title, 'Osmo game bundle', p, 'https://www.playosmo.com')
}

// Feeds for the already-catalogued bundle rows (contents mapping
// needs their descriptions too).
const yoto = await feed('https://us.yotoplay.com')
const storypod = await feed('https://www.storypod.com')
const littletikes = await feed('https://www.littletikes.com')
const feedByTitle = new Map()
for (const [platform, products, strip] of [
  ['yoto', yoto, (t) => t],
  ['storypod', storypod, (t) => t],
  ['projector', littletikes, (t) => t.replace(/^Story Dream Machine\s+/i, '')],
]) {
  for (const p of products) feedByTitle.set(keyOf(platform, strip(p.title)), { product: p, platform })
}

// Already-catalogued rows that are bundles by their details.
const EXISTING_BUNDLE_DETAILS = {
  yoto: new Set(['Yoto Card pack']),
  storypod: new Set(['Content bundle']),
  projector: new Set(['Dream Machine story collection']),
}
const existingBundles = catalog.filter(
  (r) => EXISTING_BUNDLE_DETAILS[r.platform]?.has(r.details) && r.item_type !== 'device',
)
for (const r of existingBundles) {
  const hit = feedByTitle.get(keyOf(r.platform, r.title))
  found.push({
    platform: r.platform,
    title: r.title,
    details: r.details,
    image_url: '',
    source_url: '',
    body: hit ? stripTags(hit.product.body_html) : '',
    rawHtml: hit ? hit.product.body_html ?? '' : '',
    existingId: r.id,
  })
}

console.log(`bundle products found: ${found.length} (${existingBundles.length} already in catalog)`)

// ---- map contents -------------------------------------------------------
// Three signals, in order of trust:
//   1. Tonies pack descriptions carry the contents as <b> titles
//      ("1. Dinosaurs Before Dark:", or a bare "Night of the
//      Living Dummy"). Clean patterns only; the two Narnia packs
//      run their titles into the prose, so theirs are curated
//      below from the same descriptions, verbatim.
//   2. A strict description scan: a catalog title (full, >= 8
//      chars normalized) appearing in the bundle's description
//      text. Short/generic titles never match — "Wonder" the
//      book vs "wonder" the word was a real false positive.
//   3. A series-stem match: contents whose titles start with the
//      bundle's stem ("Earth's Incredible Places Collection" ->
//      "Earth's Incredible Places: Yellowstone", ...).
// Extracted titles with no catalog row are pack-exclusive stories
// (Tonies sells Book Tonies only in packs): they are created as
// catalog rows so owning the pack can mark them as had.

const CURATED_CONTENTS = {
  'the chronicles of narnia book tonies books 1 4 4 pack': [
    "The Magician's Nephew",
    'The Lion, the Witch and the Wardrobe',
    'The Horse and His Boy',
    'Prince Caspian',
  ],
  'the chronicles of narnia book tonies books 5 7 3 pack': [
    'The Voyage of the Dawn Treader',
    'The Silver Chair',
    'The Last Battle',
  ],
}

function seriesStem(title) {
  return title
    .replace(/\s*\((?:books?|vol\.?)[^)]*\)/gi, '')
    .replace(/\s+Book Tonies.*$/i, '')
    .replace(/\s+Pocket Tonies.*$/i, '')
    .replace(/\s+Tonies\s+\d+\s*Pack.*$/i, '')
    .replace(/\s*-\s*\d+\s*Pack.*$/i, '')
    .replace(/\s+(Collection|Pack|Boxed Set|Set)$/i, '')
    .trim()
}

function boldTitles(html) {
  const out = []
  for (const m of String(html ?? '').matchAll(/<b[^>]*>(.*?)<\/b>/gis)) {
    const seg = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    const numbered = seg.match(/^\d+\.\s*(.+?):?$/)
    if (numbered && numbered[1].length <= 50) {
      out.push(numbered[1].replace(/:$/, '').trim())
    } else if (
      seg.length >= 4 && seg.length <= 45 &&
      /^[A-Z0-9"']/.test(seg) &&
      !seg.endsWith(':') &&
      seg.split(' ').length <= 9 &&
      !/[.!?].+\w/.test(seg) &&
      !/tonies|audiobook|language|sensitive|inappropriate|children\./i.test(seg)
    ) {
      out.push(seg)
    }
  }
  return out
}

function mapContents(bundle) {
  const pool = (contentsByPlatform.get(bundle.platform) ?? []).filter(
    (r) => !r.is_bundle && keyOf(r.platform, r.title) !== keyOf(bundle.platform, bundle.title),
  )
  const byNorm = new Map(pool.map((r) => [norm(r.title), r]))
  const hits = []
  const used = new Set()
  const take = (row) => {
    if (row && !used.has(row.id)) {
      used.add(row.id)
      hits.push({ row })
    }
  }
  const creates = []
  const stem = seriesStem(bundle.title)

  // Signal 1: curated + <b>-extracted titles (Tonies packs).
  let extracted = []
  if (bundle.platform === 'tonies') {
    extracted = CURATED_CONTENTS[norm(bundle.title)] ?? boldTitles(bundle.rawHtml)
    for (const t of extracted) {
      const direct = byNorm.get(norm(t)) ?? byNorm.get(norm(`${stem}: ${t}`)) ?? byNorm.get(norm(`${stem} ${t}`))
      if (direct) take(direct)
      else creates.push({
        title:
          stem && stem !== t && !norm(t).startsWith(norm(stem))
            ? `${stem}: ${t}`
            : t,
        bundle,
      })
    }
  }

  // Signal 2: strict description scan.
  const text = ` ${norm(bundle.body)} `
  for (const r of pool) {
    const v = norm(r.title)
    if (v.length >= 8 && (text.includes(` ${v} `) || text.includes(` ${v},`) || text.includes(` ${v}.`))) take(r)
  }

  // Signal 3: series stem.
  if (stem && stem.length >= 6 && norm(stem) !== norm(bundle.title)) {
    for (const r of pool) {
      if (r.title.toLowerCase().startsWith(stem.toLowerCase())) take(r)
    }
  }
  return { hits: hits.map((h) => h.row), creates }
}

const mappings = new Map() // bundle key -> { hits: [rows], creates: [{title, bundle}] }
for (const b of found) {
  const res = mapContents(b)
  // Pack-only contents are only trusted when the extraction
  // accounts for the whole pack ("4 Pack" -> 4 titles). A partial
  // guess would make the coverage line lie about the set size.
  const stated = Number(b.title.match(/(\d+)\s*pack/i)?.[1] ?? 0)
  if (stated && res.creates.length && res.hits.length + res.creates.length < stated) {
    console.log(`  (dropping ${res.creates.length} partial pack-only titles for ${b.title}: found ${res.hits.length + res.creates.length} of ${stated})`)
    res.creates = []
  }
  mappings.set(keyOf(b.platform, b.title), res)
  console.log(
    `  ${b.platform} · ${b.title} -> ${res.hits.length} contents` +
      (res.creates.length ? ` + ${res.creates.length} pack-only: ${res.creates.map((c) => c.title).join(' | ')}` : '') +
      (res.hits.length ? `: ${res.hits.map((h) => h.title).join(' | ')}` : ''),
  )
}

// ---- write ---------------------------------------------------------------
const newBundles = found.filter((b) => !b.existingId && !byKey.has(keyOf(b.platform, b.title)))
if (!dryRun) {
  // Flag the ones already catalogued.
  const flagIds = existingBundles.filter((r) => !r.is_bundle).map((r) => r.id)
  for (let i = 0; i < flagIds.length; i += 100) {
    const ids = flagIds.slice(i, i + 100).map((id) => `'${id}'`).join(',')
    if (ids) sql(`update public.catalog_items set is_bundle = true where id in (${ids})`)
  }
  // Insert the new bundle rows.
  for (let i = 0; i < newBundles.length; i += 40) {
    const chunk = newBundles.slice(i, i + 40)
    const values = chunk
      .map(
        (b, j) =>
          `('${b.platform}', '${esc(b.title)}', '${esc(b.details)}', '${esc(b.image_url)}', '${esc(b.source_url)}', ${2100 + i + j}, true)`,
      )
      .join(',\n')
    sql(
      `insert into public.catalog_items (platform, title, details, image_url, source_url, sort_order, is_bundle)
       values ${values}`,
    )
  }
  // Insert pack-only content rows (stories sold only inside a
  // pack — they still belong on a have-list once the pack is had).
  const createRows = new Map()
  for (const b of found) {
    const res = mappings.get(keyOf(b.platform, b.title))
    for (const c of res?.creates ?? []) {
      const k = keyOf(b.platform, c.title)
      if (byKey.has(k) || createRows.has(k)) continue
      createRows.set(k, {
        platform: b.platform,
        title: c.title,
        details: /book tonies/i.test(b.title) ? 'Audiobook Tonie' : 'Tonie figure',
        image_url: '',
        source_url: b.source_url,
      })
    }
  }
  const creates = [...createRows.values()]
  for (let i = 0; i < creates.length; i += 40) {
    const chunk = creates.slice(i, i + 40)
    const values = chunk
      .map(
        (c, j) =>
          `('${c.platform}', '${esc(c.title)}', '${esc(c.details)}', '', '${esc(c.source_url)}', ${2300 + i + j}, false)`,
      )
      .join(',\n')
    sql(
      `insert into public.catalog_items (platform, title, details, image_url, source_url, sort_order, is_bundle)
       values ${values}`,
    )
  }
  console.log(`pack-only content rows created: ${creates.length}`)

  // Fresh id map, then the contents pairs.
  const idByKey = new Map()
  for (let offset = 0; ; offset += 400) {
    const rows = sql(
      `select id, platform, title from public.catalog_items order by platform, title limit 400 offset ${offset}`,
    )
    for (const r of rows ?? []) idByKey.set(keyOf(r.platform, r.title), r.id)
    if (!rows || rows.length < 400) break
  }
  const pairs = []
  for (const b of found) {
    const bundleId = idByKey.get(keyOf(b.platform, b.title))
    if (!bundleId) continue
    const res = mappings.get(keyOf(b.platform, b.title))
    const contentIds = new Set()
    for (const h of res?.hits ?? []) contentIds.add(h.id)
    for (const c of res?.creates ?? []) {
      const id = idByKey.get(keyOf(b.platform, c.title))
      if (id) contentIds.add(id)
    }
    for (const id of contentIds) pairs.push(`('${bundleId}', '${id}')`)
  }
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100)
    if (chunk.length) {
      sql(`insert into public.bundle_contents (bundle_id, content_id) values ${chunk.join(',\n')} on conflict do nothing`)
    }
  }
  console.log(`contents pairs written: ${pairs.length}`)
}

console.log(
  JSON.stringify({
    dry_run: dryRun,
    bundles_found: found.length,
    already_catalogued: existingBundles.length,
    new_bundles: newBundles.length,
    mapped_bundles: [...mappings.values()].filter((h) => h.hits.length || h.creates.length).length,
  }),
)
