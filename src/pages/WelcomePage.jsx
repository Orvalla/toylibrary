import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { GENDERS, HOLIDAYS, INTERESTS, ageLabel } from '../lib/onboarding'
import { platformLabel } from '../lib/platforms'
import { platformNoun } from '../lib/bundles'
import { shareUrlFor } from '../lib/hostSlug'
import Ethos from '../components/Ethos'

const STEP_TITLES = ['About your child', 'Gift occasions', 'Their devices', 'Interests', 'Fill the shelves', 'You’re all set']

// The onboarding questionnaire. Five short steps that set up a
// child's profile (name, gender, birthday), their gift-giving
// occasions, the devices they already have, and their interests
// — then point the parent at the catalog shelves for those
// devices so the have-list gets filled in. Everything saves as
// it goes; the profile's onboarded_at stamp is what stops the
// dashboard from routing new families here.
export default function WelcomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [kids, setKids] = useState([])
  const [devices, setDevices] = useState([])
  const [mine, setMine] = useState([])
  const [occasions, setOccasions] = useState([])
  // The ethos screen comes before the questionnaire, but only
  // for a family that hasn't onboarded yet (no stamp) — anyone
  // returning to edit a profile lands on the steps directly.
  const [intro, setIntro] = useState(false)
  const [step, setStep] = useState(0)
  const [message, setMessage] = useState('')

  const [childId, setChildId] = useState(null)
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [pickedHolidays, setPickedHolidays] = useState(new Set(['christmas']))
  const [wantBirthday, setWantBirthday] = useState(true)
  const [pickedDevices, setPickedDevices] = useState(new Set())
  const [pickedInterests, setPickedInterests] = useState(new Set())

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('children').select('*').eq('owner_id', user.id).order('sort_order').order('name'),
      supabase.from('catalog_items').select('*').eq('item_type', 'device').order('title'),
      supabase.from('items').select('*').eq('owner_id', user.id),
      supabase.from('occasions').select('*'),
    ]).then(([{ data: prof }, { data: childRows }, { data: deviceRows }, { data: itemRows }, { data: occRows }]) => {
      setProfile(prof)
      setIntro(!prof?.onboarded_at)
      setKids(childRows ?? [])
      setDevices(deviceRows ?? [])
      setMine(itemRows ?? [])
      setOccasions(occRows ?? [])
      const first = (childRows ?? [])[0]
      if (first) {
        setChildId(first.id)
        setName(first.name ?? '')
        setGender(first.gender ?? '')
        setBirthDate(first.birth_date ?? '')
        setPickedInterests(new Set(first.interests ?? []))
        const ownedDeviceTitles = new Set(
          (itemRows ?? [])
            .filter((i) => i.list_type === 'have' && i.child_id === first.id)
            .map((i) => `${i.platform}|${i.title.trim().toLowerCase()}`)
        )
        setPickedDevices(
          new Set(
            (deviceRows ?? [])
              .filter((d) => ownedDeviceTitles.has(`${d.platform}|${d.title.trim().toLowerCase()}`))
              .map((d) => d.id)
          )
        )
      } else if (prof?.child_name) {
        setName(prof.child_name)
      }
      setLoading(false)
    })
  }, [user.id])

  const childName = name.trim() || 'your child'
  const shareUrl = profile ? shareUrlFor(profile.share_slug) : ''

  async function finish(withTour = false) {
    await supabase.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', user.id)
    navigate(withTour ? '/dashboard?tour=1' : '/dashboard')
  }

  // Leaving via a shelf link still counts as set up — the
  // questionnaire's answers are saved by then.
  function stamp() {
    supabase.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', user.id)
  }

  async function saveChild() {
    setMessage('')
    if (!name.trim()) {
      setMessage('A name helps — even a nickname.')
      return
    }
    const fields = { name: name.trim(), gender, birth_date: birthDate || null }
    if (childId) {
      const { error } = await supabase.from('children').update(fields).eq('id', childId)
      if (error) return setMessage(error.message)
      setKids((prev) => prev.map((k) => (k.id === childId ? { ...k, ...fields } : k)))
    } else {
      const { data, error } = await supabase
        .from('children')
        .insert({ owner_id: user.id, ...fields })
        .select()
        .single()
      if (error) return setMessage(error.message)
      setChildId(data.id)
      setKids([data])
    }
    setStep(1)
  }

  async function saveOccasions() {
    setMessage('')
    const existing = new Set(
      occasions.filter((o) => o.child_id === childId).map((o) => o.label.trim().toLowerCase())
    )
    const rows = []
    if (wantBirthday && birthDate) {
      const [, m, d] = birthDate.split('-').map(Number)
      rows.push({ child_id: childId, label: 'Birthday', month: m, day: d })
    }
    for (const h of HOLIDAYS) {
      if (pickedHolidays.has(h.key)) rows.push({ child_id: childId, label: h.label, month: h.month, day: h.day })
    }
    const fresh = rows.filter((r) => !existing.has(r.label.trim().toLowerCase()))
    if (fresh.length) {
      const { error } = await supabase.from('occasions').insert(fresh)
      if (error) return setMessage(error.message)
      setOccasions((prev) => [...prev, ...fresh])
    }
    setStep(2)
  }

  async function saveDevices() {
    setMessage('')
    const haveKeys = new Set(
      mine
        .filter((i) => i.list_type === 'have' && i.child_id === childId)
        .map((i) => `${i.platform}|${i.title.trim().toLowerCase()}`)
    )
    const adds = devices
      .filter((d) => pickedDevices.has(d.id))
      .filter((d) => !haveKeys.has(`${d.platform}|${d.title.trim().toLowerCase()}`))
      .map((d) => ({
        owner_id: user.id,
        list_type: 'have',
        platform: d.platform,
        title: d.title,
        details: d.details ?? '',
        notes: '',
        image_url: d.image_url ?? '',
        asin: d.asin ?? null,
        child_id: childId,
      }))
    if (adds.length) {
      const { error } = await supabase.from('items').insert(adds)
      if (error) return setMessage(error.message)
      setMine((prev) => [...prev, ...adds])
    }
    setStep(3)
  }

  async function saveInterests() {
    setMessage('')
    const { error } = await supabase
      .from('children')
      .update({ interests: [...pickedInterests] })
      .eq('id', childId)
    if (error) return setMessage(error.message)
    setStep(4)
  }

  const toggle = (setter) => (key) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const guidancePlatforms = useMemo(() => {
    const owned = devices.filter((d) => pickedDevices.has(d.id)).map((d) => d.platform)
    return [...new Set(owned)]
  }, [devices, pickedDevices])

  if (loading) return <main className="page"><p>Getting things ready…</p></main>

  if (intro) {
    return (
      <main className="welcome-shell">
        <div className="welcome-card">
          <div className="welcome-brand">
            <img src="/logo.svg" alt="" />
            <span>Toy Library</span>
          </div>
          <h1>Why Toy Library exists</h1>
          <p className="lede">
            Thirty seconds of why — then about a minute of setup, and the duplicate
            gifts stop.
          </p>
          <Ethos />
          <p className="finale-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn" onClick={() => setIntro(false)}>
              Set up my library →
            </button>
            <button className="btn btn-ghost" onClick={() => finish(false)}>
              Skip the setup for now
            </button>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="welcome-shell">
      <div className="welcome-card">
        <div className="welcome-brand">
          <img src="/logo.svg" alt="" />
          <span>Toy Library</span>
        </div>
        <h1>
          {step < 5 ? `Let’s set up ${childName}’s library` : 'You’re all set 🎉'}
        </h1>
        <p className="lede">
          {step < 5
            ? 'A few quick questions — then gift-givers get a link, and the gift ideas actually fit.'
            : `${childName}’s library is ready. Send the link before the next gift occasion and the duplicates stop.`}
        </p>
        <div className="wizard-dots" aria-label={`Step ${step + 1} of ${STEP_TITLES.length}: ${STEP_TITLES[step]}`}>
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={i === step ? 'wdot on' : i < step ? 'wdot done' : 'wdot'} title={t} />
          ))}
          <span className="wizard-dots-label">
            Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}
          </span>
        </div>
        {message && <p className="notice">{message}</p>}

      {step === 0 && (
        <section className="welcome-step">
          <h3>About your child</h3>
          {kids.length > 1 && (
            <div className="form">
              <label>
                Setting up
                <select
                  value={childId ?? ''}
                  onChange={(e) => {
                    const kid = kids.find((k) => k.id === e.target.value)
                    if (!kid) return
                    setChildId(kid.id)
                    setName(kid.name ?? '')
                    setGender(kid.gender ?? '')
                    setBirthDate(kid.birth_date ?? '')
                    setPickedInterests(new Set(kid.interests ?? []))
                    const owned = new Set(
                      mine
                        .filter((i) => i.list_type === 'have' && i.child_id === kid.id)
                        .map((i) => `${i.platform}|${i.title.trim().toLowerCase()}`)
                    )
                    setPickedDevices(
                      new Set(
                        devices
                          .filter((d) => owned.has(`${d.platform}|${d.title.trim().toLowerCase()}`))
                          .map((d) => d.id)
                      )
                    )
                  }}
                >
                  {kids.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="form">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" maxLength={60} />
            </label>
            <label>
              Birthday
              <input type="date" value={birthDate ?? ''} onChange={(e) => setBirthDate(e.target.value)} />
            </label>
            {birthDate && <p className="field-help">{childName} is {ageLabel(birthDate)}.</p>}
            <div>
              <p className="field-help" style={{ marginBottom: 6 }}>Gender</p>
              <div className="chip-row">
                {GENDERS.map((g) => (
                  <button
                    type="button"
                    key={g.label}
                    className={gender === g.value ? 'chip on' : 'chip'}
                    onClick={() => setGender(g.value)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p>
            <button className="btn" onClick={saveChild}>Continue</button>
          </p>
        </section>
      )}

      {step === 1 && (
        <section className="welcome-step">
          <h3>When do gifts arrive for {childName}?</h3>
          <p className="field-help">
            Pick the occasions relatives actually shop for. Wishlist claims last until
            just after each one, and the gift page counts down to the next.
          </p>
          <div className="chip-row">
            <button
              type="button"
              className={wantBirthday ? 'chip on' : 'chip'}
              onClick={() => setWantBirthday((v) => !v)}
              disabled={!birthDate}
              title={birthDate ? '' : 'Add a birthday in step 1 first'}
            >
              🎂 Birthday{birthDate ? '' : ' (needs a birthday)'}
            </button>
            {HOLIDAYS.map((h) => (
              <button
                type="button"
                key={h.key}
                className={pickedHolidays.has(h.key) ? 'chip on' : 'chip'}
                onClick={() => toggle(setPickedHolidays)(h.key)}
              >
                {h.emoji} {h.label}
              </button>
            ))}
          </div>
          <p className="field-help">
            Some holidays move a little each year — the dates are set for this year and
            can be adjusted any time in Settings.
          </p>
          <p>
            <button className="btn" onClick={saveOccasions}>Continue</button>{' '}
            <button className="linklike" onClick={() => setStep(0)}>Back</button>
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="welcome-step">
          <h3>Which players does {childName} already have?</h3>
          <p className="field-help">
            Tap the devices on your shelf. They'll be added to the have list, and gift
            ideas will only suggest stories that play on them.
          </p>
          <div className="device-grid">
            {devices.map((d) => (
              <button
                type="button"
                key={d.id}
                className={pickedDevices.has(d.id) ? 'device-pick on' : 'device-pick'}
                onClick={() => toggle(setPickedDevices)(d.id)}
              >
                {d.image_url ? <img src={d.image_url} alt="" loading="lazy" /> : <span className="device-pick-art">🎧</span>}
                <span>{d.title}</span>
                {pickedDevices.has(d.id) && <span className="device-pick-check">✓</span>}
              </button>
            ))}
          </div>
          <p>
            <button className="btn" onClick={saveDevices}>Continue</button>{' '}
            <button className="linklike" onClick={() => setStep(1)}>Back</button>
          </p>
        </section>
      )}

      {step === 3 && (
        <section className="welcome-step">
          <h3>What is {childName} into?</h3>
          <p className="field-help">Pick as many as fit — these steer the gift ideas.</p>
          <div className="chip-row">
            {INTERESTS.map((i) => (
              <button
                type="button"
                key={i.key}
                className={pickedInterests.has(i.key) ? 'chip on' : 'chip'}
                onClick={() => toggle(setPickedInterests)(i.key)}
              >
                {i.emoji} {i.label}
              </button>
            ))}
          </div>
          <p>
            <button className="btn" onClick={saveInterests}>Continue</button>{' '}
            <button className="linklike" onClick={() => setStep(2)}>Back</button>
          </p>
        </section>
      )}

      {step === 4 && (
        <section className="welcome-step">
          <h3>Now the fun part — fill {childName}'s shelves</h3>
          <p className="field-help">
            Go platform by platform and tap everything already on the shelf. Anything
            marked as owned disappears from gift-givers' "safe to buy" zone, so nobody
            doubles up.
          </p>
          <div className="guide-list">
            {guidancePlatforms.map((p) => (
              <p key={p} className="guide-row">
                <span>📚 Add the {platformLabel(p)} {platformNoun(p)} you have</span>
                <Link className="btn btn-small" to={`/catalog?platform=${p}`} onClick={stamp}>Open shelf</Link>
              </p>
            ))}
            <p className="guide-row">
              <span>📖 Add the picture &amp; story books you have</span>
              <Link className="btn btn-small" to="/catalog?platform=books" onClick={stamp}>Open shelf</Link>
            </p>
            <p className="guide-row">
              <span>🔍 Browse the whole catalog</span>
              <Link className="btn btn-small" to="/catalog" onClick={stamp}>Open</Link>
            </p>
          </div>
          <p className="field-help">
            Your gift-giver link is <span className="share-url">{shareUrl}</span> — send it
            to grandparents before the next occasion.
          </p>
          <p>
            <button className="btn" onClick={() => setStep(5)}>Continue</button>{' '}
            <button className="linklike" onClick={() => setStep(3)}>Back</button>
          </p>
        </section>
      )}

      {step === 5 && (
        <section className="welcome-step welcome-finale">
          <img className="finale-mark" src="/logo.svg" alt="" />
          <p className="field-help">
            Your gift-giver link is <span className="share-url">{shareUrl}</span> — send it
            to grandparents before the next occasion. They’ll see the wishlist, what{' '}
            {childName} already has, and they can claim a gift so nobody else buys it twice.
          </p>
          <p className="finale-actions">
            <button className="btn" onClick={() => finish(true)}>
              Take the 60-second tour
            </button>
            <button className="btn btn-ghost" onClick={() => finish(false)}>
              Skip to my library
            </button>
          </p>
        </section>
      )}


        {step < 5 && (
          <p>
            <button className="linklike" onClick={() => finish(false)}>
              Skip the setup for now
            </button>
          </p>
        )}
      </div>
    </main>
  )
}
