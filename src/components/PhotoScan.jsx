import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { platformEmoji, platformLabel } from '../lib/platforms'
import { itemKey } from '../lib/bundles'
import { bestMatch } from '../lib/photoMatch'
import { fileToDataUrl } from '../lib/photoImage'

// "Add from a photo": a parent photographs a shelf or a pile of
// Tonies, the identify-items Edge Function (vision model) lists
// the story toys it can see, each detection is matched against
// the catalog, and the parent confirms before anything lands on
// the have list. Nothing is added without the confirm tap —
// vision guesses are good, not perfect.
export default function PhotoScan({ kids, catalogRows, items, initialChildId, uploadPhoto, onAdded }) {
  const { user } = useAuth()
  const [file, setFile] = useState(null)
  const [targetChild, setTargetChild] = useState(initialChildId ?? '')
  const [phase, setPhase] = useState('idle') // idle | scanning | review | adding | done
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [scansLeft, setScansLeft] = useState(null)

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
    setRows(
      detections.map((detection) => {
        const match = bestMatch(detection, catalogRows)
        const owned = match
          ? ownedHaveKeys.has(itemKey(match.entry.platform, match.entry.title))
          : ownedHaveKeys.has(itemKey(detection.platform, detection.title))
        return { detection, match, owned, include: !owned }
      })
    )
    setPhase('review')
  }

  async function addSelected() {
    const chosen = rows.filter((r) => r.include && !r.owned)
    if (!chosen.length) return
    setPhase('adding')
    setError('')
    // Unmatched detections keep the parent's own photo as their
    // picture — upload it once and share the URL.
    let photoUrl = ''
    if (chosen.some((r) => !r.match)) {
      try {
        photoUrl = await uploadPhoto(file)
      } catch {
        photoUrl = ''
      }
    }
    const added = []
    let skipped = 0
    for (const r of chosen) {
      const payload = r.match
        ? {
            owner_id: user.id,
            list_type: 'have',
            platform: r.match.entry.platform,
            title: r.match.entry.title,
            details: r.match.entry.details ?? '',
            notes: '',
            image_url: r.match.entry.image_url ?? '',
            asin: r.match.entry.asin ?? null,
            child_id: targetChild || null,
          }
        : {
            owner_id: user.id,
            list_type: 'have',
            platform: r.detection.platform,
            title: r.detection.title,
            details: '',
            notes: 'Added from a photo',
            image_url: photoUrl,
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
    <section className="card scan-card">
      <h3>📸 Add from a photo</h3>
      <p className="field-help">
        Photograph a shelf or a pile of Tonies — we’ll spot the story toys in it and add
        the ones you confirm to the have list. Up to 10 photo scans a day.
      </p>
      <div className="claim-form">
        <label className="file-pick">
          📷 Choose a photo
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setPhase('idle')
              setRows([])
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
              const img = r.match?.entry.image_url
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
                    <span className="scan-thumb scan-emoji">{platformEmoji(platform)}</span>
                  )}
                  <span className="scan-text">
                    <strong>{title}</strong>
                    <span className="notes">
                      {' '}
                      {platformLabel(platform)}
                      {r.match
                        ? ' · found in the catalog'
                        : ' · not in the catalog — added with your photo'}
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
