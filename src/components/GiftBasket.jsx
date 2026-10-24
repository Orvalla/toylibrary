import { useEffect, useState } from 'react'
import GiftCart from './GiftCart'
import PlatformMark from './PlatformMark'

// The basket shell on the public share page. The basket (the
// in-app gift list — "basket", not "cart", to keep it distinct
// from the Amazon cart its buy links lead to) is always within
// reach without leaving the page:
//
// - A floating pill at the top right shows how much has been
//   added; one tap opens the basket.
// - On wide screens, once anything is in the basket, a narrow
//   rail down the right edge shows every item's picture at a
//   glance (the page makes room for it via body.basket-rail).
// - Opening it — from the pill or the rail — slides the full
//   pane over the right side of the page: pictures, claim
//   controls and buy links, with the page untouched behind it.
export default function GiftBasket({ entries, slug, liveById, onChanged, onRemove }) {
  const [open, setOpen] = useState(false)
  const count = entries.length

  // The desktop rail needs the page content shifted left so
  // it never covers tiles; the class lives on <body> because
  // the page markup is a sibling, not a child, of this shell.
  useEffect(() => {
    const railShown = count > 0 && !open
    document.body.classList.toggle('basket-rail', railShown)
    return () => document.body.classList.remove('basket-rail')
  }, [count, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open ])

  return (
    <>
      {!open && (
        <button
          className={count > 0 ? 'basket-pill has-items' : 'basket-pill'}
          onClick={() => setOpen(true)}
          aria-label={count > 0 ? `Open your basket, ${count} added` : 'Open your basket'}
        >
          🧺 Basket
          {count > 0 && <span className="basket-count">{count}</span>}
        </button>
      )}

      {!open && count > 0 && (
        <div className="basket-rail" aria-label="Your basket at a glance">
          <button className="basket-rail-head" onClick={() => setOpen(true)}>
            🧺 <span className="basket-count">{count}</span>
          </button>
          <div className="basket-rail-thumbs">
            {entries.map((entry) => (
              <button
                key={entry.id}
                className="basket-rail-thumb"
                onClick={() => setOpen(true)}
                title={entry.title}
                aria-label={`Open basket — ${entry.title}`}
              >
                {entry.image_url ? (
                  <img src={entry.image_url} alt="" loading="lazy" />
                ) : (
                  <span className="basket-rail-art" aria-hidden="true">
                    <PlatformMark platform={entry.platform} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <button className="basket-rail-open" onClick={() => setOpen(true)}>
            Open
          </button>
        </div>
      )}

      {open && (
        <div className="cart-overlay" onClick={() => setOpen(false)}>
          <GiftCart
            entries={entries}
            slug={slug}
            liveById={liveById}
            onChanged={onChanged}
            onRemove={onRemove}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  )
}
