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
//
// No-affiliate browsers (owner request 2026-10-22): a family can
// opt its share list out of affiliate links (profiles.no_affiliate,
// migration 0026). Anyone who opens such a list gets a permanent
// flag in this browser, and every Amazon link rendered here
// afterwards drops the tag — gifts for those kids shouldn't earn
// the family a commission. The flag lives in localStorage (the
// static host sets no cookies) and lasts until the browser's
// site data is cleared.

const BRAND_BY_PLATFORM = {
  tonies: 'Tonies',
  yoto: 'Yoto',
  leapfrog: 'LeapFrog',
  storypod: 'Storypod',
  lunii: 'Lunii',
  osmo: 'Osmo',
  projector: 'Moonlite Little Tikes',
  melissaanddoug: 'Melissa & Doug',
  littlepeople: 'Fisher-Price Little People',
  brio: 'BRIO',
  fatbrain: 'Fat Brain Toys',
  lakeshore: 'Lakeshore Learning',
  learningresources: 'Learning Resources',
  books: '',
  other: '',
}

const ASIN_RE = /^[A-Z0-9]{10}$/

export const NO_AFFILIATE_KEY = 'tl-no-affiliate'

export function affiliateSuppressed(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(NO_AFFILIATE_KEY) === '1'
  } catch {
    return false
  }
}

export function suppressAffiliate(storage = globalThis.localStorage) {
  try {
    storage?.setItem(NO_AFFILIATE_KEY, '1')
  } catch {
    // Storage blocked — links just keep the tag in this browser.
  }
}

// Called by the share page on load: an opted-out family's list
// turns the tag off in this browser, permanently.
export function noteSharePageVisit(data, storage = globalThis.localStorage) {
  if (data?.no_affiliate) suppressAffiliate(storage)
}

export function effectiveTag(tag = import.meta.env?.VITE_AMAZON_TAG) {
  return affiliateSuppressed() ? undefined : tag
}

export function amazonUrlFor(item, tag = effectiveTag()) {
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
