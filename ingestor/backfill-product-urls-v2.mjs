// Second-pass gap fill with stronger title normalisation:
// punctuation-insensitive, and the format word "Tonie(s)"
// ignored on BOTH sides (the store styles figures as
// "Disney Frozen: Elsa Tonie" where the catalog says
// "Disney Frozen — Elsa"). Matches are still exact after
// normalisation — no fuzzy guessing, so a filled URL is the
// same product, never a bag/backpack/bundle namesake.
// PLANNER ONLY: emits UPDATEs keyed by row id.
//
//   node ingestor/backfill-product-urls-v2.mjs

import { writeFileSync } from 'fs'

const REST = 'https://seskzmdgazqfuryrtgmg.supabase.co/rest/v1'
const KEY = 'sb_publishable_yN0mHmRfsfjjK-GBR7hXyA_SoHagohb'

const STORES = [
  { origin: 'https://us.tonies.com', platforms: ['tonies'] },
  { origin: 'https://us.yotoplay.com', platforms: ['yoto'] },
  { origin: 'https://www.littletikes.com', platforms: ['littletikes', 'projector'] },
  { origin: 'https://www.mymoonlite.com', platforms: ['projector'] },
]

const norm = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'tonie' && w !== 'tonies')
    .join(' ')
    .trim()
const esc = (s) => String(s).replace(/'/g, "''")

async function nullRows(platform) {
  const res = await fetch(
    `${REST}/catalog_items?platform=eq.${platform}&product_url=is.null&select=id,title`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  )
  return res.json()
}

const updates = []
for (const store of STORES) {
  const byNorm = new Map()
  for (let page = 1; ; page++) {
    const res = await fetch(`${store.origin}/products.json?limit=250&page=${page}`, {
      headers: { 'user-agent': 'ToyLibraryBackfill/1.0' },
    })
    const data = await res.json()
    const products = data.products ?? []
    if (!products.length) break
    for (const p of products) {
      if (p.title && p.handle) byNorm.set(norm(p.title), `${store.origin}/products/${p.handle}`)
    }
  }
  for (const platform of store.platforms) {
    const rows = await nullRows(platform)
    let filled = 0
    for (const row of rows) {
      const url = byNorm.get(norm(row.title))
      if (url) {
        filled += 1
        updates.push(
          `update public.catalog_items set product_url = '${esc(url)}' where id = '${row.id}' and product_url is null;`
        )
      }
    }
    console.log(`${store.origin} → ${platform}: ${filled}/${rows.length} residuals matched`)
  }
}

const OUT =
  '/home/hatch/workspace/goals/toy-library-tracker/hidden_files/product-urls/v2-chunk-001.sql'
writeFileSync(OUT, updates.join('\n') + '\n')
console.log(`planned ${updates.length} updates → ${OUT}`)
