import AmazonLink from './AmazonLink'
import { amazonUrlFor } from '../lib/amazon'
import { platformEmoji } from '../lib/platforms'

// The gift cart drawer on the public share page. It is a list,
// not a checkout: each item keeps its own "Buy on Amazon"
// affiliate link, and "Open all" just opens those pages. No
// prices are shown here — they live on Amazon.
export default function GiftCart({ entries, onRemove, onClose }) {
  function buyAll() {
    for (const entry of entries) {
      window.open(amazonUrlFor(entry), '_blank', 'noopener')
    }
  }

  return (
    <div className="cart-overlay" onClick={onClose}>
      <aside className="cart-panel" onClick={(e) => e.stopPropagation()} aria-label="Gift cart">
        <div className="cart-head">
          <h2>🛒 Your gift cart</h2>
          <button className="linklike" onClick={onClose}>
            Close ✕
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="empty">
            Nothing here yet. Tap “Add to cart” on any wishlist item and it will wait for you
            here — handy when you're picking gifts for more than one occasion.
          </p>
        ) : (
          <>
            <ul className="cart-list">
              {entries.map((entry) => (
                <li key={entry.id} className="cart-row">
                  {entry.image_url ? (
                    <img className="cart-thumb" src={entry.image_url} alt="" loading="lazy" />
                  ) : (
                    <span className="cart-thumb cart-thumb-art" aria-hidden="true">
                      {platformEmoji(entry.platform)}
                    </span>
                  )}
                  <div className="cart-row-body">
                    <strong>{entry.title}</strong>
                    {entry.child_name && <div className="details">For {entry.child_name}</div>}
                    <span className="action-row">
                      <AmazonLink item={entry} />
                      <button className="linklike danger" onClick={() => onRemove(entry.id)}>
                        Remove
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn cart-buy-all" onClick={buyAll}>
              Open all {entries.length} on Amazon ↗
            </button>
            <p className="cart-note">
              Prices and delivery are shown on Amazon. Tip: if you haven't already, claim the
              items you're buying on the wishlist — claiming holds them so nobody else buys the
              same gift.
            </p>
          </>
        )}
      </aside>
    </div>
  )
}
