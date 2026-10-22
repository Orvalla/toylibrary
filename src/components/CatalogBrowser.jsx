import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import ItemTile, { OwnedBadge } from './ItemTile'
import AmazonLink from './AmazonLink'
import GrowCatalog from './GrowCatalog'
import { PLATFORMS, platformLabel } from '../lib/platforms'
import { CATEGORIES, categoryOf } from '../lib/categories'
import BundleNote from './BundleNote'
import {
  bundleInfoFor,
  cascadeContentRows,
  indexCatalog,
  indexContents,
  ownedKeysForBucket,
  platformNoun,
} from '../lib/bundles'

// Browsable catalog of the well-known titles per platform. Parents tap
// to add instead of typing; anything already owned carries the green
// checkmark — the whole point of the app, applied at add time.
//
// Two pages share this browser: /catalog shows everything (with
// category chips — figures, books, cards, games, devices, audio) and
// /devices shows just the players themselves (catalog rows with
// item_type 'device', seeded by migration 0010).
export default function CatalogBrowser({ devicesOnly = false }) {
  const { user } = useAuth()
  const [catalog, setCatalog] = useState([])
  const [mine, setMine] = useState([])
  const [kids, setKids] = useState([])
  const [childSel, setChildSel] = useState('') // '' = Family, else a child id
  // The setup wizard links here per shelf (/catalog?platform=tonies).
  const [platform, setPlatform] = useState(
    () => new URLSearchParams(window.location.search).get('platform') ?? 'all'
  )
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [bundleRows, setBundleRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    // The catalog fetch MUST page: PostgREST caps a response at
    // 1,000 rows, and an unpaged select silently delivered only
    // the first 1,000 — 16 of 481 Tonies, 2 of 1,570 Yoto cards —
    // because the platforms' sort_order ranges interleave. The
    // id tiebreaker keeps the page order total so rows can't
    // slip between pages. (The dashboard's index fetch paginates
    // the same way; this one was missed.)
    const fetchCatalog = async () => {
      const rows = []
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase
          .from('catalog_items')
          .select('*')
          .order('sort_order')
          .order('title')
          .order('id')
          .range(from, from + 999)
        rows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      return rows
    }
    const [cat, { data: items }, { data: childRows }, { data: bundleRows }] = await Promise.all([
      fetchCatalog(),
      supabase.from('items').select('id, platform, title, list_type, child_id').eq('owner_id', user.id),
      supabase.from('children').select('*').eq('owner_id', user.id).order('sort_order').order('name'),
      supabase.from('bundle_contents').select('*'),
    ])
    setCatalog(cat ?? [])
    setMine(items ?? [])
    setKids(childRows ?? [])
    setBundleRows(bundleRows ?? [])
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

  const contentsByBundle = useMemo(() => indexContents(bundleRows), [bundleRows])
  const catalogIndex = useMemo(() => indexCatalog(catalog), [catalog])
  const bucketKeys = useMemo(
    () => ownedKeysForBucket(mine, childSel || null),
    [mine, childSel]
  )

  async function add(entry, listType) {
    setMessage('')
    const { data, error } = await supabase
      .from('items')
      .insert({
        owner_id: user.id,
        list_type: listType,
        platform: entry.platform,
        title: entry.title,
        details: entry.details,
        notes: '',
        image_url: entry.image_url ?? '',
        asin: entry.asin ?? null,
        child_id: childSel || null,
      })
      .select('id, platform, title, list_type, child_id')
      .single()
    if (error) {
      setMessage(
        error.code === '23505'
          ? `“${entry.title}” is already on that list.`
          : error.message
      )
      return
    }
    // Local state updates instead of load(): the catalog page's
    // full reload is what made dashboard mutations feel broken.
    const appended = data ? [data] : []
    // Owning a bundle means owning everything inside it: the
    // mapped contents join the have list too.
    if (listType === 'have' && entry.is_bundle) {
      const rows = cascadeContentRows({
        entry,
        contentsByBundle,
        catalogById: catalogIndex.byId,
        ownedKeys: bucketKeys,
        ownerId: user.id,
        childId: childSel || null,
      })
      let added = 0
      for (const row of rows) {
        const { data: crow, error: cerr } = await supabase
          .from('items')
          .insert(row)
          .select('id, platform, title, list_type, child_id')
          .single()
        if (!cerr) {
          added++
          if (crow) appended.push(crow)
        }
      }
      if (added > 0) {
        setMessage(
          `Added “${entry.title}” — and the ${added} ${platformNoun(entry.platform)} inside it — to the have list.`
        )
      }
    }
    if (appended.length) setMine((prev) => [...prev, ...appended])
    else load()
  }

  // Removing from the catalog grid: until now the only way off a
  // list was the dashboard's small Remove link, which nobody
  // could find from here. The row removed is the one in the
  // currently selected child's bucket — the same bucket the ✓
  // and the add buttons refer to. Removing a bundle leaves its
  // contents in place: they may be owned individually too.
  async function remove(entry, listType) {
    setMessage('')
    const target = mine.find(
      (i) =>
        i.list_type === listType &&
        key(i.child_id, i.platform, i.title) === key(childSel || null, entry.platform, entry.title)
    )
    if (!target?.id) {
      load()
      return
    }
    setMine((prev) => prev.filter((i) => i.id !== target.id))
    const { error } = await supabase.from('items').delete().eq('id', target.id)
    if (error) {
      setMessage(`Couldn't remove “${entry.title}”: ${error.message}`)
      load()
    }
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

  // The devices page is just the catalog narrowed to the players
  // themselves; rows from before migration 0010 have no item_type
  // and count as content.
  const base = devicesOnly
    ? catalog.filter((c) => c.item_type === 'device')
    : catalog
  const categoriesPresent = CATEGORIES.filter((cat) => base.some((c) => categoryOf(c) === cat))

  // Word-wise search: every word in the query must appear in the
  // title or details, but not necessarily adjacently — a raw
  // substring match missed "amelia bedelia beat the clock"
  // against "Amelia Bedelia & Friends Beat the Clock".
  const qWords = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matchesQuery = (c) =>
    qWords.every(
      (w) => c.title.toLowerCase().includes(w) || (c.details ?? '').toLowerCase().includes(w)
    )
  const visible = base.filter(
    (c) =>
      (platform === 'all' || c.platform === platform) &&
      (devicesOnly || category === 'all' || categoryOf(c) === category) &&
      (!qWords.length || matchesQuery(c))
  )
  const byPlatform = visible.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])

  return (
    <main className="page">
      {devicesOnly ? (
        <>
          <h1>The devices</h1>
          <p className="lede">
            The players themselves — a Toniebox, a Yoto Player, a LeapPad. Mark the
            ones you already own so nobody gifts you a second, or wishlist the one
            you're saving up for.
          </p>
        </>
      ) : (
        <>
          <h1>Browse the catalog</h1>
          <p className="lede">
            Tap the ones already on your shelf — a green ✓ means it's on your have list,
            so gift-givers will see it and skip it.
          </p>
        </>
      )}

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
        {PLATFORMS.filter((p) => base.some((c) => c.platform === p.key)).map((p) => (
          <button
            key={p.key}
            className={platform === p.key ? 'active' : ''}
            onClick={() => setPlatform(p.key)}
          >
            {p.emoji} {p.label}
          </button>
        ))}
      </div>

      {!devicesOnly && (
        <div className="tabs" aria-label="Category">
          <button
            className={category === 'all' ? 'active' : ''}
            onClick={() => setCategory('all')}
          >
            All categories
          </button>
          {categoriesPresent.map((cat) => (
            <button
              key={cat}
              className={category === cat ? 'active' : ''}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <input
        className="filter-input"
        placeholder={devicesOnly ? 'Search devices…' : 'Search the catalog…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {message && <p className="notice">{message}</p>}

      {visible.length === 0 && (
        <p className="empty">
          {devicesOnly
            ? 'No devices match. Try another search.'
            : 'Nothing matches. Try another search — or grow the catalog below.'}
        </p>
      )}

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
                    {entry.is_bundle &&
                      (contentsByBundle.get(entry.id)?.length ? (
                        <BundleNote
                          info={bundleInfoFor({
                            twin: entry,
                            contentsByBundle,
                            catalogById: catalogIndex.byId,
                            ownedKeys: bucketKeys,
                          })}
                          name={kids.find((k) => k.id === childSel)?.name ?? 'Family'}
                          platform={entry.platform}
                        />
                      ) : (
                        <span className="notes">📦 Bundle</span>
                      ))}
                    {owned ? (
                      <>
                        <span className="claimed-badge mine">✓ On your have list</span>
                        <button className="linklike danger" onClick={() => remove(entry, 'have')}>
                          ✕ Remove from have list
                        </button>
                      </>
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
                        {wished && (
                          <>
                            <span className="notes">Already on your wishlist</span>
                            <button
                              className="linklike danger"
                              onClick={() => remove(entry, 'wishlist')}
                            >
                              ✕ Remove from wishlist
                            </button>
                          </>
                        )}
                      </>
                    )}
                    <AmazonLink item={entry} />
                  </div>
                </ItemTile>
              )
            })}
          </div>
        </section>
      ))}

      {!devicesOnly && <GrowCatalog onAdded={handleCatalogAdded} />}
    </main>
  )
}
