// One-time planner: emit product_url backfill SQL for
// catalog_items from the URL-bearing sources already on disk —
// the overnight feed snapshots (ingestor/out feeds captured
// 2026-10-21/22) and the expansion manifests, all of which kept
// each product's source_url even though the catalog schema had
// nowhere to put it until migration 0025.
//
// PLANNER ONLY (sandbox mirror rule): this writes .sql files;
// the main agent applies them via short foreground sb.py calls
// and verifies counts through the public REST API.
//
//   node ingestor/backfill-product-urls.mjs
//   → ~/workspace/goals/toy-library-tracker/hidden_files/product-urls/chunk-NNN.sql

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const GOAL = '/home/hatch/workspace/goals/toy-library-tracker/hidden_files'
const OUT = join(GOAL, 'product-urls')

// Feed snapshots: filename → the catalog platform its rows
// belong to (moonlite and the Little Tikes Dream Machine feed
// both live under 'projector').
const FEEDS = {
  'tonies.json': 'tonies',
  'yoto.json': 'yoto',
  'lunii.json': 'lunii',
  'leapfrog.json': 'leapfrog',
  'moonlite.json': 'projector',
  'osmo.json': 'osmo',
  'storypod.json': 'storypod',
  'littletikes.json': 'projector',
}

// Expansion manifests: path → platform (null = read it from
// each row, as the devices manifest spans platforms).
const MANIFESTS = {
  'brio/brio-manifest.json': 'brio',
  'melissaanddoug/melissaanddoug-manifest.json': 'melissaanddoug',
  'haba/haba-manifest.json': 'haba',
  'haba-family/haba-family-manifest.json': 'haba',
  'fatbrain/fatbrain-manifest.json': 'fatbrain',
  'lakeshore/lakeshore-manifest.json': 'lakeshore',
  'learningresources/learningresources-manifest.json': 'learningresources',
  'learningresources/learningresources-completion-manifest.json': 'learningresources',
  'littlepeople/littlepeople-manifest.json': 'littlepeople',
  'lovevery/lovevery-manifest.json': 'lovevery',
  'magnatiles/magnatiles-manifest.json': 'magnatiles',
  'smartgames/smartgames-manifest.json': 'smartgames',
  'vtech/vtech-manifest.json': 'vtech',
  'devices/devices-manifest.json': null,
}

const norm = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const byKey = new Map() // `${platform}|${normTitle}` → url
const stats = new Map()
function add(platform, title, url, sourceName) {
  if (!platform || !title || !url) return
  const key = `${platform}|${norm(title)}`
  if (!byKey.has(key)) byKey.set(key, url)
  const s = stats.get(sourceName) ?? { rows: 0, withUrl: 0 }
  s.rows += 1
  if (url) s.withUrl += 1
  stats.set(sourceName, s)
}

for (const [file, platform] of Object.entries(FEEDS)) {
  const rows = JSON.parse(readFileSync(join(GOAL, 'overnight/feeds', file), 'utf8'))
  for (const r of rows) add(platform, r.title, r.source_url, `feed:${file}`)
}
for (const [file, platform] of Object.entries(MANIFESTS)) {
  const rows = JSON.parse(readFileSync(join(GOAL, file), 'utf8'))
  for (const r of rows)
    add(platform ?? r.platform, r.title, r.source_url ?? r.url, `manifest:${file}`)
}

const esc = (s) => String(s).replace(/'/g, "''")
const updates = [...byKey.entries()].map(([key, url]) => {
  const sep = key.indexOf('|')
  const platform = key.slice(0, sep)
  const title = key.slice(sep + 1)
  // lower(title) matching happens in SQL against the stored
  // title; the key holds the normalised form, and catalog
  // titles differ from it only by case/™/spacing, which the
  // WHERE below reproduces.
  return `update public.catalog_items set product_url = '${esc(url)}' where platform = '${esc(platform)}' and lower(regexp_replace(title, '[®™]', '', 'g')) = '${esc(title)}' and product_url is null;`
})

mkdirSync(OUT, { recursive: true })
const CHUNK = 400
let n = 0
for (let i = 0; i < updates.length; i += CHUNK) {
  n += 1
  const name = `chunk-${String(n).padStart(3, '0')}.sql`
  writeFileSync(join(OUT, name), updates.slice(i, i + CHUNK).join('\n') + '\n')
}
console.log(`planned ${updates.length} updates in ${n} chunks → ${OUT}`)
for (const [name, s] of stats) console.log(`  ${name}: ${s.withUrl}/${s.rows} rows carry a source_url`)
