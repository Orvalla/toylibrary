import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { formatOccasionLine } from '../lib/occasions'
import { normalizeShareSlug, validateShareSlug } from '../lib/slug'
import { shareUrlFor } from '../lib/hostSlug'
import { GENDERS, INTERESTS } from '../lib/onboarding'
import { giftMessage, instagramLink, messengerLink, normalizeHandle } from '../lib/giftCircle'
import { PREF_LANGUAGES } from '../lib/language'

export default function SettingsPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [childName, setChildName] = useState('')
  const [kids, setKids] = useState([])
  const [kidEdits, setKidEdits] = useState({}) // child id -> edited name
  const [kidProfiles, setKidProfiles] = useState({}) // child id -> { gender, birth_date, interests }
  const [newKidName, setNewKidName] = useState('')
  const [occasions, setOccasions] = useState([])
  const [occForms, setOccForms] = useState({}) // child id -> { label, date }
  const [relatives, setRelatives] = useState([])
  const [relLinks, setRelLinks] = useState({}) // relative id -> [child id]
  const [relForm, setRelForm] = useState({ name: '', email: '', instagram: '', facebook: '', kidIds: [] })
  const [copiedRelId, setCopiedRelId] = useState('')
  const [message, setMessage] = useState('')
  const [slugInput, setSlugInput] = useState('')
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
      supabase.from('relatives').select('*').eq('owner_id', user.id).order('created_at'),
      supabase.from('relative_children').select('*'),
    ]).then(([{ data }, { data: childRows }, { data: occRows }, { data: relRows }, { data: linkRows }]) => {
      setProfile(data)
      setDisplayName(data?.display_name ?? '')
      setChildName(data?.child_name ?? '')
      setSlugInput(data?.share_slug ?? '')
      setKids(childRows ?? [])
      setKidProfiles(
        Object.fromEntries(
          (childRows ?? []).map((k) => [
            k.id,
            {
              gender: k.gender ?? '',
              birth_date: k.birth_date ?? '',
              interests: k.interests ?? [],
              grow_into_years: k.grow_into_years ?? null,
            },
          ])
        )
      )
      setOccasions(occRows ?? [])
      setRelatives(relRows ?? [])
      const links = {}
      for (const row of linkRows ?? []) {
        links[row.relative_id] = [...(links[row.relative_id] ?? []), row.child_id]
      }
      setRelLinks(links)
      setLoading(false)
    })
  }, [user.id])

  async function renameKid(kid) {
    const name = (kidEdits[kid.id] ?? kid.name).trim()
    if (!name) return
    const prof = kidProfiles[kid.id] ?? { gender: '', birth_date: '', interests: [], grow_into_years: null }
    const fields = {
      name,
      gender: prof.gender ?? '',
      birth_date: prof.birth_date || null,
      interests: prof.interests ?? [],
      grow_into_years: prof.grow_into_years ?? null,
    }
    setMessage('')
    const { error } = await supabase.from('children').update(fields).eq('id', kid.id)
    if (error) {
      setMessage(error.message)
      return
    }
    setKids((ks) => ks.map((k) => (k.id === kid.id ? { ...k, ...fields } : k)))
    setMessage(`${name}'s profile saved.`)
  }

  function setKidProfile(kidId, patch) {
    setKidProfiles((p) => ({
      ...p,
      [kidId]: {
        gender: '',
        birth_date: '',
        interests: [],
        grow_into_years: null,
        ...(p[kidId] ?? {}),
        ...patch,
      },
    }))
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

  // ------------------------------------------------ gift circle
  // Kids a relative hears about: their linked kids, or every kid
  // when they have no links (the common case — grandparents gift
  // the whole family).
  function kidsLabelFor(rel) {
    const linked = relLinks[rel.id] ?? []
    if (linked.length === 0) return kids.map((k) => k.name).join(' and ') || 'your kids'
    return kids
      .filter((k) => linked.includes(k.id))
      .map((k) => k.name)
      .join(' and ')
  }

  async function addRelative(e) {
    e.preventDefault()
    const name = relForm.name.trim()
    const email = relForm.email.trim()
    if (!name) {
      setMessage('Give this person a name first.')
      return
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setMessage('That email doesn’t look complete — or clear it to add them without one.')
      return
    }
    setMessage('')
    const { data, error } = await supabase
      .from('relatives')
      .insert({
        owner_id: user.id,
        name,
        email: email || null,
        instagram: normalizeHandle(relForm.instagram) || null,
        facebook: normalizeHandle(relForm.facebook) || null,
      })
      .select()
      .single()
    if (error) {
      setMessage(error.message)
      return
    }
    if (relForm.kidIds.length > 0) {
      const { error: linkError } = await supabase
        .from('relative_children')
        .insert(relForm.kidIds.map((child_id) => ({ relative_id: data.id, child_id })))
      if (linkError) {
        setMessage(linkError.message)
        return
      }
      setRelLinks((l) => ({ ...l, [data.id]: [...relForm.kidIds] }))
    }
    setRelatives((rs) => [...rs, data])
    setRelForm({ name: '', email: '', instagram: '', facebook: '', kidIds: [] })
    setMessage(
      email
        ? `${name} added — they'll be emailed the wishlist before gift occasions.`
        : `${name} added — use the chat buttons below to send them the wishlist.`
    )
  }

  async function deleteRelative(rel) {
    if (!window.confirm(`Remove ${rel.name} from your gift circle?`)) return
    setMessage('')
    const { error } = await supabase.from('relatives').delete().eq('id', rel.id)
    if (error) {
      setMessage(error.message)
      return
    }
    setRelatives((rs) => rs.filter((r) => r.id !== rel.id))
    setMessage(`${rel.name} removed from your gift circle.`)
  }

  // Instagram and Messenger won't let an app send the first
  // message to someone, so the flow is: copy the ready-made
  // message, open the chat, paste. (See lib/giftCircle.js.)
  async function copyGiftMessage(rel) {
    const text = giftMessage({
      relativeName: rel.name,
      ownerName: displayName.trim(),
      kidsLabel: kidsLabelFor(rel),
      link: shareUrl,
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopiedRelId(rel.id)
      setMessage(`Message for ${rel.name} copied — open their chat and paste it.`)
    } catch {
      setMessage(`Copy this message for ${rel.name}: ${text}`)
    }
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
    setSlugInput(data)
    setMessage('New share link created. The old one no longer works.')
  }

  // Pick a memorable slug (the-millers instead of fam-015f2077).
  // The input is normalized as it's saved; the server (migration
  // 0012) re-validates and reports a taken slug as 'slug_taken'.
  async function saveSlug(e) {
    e.preventDefault()
    setMessage('')
    const slug = normalizeShareSlug(slugInput)
    setSlugInput(slug)
    const problem = validateShareSlug(slug)
    if (problem) {
      setMessage(problem)
      return
    }
    if (slug === profile.share_slug) {
      setMessage('That is already your link.')
      return
    }
    const { data, error } = await supabase.rpc('set_share_slug', { p_slug: slug })
    if (error) {
      setMessage(
        error.message.includes('slug_taken')
          ? 'That link is already taken — try another.'
          : error.message.includes('reserved_slug')
            ? 'That one is reserved — try another.'
            : error.message.includes('invalid_slug')
              ? 'That link is not allowed — use letters, numbers and single hyphens.'
              : error.message
      )
      return
    }
    setProfile((p) => ({ ...p, share_slug: data }))
    setSlugInput(data)
    setMessage('Your share link has been updated. The old one no longer works.')
  }

  if (loading) return <main className="page narrow"><p>Loading…</p></main>
  if (!profile) return <main className="page narrow"><p>We couldn't load your profile.</p></main>

  async function toggleReminders(on) {
    setProfile((p) => ({ ...p, occasion_reminders: on }))
    const { error } = await supabase
      .from('profiles')
      .update({ occasion_reminders: on })
      .eq('id', user.id)
    if (error) {
      setMessage(error.message)
      setProfile((p) => ({ ...p, occasion_reminders: !on }))
    }
  }

  // Change password: prove the current one by signing in with
  // it (works whatever the project's secure-change settings
  // are, and it's the check a person expects), then set the new
  // one on the live session.
  async function changePassword(e) {
    e.preventDefault()
    setMessage('')
    if (pw.next.length < 8) {
      setMessage('Your new password needs at least 8 characters.')
      return
    }
    if (pw.next !== pw.confirm) {
      setMessage("The new passwords don't match.")
      return
    }
    setPwBusy(true)
    const { error: checkError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: pw.current,
    })
    if (checkError) {
      setPwBusy(false)
      setMessage("Your current password doesn't match — nothing was changed.")
      return
    }
    const { error } = await supabase.auth.updateUser({ password: pw.next })
    setPwBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setPw({ current: '', next: '', confirm: '' })
    setMessage('Password changed.')
  }

  async function toggleFamilyScope(on) {
    setProfile((p) => ({ ...p, subscriber_family_scope: on }))
    const { error } = await supabase
      .from('profiles')
      .update({ subscriber_family_scope: on })
      .eq('id', user.id)
    if (error) {
      setMessage(error.message)
      setProfile((p) => ({ ...p, subscriber_family_scope: !on }))
    }
  }

  async function setLanguagePrefs(next) {
    const prev = profile.language_pref
    setProfile((p) => ({ ...p, language_pref: next }))
    const { error } = await supabase
      .from('profiles')
      .update({ language_pref: next })
      .eq('id', user.id)
    if (error) {
      setMessage(error.message)
      setProfile((p) => ({ ...p, language_pref: prev }))
    }
  }

  function togglePrefLanguage(key) {
    const cur = Array.isArray(profile.language_pref) ? profile.language_pref : []
    setLanguagePrefs(
      cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]
    )
  }

  async function toggleNoAffiliate(on) {
    setProfile((p) => ({ ...p, no_affiliate: on }))
    const { error } = await supabase
      .from('profiles')
      .update({ no_affiliate: on })
      .eq('id', user.id)
    if (error) {
      setMessage(error.message)
      setProfile((p) => ({ ...p, no_affiliate: !on }))
    }
  }

  const shareUrl = shareUrlFor(profile.share_slug)

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
          is ever deleted. Birthday, gender and interests steer the gift
          ideas on your library page — or{' '}
          <Link to="/welcome">run the setup questions</Link> to do it the fun way, or{' '}
          <Link to="/dashboard?tour=1">take the guided tour</Link>.
        </p>
        {kids.length === 0 && <p className="notes">No children yet — add the first one below.</p>}
        <ul className="item-list">
          {kids.map((kid) => {
            const prof = kidProfiles[kid.id] ?? { gender: '', birth_date: '', interests: [] }
            return (
              <li key={kid.id} className="item child-row child-block">
                <div className="child-row-main">
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
                </div>
                <div className="child-profile">
                  <label>
                    Birthday
                    <input
                      type="date"
                      value={prof.birth_date ?? ''}
                      onChange={(e) => setKidProfile(kid.id, { birth_date: e.target.value })}
                    />
                  </label>
                  <label>
                    Gender
                    <select
                      value={prof.gender ?? ''}
                      onChange={(e) => setKidProfile(kid.id, { gender: e.target.value })}
                    >
                      {GENDERS.map((g) => (
                        <option key={g.label} value={g.value}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Gift ideas may aim ahead
                    <select
                      value={prof.grow_into_years ?? 3}
                      onChange={(e) =>
                        setKidProfile(kid.id, { grow_into_years: Number(e.target.value) })
                      }
                    >
                      <option value={0}>Only their age right now</option>
                      <option value={1}>Up to 1 year older</option>
                      <option value={2}>Up to 2 years older</option>
                      <option value={3}>Up to 3 years older</option>
                      <option value={5}>Up to 5 years older</option>
                    </select>
                  </label>
                </div>
                <p className="field-help" style={{ marginTop: 0 }}>
                  Gift suggestions usually include a few things {kid.name} will grow
                  into. “Only their age right now” keeps ideas strictly for the age
                  they are today.
                </p>
                <div className="chip-row">
                  {INTERESTS.map((i) => {
                    const on = (prof.interests ?? []).includes(i.key)
                    return (
                      <button
                        type="button"
                        key={i.key}
                        className={on ? 'chip small on' : 'chip small'}
                        onClick={() =>
                          setKidProfile(kid.id, {
                            interests: on
                              ? prof.interests.filter((k) => k !== i.key)
                              : [...(prof.interests ?? []), i.key],
                          })
                        }
                      >
                        {i.emoji} {i.label}
                      </button>
                    )
                  })}
                </div>
              </li>
            )
          })}
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
        <form onSubmit={saveSlug} className="form">
          <label>
            Make it memorable
            <span className="slug-field">
              <span className="slug-prefix">https://</span>
              <input
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder="the-millers"
                maxLength={40}
              />
              <span className="slug-prefix">.toylibrary.store</span>
            </span>
          </label>
          <p className="field-help">
            Letters, numbers and hyphens — 3 to 30 characters. Pick
            something easy to say out loud, like your family name.
            Changing it breaks the old link.
          </p>
          <p>
            <button type="submit" className="btn btn-small">
              Save my link
            </button>
          </p>
        </form>
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
        <h4>Occasion reminders</h4>
        <p>
          Before a birthday or holiday on a child's list, we'll email you the
          wishlist link — and gift-circle family below who've given an email
          get it directly, so nobody has to remember to forward it.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={profile.occasion_reminders !== false}
            onChange={(e) => toggleReminders(e.target.checked)}
          />{' '}
          Email me before gift occasions
        </label>
        <h4>Book &amp; story languages</h4>
        <p>
          Tick every language your family reads in — bilingual families can
          pick more than one. Your picks set the catalog's starting language
          filter and shape the gift ideas on your dashboard: books and
          stories in other languages won't be shown. Bilingual editions
          always appear, since they work in both. Leave everything unticked
          to see all languages.
        </p>
        <div>
          {PREF_LANGUAGES.map((l) => (
            <label key={l.key} className="toggle">
              <input
                type="checkbox"
                checked={(profile.language_pref ?? []).includes(l.key)}
                onChange={() => togglePrefLanguage(l.key)}
              />{' '}
              {l.flag} {l.label}
            </label>
          ))}
        </div>
        <h4>Affiliate links</h4>
        <p>
          Item links normally carry a small affiliate tag, which earns a
          commission when someone buys through them. If you'd rather gifts
          for your kids earned nothing, turn this on: your share page drops
          the tag, and anyone who opens your list keeps it off in their
          browser from then on.
        </p>
        <p>
          <strong>Related to the site's owner?</strong> Please turn this on
          for your family too. The commission goes to him, and gifts between
          family shouldn't earn him anything — he'd much rather you just
          bought the toy.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={profile.no_affiliate === true}
            onChange={(e) => toggleNoAffiliate(e.target.checked)}
          />{' '}
          No affiliate links for my family
        </label>
      </section>

      <section className="card">
        <h3>Password</h3>
        <form onSubmit={changePassword} className="form">
          <label>
            Current password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
            />
          </label>
          <label>
            New password (at least 8 characters)
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
            />
          </label>
          <label>
            New password again
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
            />
          </label>
          <p>
            <button type="submit" className="btn btn-small" disabled={pwBusy}>
              {pwBusy ? 'Changing…' : 'Change password'}
            </button>
          </p>
        </form>
      </section>

      <section className="card">
        <h3>Gift circle</h3>
        <p>
          The family and friends who gift your kids. Add their{' '}
          <strong>email</strong> and we'll email them the wishlist ahead of
          each birthday or holiday — no account needed, and every email has an
          unsubscribe link. Turning off occasion reminders above pauses
          family emails too.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={profile.subscriber_family_scope === true}
            onChange={(e) => toggleFamilyScope(e.target.checked)}
          />{' '}
          One gift-list signup covers all our children
        </label>
        <p className="notes">
          Visitors can leave an email at the top of your gift list to be reminded
          before a child's birthday or holiday. Normally they pick one child;
          turn this on and a single signup reminds them about every child's big
          days. (Signups made before you flip this keep their original reach.)
        </p>
        <p>
          For <strong>Instagram or Facebook</strong>: those apps don't let
          anyone send a first message for you, so each person below gets
          one-tap buttons instead — <em>Copy message</em> puts a ready-made
          wishlist note on your clipboard, then open their chat and paste.
        </p>
        {relatives.length === 0 ? (
          <p className="notes">Nobody in your gift circle yet — add the grandparents below.</p>
        ) : (
          <ul className="item-list">
            {relatives.map((rel) => {
              const mLink = messengerLink(rel.facebook)
              const igLink = instagramLink(rel.instagram)
              const linked = relLinks[rel.id] ?? []
              return (
                <li key={rel.id} className="item child-block">
                  <div className="child-row-main">
                    <strong>{rel.name}</strong>
                    <span className="item-actions">
                      <button className="linklike danger" onClick={() => deleteRelative(rel)}>
                        Remove
                      </button>
                    </span>
                  </div>
                  <p className="notes" style={{ margin: 0 }}>
                    {rel.email ? (
                      rel.notify_email ? (
                        <>✉️ {rel.email} — emailed before occasions</>
                      ) : (
                        <>✉️ {rel.email} — unsubscribed from emails</>
                      )
                    ) : (
                      <>No email — reach them by chat</>
                    )}
                    {rel.instagram && <> · 📷 @{rel.instagram}</>}
                    {rel.facebook && <> · 💬 {rel.facebook}</>}
                    <br />
                    Hears about: {linked.length === 0 ? 'all your kids' : kidsLabelFor(rel)}
                  </p>
                  <p style={{ margin: 0, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-small" onClick={() => copyGiftMessage(rel)}>
                      {copiedRelId === rel.id ? '✓ Copied' : '📋 Copy message'}
                    </button>
                    {mLink && (
                      <a className="btn btn-small btn-ghost" href={mLink} target="_blank" rel="noreferrer">
                        💬 Messenger
                      </a>
                    )}
                    {igLink && (
                      <a className="btn btn-small btn-ghost" href={igLink} target="_blank" rel="noreferrer">
                        📷 Instagram
                      </a>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        <form onSubmit={addRelative} className="form">
          <label>
            Name
            <input
              value={relForm.name}
              onChange={(e) => setRelForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Aunt Jen"
            />
          </label>
          <label>
            Email (optional — needed for automatic holiday emails)
            <input
              type="email"
              value={relForm.email}
              onChange={(e) => setRelForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jen@example.com"
            />
          </label>
          <label>
            Instagram handle (optional)
            <input
              value={relForm.instagram}
              onChange={(e) => setRelForm((f) => ({ ...f, instagram: e.target.value }))}
              placeholder="@aunt.jen"
            />
          </label>
          <label>
            Facebook username (optional)
            <input
              value={relForm.facebook}
              onChange={(e) => setRelForm((f) => ({ ...f, facebook: e.target.value }))}
              placeholder="aunt.jen"
            />
          </label>
          {kids.length > 1 && (
            <>
              <p className="field-help" style={{ margin: 0 }}>
                Only notify them about specific kids? Tap to pick — none
                picked means all of them.
              </p>
              <div className="chip-row" style={{ margin: 0 }}>
                {kids.map((kid) => {
                  const on = relForm.kidIds.includes(kid.id)
                  return (
                    <button
                      type="button"
                      key={kid.id}
                      className={on ? 'chip small on' : 'chip small'}
                      onClick={() =>
                        setRelForm((f) => ({
                          ...f,
                          kidIds: on ? f.kidIds.filter((id) => id !== kid.id) : [...f.kidIds, kid.id],
                        }))
                      }
                    >
                      {kid.name}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          <p>
            <button type="submit" className="btn btn-small">
              Add to gift circle
            </button>
          </p>
        </form>
      </section>

      {profile.is_admin && (
        <section className="card">
          <h2>🛡️ Site admin</h2>
          <p>
            You run the place. Review what parents have added to the catalog, remove
            anything that doesn't belong, or make an addition private to its owner.
          </p>
          <p>
            <Link to="/admin" className="btn btn-small">
              Open the admin page
            </Link>
          </p>
        </section>
      )}

      {message && <p className="notice">{message}</p>}
    </main>
  )
}
