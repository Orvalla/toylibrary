// Paging for the catalog browser: the full catalog is 6,000+
// tiles, far too many to render at once. Pure helpers — the
// component holds the page state, these decide what's on it.

export const PAGE_SIZES = [24, 48, 96]

export function pageCountFor(total, perPage) {
  return Math.max(1, Math.ceil((total ?? 0) / perPage))
}

// Clamp a requested page into range (filters can shrink the
// list out from under a page the user was sitting on).
export function clampPage(page, total, perPage) {
  return Math.min(Math.max(1, page || 1), pageCountFor(total, perPage))
}

export function pageSlice(items, page, perPage) {
  const list = items ?? []
  const p = clampPage(page, list.length, perPage)
  const start = (p - 1) * perPage
  return {
    pageItems: list.slice(start, start + perPage),
    page: p,
    pageCount: pageCountFor(list.length, perPage),
    total: list.length,
  }
}

// The page-number buttons to show: everything when there are
// few pages; otherwise the edges plus the current neighbourhood,
// with '…' for the gaps. e.g. page 12 of 40 →
// [1, 2, '…', 11, 12, 13, '…', 39, 40]
export function pageNumbers(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const keep = new Set(
    [1, 2, pageCount - 1, pageCount, page - 1, page, page + 1].filter(
      (n) => n >= 1 && n <= pageCount
    )
  )
  const sorted = [...keep].sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}
