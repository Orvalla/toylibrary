// The PATCH body for a rating found on a product page, or null when
// there is nothing honest to write. Rule 3: a rating is only stored
// with a positive integer review count behind it — never a bare
// value, and never a brand-wide aggregate.
//
// Lives in its own module (not weekly.mjs) so a test can import it:
// weekly.mjs runs main() on load.
export function ratingPatch(found) {
  if (!found || !Number.isFinite(found.rating)) return null
  if (!Number.isInteger(found.rating_count) || found.rating_count <= 0) return null
  return { rating: found.rating, rating_count: found.rating_count }
}
