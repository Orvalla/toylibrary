import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import ItemTile, { OwnedBadge } from '../components/ItemTile'
import GrowCatalog from '../components/GrowCatalog'
import { PLATFORMS, platformLabel } from '../lib/platforms'

// Browsable catalog of the well-known titles per platform. Parents tap
// to add instead of typing; anything already owned carries the green
// checkmark — the whole point of the app, applied at add time.
export default function CatalogPage() {
  const { user } = useAuth()
  const [catalog, setCatalog] = useState([])
  const [mine, setMine] = useState([])
  const [kids, setKids] = useState([])
  const [childSel, setChildSel] = useState('') // '' = Family, else a child id
  const [platform, setPlatform] = useState('all')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [{ data: cat }, { data: items }, { data: childRows }] = await Promise.all([
      supabase.from('catalog_items').select('*').order('sort_order').order('title'),
      supabase.from('items').select('platform, title, list_type, child_id').eq('owner_id', user.id),
      supabase.from('children').select('*').eq('owner_id', user.id).order('sort_order').order('name'),
    ])
    setCatalog(cat ?? [])
    setMine(items ?? [])
    setKids(childRows ?? [])
    // Default to the first child once children are known (Family if none).
    if (childRows?.length) setChildSel((prev) => prev || childRows[0].id)
    setLoading(false)
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  // Ownership is per child: a title only counts as owned (or wished)
  // for the child currently selected above — Alex having Bluey doesn't
  // mean Noah does.
  const key = (childId, platformKey, title) =>
    `${childId ?? ''}|${platformKey}|${title.trim().toLowerCase()}`
  const haveSet = useMemo(
    () =>
      new Set(
        mine.filter((i) => i.list_type === 'have').map((i) => key(i.child_id, i.platform, i.title))
      ),
    [mine]
  )
  const wishSet = useMemo(
    () =>
      new Set(
        mine
          .filter((i) => i.list_type === 'wishlist')
          .map((i) => key(i.child_id, i.platform, i.title))
      ),
    [mine]
  )

  async function add(entry, listType) {
    setMessage('')
    const { error } = await supabase.from('items').insert({
      owner_id: user.id,
      list_type: listType,
      platform: entry.platform,
      title: entry.title,
      details: entry.details,
      notes: '',
      image_url: entry.image_url ?? '',
      child_id: childSel || null,
    })
    if (error) {
      setMessage(
        error.code === '23505'
          ? `“${entry.title}” is already on that list.`
          : error.message
      )
      return
    }
    load()
  }

  // A product added via "Grow the catalog" joins the grid at once,
  // without waiting for a refetch round-trip. A bulk collection
  // import calls this with no item — too many rows to append, so
  // the grid simply refetches.
  function handleCatalogAdded(item) {
    if (!item) {
      load()
      return
    }
    setCatalog((prev) => (prev.some((c) => c.id === item.id) ? prev : [...prev, item]))
    setMessage(`“${item.title}” is now in the catalog.`)
  }

  if (loading) return <main className="page"><p>Loading the catalog…</p></main>

  const q = query.trim().toLowerCase()
  const visible = catalog.filter(
    (c) =>
      (platform === 'all' || c.platform === platform) &&
      (!q || c.title.toLowerCase().includes(q) || c.details.toLowerCase().includes(q))
  )
  const byPlatform = visible.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])

  return (
    <main className="page">
      <h1>Browse the catalog</h1>
      <p className="lede">
        Tap the ones already on your shelf — a green ✓ means it's on your have list,
        so gift-givers will see it and skip it.
      </p>

      {kids.length > 0 && (
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Adding for
            <select
              value={childSel}
              onChange={(e) => setChildSel(e.target.value)}
              aria-label="Child"
            >
              {kids.map((kid) => (
                <option key={kid.id} value={kid.id}>
                  {kid.name}
                </option>
              ))}
              <option value="">Family / shared</option>
            </select>
          </label>
        </form>
      )}

      <div className="tabs">
        <button className={platform === 'all' ? 'active' : ''} onClick={() => setPlatform('all')}>
          All
        </button>
        {PLATFORMS.filter((p) => catalog.some((c) => c.platform === p.key)).map((p) => (
          <button
            key={p.key}
            className={platform === p.key ? 'active' : ''}
            onClick={() => setPlatform(p.key)}
          >
            {p.emoji} {p.label}
          </button>
        ))}
      </div>

      <input
        className="filter-input"
        placeholder="Search the catalog…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {message && <p className="notice">{message}</p>}

      {visible.length === 0 && <p className="empty">Nothing matches. Try another search — or grow the catalog below.</p>}

      {ordered.map((pKey) => (
        <section key={pKey} className="platform-group">
          <h3>{platformLabel(pKey)}</h3>
          <div className="tile-grid">
            {byPlatform[pKey].map((entry) => {
              const owned = haveSet.has(key(childSel || null, entry.platform, entry.title))
              const wished = wishSet.has(key(childSel || null, entry.platform, entry.title))
              return (
                <ItemTile
                  key={entry.id}
                  item={entry}
                  badge={
                    owned ? (
                      <OwnedBadge />
                    ) : wished ? (
                      <span className="tile-badge">⭐ On wishlist</span>
                    ) : null
                  }
                >
                  <div className="tile-actions">
                    {owned ? (
                      <span className="claimed-badge mine">✓ On your have list</span>
                    ) : (
                      <>
                        <button className="linklike" onClick={() => add(entry, 'have')}>
                          ＋ We have it
                        </button>
                        {!wished && (
                          <button className="linklike" onClick={() => add(entry, 'wishlist')}>
                            ☆ Add to wishlist
                          </button>
                        )}
                        {wished && <span className="notes">Already on your wishlist</span>}
                      </>
                    )}
                  </div>
                </ItemTile>
              )
            })}
          </div>
        </section>
      ))}

      <GrowCatalog onAdded={handleCatalogAdded} />
    </main>
  )
}
