// Gap-fill planner: fetch the live Shopify product feeds for
// the stores whose snapshot left gaps (Tonies especially —
// ~96 rows were added by parents/weekly ingest after the
// snapshot) and emit product_url updates. Every UPDATE keeps
// `product_url is null`, so rows the snapshot already filled
// are untouched. PLANNER ONLY — see backfill-product-urls.mjs.
//
//   node ingestor/backfill-product-urls-live.mjs

import { writeFileSync } from 'fs'

const STORES = [
  { origin: 'https://us.tonies.com', platforms: ['tonies'] },
  { origin: 'https://www.littletikes.com', platforms: ['littletikes', 'projector'] },
  { origin: 'https://www.mymoonlite.com', platforms: ['projector'] },
  { origin: 'https://us.yotoplay.com', platforms: ['yoto'] },
]

const norm = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const esc = (s) => String(s).replace(/'/g, "''")

const updates = []
for (const store of STORES) {
  let page = 1
  let count = 0
  for (;;) {
    const res = await fetch(`${store.origin}/products.json?limit=250&page=${page}`, {
      headers: { 'user-agent': 'ToyLibraryBackfill/1.0' },
    })
    if (!res.ok) throw new Error(`${store.origin} page ${page}: HTTP ${res.status}`)
    const data = await res.json()
    const products = data.products ?? []
    if (!products.length) break
    for (const p of products) {
      if (!p.title || !p.handle) continue
      count += 1
      const url = `${store.origin}/products/${p.handle}`
      for (const platform of store.platforms) {
        updates.push(
          `update public.catalog_items set product_url = '${esc(url)}' where platform = '${platform}' and lower(regexp_replace(title, '[®™]', '', 'g')) = '${esc(norm(p.title))}' and product_url is null;`
        )
      }
    }
    page += 1
  }
  console.log(`${store.origin}: ${count} products`)
}

const OUT =
  '/home/hatch/workspace/goals/toy-library-tracker/hidden_files/product-urls/live-chunk-001.sql'
writeFileSync(OUT, updates.join('\n') + '\n')
console.log(`planned ${updates.length} updates → ${OUT}`)
