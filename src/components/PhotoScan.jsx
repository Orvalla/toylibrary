import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { platformLabel } from '../lib/platforms'
import PlatformMark from './PlatformMark'
import { itemKey } from '../lib/bundles'
import { bestMatch } from '../lib/photoMatch'
import { fileToDataUrl } from '../lib/photoImage'
import { createBookResolver, createProductImageFetcher } from '../lib/productImage'

// "Add from a photo": a parent photographs a shelf or a pile of
// Tonies, the identify-items Edge Function (vision model) lists
// the story toys it can see, each detection is matched against
// the catalog, and the parent confirms before anything lands on
// the have list. Nothing is added without the confirm tap —
// vision guesses are good, not perfect.
export default function PhotoScan({ kids, catalogRows, items, initialChildId, onAdded }) {
  const { user } = useAuth()
  const [file, setFile] = useState(null)
  const [targetChild, setTargetChild] = useState(initialChildId ?? '')
  const [phase, setPhase] = useState('idle') // idle | scanning | review | adding | done
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [scansLeft, setScansLeft] = useState(null)

  // Unmatched detections get the product's real picture fetched
  // (store photo / book cover — see lib/productImage), never
  // the parent's own photo: tiles are shown to gift-givers.
  // Lookups start at scan time so the review list can show the
  // picture that will be used; in-flight promises are kept so
  // Add can await any still running.
  const fetchProductImage = useMemo(
    () =>
      createProductImageFetcher({
        searchStores: async (query) => {
          const { data } = await supabase.functions.invoke('ingest-catalog', {
            body: { mode: 'search', query },
          })
          return data?.results ?? []
        },
        fetchJson: async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error('picture lookup failed')
          return res.json()
        },
      }),
    []
  )
  const resolveBook = useMemo(
    () =>
      createBookResolver({
        fetchJson: async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error('book lookup failed')
          return res.json()
        },
      }),
    []
  )
  const bookLookups = useRef(new Map())
  const imageLookups = useRef(new Map())
  const lookupKey = (d) => `${d.platform}|${String(d.title ?? '').trim().toLowerCase()}`

  // The scan target follows the add form's child (which follows
  // the filter pills), same as typing an item by hand.
  useEffect(() => {
    setTargetChild(initialChildId ?? '')
  }, [initialChildId])

  const targetName = targetChild
    ? (kids.find((k) => k.id === targetChild)?.name ?? 'your child')
    : 'the family'

  // Have-list keys for the target bucket — a child bucket also
  // counts family-shared items as owned (same rule as bundles).
  const ownedHaveKeys = useMemo(() => {
    const set = new Set()
    for (const i of items) {
      if (i.list_type !== 'have') continue
      if (targetChild ? i.child_id && i.child_id !== targetChild : i.child_id) continue
      set.add(itemKey(i.platform, i.title))
    }
    return set
  }, [items, targetChild])

  async function scan() {
    if (!file) return
    setError('')
    setNote('')
    setPhase('scanning')
    let dataUrl
    try {
      dataUrl = await fileToDataUrl(file)
    } catch {
      setError('Could not read that photo file — try another one.')
      setPhase('idle')
      return
    }
    const { data, error: fnError } = await supabase.functions.invoke('identify-items', {
      body: { image: dataUrl },
    })
    if (fnError || data?.error) {
      setError(data?.error ?? 'The photo scan failed — please try again.')
      setPhase('idle')
      return
    }
    if (!data?.configured) {
      setNote('Photo scanning isn’t switched on yet — it needs a vision key added in setup.')
      setPhase('idle')
      return
    }
    if (data.limited) {
      setScansLeft(0)
      setNote(
        'That’s all 10 of today’s photo scans used. Scans free up again 24 hours after each one — try again a little later.'
      )
      setPhase('idle')
      return
    }
    if (typeof data.scansLeft === 'number') setScansLeft(data.scansLeft)
    const detections = data.items ?? []
    if (!detections.length) {
      setNote('No story toys spotted in that photo. A closer, well-lit shot works best.')
      setPhase('idle')
      return
    }
    const built = detections.map((detection) => {
      const match = bestMatch(detection, catalogRows)
      const owned = match
        ? ownedHaveKeys.has(itemKey(match.entry.platform, match.entry.title))
        : ownedHaveKeys.has(itemKey(detection.platform, detection.title))
      return { detection, match, owned, include: !owned, fetchedImage: '', resolution: null }
    })
    // Multi-shelf: review rows accumulate across scans, so a
    // whole bookcase can be worked through photo by photo.
    // A title already in the review list isn't added twice.
    setRows((prev) => {
      const seen = new Set(prev.map((r) => lookupKey(r.detection)))
      return [...prev, ...built.filter((r) => !seen.has(lookupKey(r.detection)))]
    })
    // Start the product-picture hunt for unmatched detections
    // right away; results patch into the review rows as they land.
    for (const row of built) {
      if (row.match) continue
      if (row.detection.platform === 'books') {
        // Books resolve to a real Open Library work (title,
        // author, cover) — enough to add the book to the
        // catalog itself when it's confirmed.
        const bp = resolveBook(row.detection)
        bookLookups.current.set(lookupKey(row.detection), bp)
        bp.then((resolution) => {
          if (resolution) {
            setRows((prev) =>
              prev.map((r) =>
                r.detection === row.detection
                  ? { ...r, resolution, fetchedImage: resolution.image_url }
                  : r
              )
            )
          }
        }).catch(() => {})
        continue
      }
      const p = fetchProductImage(row.detection)
      imageLookups.current.set(lookupKey(row.detection), p)
      p.then((url) => {
        if (url) {
          setRows((prev) =>
            prev.map((r) => (r.detection === row.detection ? { ...r, fetchedImage: url } : r))
          )
        }
      }).catch(() => {})
    }
    setPhase('review')
  }

  async function addSelected() {
    const chosen = rows.filter((r) => r.include && !r.owned)
    if (!chosen.length) return
    setPhase('adding')
    setError('')
    const added = []
    let skipped = 0
    for (const r of chosen) {
      // Unmatched detections use the fetched product picture
      // (await the scan-time lookup if it's still in flight).
      // Never the parent's photo — '' falls back to tile art.
      let fetchedImage = r.fetchedImage ?? ''
      if (!r.match && !fetchedImage) {
        const pending = imageLookups.current.get(lookupKey(r.detection))
        if (pending) fetchedImage = (await pending.catch(() => '')) || ''
      }
      // A resolved book that isn't in the catalog yet gets
      // catalogued first (through the ingest function's
      // guarded add), so the have-list entry is a real catalog
      // item — cover, Open Library link and all. Any failure
      // falls back to the plain unmatched add below.
      let resolution = r.resolution
      if (!r.match && !resolution && r.detection.platform === 'books') {
        const pendingBook = bookLookups.current.get(lookupKey(r.detection))
        if (pendingBook) resolution = (await pendingBook.catch(() => null)) || null
      }
      let catalogEntry = r.match?.entry ?? null
      if (!catalogEntry && resolution) {
        const { data: addData } = await supabase.functions
          .invoke('ingest-catalog', {
            body: {
              mode: 'add',
              candidate: {
                platform: 'books',
                title: resolution.title,
                details: '',
                image_url: resolution.image_url,
                source_url: resolution.work_url,
              },
            },
          })
          .catch(() => ({ data: null }))
        if (addData?.item) catalogEntry = addData.item
      }
      const payload = catalogEntry
        ? {
            owner_id: user.id,
            list_type: 'have',
            platform: catalogEntry.platform,
            title: catalogEntry.title,
            details: catalogEntry.details ?? '',
            notes: '',
            image_url: catalogEntry.image_url ?? '',
            asin: catalogEntry.asin ?? null,
            product_url: catalogEntry.product_url ?? null,
            child_id: targetChild || null,
          }
        : {
            owner_id: user.id,
            list_type: 'have',
            platform: r.detection.platform,
            title: r.detection.title,
            details: '',
            notes: 'Added from a photo',
            image_url: fetchedImage,
            child_id: targetChild || null,
          }
      const { data, error: insError } = await supabase
        .from('items')
        .insert(payload)
        .select()
        .single()
      if (insError) skipped++
      else if (data) added.push(data)
    }
    if (added.length) onAdded(added)
    setNote(
      `Added ${added.length} item${added.length === 1 ? '' : 's'} to ${targetName}’s have list.` +
        (skipped ? ` ${skipped} already there, skipped.` : '')
    )
    setRows([])
    setFile(null)
    setPhase('done')
  }

  const chosenCount = rows.filter((r) => r.include && !r.owned).length

  return (
    <section className="card scan-card" data-tour="photo">
      <h3>📸 Add from a photo</h3>
      <p className="field-help">
        Photograph a bookshelf or a pile of Tonies — we’ll read the spines and spot the
        story toys, then add the ones you confirm to the have list. Books we don’t know
        yet get looked up and added to the catalog too, and you can scan shelf after
        shelf before confirming. Up to 10 photo scans a day.
      </p>
      <div className="claim-form">
        <label className="file-pick">
          📷 Choose a photo
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              // Picking another photo must NOT clear the review
              // list — multi-shelf scanning accumulates into it.
              setFile(e.target.files?.[0] ?? null)
              setNote('')
              setError('')
            }}
          />
          {file && <span className="notes"> {file.name}</span>}
        </label>
        {kids.length > 0 && (
          <select
            value={targetChild}
            onChange={(e) => setTargetChild(e.target.value)}
            aria-label="Add photo items for"
          >
            {kids.map((kid) => (
              <option key={kid.id} value={kid.id}>
                For {kid.name}
              </option>
            ))}
            <option value="">Family / shared</option>
          </select>
        )}
        <button
          className="btn btn-small"
          onClick={scan}
          disabled={!file || phase === 'scanning'}
        >
          {phase === 'scanning' ? 'Looking…' : '🔍 Spot the toys'}
        </button>
      </div>
      {scansLeft !== null && phase !== 'review' && (
        <p className="field-help">
          {scansLeft} of today’s 10 photo scans left.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {note && <p className="notice">{note}</p>}

      {phase !== 'idle' && rows.length > 0 && (
        <>
          <ul className="scan-list">
            {rows.map((r, idx) => {
              const title = r.match ? r.match.entry.title : r.detection.title
              const platform = r.match ? r.match.entry.platform : r.detection.platform
              const img = r.match?.entry.image_url || r.fetchedImage
              return (
                <li key={idx} className="scan-row">
                  <input
                    type="checkbox"
                    checked={r.include && !r.owned}
                    disabled={r.owned || phase === 'adding'}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, include: e.target.checked } : p))
                      )
                    }
                    aria-label={`Add ${title}`}
                  />
                  {img ? (
                    <img className="scan-thumb" src={img} alt="" />
                  ) : (
                    <span className="scan-thumb scan-emoji"><PlatformMark platform={platform} /></span>
                  )}
                  <span className="scan-text">
                    <strong>{title}</strong>
                    <span className="notes">
                      {' '}
                      {platformLabel(platform)}
                      {r.match
                        ? ' · found in the catalog'
                        : r.resolution
                          ? ' · new to the catalog — will be added there too'
                          : r.fetchedImage
                            ? ' · not in the catalog — product picture found'
                            : ' · not in the catalog'}
                      {r.detection.confidence
                        ? ` · ${Math.round(r.detection.confidence * 100)}% sure`
                        : ''}
                    </span>
                    {r.owned && <span className="badge">✓ Already on the have list</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <button className="btn" onClick={addSelected} disabled={!chosenCount || phase === 'adding'}>
            {phase === 'adding'
              ? 'Adding…'
              : `Add ${chosenCount} to ${targetName}’s have list`}
          </button>
        </>
      )}
    </section>
  )
}
