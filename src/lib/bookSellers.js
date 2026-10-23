// Used-book sellers offered alongside "Buy on Amazon" for book
// items (owner request 2026-10-23): a parent may rather give a
// book a second life than buy a new spine, and the choice should
// be one tap either way. Every seller here is a direct seller of
// its own inventory — no marketplaces, no dropship fronts — and
// was chosen for reputation and ethics:
//
//   ThriftBooks       the largest US used bookseller; real
//                     warehouses, its own stock, reading-rewards
//                     programme funds classroom libraries.
//   Better World Books social enterprise: every order funds
//                     global literacy and keeps books out of
//                     landfill; free US shipping.
//   Powell's          Portland's independent icon, selling used
//                     and new since 1971.
//   Half Price Books  family-owned since 1972; used books,
//                     records and remainders, Texas-based.
//
// Search links by title (book rows carry no author field) — the
// same honest fallback shape as the Amazon search link: it lands
// on the seller's own results for the title, editions and
// conditions side by side, and keeps working as stock rotates.
// No affiliate relationship with any of them; these links earn
// nothing.

export const BOOK_SELLERS = [
  {
    key: 'thriftbooks',
    label: 'ThriftBooks',
    searchUrl: (title) =>
      `https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(title)}`,
  },
  {
    key: 'betterworldbooks',
    label: 'Better World Books',
    searchUrl: (title) =>
      `https://www.betterworldbooks.com/search/results?q=${encodeURIComponent(title)}`,
  },
  {
    key: 'powells',
    label: "Powell's",
    searchUrl: (title) =>
      `https://www.powells.com/books/search?query=${encodeURIComponent(title)}`,
  },
  {
    key: 'hpb',
    label: 'Half Price Books',
    searchUrl: (title) =>
      `https://www.hpb.com/search?q=${encodeURIComponent(title)}`,
  },
]

// [{ key, label, href }] for a book item; [] for anything else.
export function usedBookLinksFor(item) {
  if (!item || item.platform !== 'books' || !item.title) return []
  return BOOK_SELLERS.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.searchUrl(item.title),
  }))
}
