import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import ItemTile, { OwnedBadge } from './ItemTile'
import AmazonLink from './AmazonLink'
import ManufacturerLink from './ManufacturerLink'
import GrowCatalog from './GrowCatalog'
import { PLATFORMS, platformLabel } from '../lib/platforms'
import PlatformMark from './PlatformMark'
import { CATEGORIES, categoryOf } from '../lib/categories'
import { PROJECTOR_BRANDS, projectorBrandOf } from '../lib/projector'
import BundleNote from './BundleNote'
import PlatformGrid from './PlatformGrid'
import {
  bundleInfoFor,
  cascadeContentRows,
  indexCatalog,
  indexContents,
  itemKey,
  ownedKeysForBucket,
  platformNoun,
} from '../lib/bundles'
import { sortBySuggestions } from '../lib/recommend'
import { PAGE_SIZES, pageNumbers, pageSlice } from '../lib/paging'
import { AGE_BANDS, inAgeBand } from '../lib/ages'
import { BOOK_STAGES, bookInStage } from '../lib/books'

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
  // Sub-category inside the projector platform: Moonlite vs Dream
  // Machine (lib/projector.js). Reset whenever the platform changes.
  const [subBrand, setSubBrand] = useState('all')
  const [ageBand, setAgeBand] = useState(
    () => new URLSearchParams(window.location.search).get('age') ?? 'all'
  )
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? ''
  )
  // Reading stage, for the books platform only (lib/books) —
  // seeded by the Books page's stage tiles (?stage=ya).
  const [stage, setStage] = useState(
    () => new URLSearchParams(window.location.search).get('stage') ?? 'all'
  )
  const [sort, setSort] = useState('popular')
  // Paging (lib/paging): the catalog is 6,000+ tiles — render a
  // page at a time, with a Show-N-per-page selector.
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(48)
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

  useEffect(() => {
    setSubBrand('all')
  }, [platform])

  // Any change to what could be visible starts back at page 1.
  useEffect(() => {
    setPage(1)
  }, [platform, category, ageBand, query, sort, childSel, subBrand, stage, perPage, devicesOnly])

  // Ownership is per child: a title only counts as owned (or wished)
  // for the child currently selected above — Sam having Bluey doesn't
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
  // Platforms of the players the selected bucket owns — feeds
  // the "Suggested" sort. (A hook, so it lives up here with the
  // others, above the loading early-return.)
  const bucketDevicePlatforms = useMemo(() => {
    const platforms = new Set()
    for (const i of mine) {
      if (i.list_type !== 'have') continue
      if (i.child_id && i.child_id !== (childSel || null)) continue
      const twin = catalogIndex.byKey.get(itemKey(i.platform, i.title))
      if (twin?.item_type === 'device') platforms.add(twin.platform)
    }
    return platforms
  }, [mine, childSel, catalogIndex])

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
        product_url: entry.product_url ?? null,
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
  const projectorRows = base.filter((c) => c.platform === 'projector')
  const projectorCount = (brandKey) =>
    projectorRows.filter((c) => projectorBrandOf(c) === brandKey).length
  const visible = base.filter(
    (c) =>
      (platform === 'all' || c.platform === platform) &&
      (platform !== 'projector' || subBrand === 'all' || projectorBrandOf(c) === subBrand) &&
      (devicesOnly || category === 'all' || categoryOf(c) === category) &&
      (ageBand === 'all' || inAgeBand(c, ageBand)) &&
      (stage === 'all' || c.platform !== 'books' || bookInStage(c, stage)) &&
      (!qWords.length || matchesQuery(c))
  )

  // Sort orders. "Popular" is the catalog's own order — stores
  // list their best-sellers first and the ingest kept that, and
  // the books were ingested in ranked order. "Suggested" floats
  // up what fits the selected child: content for players they
  // own, their interests, age-fit books (lib/recommend.js).
  const selectedKid = kids.find((k) => k.id === childSel) ?? null
  const sortedVisible =
    sort === 'az'
      ? [...visible].sort((a, b) => a.title.localeCompare(b.title))
      : sort === 'za'
        ? [...visible].sort((a, b) => b.title.localeCompare(a.title))
        : sort === 'suggested'
          ? sortBySuggestions(visible, {
              child: selectedKid,
              ownedPlatforms: bucketDevicePlatforms,
            })
          : [...visible].sort(
              (a, b) =>
                (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title)
            )
  const byPlatform = sortedVisible.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])

  // Cut the section-ordered list into pages. A platform section's
  // header rides with its items and repeats when a section spans
  // two pages. safePage is the clamped page actually shown.
  const groupedFlat = ordered.flatMap((pKey) => byPlatform[pKey])
  const {
    pageItems,
    page: safePage,
    pageCount,
  } = pageSlice(groupedFlat, page, perPage)
  const pageByPlatform = pageItems.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const pageOrdered = PLATFORMS.map((p) => p.key).filter((k) => pageByPlatform[k])

  const pagerBar = () =>
    sortedVisible.length > PAGE_SIZES[0] ? (
      <nav className="pager" aria-label="Catalog pages">
        <span className="details">
          {sortedVisible.length} items · Page {safePage} of {pageCount}
        </span>
        <span className="pager-pages">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            ← Prev
          </button>
          {pageNumbers(safePage, pageCount).map((n, i) =>
            n === '…' ? (
              <span key={`gap-${i}`} className="pager-gap">
                …
              </span>
            ) : (
              <button
                type="button"
                key={n}
                className={n === safePage ? 'active' : ''}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            )
          )}
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            Next →
          </button>
        </span>
        <label className="pager-size">
          Show{' '}
          <select
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            aria-label="Items per page"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{' '}
          per page
        </label>
      </nav>
    ) : null

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
            <PlatformMark platform={p.key} /> {p.label}
          </button>
        ))}
      </div>

      {platform === 'projector' && (
        <div className="tabs" aria-label="Projector type">
          <button
            className={subBrand === 'all' ? 'active' : ''}
            onClick={() => setSubBrand('all')}
          >
            All projectors
          </button>
          {PROJECTOR_BRANDS.map((b) => (
            <button
              key={b.key}
              className={subBrand === b.key ? 'active' : ''}
              onClick={() => setSubBrand(b.key)}
            >
              {b.emoji} {b.label} ({projectorCount(b.key)})
            </button>
          ))}
        </div>
      )}

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

      {platform === 'books' && (
        <div className="tabs" aria-label="Reading stage">
          <button className={stage === 'all' ? 'active' : ''} onClick={() => setStage('all')}>
            All books
          </button>
          {BOOK_STAGES.map((s) => (
            <button
              key={s.key}
              className={stage === s.key ? 'active' : ''}
              onClick={() => setStage(s.key)}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" aria-label="Age">
        <button className={ageBand === 'all' ? 'active' : ''} onClick={() => setAgeBand('all')}>
          All ages
        </button>
        {AGE_BANDS.map((band) => (
          <button
            key={band.key}
            className={ageBand === band.key ? 'active' : ''}
            onClick={() => setAgeBand(band.key)}
          >
            {band.label}
          </button>
        ))}
      </div>

      <input
        className="filter-input"
        placeholder={devicesOnly ? 'Search devices…' : 'Search the catalog…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <label className="sort-pick">
        Sort
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="popular">🔥 Popular</option>
          <option value="suggested">
            ✨ Suggested{selectedKid ? ` for ${selectedKid.name}` : ''}
          </option>
          <option value="az">Name A–Z</option>
          <option value="za">Name Z–A</option>
        </select>
      </label>
      {message && <p className="notice">{message}</p>}

      {pagerBar()}

      {visible.length === 0 && (
        <p className="empty">
          {devicesOnly
            ? 'No devices match. Try another search.'
            : 'Nothing matches. Try another search — or grow the catalog below.'}
        </p>
      )}

      {pageOrdered.map((pKey) => (
        <section key={pKey} className="platform-group">
          <h3>{platformLabel(pKey)}</h3>
          <PlatformGrid
            platform={pKey}
            items={pageByPlatform[pKey]}
            renderItem={(entry) => {
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
                    <ManufacturerLink item={entry} />
                  </div>
                </ItemTile>
              )
            }}
          />
        </section>
      ))}

      {pagerBar()}

      {!devicesOnly && <GrowCatalog onAdded={handleCatalogAdded} />}
    </main>
  )
}
