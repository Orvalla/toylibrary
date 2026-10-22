import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import ItemTile from '../components/ItemTile'
import AmazonLink from '../components/AmazonLink'
import { PLATFORMS, platformEmoji, platformLabel } from '../lib/platforms'
import { childNameFor } from '../lib/children'
import { formatOccasionLine, nearestOccasion } from '../lib/occasions'
import BundleNote from '../components/BundleNote'
import {
  bundleInfoFor,
  indexCatalog,
  indexContents,
  itemKey,
  ownedKeysForBucket,
} from '../lib/bundles'
import { recommendForChild } from '../lib/recommend'

// The catalog is several thousand rows — page through it so the
// bundle lookup below sees every row, not just the first page.
async function fetchCatalogIndex() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('catalog_items')
      .select('id, platform, title, details, image_url, asin, is_bundle, item_type, sort_order')
      .range(from, from + 999)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

// child_id '' in a form means Family (stored as NULL in the database).
const EMPTY_FORM = { platform: 'tonies', title: '', details: '', notes: '', image_url: '', child_id: '' }

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [items, setItems] = useState([])
  const [kids, setKids] = useState([])
  const [occasions, setOccasions] = useState([])
  const [childFilter, setChildFilter] = useState('all') // 'all' | 'family' | child id
  const [formChildTouched, setFormChildTouched] = useState(false)
  const [tab, setTab] = useState('have')
  const [form, setForm] = useState(EMPTY_FORM)
  const [photoFile, setPhotoFile] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [catalogRows, setCatalogRows] = useState([])
  const [bundleRows, setBundleRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [
      { data: prof },
      { data: rows },
      { data: childRows },
      { data: occRows },
      { data: bcRows },
      catRows,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('items')
        .select('*')
        .eq('owner_id', user.id)
        .order('platform')
        .order('title'),
      supabase
        .from('children')
        .select('*')
        .eq('owner_id', user.id)
        .order('sort_order')
        .order('name'),
      // RLS scopes occasions to this parent's children.
      supabase.from('occasions').select('*'),
      supabase.from('bundle_contents').select('*'),
      fetchCatalogIndex(),
    ])
    setProfile(prof)
    setItems(rows ?? [])
    setKids(childRows ?? [])
    setOccasions(occRows ?? [])
    setBundleRows(bcRows ?? [])
    setCatalogRows(catRows ?? [])
    setLoading(false)
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  // New families land in the setup questionnaire first.
  useEffect(() => {
    if (profile && !profile.onboarded_at) navigate('/welcome', { replace: true })
  }, [profile, navigate])

  // Until the parent picks otherwise, new items default to the first
  // child (or Family when there are no children yet).
  useEffect(() => {
    if (!formChildTouched && kids.length) {
      setForm((f) => ({ ...f, child_id: kids[0].id }))
    }
  }, [kids, formChildTouched])

  // Picking a filter pill also aims the add form at the same child, so
  // "filter to Alex, add three Tonies" doesn't need the dropdown touched.
  function selectChildFilter(value) {
    setChildFilter(value)
    setFormChildTouched(true)
    setForm((f) => ({
      ...f,
      child_id: value === 'family' ? '' : value === 'all' ? kids[0]?.id ?? '' : value,
    }))
  }

  // Uploads a photo to the item-images bucket under the user's own
  // folder (the storage RLS policies require that prefix) and returns
  // its public URL.
  async function uploadPhoto(file) {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('item-images').upload(path, file)
    if (error) throw error
    return supabase.storage.from('item-images').getPublicUrl(path).data.publicUrl
  }

  async function addItem(e) {
    e.preventDefault()
    setMessage('')
    let imageUrl = form.image_url.trim()
    try {
      if (photoFile) imageUrl = await uploadPhoto(photoFile)
    } catch (err) {
      setMessage(`Photo upload failed: ${err.message}`)
      return
    }
    const { data, error } = await supabase
      .from('items')
      .insert({
        owner_id: user.id,
        list_type: tab,
        platform: form.platform,
        title: form.title.trim(),
        details: form.details.trim(),
        notes: form.notes.trim(),
        image_url: imageUrl,
        child_id: form.child_id || null,
      })
      .select()
      .single()
    if (error) {
      // The unique index items_no_duplicates_idx is the last line of defence
      // against the exact problem this app solves.
      setMessage(
        error.code === '23505'
          ? `“${form.title}” is already on your ${tab === 'have' ? 'have' : 'wish'} list for that platform.`
          : error.message
      )
      return
    }
    // Keep the child selection — parents usually add several in a row
    // for the same kid.
    setForm((f) => ({ ...EMPTY_FORM, child_id: f.child_id }))
    setPhotoFile(null)
    // Append the new row locally instead of load(): a full reload
    // re-pages the whole catalog index and takes seconds, which
    // made every mutation look like it hadn't happened.
    if (data) setItems((prev) => [...prev, data])
  }

  async function removeItem(item) {
    setMessage('')
    // Optimistic: drop the tile immediately, then delete. Rolling
    // back through load() only if the delete actually failed.
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    const { error } = await supabase.from('items').delete().eq('id', item.id)
    if (error) {
      setMessage(`Couldn't remove “${item.title}”: ${error.message}`)
      load()
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditForm({
      platform: item.platform,
      title: item.title,
      details: item.details,
      notes: item.notes,
      image_url: item.image_url ?? '',
      child_id: item.child_id ?? '',
    })
    setMessage('')
  }

  async function saveEdit(item) {
    const { error } = await supabase
      .from('items')
      .update({
        platform: editForm.platform,
        title: editForm.title.trim(),
        details: editForm.details.trim(),
        notes: editForm.notes.trim(),
        image_url: editForm.image_url.trim(),
        child_id: editForm.child_id || null,
      })
      .eq('id', item.id)
    if (error) {
      setMessage(
        error.code === '23505'
          ? `That would duplicate another item on this list — “${editForm.title}” is already there for that platform.`
          : error.message
      )
      return
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              platform: editForm.platform,
              title: editForm.title.trim(),
              details: editForm.details.trim(),
              notes: editForm.notes.trim(),
              image_url: editForm.image_url.trim(),
              child_id: editForm.child_id || null,
            }
          : i,
      ),
    )
    setEditingId(null)
  }

  // The post-holiday flow: a wishlist item was gifted, so it moves to
  // "have" — where it now blocks future duplicates.
  async function markReceived(item) {
    setMessage('')
    const { error } = await supabase
      .from('items')
      .update({ list_type: 'have', claimed_at: null, claimed_by_name: '', claim_token_hash: null })
      .eq('id', item.id)
    if (error) {
      setMessage(
        error.code === '23505'
          ? `You already have “${item.title}” on that platform — removing it from the wishlist instead would clear the clash.`
          : error.message
      )
      return
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, list_type: 'have', claimed_at: null, claimed_by_name: '', claim_token_hash: null }
          : i,
      ),
    )
  }

  async function toggleSharing(enabled) {
    await supabase.from('profiles').update({ share_enabled: enabled }).eq('id', user.id)
    setProfile((p) => (p ? { ...p, share_enabled: enabled } : p))
  }

  const catalogIndex = useMemo(() => indexCatalog(catalogRows), [catalogRows])
  const contentsByBundle = useMemo(() => indexContents(bundleRows), [bundleRows])

  if (loading) return <main className="page"><p>Loading your library…</p></main>
  if (!profile) return <main className="page"><p>We couldn't load your profile. Try refreshing.</p></main>

  const shareUrl = `${window.location.origin}/s/${profile.share_slug}`
  const q = filter.trim().toLowerCase()
  const visible = items.filter(
    (i) =>
      i.list_type === tab &&
      (childFilter === 'all' ||
        (childFilter === 'family' ? !i.child_id : i.child_id === childFilter)) &&
      (!q ||
        i.title.toLowerCase().includes(q) ||
        i.details.toLowerCase().includes(q) ||
        i.notes.toLowerCase().includes(q))
  )
  const byPlatform = visible.reduce((acc, item) => {
    ;(acc[item.platform] ??= []).push(item)
    return acc
  }, {})
  const orderedPlatforms = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])
  const editingItem = items.find((i) => i.id === editingId)

  // When the list is filtered to one child, surface their next
  // occasion — handy context for what's about to be gifted (and when
  // wishlist claims on their items will release).
  const filteredKid = kids.find((k) => k.id === childFilter)
  const nextForKid = filteredKid
    ? nearestOccasion(occasions.filter((o) => o.child_id === filteredKid.id))
    : null

  // Tailored gift ideas for the filtered child: content for the
  // devices they have, matched to their interests and age.
  const recs = filteredKid
    ? recommendForChild({
        catalog: catalogRows,
        child: filteredKid,
        ownedPlatforms: new Set(
          items
            .filter(
              (i) =>
                i.list_type === 'have' &&
                (i.child_id === filteredKid.id || !i.child_id)
            )
            .map((i) => catalogIndex.byKey.get(itemKey(i.platform, i.title)))
            .filter((t) => t?.item_type === 'device')
            .map((t) => t.platform)
        ),
        ownedKeys: ownedKeysForBucket(items, filteredKid.id),
        wishlistKeys: new Set(
          items
            .filter(
              (i) =>
                i.list_type === 'wishlist' &&
                (i.child_id === filteredKid.id || !i.child_id)
            )
            .map((i) => itemKey(i.platform, i.title))
        ),
        limit: 8,
      })
    : []

  async function addToWishlist(entry) {
    setMessage('')
    const { data, error } = await supabase
      .from('items')
      .insert({
        owner_id: user.id,
        list_type: 'wishlist',
        platform: entry.platform,
        title: entry.title,
        details: entry.details ?? '',
        notes: '',
        image_url: entry.image_url ?? '',
        asin: entry.asin ?? null,
        child_id: filteredKid.id,
      })
      .select()
      .single()
    if (error) {
      setMessage(error.code === '23505' ? `“${entry.title}” is already on a list.` : error.message)
      return
    }
    if (data) setItems((prev) => [...prev, data])
  }

  return (
    <main className="page">
      <h1>{profile.child_name ? `${profile.child_name}'s library` : 'My library'}</h1>

      <section className="share-box">
        <div>
          <strong>Your gift-giver link</strong>
          <div className="share-url">{shareUrl}</div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={profile.share_enabled}
              onChange={(e) => toggleSharing(e.target.checked)}
            />{' '}
            Sharing is {profile.share_enabled ? 'on' : 'off'}
          </label>
        </div>
        <button
          className="btn btn-small"
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </section>

      <p className="catalog-cta">
        Building your list? <Link to="/catalog">Browse the catalog</Link> and tap to add the
        ones you own — faster than typing.
      </p>

      <div className="tabs">
        <button className={tab === 'have' ? 'active' : ''} onClick={() => setTab('have')}>
          ✅ We have it ({items.filter((i) => i.list_type === 'have').length})
        </button>
        <button className={tab === 'wishlist' ? 'active' : ''} onClick={() => setTab('wishlist')}>
          ⭐ Wishlist ({items.filter((i) => i.list_type === 'wishlist').length})
        </button>
      </div>

      {kids.length > 0 && (
        <div className="tabs child-tabs">
          <button className={childFilter === 'all' ? 'active' : ''} onClick={() => selectChildFilter('all')}>
            Everyone
          </button>
          {kids.map((kid) => (
            <button
              key={kid.id}
              className={childFilter === kid.id ? 'active' : ''}
              onClick={() => selectChildFilter(kid.id)}
            >
              {kid.name}
            </button>
          ))}
          <button className={childFilter === 'family' ? 'active' : ''} onClick={() => selectChildFilter('family')}>
            Family
          </button>
        </div>
      )}

      {nextForKid && (
        <p className="occasion-line">
          🎂 {formatOccasionLine({ ...nextForKid, childName: filteredKid.name })}
        </p>
      )}

      {filteredKid && recs.length > 0 && (
        <section className="card recs-card">
          <h3>🎁 Gift ideas for {filteredKid.name}</h3>
          <p className="field-help">
            Based on the players {filteredKid.name} has and what they're into. Add one to
            the wishlist and it shows up on the gift-giver page.
          </p>
          <div className="tile-grid">
            {recs.map((entry) => (
              <ItemTile key={entry.id} item={entry}>
                <div className="tile-actions">
                  <button className="linklike" onClick={() => addToWishlist(entry)}>
                    ☆ Add to wishlist
                  </button>
                  <AmazonLink item={entry} />
                </div>
              </ItemTile>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={addItem} className="form inline-form">
        <select
          value={form.platform}
          onChange={(e) => setForm({ ...form, platform: e.target.value })}
          aria-label="Platform"
        >
          {PLATFORMS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.emoji} {p.label}
            </option>
          ))}
        </select>
        <input
          required
          placeholder={tab === 'have' ? 'Title you own, e.g. “The Very Hungry Caterpillar”' : "Title you'd like, e.g. “Bluey”"}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <input
          placeholder="Details (character, series, cartridge…)"
          value={form.details}
          onChange={(e) => setForm({ ...form, details: e.target.value })}
        />
        <input
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        {kids.length > 0 && (
          <select
            value={form.child_id}
            onChange={(e) => {
              setFormChildTouched(true)
              setForm({ ...form, child_id: e.target.value })
            }}
            aria-label="Child"
          >
            {kids.map((kid) => (
              <option key={kid.id} value={kid.id}>
                For {kid.name}
              </option>
            ))}
            <option value="">Family / shared</option>
          </select>
        )}
        <input
          placeholder="Image URL (optional)"
          value={form.image_url}
          onChange={(e) => setForm({ ...form, image_url: e.target.value })}
        />
        <label className="file-pick">
          📷 Photo
          <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          {photoFile && <span className="notes"> {photoFile.name}</span>}
        </label>
        <button className="btn">Add to {tab === 'have' ? 'have list' : 'wishlist'}</button>
      </form>
      {message && <p className="notice">{message}</p>}

      <input
        className="filter-input"
        placeholder="Filter this list…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {editingItem && (
        <section className="card edit-panel">
          <h3>Editing “{editingItem.title}”</h3>
          <div className="claim-form">
            <select
              value={editForm.platform}
              onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })}
              aria-label="Platform"
            >
              {PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.emoji} {p.label}
                </option>
              ))}
            </select>
            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Title" />
            <input value={editForm.details} onChange={(e) => setEditForm({ ...editForm, details: e.target.value })} placeholder="Details" />
            <input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Notes" />
            <input value={editForm.image_url} onChange={(e) => setEditForm({ ...editForm, image_url: e.target.value })} placeholder="Image URL" />
            {kids.length > 0 && (
              <select
                value={editForm.child_id}
                onChange={(e) => setEditForm({ ...editForm, child_id: e.target.value })}
                aria-label="Child"
              >
                {kids.map((kid) => (
                  <option key={kid.id} value={kid.id}>
                    For {kid.name}
                  </option>
                ))}
                <option value="">Family / shared</option>
              </select>
            )}
            <button className="btn btn-small" onClick={() => saveEdit(editingItem)}>
              Save
            </button>
            <button className="linklike" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {visible.length === 0 ? (
        <p className="empty">
          {tab === 'have'
            ? 'Nothing here yet. Add the first Tonie, book or cartridge you own — or browse the catalog.'
            : "Wishlist is empty. Add what you'd love gifted next."}
        </p>
      ) : (
        orderedPlatforms.map((platform) => (
          <section key={platform} className="platform-group">
            <h3>
              {platformEmoji(platform)} {platformLabel(platform)}
            </h3>
            <div className="tile-grid">
              {byPlatform[platform].map((item) => (
                <ItemTile key={item.id} item={item}>
                  <BundleNote
                    info={(() => {
                      const twin = catalogIndex.byKey.get(itemKey(item.platform, item.title))
                      return twin
                        ? bundleInfoFor({
                            twin,
                            contentsByBundle,
                            catalogById: catalogIndex.byId,
                            ownedKeys: ownedKeysForBucket(items, item.child_id ?? null),
                          })
                        : null
                    })()}
                    name={childNameFor(item, kids)}
                    platform={item.platform}
                  />
                  <div className="tile-actions">
                    {childFilter === 'all' && kids.length > 0 && (
                      <span className="badge">
                        {item.child_id ? `For ${childNameFor(item, kids)}` : 'Family'}
                      </span>
                    )}
                    {tab === 'wishlist' && (
                      <button className="linklike" onClick={() => markReceived(item)}>
                        Mark as received ✓
                      </button>
                    )}
                    <span className="action-row">
                      <button className="linklike" onClick={() => startEdit(item)}>
                        Edit
                      </button>
                      <button className="linklike danger" onClick={() => removeItem(item)}>
                        Remove
                      </button>
                      <AmazonLink item={item} />
                    </span>
                  </div>
                </ItemTile>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}
