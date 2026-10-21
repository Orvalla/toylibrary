// "Buy on Amazon" links: affiliate links on every item, per the
// where-to-buy decision. When the item carries a resolved Amazon
// ASIN (catalog_items.asin / items.asin, filled in batches by
// ingestor/backfill-asins.mjs), the link goes straight to the
// product page: amazon.com/dp/<ASIN>. Without one it falls back to
// an Amazon search for the item's title plus the brand word for
// its platform — the top result is the product in practice, and
// the link keeps working even as listings come and go.
//
// The affiliate tag comes from VITE_AMAZON_TAG (a build-time env var,
// like the Supabase keys). With no tag configured the links still
// work — they just don't carry attribution.

const BRAND_BY_PLATFORM = {
  tonies: 'Tonies',
  yoto: 'Yoto',
  leapfrog: 'LeapFrog',
  storypod: 'Storypod',
  lunii: 'Lunii',
  osmo: 'Osmo',
  projector: 'Moonlite Little Tikes',
  books: '',
  other: '',
}

const ASIN_RE = /^[A-Z0-9]{10}$/

export function amazonUrlFor(item, tag = import.meta.env?.VITE_AMAZON_TAG) {
  const asin = typeof item?.asin === 'string' ? item.asin.trim().toUpperCase() : ''
  if (ASIN_RE.test(asin)) {
    return tag
      ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}`
      : `https://www.amazon.com/dp/${asin}`
  }
  const brand = BRAND_BY_PLATFORM[item?.platform] ?? ''
  const query = [item?.title ?? '', brand]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(' ')
  let url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
  if (tag) url += `&tag=${encodeURIComponent(tag)}`
  return url
}
