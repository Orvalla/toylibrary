import { bestMatch, matchScore, titleWords } from './photoMatch'

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

// Resolve a book detection to a real Open Library work — not
// just a cover, the whole identity: canonical title, author,
// cover, and the work's page. This is what lets a bookshelf
// scan ADD a book to the catalog when the catalog doesn't have
// it yet (scan upgrade 2026-10-22). Title must word-match like
// a catalog match; when the detection carries an author (the
// vision model reads spines), a surname agreement is a strong
// extra signal and can carry a slightly weaker title match.
export function openLibraryResolution(docs, detection) {
  const withCovers = (docs ?? []).filter((d) => d.cover_i)
  if (!withCovers.length) return null
  const detAuthor = titleWords(detection?.author ?? '')
  let best = null
  let bestScore = 0
  for (const doc of withCovers) {
    let score = matchScore(detection, doc)
    if (detAuthor.size) {
      const docAuthors = new Set(
        (doc.author_name ?? []).flatMap((a) => [...titleWords(a)])
      )
      const surnameHit = [...detAuthor].some((w) => docAuthors.has(w))
      if (surnameHit) score += 0.25
      else if (score >= 0.6) score -= 0.15 // title matches, author doesn't — trust it less
    }
    if (score > bestScore) {
      bestScore = score
      best = doc
    }
  }
  if (!best || bestScore < 0.6) return null
  return {
    title: best.title,
    author: (best.author_name ?? [])[0] ?? '',
    image_url: coverUrlFor(best.cover_i),
    work_url: best.key ? `https://openlibrary.org${best.key}` : '',
  }
}

// fetchJson(url) → parsed JSON (Open Library). The resolver
// searches by title, adding the author when the spine gave one.
export function createBookResolver({ fetchJson }) {
  return async function resolveBook(detection) {
    try {
      const params = new URLSearchParams({
        title: detection?.title ?? '',
        limit: '5',
        fields: 'title,author_name,cover_i,key',
      })
      if (detection?.author) params.set('author', detection.author)
      const data = await fetchJson(`https://openlibrary.org/search.json?${params}`)
      return openLibraryResolution(data?.docs, detection)
    } catch {
      return null
    }
  }
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
