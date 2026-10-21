import { useState } from 'react'
import { platformEmoji } from '../lib/platforms'

// One item as a tile: photo on top (or platform art when there's no
// photo yet), title/details below, and whatever actions the parent
// page passes as children. `badge` renders as an overlay on the photo
// (the catalog uses it for the green "owned" checkmark).
export default function ItemTile({ item, badge, children }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = Boolean(item.image_url) && imgOk

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
