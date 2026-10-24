// The one way the app downloads the catalog.
//
// The catalog passed 18k rows in October 2026, and the old
// fetch — select * in 1,000-row pages, strictly one page at a
// time, with the page gated on the last one — took tens of
// seconds on a phone: ~10.7 MB of JSON in 19 sequential round
// trips. Three fixes live here so every surface gets them:
//
// 1. Slim: only the columns the UI renders. (source_url and
//    added_by were the fattest and are read by nobody here;
//    RLS, not the client, keeps hidden rows out.)
// 2. Parallel: after page one reports the total, the
//    remaining pages fetch with bounded concurrency.
// 3. Progressive: onChunk fires with the assembled rows (in
//    catalog order) as pages land, so callers can render the
//    first screenful immediately and fill in behind it.
//
// Paging keeps the total order (sort_order, title, id) — an
// unpaged or unstably-paged read silently loses rows at the
// 1,000-row REST cap, which is how whole platforms once
// vanished from the browser.

export const CATALOG_COLUMNS =
  'id, platform, title, details, image_url, asin, product_url, logo_url, is_bundle, item_type, sort_order, age_min_years, age_max_years, rating, rating_count, language'

export const CATALOG_PAGE_SIZE = 1000
const CONCURRENCY = 6

export async function fetchCatalog(client, { onChunk } = {}) {
  const pages = new Map() // page index -> rows
  let emitted = 0

  // Emit the longest assembled prefix: page order is display
  // order, so a later page never jumps ahead of a missing one.
  const emit = () => {
    const rows = []
    for (let i = 0; pages.has(i); i++) rows.push(...pages.get(i))
    if (rows.length > emitted) {
      emitted = rows.length
      onChunk?.(rows)
    }
    return rows
  }

  const fetchPage = async (index, withCount = false) => {
    const from = index * CATALOG_PAGE_SIZE
    let query = client
      .from('catalog_items')
      .select(CATALOG_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .order('sort_order')
      .order('title')
      .order('id')
      .range(from, from + CATALOG_PAGE_SIZE - 1)
    const { data, count } = await query
    const rows = data ?? []
    pages.set(index, rows)
    return { rows, count }
  }

  const first = await fetchPage(0, true)
  emit()
  if (first.rows.length < CATALOG_PAGE_SIZE) return first.rows

  const totalPages = Number.isFinite(first.count)
    ? Math.ceil(first.count / CATALOG_PAGE_SIZE)
    : null

  if (totalPages) {
    let next = 1
    const worker = async () => {
      while (next < totalPages) {
        const index = next++
        await fetchPage(index)
        emit()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalPages - 1) }, worker))
  } else {
    // No count came back (an unusual client): fetch in waves
    // until a short page says the catalog is exhausted.
    let waveStart = 1
    for (;;) {
      const indexes = Array.from({ length: CONCURRENCY }, (_, i) => waveStart + i)
      const results = await Promise.all(indexes.map((i) => fetchPage(i)))
      emit()
      if (results.some((r) => r.rows.length < CATALOG_PAGE_SIZE)) break
      waveStart += CONCURRENCY
    }
  }
  return emit()
}
