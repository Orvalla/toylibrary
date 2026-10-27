import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { loadCatalog } from '../lib/catalogCache'
import { popularityIndex, sortByPopularity } from '../lib/popular'
import { inKind, kindOf } from '../lib/kinds'
import KindBar from './KindBar'
import ItemTile from './ItemTile'
import AmazonLink from './AmazonLink'
import ManufacturerLink from './ManufacturerLink'
import { PLATFORMS, platformLabel } from '../lib/platforms'
import PlatformMark from './PlatformMark'
import { CATEGORIES, categoryOf } from '../lib/categories'
import { THEMES, themesOf } from '../lib/themes'
import { CATALOG_LANGUAGES, languageLabel, languagesVisible } from '../lib/language'
import { PROJECTOR_BRANDS, isDevicesPageRow, projectorBrandOf } from '../lib/projector'
import { isSteamRow } from '../lib/steam'
import PlatformGrid from './PlatformGrid'
import { FilterGroup, FilterSection } from './FilterSection'
import { amazonUrlFor } from '../lib/amazon'
import {
  bundleInfoFor,
  indexCatalog,
  indexContents,
  platformNoun,
} from '../lib/bundles'
import { PAGE_SIZES, pageNumbers, pageSlice } from '../lib/paging'
import { AGE_BANDS, inAgeBand } from '../lib/ages'
import { BOOK_STAGES, bookInStage } from '../lib/books'

// The guest catalog (owner request 2026-10-23): the same shelves
// signed-in parents browse — same filters, search, sorts and
// paging — but read-only and open to everyone. No account, no
// child's list needed: every tile carries its shopping links
// (Amazon, the maker, used copies for books), bundle tiles lay
// out their pieces with buy links, and lists stay a sign-up
// away. Data is the public catalog read (RLS keeps hidden rows
// out) plus the bundle map, opened to anon in migration 0036.
export default function PublicCatalog({ devicesOnly = false, steamOnly = false }) {
  const focusedPage = devicesOnly || steamOnly
  const [catalog, setCatalog] = useState([])
  const [bundleRows, setBundleRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [platform, setPlatform] = useState(
    () => new URLSearchParams(window.location.search).get('platform') ?? 'all'
  )
  // The main shelf (lib/kinds), mirroring the signed-in
  // browser; the header's Board games link lands as ?kind=games.
  const [kind, setKind] = useState(
    () => new URLSearchParams(window.location.search).get('kind') ?? 'all'
  )
  const [category, setCategory] = useState('all')
  const [theme, setTheme] = useState('all')
  const [languages, setLanguages] = useState([])
  const toggleLanguage = (k) =>
    setLanguages((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    )
  const [subBrand, setSubBrand] = useState('all')
  const [ageBand, setAgeBand] = useState(
    () => new URLSearchParams(window.location.search).get('age') ?? 'all'
  )
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? ''
  )
  const [stage, setStage] = useState(
    () => new URLSearchParams(window.location.search).get('stage') ?? 'all'
  )
  const [sort, setSort] = useState('popular')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(48)
  const [sectionOpen, setSectionOpen] = useState({})

  const load = useCallback(async () => {
    // Same cached load as the signed-in browser (lib/catalogCache): render
    // on the first chunk, fill in behind a "still loading"
    // note, instead of gating on all ~18k rows.
    setCatalogLoading(true)
    let resolveFirst
    const firstChunk = new Promise((r) => (resolveFirst = r))
    const catalogDone = loadCatalog(supabase, {
      onChunk: (rows) => {
        setCatalog(rows)
        resolveFirst()
      },
    }).then(() => setCatalogLoading(false))
    const [, { data: bundles }] = await Promise.all([
      firstChunk,
      supabase.from('bundle_contents').select('*'),
    ])
    setBundleRows(bundles ?? [])
    setLoading(false)
    await catalogDone
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setSubBrand('all')
  }, [platform])

  useEffect(() => {
    setPage(1)
  }, [kind, platform, category, theme, ageBand, query, sort, subBrand, stage, perPage, devicesOnly, steamOnly])

  const sectionDefaultOpen = (id) => {
    switch (id) {
      case 'platform':
        return platform === 'all'
      case 'stage':
        return platform === 'books'
      case 'brand':
        return platform === 'projector'
      case 'age':
        return true
      case 'category':
        return platform === 'all'
      case 'theme':
        return platform === 'all'
      default:
        return false
    }
  }
  const isSectionOpen = (id) => sectionOpen[id] ?? sectionDefaultOpen(id)
  const toggleSection = (id) =>
    setSectionOpen((prev) => ({ ...prev, [id]: !isSectionOpen(id) }))
  // The folded Filters header (FilterGroup) still reports
  // what's set: the active selections, first two named.
  const activeFilters = []
  if (platform !== 'all') activeFilters.push(platformLabel(platform))
  if (platform === 'projector' && subBrand !== 'all')
    activeFilters.push(
      PROJECTOR_BRANDS.find((b) => b.key === subBrand)?.label ?? subBrand
    )
  if (!focusedPage && category !== 'all') activeFilters.push(category)
  if (!focusedPage && theme !== 'all')
    activeFilters.push(THEMES.find((t) => t.key === theme)?.label ?? theme)
  if (!focusedPage && languages.length > 0)
    activeFilters.push(
      languages.length === 1
        ? languageLabel(languages[0])
        : `${languages.length} languages`
    )
  if (platform === 'books' && stage !== 'all')
    activeFilters.push(BOOK_STAGES.find((s) => s.key === stage)?.label ?? stage)
  if (ageBand !== 'all')
    activeFilters.push(AGE_BANDS.find((b) => b.key === ageBand)?.label ?? ageBand)
  const filterSummary =
    activeFilters.length === 0
      ? 'Platform, category, age & more'
      : activeFilters.slice(0, 2).join(' · ') +
        (activeFilters.length > 2 ? ` · +${activeFilters.length - 2} more` : '')

  const contentsByBundle = useMemo(() => indexContents(bundleRows), [bundleRows])
  const catalogIndex = useMemo(() => indexCatalog(catalog), [catalog])
  const popIndex = useMemo(() => popularityIndex(catalog), [catalog])
  const themeMap = useMemo(
    () => new Map(catalog.map((c) => [c.id, themesOf(c)])),
    [catalog]
  )
  const noOwned = useMemo(() => new Set(), [])

  if (loading) return <main className="page"><p>Loading the catalog…</p></main>

  const baseAll = devicesOnly
    ? catalog.filter(isDevicesPageRow)
    : steamOnly
      ? catalog.filter(isSteamRow)
      : catalog
  const base = kind === 'all' ? baseAll : baseAll.filter((c) => inKind(c, kind))
  const kindCounts = { all: baseAll.length }
  for (const c of baseAll) {
    const k = kindOf(c)
    kindCounts[k] = (kindCounts[k] ?? 0) + 1
  }
  const pickKind = (k) => {
    setKind(k)
    setPlatform('all')
  }
  const categoriesPresent = CATEGORIES.filter((cat) => base.some((c) => categoryOf(c) === cat))
  const themeCount = (k) =>
    base.reduce((n, c) => n + ((themeMap.get(c.id) ?? []).includes(k) ? 1 : 0), 0)
  const themesPresent = THEMES.filter((t) => themeCount(t.key) > 0)
  const languageCount = (k) =>
    base.reduce((n, c) => n + ((c.language || 'en') === k ? 1 : 0), 0)
  const languagesPresent = CATALOG_LANGUAGES.filter((l) => languageCount(l.key) > 0)

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
      (focusedPage || category === 'all' || categoryOf(c) === category) &&
      (focusedPage || theme === 'all' || (themeMap.get(c.id) ?? []).includes(theme)) &&
      (focusedPage || languagesVisible(c.language, languages)) &&
      (ageBand === 'all' || inAgeBand(c, ageBand)) &&
      (stage === 'all' || c.platform !== 'books' || bookInStage(c, stage)) &&
      (!qWords.length || matchesQuery(c))
  )

  // The default sort is the unified popularity score
  // (lib/popular.js — same metric as the signed-in browser).
  const sortedVisible =
    sort === 'az'
      ? [...visible].sort((a, b) => a.title.localeCompare(b.title))
      : sort === 'za'
        ? [...visible].sort((a, b) => b.title.localeCompare(a.title))
        : sortByPopularity(visible, popIndex)
  const byPlatform = sortedVisible.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])
  // Popular — the default here — is the catalog's own ranked
  // order, so it pages flat like the signed-in browser's
  // ranked sorts (see CatalogBrowser): regrouping into brand
  // sections renders them in fixed registry order and buries
  // the ranking, opening the Everything shelf with page after
  // page of a single brand. A–Z / Z–A keep the sections.
  const flatList = sort === 'popular'
  const groupedFlat = flatList ? sortedVisible : ordered.flatMap((pKey) => byPlatform[pKey])
  const { pageItems, page: safePage, pageCount } = pageSlice(groupedFlat, page, perPage)
  const pageByPlatform = pageItems.reduce((acc, c) => {
    ;(acc[c.platform] ??= []).push(c)
    return acc
  }, {})
  const pageOrdered = PLATFORMS.map((p) => p.key).filter((k) => pageByPlatform[k])
  const pageSections = flatList
    ? [{ key: '__flat', label: null, platform: 'flat', items: pageItems }]
    : pageOrdered.map((pKey) => ({
        key: pKey,
        label: platformLabel(pKey),
        platform: pKey,
        items: pageByPlatform[pKey],
      }))

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
      {catalogLoading && (
        <p className="notice" role="status">
          Loading the rest of the catalog…
        </p>
      )}
      {devicesOnly ? (
        <>
          <h1>The devices</h1>
          <p className="lede">
            The players themselves — a Toniebox, a Yoto Player, a LeapPad — plus
            every story collection for the storybook projectors, with the links to
            buy each one. No account needed to look around.
          </p>
        </>
      ) : steamOnly ? (
        <>
          <h1>STEAM Toys</h1>
          <p className="lede">
            Science, technology, engineering, art and maths — electronics kits,
            robots, experiments and building sets from the makers themselves,
            with the links to buy each one. No account needed to look around.
          </p>
        </>
      ) : (
        <>
          <h1>Browse the catalog</h1>
          <p className="lede">
            Every shelf, open to everyone — shop any title right from its tile.
            No account needed to browse or buy.
          </p>
        </>
      )}

      {!focusedPage && <KindBar counts={kindCounts} value={kind} onChange={pickKind} />}

      <section className="card guest-banner">
        <p>
          👀 <strong>Browsing as a guest.</strong> Want a have-list and wishlist for
          your own kids — plus a gift link relatives can check before they buy?{' '}
          <Link to="/signup" className="btn btn-small">
            Sign up free
          </Link>{' '}
          <Link to="/login" className="linklike">
            Log in
          </Link>
        </p>
      </section>

      <FilterGroup
        label="Filters"
        summary={filterSummary}
        badge={activeFilters.length > 0 ? `${activeFilters.length} active` : null}
      >
      <FilterSection
        id="platform"
        label="Platform"
        summary={platform === 'all' ? 'All platforms' : platformLabel(platform)}
        open={isSectionOpen('platform')}
        onToggle={toggleSection}
      >
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
      </FilterSection>

      {platform === 'projector' && (
        <FilterSection
          id="brand"
          label="Projector type"
          summary={
            subBrand === 'all'
              ? 'All projectors'
              : (PROJECTOR_BRANDS.find((b) => b.key === subBrand)?.label ?? 'All projectors')
          }
          open={isSectionOpen('brand')}
          onToggle={toggleSection}
        >
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
        </FilterSection>
      )}

      {!focusedPage && (
        <FilterSection
          id="category"
          label="Category"
          summary={category === 'all' ? 'All categories' : category}
          open={isSectionOpen('category')}
          onToggle={toggleSection}
        >
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
        </FilterSection>
      )}

      {!focusedPage && (
        <FilterSection
          id="theme"
          label="Shop by interest"
          summary={
            theme === 'all'
              ? 'All interests'
              : (THEMES.find((t) => t.key === theme)?.label ?? 'All interests')
          }
          open={isSectionOpen('theme')}
          onToggle={toggleSection}
        >
          <div className="tabs" aria-label="Shop by interest">
            <button
              className={theme === 'all' ? 'active' : ''}
              onClick={() => setTheme('all')}
            >
              All interests
            </button>
            {themesPresent.map((t) => (
              <button
                key={t.key}
                className={theme === t.key ? 'active' : ''}
                onClick={() => setTheme(t.key)}
              >
                {t.emoji} {t.label} ({themeCount(t.key)})
              </button>
            ))}
          </div>
        </FilterSection>
      )}

      {!focusedPage && languagesPresent.length > 1 && (
        <FilterSection
          id="language"
          label="Language"
          summary={
            languages.length === 0
              ? 'All languages'
              : languages.length === 1
                ? languageLabel(languages[0])
                : `${languages.length} languages`
          }
          open={isSectionOpen('language')}
          onToggle={toggleSection}
        >
          <div className="tabs" aria-label="Language">
            <button
              className={languages.length === 0 ? 'active' : ''}
              onClick={() => setLanguages([])}
            >
              All languages
            </button>
            {languagesPresent.map((l) => (
              <button
                key={l.key}
                className={languages.includes(l.key) ? 'active' : ''}
                onClick={() => toggleLanguage(l.key)}
                aria-pressed={languages.includes(l.key)}
              >
                {l.flag} {l.label} ({languageCount(l.key)})
              </button>
            ))}
          </div>
        </FilterSection>
      )}

      {platform === 'books' && (
        <FilterSection
          id="stage"
          label="Reading stage"
          summary={
            stage === 'all'
              ? 'All books'
              : (BOOK_STAGES.find((s) => s.key === stage)?.label ?? 'All books')
          }
          open={isSectionOpen('stage')}
          onToggle={toggleSection}
        >
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
        </FilterSection>
      )}

      <FilterSection
        id="age"
        label="Age"
        summary={
          ageBand === 'all'
            ? 'All ages'
            : (AGE_BANDS.find((b) => b.key === ageBand)?.label ?? 'All ages')
        }
        open={isSectionOpen('age')}
        onToggle={toggleSection}
      >
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
      </FilterSection>
      </FilterGroup>

      <input
        className="filter-input"
        placeholder={devicesOnly ? 'Search devices…' : steamOnly ? 'Search STEAM toys…' : 'Search the catalog…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <label className="sort-pick">
        Sort
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="popular">🔥 Popular</option>
          <option value="az">Name A–Z</option>
          <option value="za">Name Z–A</option>
        </select>
      </label>

      {pagerBar()}

      {visible.length === 0 && (
        <p className="empty">
          {devicesOnly ? 'No devices match. Try another search.' : steamOnly ? 'No STEAM toys match. Try another search.' : 'Nothing matches. Try another search.'}
        </p>
      )}

      {pageSections.map((sec) => (
        <section key={sec.key} className="platform-group">
          {sec.label && <h3>{sec.label}</h3>}
          <PlatformGrid
            platform={sec.platform}
            items={sec.items}
            renderItem={(entry) => {
              const info = entry.is_bundle
                ? bundleInfoFor({
                    twin: entry,
                    contentsByBundle,
                    catalogById: catalogIndex.byId,
                    ownedKeys: noOwned,
                  })
                : null
              return (
                <ItemTile key={entry.id} item={entry}>
                  <div className="tile-actions">
                    {entry.is_bundle &&
                      (info?.total ? (
                        <div className="bundle-note">
                          <p className="bundle-line">
                            🧺 Bundle of {info.total} {platformNoun(entry.platform)} — buy
                            the set above, or just a piece:
                          </p>
                          <p className="bundle-missing">
                            {info.missing.map((m, i) => (
                              <span key={`${m.platform}-${m.title}`}>
                                {i > 0 && ' · '}
                                <a
                                  href={amazonUrlFor(m)}
                                  target="_blank"
                                  rel="sponsored nofollow noopener"
                                >
                                  {m.title} ↗
                                </a>
                              </span>
                            ))}
                          </p>
                        </div>
                      ) : (
                        <span className="notes">📦 Bundle</span>
                      ))}
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
    </main>
  )
}
