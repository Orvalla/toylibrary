// store-rating-extractors.mjs — platform-specific static-HTML
// rating extractors for stores that publish a rating + count
// outside JSON-LD (completeness program, packet 1; recon in
// hidden_files/completeness/RECON.md + partials A1–A3).
//
// Every extractor returns the extractAggregateRating shape —
// { rating, rating_count, extractor } — or null when the page
// carries no usable pair. A rating is only ever returned
// alongside its count (rating_count may be 0, which the caller
// counts as an honest zero / no-count and never writes).
//
// Sources wired here:
//   - Moonlite (platform 'projector', host mymoonlite.com):
//     the Klaviyo `viewed_product` blob's Shopify-standard
//     MetafieldReviews field. The same blob carries a STALE
//     Okendo pair (okendoProduct) that must never win — this
//     module simply never reads it. Klaviyo is the live widget.
//   - HABA (Shopify): MetafieldReviews, falling back to the
//     MetafieldYotpoRating / MetafieldYotpoCount page vars.
//   - eeBoo (Shopify): MetafieldReviews.
//   - BRIO / Ravensburger (ravensburger.us): native first-party
//     reviews, server-rendered — scoped to the main product's
//     #productDetailShowReviewsForm (BRIO) or .review-wrapper
//     block (Ravensburger games), because recommendation cards
//     on the same page carry identical star-summary blocks.

// Read the balanced {...} span starting at `start` (which must
// point at a '{'). Brace counting ignores string state: in the
// escaped blob form only the quotes are backslash-escaped, the
// braces are literal, and this object's own string values are
// numeric (no braces). The span is parsed raw first, then with
// backslash escapes stripped (the blob form) — first success
// wins. Returns the parsed object or null.
function readObjectAt(text, start) {
  if (text[start] !== '{') return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const span = text.slice(start, i + 1)
        for (const candidate of [span, span.replace(/\\(.)/g, '$1')]) {
          try {
            const parsed = JSON.parse(candidate)
            if (parsed && typeof parsed === 'object') return parsed
          } catch {
            /* try the next form */
          }
        }
        return null
      }
    }
  }
  return null
}

// Find a populated object assigned to `marker`, scanning EVERY
// occurrence: these blobs declare the var as a null stub first
// (`var MetafieldReviews = null`) and assign the real value
// later inside a try block, so the first occurrence is never
// the data. An occurrence counts only when an '=' or ':'
// directly introduces a '{' (a bare reference like
// `reviews: MetafieldReviews,` is skipped), and a stub
// (null / {}) does not stop the scan.
function assignedObject(html, marker) {
  for (const m of html.matchAll(new RegExp(marker, 'g'))) {
    const rest = html.slice(m.index + marker.length, m.index + marker.length + 60)
    const intro = rest.match(/^\s*[=:]\s*/)
    if (!intro) continue
    const after = rest.slice(intro[0].length)
    if (after.startsWith('null')) continue
    if (after[0] !== '{') continue
    const obj = readObjectAt(html, m.index + marker.length + intro[0].length)
    if (obj && Object.keys(obj).length > 0) return obj
  }
  return null
}

function ratingPair(value, count, extractor) {
  const rating = Math.round(Number(value) * 10) / 10
  const n = Number(count)
  if (!Number.isFinite(rating) || !Number.isFinite(n) || n < 0) return null
  if (rating <= 0 || rating > 5) {
    // A published 0.0 with a 0 count is an honest zero: surface
    // it (counted, never written); anything else out of range
    // is malformed — drop it.
    return rating === 0 && n === 0 ? { rating: 0, rating_count: 0, extractor } : null
  }
  return { rating, rating_count: Math.trunc(n), extractor }
}

// Shopify-standard reviews metafield, as mirrored into page
// blobs by Klaviyo/Yotpo-era themes:
//   MetafieldReviews = {"rating":{"scale_min":"1.0",
//     "scale_max":"5.0","value":"4.75"},"rating_count":12}
// An empty {} (the common no-reviews state) yields null.
export function extractMetafieldReviews(html, extractor = 'metafield-reviews') {
  if (!html) return null
  const obj = assignedObject(html, 'MetafieldReviews')
  if (!obj || !obj.rating || obj.rating.value == null) return null
  return ratingPair(obj.rating.value, obj.rating_count, extractor)
}

// HABA mirrors its Yotpo aggregate into bare page vars:
//   MetafieldYotpoRating = "4.7"  MetafieldYotpoCount = "25"
export function extractYotpoPageVars(html) {
  if (!html) return null
  const r = html.match(/MetafieldYotpoRating\s*=\s*["']?([\d.]+)["']?/)
  const c = html.match(/MetafieldYotpoCount\s*=\s*["']?(\d+)["']?/)
  if (!r || !c) return null
  return ratingPair(r[1], c[1], 'yotpo-page-vars')
}

// ravensburger.us native reviews. BRIO product pages carry the
// main product's summary inside <form id="productDetailShow
// ReviewsForm">; Ravensburger games pages carry it in a
// .review-wrapper block. Both render:
//   "Average rating 5.0 out of 5 stars." + <span
//   class="review-count">(1)</span>
// or an explicit "No Reviews submitted yet" zero state.
// Recommendation cards reuse the star markup, so extraction is
// scoped to those two containers and nothing else.
export function extractRavensburgerRating(html) {
  if (!html) return null
  const scopes = []
  const formIdx = html.indexOf('id="productDetailShowReviewsForm"')
  if (formIdx >= 0) {
    const end = html.indexOf('</form>', formIdx)
    scopes.push({ name: 'ravensburger-form', text: html.slice(formIdx, end > formIdx ? end : formIdx + 30000) })
  }
  const wrapIdx = html.indexOf('class="review-wrapper"')
  if (wrapIdx >= 0) {
    scopes.push({ name: 'ravensburger-wrapper', text: html.slice(wrapIdx, wrapIdx + 30000) })
  }
  for (const scope of scopes) {
    const avg = scope.text.match(/Average rating ([\d.]+) out of 5 stars/)
    const cnt = scope.text.match(/review-count[^>]*>\s*\((\d+)\)/)
    if (avg && cnt) return ratingPair(avg[1], cnt[1], scope.name)
    if (/No Reviews submitted yet/i.test(scope.text)) {
      return { rating: 0, rating_count: 0, extractor: scope.name }
    }
  }
  return null
}

// Dispatcher used by backfill-ratings-stores.mjs's HTML path.
// Returns null for platforms/hosts with no bespoke extractor —
// the caller then falls back to JSON-LD extraction.
export function extractStoreRating(platform, url, html) {
  if (!html) return null
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    /* non-URL input: platform routing only */
  }
  // Moonlite only — the projector platform also carries Little
  // Tikes Dream Machine rows, whose ratings ride the
  // Bazaarvoice spec; a thin Klaviyo pair on those pages must
  // not pre-empt it (rated rows are skipped by later passes).
  if (host.endsWith('mymoonlite.com')) {
    return extractMetafieldReviews(html, 'metafield-klaviyo')
  }
  if (platform === 'haba') {
    return extractMetafieldReviews(html) ?? extractYotpoPageVars(html)
  }
  if (platform === 'eeboo') {
    return extractMetafieldReviews(html)
  }
  if (platform === 'brio' || platform === 'ravensburger') {
    return extractRavensburgerRating(html)
  }
  return null
}
