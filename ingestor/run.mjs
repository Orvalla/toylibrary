#!/usr/bin/env node
// Toy Library catalog ingestor.
//
// Pulls the tracked product lines (see lib/sources.mjs) from the
// manufacturers' own stores and produces the browsable catalog:
//
//   node ingestor/run.mjs                     # writes ingestor/out/catalog.json
//   node ingestor/run.mjs --sql out.sql       # also emit SQL upserts
//   node ingestor/run.mjs --only tonies       # one source
//   node ingestor/run.mjs --apply             # upsert into Supabase
//       (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env)
//
// Sources run independently: one store being down never blocks the
// others, and the summary says exactly what each source yielded.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCES } from './lib/sources.mjs'
import { ingestShopify } from './lib/shopify.mjs'
import { ingestLeapfrog } from './lib/leapfrog.mjs'
import { ingestLunii } from './lib/lunii.mjs'
import { dedupeCatalog, catalogToSql, applyToSupabase } from './lib/output.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const only = opt('--only')
const outPath = opt('--out') ?? path.join(here, 'out', 'catalog.json')
const sqlPath = opt('--sql')
const apply = args.includes('--apply')

const ADAPTERS = { shopify: ingestShopify, leapfrog: ingestLeapfrog, lunii: ingestLunii }

const all = []
const summary = []
for (const source of SOURCES) {
  if (only && source.id !== only) continue
  console.log(`▸ ${source.id} (${source.kind})`)
  try {
    const rows = await ADAPTERS[source.kind](source)
    const withImages = rows.filter((r) => r.image_url).length
    summary.push({ source: source.id, rows: rows.length, withImages })
    console.log(`  ✓ ${rows.length} rows, ${withImages} with images`)
    all.push(...rows)
  } catch (err) {
    summary.push({ source: source.id, error: err.message })
    console.error(`  ✗ failed: ${err.message}`)
  }
}

const catalog = dedupeCatalog(all)
console.log(`\nTotal: ${all.length} rows → ${catalog.length} after dedupe`)
for (const s of summary) {
  console.log(
    `  ${s.source}: ${s.error ? `FAILED (${s.error})` : `${s.rows} rows, ${s.withImages} with images`}`
  )
}

await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Wrote ${outPath}`)

if (sqlPath) {
  await writeFile(sqlPath, catalogToSql(catalog))
  console.log(`Wrote ${sqlPath}`)
}

if (apply) {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment')
    process.exitCode = 1
  } else {
    const n = await applyToSupabase(catalog, { url, serviceKey })
    console.log(`Upserted ${n} rows into catalog_items`)
  }
}
