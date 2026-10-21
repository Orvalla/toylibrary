import { useState } from 'react'
import { supabase } from '../supabaseClient'
import ItemTile from './ItemTile'
import { platformLabel } from '../lib/platforms'

// "Grow the catalog": the shared catalog used to be stocked only by
// the offline ingestor, so a title it hadn't picked up was simply
// missing. Parents can now add products themselves, two ways:
//
//  * Search stores — asks the known Shopify stores (Tonies, Yoto,
//    Storypod, Osmo, Moonlite, Little Tikes) for matches via the
//    ingest-catalog Edge Function, then one tap adds a result.
//  * Paste a link — the function fetches the page server-side and
//    adds what it points at: a product page adds that product; a
//    collection page (e.g. a Tonies collection) adds everything in
//    it at once, minus the store's bundles/players/extras, and the
//    outcome below reports the tally.
//
// All writes happen in the function (service role, caller JWT
// checked); this component only invokes it and renders the outcome.
export default function GrowCatalog({ onAdded }) {
  const [tab, setTab] = useState('search')
  const [error, setError] = useState('')

  // Search tab state. `results === null` means "haven't searched yet".
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [addStates, setAddStates] = useState({}) // candidate key -> adding|added|exists

  // Link tab state. `outcome` is the function's response: either
  // { status: 'added'|'exists', item } for a product link, or
  // { status: 'collection', platform, total_found, added,
  //   already_present, skipped_filtered } for a collection link.
  const [url, setUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [outcome, setOutcome] = useState(null)

  const candidateKey = (c) => `${c.platform}|${c.title.trim().toLowerCase()}`

  // The function answers failures as { error: 'plain message' } with a
  // non-2xx status; supabase-js surfaces that as an error whose
  // context is the raw response, so dig the message back out.
  async function invoke(body) {
    const { data, error: fnError } = await supabase.functions.invoke('ingest-catalog', { body })
    if (fnError) {
      let message = 'Something went wrong — try again.'
      try {
        const payload = await fnError.context?.json()
        if (payload?.error) message = payload.error
      } catch {
        // Keep the generic message.
      }
      throw new Error(message)
    }
    if (data?.error) throw new Error(data.error)
    return data
  }

  async function doSearch(e) {
    e.preventDefault()
    setError('')
    setSearching(true)
    setResults(null)
    try {
      const data = await invoke({ mode: 'search', query })
      setResults(data.results ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  async function addCandidate(candidate) {
    const key = candidateKey(candidate)
    setError('')
    setAddStates((s) => ({ ...s, [key]: 'adding' }))
    try {
      const data = await invoke({ mode: 'add', candidate })
      setAddStates((s) => ({ ...s, [key]: data.status }))
      if (data.status === 'added') onAdded?.(data.item)
    } catch (err) {
      setAddStates((s) => ({ ...s, [key]: undefined }))
      setError(err.message)
    }
  }

  async function addFromLink(e) {
    e.preventDefault()
    setError('')
    setOutcome(null)
    setAddingLink(true)
    try {
      const data = await invoke({ mode: 'url', url })
      setOutcome(data)
      if (data.status === 'added') onAdded?.(data.item)
      // A bulk import adds too many rows to hand up one by one —
      // the parent refetches the grid instead.
      if (data.status === 'collection' && data.added > 0) onAdded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingLink(false)
    }
  }

  return (
    <section className="grow-catalog">
      <h2>Can't find a product? Grow the catalog</h2>
      <p className="lede">
        If a title isn't listed above yet, add it for everyone — search the stores we
        track, or paste a link to the product page.
      </p>

      <div className="tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          Search stores
        </button>
        <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>
          Paste a link
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {tab === 'search' && (
        <>
          <form className="form inline-form" onSubmit={doSearch}>
            <input
              placeholder="e.g. Bluey, Gruffalo, detective…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the stores"
            />
            <button className="btn" type="submit" disabled={searching || !query.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          <p className="notes">
            Searches the Tonies, Yoto, Storypod, Osmo, Moonlite and Little Tikes stores.
          </p>

          {results !== null && results.length === 0 && (
            <p className="empty">
              No matches in those stores. Try the "Paste a link" tab with the product
              page instead.
            </p>
          )}
          {results !== null && results.length > 0 && (
            <div className="tile-grid">
              {results.map((candidate) => {
                const state = addStates[candidateKey(candidate)]
                return (
                  <ItemTile key={candidateKey(candidate)} item={candidate}>
                    <div className="tile-actions">
                      <span className="notes">{platformLabel(candidate.platform)}</span>
                      {state === 'added' ? (
                        <span className="claimed-badge mine">✓ In the catalog</span>
                      ) : state === 'exists' ? (
                        <span className="claimed-badge mine">Already in the catalog ✓</span>
                      ) : (
                        <button
                          className="linklike"
                          disabled={state === 'adding'}
                          onClick={() => addCandidate(candidate)}
                        >
                          {state === 'adding' ? 'Adding…' : '＋ Add to catalog'}
                        </button>
                      )}
                    </div>
                  </ItemTile>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'link' && (
        <>
          <form className="form inline-form" onSubmit={addFromLink}>
            <input
              placeholder="https://… product or collection link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Product or collection link"
              inputMode="url"
            />
            <button className="btn" type="submit" disabled={addingLink || !url.trim()}>
              {addingLink ? 'Adding…' : 'Add from link'}
            </button>
          </form>
          <p className="notes">
            Paste a product link — or a whole collection link (like a Tonies
            collection page) to add everything in it at once.
          </p>

          {outcome && outcome.status === 'collection' && (
            <p className="notice">
              Added {outcome.added} new {platformLabel(outcome.platform)} ·{' '}
              {outcome.already_present} already in the catalog
              {outcome.skipped_filtered > 0 &&
                ` · ${outcome.skipped_filtered} skipped (bundles & accessories)`}
            </p>
          )}

          {outcome && outcome.status !== 'collection' && (
            <>
              <p className="notice">
                {outcome.status === 'added'
                  ? `“${outcome.item.title}” is now in the catalog — thanks!`
                  : `“${outcome.item.title}” is already in the catalog ✓`}
              </p>
              <div className="tile-grid">
                <ItemTile item={outcome.item}>
                  <div className="tile-actions">
                    <span className="notes">{platformLabel(outcome.item.platform)}</span>
                  </div>
                </ItemTile>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
