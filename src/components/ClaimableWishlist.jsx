import ItemTile from './ItemTile'
import AmazonLink from './AmazonLink'
import ManufacturerLink from './ManufacturerLink'
import BundleNote from './BundleNote'
import PlatformGrid from './PlatformGrid'
import { PLATFORMS, platformLabel } from '../lib/platforms'
import PlatformMark from './PlatformMark'
import { useClaim } from './useClaim'

// Wishlist tiles with anonymous claiming, for the public share
// page. The claiming mechanics live in useClaim (shared with
// the gift cart, where the same items can be claimed inline).

function WishlistTile({ slug, item, onChanged, inCart, onToggleCart }) {
  const { mine, claiming, setClaiming, name, setName, busy, note, claim, unclaim } =
    useClaim(slug, item, onChanged)

  return (
    <ItemTile
      item={item}
      badge={
        item.claimed ? (
          <span className="tile-badge">{mine ? '🎁 Yours' : '🎁 Claimed'}</span>
        ) : null
      }
    >
      <div className="tile-actions">
        <BundleNote info={item.bundle} name={item.child_name} platform={item.platform} />
        {item.claimed ? (
          mine ? (
            <>
              <span className="claimed-badge mine">🎁 You claimed this</span>
              <button className="linklike" onClick={unclaim} disabled={busy}>
                Undo claim
              </button>
            </>
          ) : (
            <span className="claimed-badge">
              🎁 Claimed{item.claimed_by ? ` by ${item.claimed_by}` : ''}
            </span>
          )
        ) : claiming ? (
          <div className="claim-form">
            <input
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <button className="btn btn-small" onClick={claim} disabled={busy}>
              {busy ? 'Claiming…' : 'Confirm claim'}
            </button>
            <button className="linklike" onClick={() => setClaiming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="linklike" onClick={() => setClaiming(true)}>
            🎁 I'll get this — claim it
          </button>
        )}
        {note && <div className="notes">{note}</div>}
        {(!item.claimed || mine) && onToggleCart && (
          <button className="linklike" onClick={() => onToggleCart(item)}>
            {inCart ? '🛒 In your cart — tap to remove' : '🛒 Add to cart'}
          </button>
        )}
        <AmazonLink item={item} />
        <ManufacturerLink item={item} />
      </div>
    </ItemTile>
  )
}

export default function ClaimableWishlist({ slug, items, onChanged, cartIds, onToggleCart }) {
  if (!items.length) return <p className="empty">No wishlist yet — ask the parents!</p>

  const byPlatform = items.reduce((acc, item) => {
    ;(acc[item.platform] ??= []).push(item)
    return acc
  }, {})

  // Keep platform sections in the canonical PLATFORMS order.
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])

  return (
    <div>
      {ordered.map((platform) => (
        <section key={platform} className="platform-group">
          <h3>
            <PlatformMark platform={platform} /> {platformLabel(platform)}
          </h3>
          <PlatformGrid
            platform={platform}
            items={byPlatform[platform]}
            renderItem={(item) => (
              <WishlistTile
                key={item.id}
                slug={slug}
                item={item}
                onChanged={onChanged}
                inCart={cartIds?.has(item.id) ?? false}
                onToggleCart={onToggleCart}
              />
            )}
          />
        </section>
      ))}
    </div>
  )
}
