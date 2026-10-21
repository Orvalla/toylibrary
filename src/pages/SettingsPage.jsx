import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { formatOccasionLine } from '../lib/occasions'

export default function SettingsPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [childName, setChildName] = useState('')
  const [kids, setKids] = useState([])
  const [kidEdits, setKidEdits] = useState({}) // child id -> edited name
  const [newKidName, setNewKidName] = useState('')
  const [occasions, setOccasions] = useState([])
  const [occForms, setOccForms] = useState({}) // child id -> { label, date }
  const [message, setMessage] = useState('')
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('children')
        .select('*')
        .eq('owner_id', user.id)
        .order('sort_order')
        .order('name'),
      // RLS scopes occasions to children the signed-in parent owns.
      supabase.from('occasions').select('*').order('month').order('day'),
    ]).then(([{ data }, { data: childRows }, { data: occRows }]) => {
      setProfile(data)
      setDisplayName(data?.display_name ?? '')
      setChildName(data?.child_name ?? '')
      setKids(childRows ?? [])
      setOccasions(occRows ?? [])
      setLoading(false)
    })
  }, [user.id])

  async function renameKid(kid) {
    const name = (kidEdits[kid.id] ?? kid.name).trim()
    if (!name) return
    setMessage('')
    const { error } = await supabase.from('children').update({ name }).eq('id', kid.id)
    if (error) {
      setMessage(error.message)
      return
    }
    setKids((ks) => ks.map((k) => (k.id === kid.id ? { ...k, name } : k)))
    setMessage(`Renamed to ${name}.`)
  }

  async function addKid(e) {
    e.preventDefault()
    const name = newKidName.trim()
    if (!name) return
    setMessage('')
    const { data, error } = await supabase
      .from('children')
      .insert({ owner_id: user.id, name, sort_order: kids.length })
      .select()
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    setKids((ks) => [...ks, data])
    setNewKidName('')
    setMessage(`${name} added — their lists are ready.`)
  }

  async function deleteKid(kid) {
    // Deleting a child never deletes toys: items.child_id is
    // ON DELETE SET NULL, so everything of theirs becomes Family.
    if (!window.confirm(`Remove ${kid.name}? Their toys and wishlist items will move to Family — nothing is deleted.`)) return
    setMessage('')
    const { error } = await supabase.from('children').delete().eq('id', kid.id)
    if (error) {
      setMessage(error.message)
      return
    }
    setKids((ks) => ks.filter((k) => k.id !== kid.id))
    setMessage(`${kid.name} removed. Their items are now under Family.`)
  }

  function occFormFor(kidId) {
    return occForms[kidId] ?? { label: '', date: '' }
  }

  function setOccForm(kidId, patch) {
    setOccForms((f) => ({ ...f, [kidId]: { ...occFormFor(kidId), ...patch } }))
  }

  async function addOccasion(e, kid) {
    e.preventDefault()
    const form = occFormFor(kid.id)
    const label = form.label.trim()
    // The date input's year is ignored — occasions recur yearly, so
    // only the month/day are stored. (Feb 29 is allowed; it lands on
    // Feb 28 in years without one.)
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date)
    if (!label || !parts) {
      setMessage('Give the occasion a name and pick a day.')
      return
    }
    setMessage('')
    const { data, error } = await supabase
      .from('occasions')
      .insert({ child_id: kid.id, label, month: Number(parts[2]), day: Number(parts[3]) })
      .select()
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    setOccasions((os) => [...os, data])
    setOccForms((f) => ({ ...f, [kid.id]: { label: '', date: '' } }))
    setMessage(`${label} added for ${kid.name}.`)
  }

  async function deleteOccasion(occ, kid) {
    setMessage('')
    const { error } = await supabase.from('occasions').delete().eq('id', occ.id)
    if (error) {
      setMessage(error.message)
      return
    }
    setOccasions((os) => os.filter((o) => o.id !== occ.id))
    setMessage(`${occ.label} removed for ${kid.name}.`)
  }

  async function saveNames(e) {
    e.preventDefault()
    setMessage('')
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim(), child_name: childName.trim() })
      .eq('id', user.id)
    setMessage(error ? error.message : 'Saved.')
    if (!error) setProfile((p) => ({ ...p, display_name: displayName.trim(), child_name: childName.trim() }))
  }

  // Retire the current share link (e.g. it was forwarded beyond the
  // family) and mint a new one. The old link stops working immediately.
  async function regenerate() {
    setMessage('')
    const { data, error } = await supabase.rpc('regenerate_share_slug')
    if (error) {
      setMessage(error.message)
      return
    }
    setConfirmRegen(false)
    setProfile((p) => ({ ...p, share_slug: data }))
    setMessage('New share link created. The old one no longer works.')
  }

  if (loading) return <main className="page narrow"><p>Loading…</p></main>
  if (!profile) return <main className="page narrow"><p>We couldn't load your profile.</p></main>

  const shareUrl = `${window.location.origin}/s/${profile.share_slug}`

  return (
    <main className="page narrow">
      <h1>Settings</h1>

      <form onSubmit={saveNames} className="form">
        <label>
          Your name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          Child's first name
          <input value={childName} onChange={(e) => setChildName(e.target.value)} />
        </label>
        <button className="btn">Save</button>
      </form>

      <section className="card">
        <h3>Your children</h3>
        <p>
          Each child gets their own have-list and wishlist. Anything not
          tied to one child lives under <strong>Family</strong> — shared by
          everyone. Removing a child moves their toys to Family; nothing
          is ever deleted.
        </p>
        {kids.length === 0 && <p className="notes">No children yet — add the first one below.</p>}
        <ul className="item-list">
          {kids.map((kid) => (
            <li key={kid.id} className="item child-row">
              <input
                value={kidEdits[kid.id] ?? kid.name}
                onChange={(e) => setKidEdits((ed) => ({ ...ed, [kid.id]: e.target.value }))}
                aria-label={`Name for ${kid.name}`}
              />
              <span className="item-actions">
                <button className="linklike" onClick={() => renameKid(kid)}>
                  Save
                </button>
                <button className="linklike danger" onClick={() => deleteKid(kid)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={addKid} className="claim-form">
          <input
            placeholder="New child's first name"
            value={newKidName}
            onChange={(e) => setNewKidName(e.target.value)}
          />
          <button className="btn btn-small">Add child</button>
        </form>
      </section>

      <section className="card">
        <h3>Occasions</h3>
        <p>
          Birthdays and holidays come back every year — just add the day
          once. Your gift-giver page highlights each child's next
          occasion, and a wishlist claim holds until the day after it
          (when it's within 90 days; otherwise claims hold for 60 days),
          then quietly opens up again so the list stays current.
        </p>
        {kids.length === 0 && (
          <p className="notes">Add a child above first — occasions belong to a child.</p>
        )}
        {kids.map((kid) => {
          const mine = occasions.filter((o) => o.child_id === kid.id)
          const form = occFormFor(kid.id)
          return (
            <div key={kid.id} className="occasion-kid">
              <h4>{kid.name}</h4>
              {mine.length === 0 ? (
                <p className="notes">No occasions yet.</p>
              ) : (
                <ul className="item-list">
                  {mine.map((occ) => (
                    <li key={occ.id} className="item">
                      <span>{formatOccasionLine(occ)}</span>
                      <span className="item-actions">
                        <button className="linklike danger" onClick={() => deleteOccasion(occ, kid)}>
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={(e) => addOccasion(e, kid)} className="claim-form">
                <input
                  placeholder="Birthday, Christmas, …"
                  value={form.label}
                  onChange={(e) => setOccForm(kid.id, { label: e.target.value })}
                  aria-label={`Occasion name for ${kid.name}`}
                />
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setOccForm(kid.id, { date: e.target.value })}
                  aria-label={`Occasion day for ${kid.name}`}
                />
                <button className="btn btn-small">Add</button>
              </form>
              <p className="notes">
                Quick picks:{' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => setOccForm(kid.id, { label: 'Birthday' })}
                >
                  Birthday
                </button>{' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() =>
                    setOccForm(kid.id, {
                      label: 'Christmas',
                      date: `${new Date().getFullYear()}-12-25`,
                    })
                  }
                >
                  Christmas
                </button>{' '}
                — the year is ignored, occasions repeat.
              </p>
            </div>
          )
        })}
      </section>

      <section className="card">
        <h3>Share link</h3>
        <p className="share-url">{shareUrl}</p>
        <p>
          If this link has spread further than you'd like, regenerate it —
          the old link stops working right away and you'll get a fresh one
          to send to family.
        </p>
        {confirmRegen ? (
          <p>
            <button className="btn btn-small" onClick={regenerate}>
              Yes, replace my link
            </button>{' '}
            <button className="linklike" onClick={() => setConfirmRegen(false)}>
              Keep the current one
            </button>
          </p>
        ) : (
          <button className="linklike danger" onClick={() => setConfirmRegen(true)}>
            Regenerate share link
          </button>
        )}
      </section>

      {message && <p className="notice">{message}</p>}
    </main>
  )
}
