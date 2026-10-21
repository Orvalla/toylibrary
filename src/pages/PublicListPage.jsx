import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import ItemTiles from '../components/ItemTiles'
import ClaimableWishlist from '../components/ClaimableWishlist'
import { groupByChild } from '../lib/children'
import { formatISODate, formatOccasionLine, occasionTitle, occasionWhen } from '../lib/occasions'

// The page gift-givers see. No login: the data comes from the
// get_shared_list() RPC, which only exposes the two lists for this slug.
// Wishlist items can be claimed anonymously (see ClaimableWishlist).
export default function PublicListPage() {
  const { slug } = useParams()
  const [data, setData] = useState(undefined) // undefined = loading, null = unavailable
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    supabase.rpc('get_shared_list', { p_slug: slug }).then(({ data, error }) => {
      setData(error ? null : data)
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
              <ClaimableWishlist slug={slug} items={s.items} onChanged={load} />
            </div>
          ))
        ) : (
          <ClaimableWishlist slug={slug} items={[]} onChanged={load} />
        )
      ) : (
        <ClaimableWishlist slug={slug} items={data.wishlist} onChanged={load} />
      )}
    </main>
  )
}
