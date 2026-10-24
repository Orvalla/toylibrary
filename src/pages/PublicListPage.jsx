import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import ItemTiles from '../components/ItemTiles'
import ClaimableWishlist from '../components/ClaimableWishlist'
import GiftCart from '../components/GiftCart'
import SuggestGift, { ApprovedGifts } from '../components/SuggestGift'
import { addToCart, cartHas, loadCart, removeFromCart, saveCart } from '../lib/cart'
import { noteSharePageVisit } from '../lib/amazon'
import { groupByChild } from '../lib/children'
import { formatISODate, formatOccasionLine, occasionTitle, occasionWhen } from '../lib/occasions'
import { defaultChildId, subscribePayload, subscribeResultMessage } from '../lib/giftSubscribe'

// The page gift-givers see. No login: the data comes from the
// get_shared_list() RPC, which only exposes the two lists for this slug.
// Wishlist items can be claimed anonymously (see ClaimableWishlist).
export default function PublicListPage({ slugOverride } = {}) {
  const { slug: routeSlug } = useParams()
  const slug = slugOverride ?? routeSlug
  const [data, setData] = useState(undefined) // undefined = loading, null = unavailable
  const [query, setQuery] = useState('')
  // The gift cart: a per-slug list in this browser's localStorage.
  // Collecting items here changes nothing on the family's lists;
  // the drawer also offers claiming inline, and claiming is what
  // holds an item against other gift-givers.
  const [cart, setCart] = useState(() => loadCart(slug))
  const [cartOpen, setCartOpen] = useState(false)

  useEffect(() => {
    saveCart(slug, cart)
  }, [slug, cart])

  const cartIds = useMemo(() => new Set(cart.map((e) => e.id)), [cart])
  // Live wishlist state by item id, so the cart drawer can show
  // (and change) each entry's claim state without a second fetch.
  const liveById = useMemo(
    () => new Map((data?.wishlist ?? []).map((i) => [i.id, i])),
    [data]
  )
  const toggleCart = (item) =>
    setCart((prev) => (cartHas(prev, item.id) ? removeFromCart(prev, item.id) : addToCart(prev, item)))

  // Approved gift proposals (0024): off-list gifts the parents
  // already said yes to, shown so nobody buys them twice.
  const [proposals, setProposals] = useState([])

  // Gift-buyer reminder signups (0034): a visitor leaves an
  // email and gets the wishlist link ahead of the child's
  // occasions. Whether one signup covers the whole family is
  // the parent's Settings choice — the page asks the RPC which
  // form to render.
  const [familyScope, setFamilyScope] = useState(false)
  const [subEmail, setSubEmail] = useState('')
  const [subChild, setSubChild] = useState(null)
  const [subState, setSubState] = useState('idle') // idle | sending | done
  const [subMsg, setSubMsg] = useState('')

  useEffect(() => {
    supabase.rpc('gift_list_family_scope', { p_slug: slug }).then(({ data }) => {
      setFamilyScope(data === true)
    })
  }, [slug])

  useEffect(() => {
    if (subChild === null) setSubChild(defaultChildId(data?.children ?? []))
  }, [data, subChild])

  async function onSubscribe(e) {
    e.preventDefault()
    setSubState('sending')
    setSubMsg('')
    const { data, error } = await supabase.rpc(
      'subscribe_gift_list',
      subscribePayload({ slug, email: subEmail, familyScope, childId: subChild }),
    )
    const code = error ? 'error' : data
    setSubMsg(
      subscribeResultMessage(code, {
        familyScope,
        childName: (data?.children ?? []).find((k) => k.id === subChild)?.name,
      }),
    )
    setSubState(code === 'ok' ? 'done' : 'idle')
  }

  const load = useCallback(() => {
    supabase.rpc('get_shared_list', { p_slug: slug }).then(({ data, error }) => {
      // An affiliate-opted-out family's list turns the tag off
      // in this browser for good (lib/amazon).
      if (!error) noteSharePageVisit(data)
      setData(error ? null : data)
    })
    supabase.rpc('get_shared_proposals', { p_slug: slug }).then(({ data }) => {
      setProposals(Array.isArray(data) ? data : [])
    })
  }, [slug])

  useEffect(load, [load])

  const owned = useMemo(() => {
    if (!data || !query.trim()) return null
    const q = query.trim().toLowerCase()
    return data.have.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.details ?? '').toLowerCase().includes(q)
    )
  }, [data, query])

  if (data === undefined) return <main className="page narrow"><p>Loading…</p></main>
  if (data === null)
    return (
      <main className="page narrow">
        <h1>This link isn't available</h1>
        <p>The family may have turned sharing off, or the link has a typo.</p>
      </main>
    )

  const name = data.child_name || 'this child'

  // Per-child grouping (RPC v5). Older responses without a children
  // array fall back to the original flat lists.
  const kids = data.children ?? []
  const grouped = kids.length > 0
  const haveSections = groupByChild(data.have, kids)
  const wishSections = groupByChild(data.wishlist, kids)
  const sectionTitle = (s) => (s.childId ? `For ${s.childName}` : 'For the whole family')

  // Occasions (RPC v6): each child's nearest upcoming one, plus the
  // single nearest across the family for the banner.
  const occByChild = new Map((data.occasions ?? []).map((o) => [o.child_id, o]))
  const next = data.next_occasion ?? null
  const occasionBadge = (childId) => {
    const occ = childId ? occByChild.get(childId) : null
    return occ ? <p className="occasion-line">🎂 {formatOccasionLine(occ)}</p> : null
  }

  return (
    <main className="page">
      <h1>
        {data.child_name ? `${data.child_name}'s` : 'Our'} toy &amp; story library
      </h1>
      <p className="lede">
        Thinking of a gift for {name}? Check here first — everything under
        “Already have it” is already on the shelf, so please don't double up.
        Picking from the wishlist? Claim it so nobody else buys the same one. 💛
      </p>

      {next && (
        <p className="occasion-banner">
          🎂 Next up: {occasionTitle(next)} — {formatISODate(next.date)} ({occasionWhen(next.days_until)})
        </p>
      )}

      {kids.length > 0 && subState !== 'done' && (
        <section className="card subscribe-card">
          <h2>📬 Never miss a birthday</h2>
          <p>
            Leave your email and we'll send you this wishlist a couple of weeks before{' '}
            {familyScope ? "each child's birthday and holidays" : "the big days"} — the
            link, a heads-up, nothing else. Unsubscribe any time.
          </p>
          <form onSubmit={onSubscribe} className="subscribe-form">
            {!familyScope && kids.length > 1 && (
              <label>
                Remind me about{' '}
                <select value={subChild ?? ''} onChange={(e) => setSubChild(e.target.value)}>
                  {kids.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={subEmail}
              onChange={(e) => setSubEmail(e.target.value)}
              aria-label="Your email"
            />
            <button className="btn btn-small" disabled={subState === 'sending'}>
              {subState === 'sending' ? 'Signing up…' : 'Remind me'}
            </button>
          </form>
          {subMsg && <p className="notice">{subMsg}</p>}
        </section>
      )}
      {subState === 'done' && <p className="notice">📬 {subMsg}</p>}

      <p>
        <button className="btn btn-small" onClick={() => setCartOpen(true)}>
          🛒 Your gift cart ({cart.length})
        </button>{' '}
        <span className="details">
          Collecting gifts for a few kids or occasions? Add wishlist items to the cart and buy
          them together on Amazon.
        </span>
      </p>
      {cartOpen && (
        <GiftCart
          entries={cart}
          slug={slug}
          liveById={liveById}
          onChanged={load}
          onRemove={(id) => setCart((prev) => removeFromCart(prev, id))}
          onClose={() => setCartOpen(false)}
        />
      )}

      <section className="check-box">
        <h2>🔍 Check before you buy</h2>
        <input
          placeholder="Type a title — e.g. “Paw Patrol” or “Caterpillar”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {owned !== null &&
          (owned.length > 0 ? (
            <p className="verdict owned">
              ⚠️ Already owned:{' '}
              {owned
                .map((i) => (i.child_name ? `“${i.title}” (on ${i.child_name}'s shelf)` : `“${i.title}”`))
                .join(', ')}{' '}
              — best pick something else.
            </p>
          ) : (
            <p className="verdict safe">
              ✅ Not on the have list — you're clear (double-check the wishlist below
              in case it's already been asked for).
            </p>
          ))}
      </section>

      <h2>🚫 Already have it — please don't buy these</h2>
      {grouped ? (
        haveSections.length ? (
          haveSections.map((s) => (
            <div key={s.childId ?? 'family'}>
              <h3>{sectionTitle(s)}</h3>
              {occasionBadge(s.childId)}
              <ItemTiles items={s.items} emptyText="Nothing logged yet." />
            </div>
          ))
        ) : (
          <p className="empty">Nothing logged yet.</p>
        )
      ) : (
        <ItemTiles items={data.have} emptyText="Nothing logged yet." />
      )}

      <h2>⭐ Wishlist — safe bets (claim yours so it isn't doubled)</h2>
      {grouped ? (
        wishSections.length ? (
          wishSections.map((s) => (
            <div key={s.childId ?? 'family'}>
              <h3>{sectionTitle(s)}</h3>
              {occasionBadge(s.childId)}
              <ClaimableWishlist slug={slug} items={s.items} onChanged={load} cartIds={cartIds} onToggleCart={toggleCart} />
            </div>
          ))
        ) : (
          <ClaimableWishlist slug={slug} items={[]} onChanged={load} cartIds={cartIds} onToggleCart={toggleCart} />
        )
      ) : (
        <ClaimableWishlist slug={slug} items={data.wishlist} onChanged={load} cartIds={cartIds} onToggleCart={toggleCart} />
      )}

      <ApprovedGifts proposals={proposals} />
      <SuggestGift slug={slug} kids={data.children ?? []} />
    </main>
  )
}
