import { bestMatch } from './photoMatch'

// Fetch the ACTUAL product picture for a photo-scan detection
// that didn't match the catalog. The parent's shelf photo is a
// private snapshot — it must never become the item's tile,
// because tiles are what the share page shows to grandparents.
// So an unmatched detection borrows a real product image:
//
//   books         → Open Library's cover search by title
//   anything else → the same store search "Grow the catalog"
//                   uses (Tonies/Yoto/Storypod/Osmo/Moonlite/
//                   Little Tikes), word-matched the same way
//                   detections are matched to catalog rows
//
// Nothing found → '' and the tile falls back to the platform
// art, like every other imageless row. Lookups never throw —
// a failed picture hunt just means no picture.

export function coverUrlFor(coverId) {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : ''
}

// Pick the Open Library cover for a detection from its search
// docs ([{ title, cover_i }]) — only docs with a cover count,
// and the title has to word-match like a catalog match.
export function openLibraryCover(docs, detection) {
  const withCovers = (docs ?? []).filter((d) => d.cover_i)
  if (!withCovers.length) return ''
  const m = bestMatch(detection, withCovers)
  return m ? coverUrlFor(m.entry.cover_i) : ''
}

// Pick a store candidate's image for a detection.
export function storeImageFor(candidates, detection) {
  const m = bestMatch(detection, candidates ?? [])
  return m?.entry.image_url || ''
}

// searchStores(query) → candidate rows (the ingest-catalog
// search); fetchJson(url) → parsed JSON (Open Library).
export function createProductImageFetcher({ searchStores, fetchJson }) {
  return async function fetchProductImage(detection) {
    try {
      if (detection?.platform === 'books') {
        const q = encodeURIComponent(detection.title ?? '')
        const data = await fetchJson(
          `https://openlibrary.org/search.json?title=${q}&limit=5&fields=title,cover_i`
        )
        return openLibraryCover(data?.docs, detection)
      }
      const results = await searchStores(detection?.title ?? '')
      return storeImageFor(results, detection)
    } catch {
      return ''
    }
  }
}
