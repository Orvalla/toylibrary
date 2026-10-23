// Store logos for catalog items (owner request 2026-10-23):
// platforms carry real brand logos (lib/platforms.js →
// public/logos/), and an item whose platform has none — above
// all items parents added themselves from a store we don't
// carry — shows that store's favicon instead, pulled from the
// site the item links to (the same trick browsers use for
// tabs). catalog_items.logo_url is stamped at ingest time from
// the source link; the fallback below derives it on the fly
// from the product page, so older rows are covered too.

export function faviconUrlFor(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host) return null
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`
}

// The store mark for one item: its stamped logo when present,
// else the favicon of its product page, else null.
export function storeLogoUrlFor(item) {
  if (item?.logo_url) return item.logo_url
  if (item?.product_url) return faviconUrlFor(item.product_url)
  return null
}
