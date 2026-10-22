import { useState } from 'react'
import { platformEmoji } from '../lib/platforms'
import { ageLabelFor } from '../lib/ages'

// One item as a tile: photo on top (or platform art when there's no
// photo yet), title/details below, and whatever actions the parent
// page passes as children. `badge` renders as an overlay on the photo
// (the catalog uses it for the green "owned" checkmark).
export default function ItemTile({ item, badge, children }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = Boolean(item.image_url) && imgOk
  // Ratings come from the catalog row (Open Library for books,
  // the store's own JSON-LD for products — migration 0017).
  // Both halves are required: a bare average with no count
  // behind it isn't evidence of anything.
  const rating = Number(item.rating)
  const ratingCount = Number(item.rating_count)
  const showRating = Number.isFinite(rating) && rating > 0 && Number.isFinite(ratingCount) && ratingCount > 0

  return (
    <article className={`tile tile-${item.platform}`}>
      <div className="tile-media">
        {showImg ? (
          <img src={item.image_url} alt={item.title} loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <div className="tile-art" aria-hidden="true">
            <span>{platformEmoji(item.platform)}</span>
          </div>
        )}
        {badge}
      </div>
      <div className="tile-body">
        <strong>{item.title}</strong>
        {item.details && <div className="details">{item.details}</div>}
        {showRating && (
          <div
            className="notes"
            aria-label={`Rated ${rating.toFixed(1)} out of 5 from ${ratingCount} ratings`}
          >
            ★ {rating.toFixed(1)} ({ratingCount.toLocaleString('en-US')})
          </div>
        )}
        {ageLabelFor(item) && <div className="notes">🎂 {ageLabelFor(item)}</div>}
        {item.notes && <div className="notes">{item.notes}</div>}
        {children}
      </div>
    </article>
  )
}

// The green checkmark shown on catalog tiles (and anywhere else) for
// items already on the family's have list.
export function OwnedBadge() {
  return (
    <span className="owned-check" role="img" aria-label="Already owned" title="Already owned">
      ✓
    </span>
  )
}
