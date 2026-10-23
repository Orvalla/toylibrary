// The gift cart on the public share page.
//
// A gift-giver collects wishlist items in the cart, then buys
// them on Amazon through the usual affiliate links. There is no
// shop behind it — no products, prices or inventory to maintain:
// the cart is just a list, kept in this browser's localStorage
// per share slug, the same way claim tokens are kept. Prices
// live on Amazon and are only ever shown there.

export const cartKey = (slug) => `giftcart:${slug}`

// Snapshot the fields the cart drawer renders, so the cart still
// makes sense if the list changes underneath it.
export function cartEntryFor(item) {
  return {
    id: item.id,
    title: item.title ?? '',
    platform: item.platform ?? 'other',
    details: item.details ?? '',
    image_url: item.image_url ?? '',
    asin: item.asin ?? null,
    product_url: item.product_url ?? null,
    child_name: item.child_name ?? null,
  }
}

export function addToCart(entries, item) {
  if (entries.some((e) => e.id === item.id)) return entries
  return [...entries, cartEntryFor(item)]
}

export function removeFromCart(entries, id) {
  return entries.filter((e) => e.id !== id)
}

export function cartHas(entries, id) {
  return entries.some((e) => e.id === id)
}

export function loadCart(slug, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(cartKey(slug))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e) => e && typeof e.id === 'string' && typeof e.title === 'string')
  } catch {
    return []
  }
}

export function saveCart(slug, entries, storage = globalThis.localStorage) {
  try {
    storage?.setItem(cartKey(slug), JSON.stringify(entries))
  } catch {
    // A full or blocked localStorage must never break the page;
    // the cart just won't persist across visits.
  }
}
