import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import ItemTile from './ItemTile'
import AmazonLink from './AmazonLink'
import BundleNote from './BundleNote'
import { PLATFORMS, platformLabel } from '../lib/platforms'
import PlatformMark from './PlatformMark'
import { formatISODate } from '../lib/occasions'

// Wishlist tiles with anonymous claiming, for the public share page.
//
// How claiming works without gift-giver accounts:
//   claim_wishlist_item() returns a one-time token. We keep it in
//   localStorage (`claim:<itemId>`); its presence is how this browser
//   knows "I claimed this" and it's required to undo the claim.
//   Other visitors just see that the item is taken.
//   Claims also expire (the RPC returns `expires_at`): once it passes,
//   the share page treats the item as unclaimed again.

const tokenKey = (itemId) => `claim:${itemId}`

function WishlistTile({ slug, item, onChanged, inCart, onToggleCart }) {
  const [mine, setMine] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    setMine(Boolean(localStorage.getItem(tokenKey(item.id))))
  }, [item.id, item.claimed])

  async function claim() {
    setBusy(true)
    setNote('')
    const { data, error } = await supabase.rpc('claim_wishlist_item', {
      p_slug: slug,
      p_item_id: item.id,
      p_claimer_name: name.trim(),
    })
    setBusy(false)
    if (error) {
      setNote('Something went wrong — please try again.')
      return
    }
    if (data?.ok) {
      localStorage.setItem(tokenKey(item.id), data.token)
      setClaiming(false)
      // Claims expire (usually the day after the child's next
      // occasion): say how long the hold lasts so it never feels
      // arbitrary when the item opens up again.
      if (data.expires_at) {
        setNote(
          `Held for you until ${formatISODate(data.expires_at)} — after that it opens up again so the list stays current.`
        )
      }
      onChanged()
    } else if (data?.reason === 'already_claimed') {
      setNote('Someone just claimed this one — refreshing the list.')
      onChanged()
    } else {
      setNote('This item is no longer available to claim.')
    }
  }

  async function unclaim() {
    const token = localStorage.getItem(tokenKey(item.id))
    if (!token) return
    setBusy(true)
    const { data } = await supabase.rpc('unclaim_wishlist_item', {
      p_slug: slug,
      p_item_id: item.id,
      p_token: token,
    })
    setBusy(false)
    if (data?.ok) {
      localStorage.removeItem(tokenKey(item.id))
      setMine(false)
      onChanged()
    } else {
      setNote("That claim couldn't be released from this browser.")
    }
  }

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
          <div className="tile-grid">
            {byPlatform[platform].map((item) => (
              <WishlistTile
                key={item.id}
                slug={slug}
                item={item}
                onChanged={onChanged}
                inCart={cartIds?.has(item.id) ?? false}
                onToggleCart={onToggleCart}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
