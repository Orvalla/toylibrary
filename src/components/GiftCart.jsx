import { useState } from 'react'
import AmazonLink from './AmazonLink'
import { amazonUrlFor } from '../lib/amazon'
import PlatformMark from './PlatformMark'

// The gift cart drawer on the public share page. It is a list,
// not a checkout: each item keeps its own "Buy on Amazon"
// affiliate link. No prices are shown here — they live on
// Amazon.
//
// "Open all" can't literally open every tab at once: browsers
// allow only ONE new tab per tap and silently block the rest,
// which made the old button look broken (only the first item
// ever opened). So it starts a launch list instead — the
// first item opens immediately, and each remaining row turns
// into a big "Open on Amazon" button the gift-giver taps in
// turn, checking items off as they go.
export default function GiftCart({ entries, onRemove, onClose }) {
  const [launching, setLaunching] = useState(false)
  const [opened, setOpened] = useState(() => new Set())

  const openedCount = entries.filter((e) => opened.has(e.id)).length
  const allOpened = entries.length > 0 && openedCount === entries.length

  function markOpened(id) {
    setOpened((prev) => new Set(prev).add(id))
  }

  function startLaunch() {
    const [first, ...rest] = entries
    if (!first) return
    // The one tab this tap is allowed to open.
    if (window.open(amazonUrlFor(first), '_blank', 'noopener')) markOpened(first.id)
    if (rest.length) setLaunching(true)
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
        ) : launching ? (
          <>
            <p className="cart-progress" role="status">
              {allOpened
                ? 'All opened 🎉'
                : `Opening your gifts — ${openedCount} of ${entries.length} opened`}
            </p>
            <p className="cart-note">
              Browsers only allow one new tab per tap, so tap each item to open it on Amazon.
            </p>
            <ul className="cart-list">
              {entries.map((entry) => (
                <li key={entry.id} className={opened.has(entry.id) ? 'cart-row opened' : 'cart-row'}>
                  {entry.image_url ? (
                    <img className="cart-thumb" src={entry.image_url} alt="" loading="lazy" />
                  ) : (
                    <span className="cart-thumb cart-thumb-art" aria-hidden="true">
                      <PlatformMark platform={entry.platform} />
                    </span>
                  )}
                  <div className="cart-row-body">
                    <strong>{entry.title}</strong>
                    {entry.child_name && <div className="details">For {entry.child_name}</div>}
                    {opened.has(entry.id) ? (
                      <span className="action-row">
                        <span className="cart-opened-tag">✓ Opened</span>
                        <AmazonLink item={entry} />
                      </span>
                    ) : (
                      <a
                        className="btn cart-open-one"
                        href={amazonUrlFor(entry)}
                        target="_blank"
                        rel="sponsored nofollow noopener"
                        onClick={() => markOpened(entry.id)}
                      >
                        Open on Amazon ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {allOpened ? (
              <>
                <p className="cart-note">
                  Tip: claim the items you're buying on the wishlist — claiming holds them so
                  nobody else buys the same gift.
                </p>
                <button className="btn cart-buy-all" onClick={onClose}>
                  Done
                </button>
              </>
            ) : (
              <button className="linklike" onClick={() => setLaunching(false)}>
                ← Back to cart
              </button>
            )}
          </>
        ) : (
          <>
            <ul className="cart-list">
              {entries.map((entry) => (
                <li key={entry.id} className="cart-row">
                  {entry.image_url ? (
                    <img className="cart-thumb" src={entry.image_url} alt="" loading="lazy" />
                  ) : (
                    <span className="cart-thumb cart-thumb-art" aria-hidden="true">
                      <PlatformMark platform={entry.platform} />
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
            <button className="btn cart-buy-all" onClick={startLaunch}>
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
