// Direct manufacturer links (owner request 2026-10-22): tiles
// offer the maker's own product page next to the Amazon link —
// but ONLY a direct product page. The owner explicitly ruled
// out falling back to the maker's storefront/catalog home:
// a link that lands on a generic catalog isn't the item, so
// items whose exact page is unknown (mostly discontinued
// stock the maker's store no longer lists) simply show no
// manufacturer link. catalog_items.product_url (migration
// 0025) is copied onto items when they're added, so one field
// serves every tile.

export function manufacturerUrlFor(item) {
  return item?.product_url || null
}
