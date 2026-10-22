import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  addProposalToken,
  loadProposalTokens,
  priceLabel,
  proposalStatusLabel,
  suggesterNameKey,
} from '../lib/proposals'

// The share page's gift-proposal pieces (migration 0024):
//   ApprovedGifts — the approved proposals, shown to every
//     visitor so two gift-givers can't both buy the same
//     off-list gift.
//   SuggestGift — the "want to buy something that's not on
//     the list?" form plus this browser's own suggestions
//     and their statuses.

// The function's own message beats the SDK's generic one.
async function functionMessage(error) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // fall through
  }
  return error.message ?? 'Something went wrong — try again.'
}

export function ApprovedGifts({ proposals }) {
  if (!proposals?.length) return null
  return (
    <section className="proposal-public">
      <h3>🎁 Also on the way — approved gift ideas</h3>
      <p className="muted">
        Family suggested these off-list gifts and the parents said yes — no need to buy
        them again.
      </p>
      <div className="proposal-list">
        {proposals.map((p) => (
          <div className="proposal-row" key={p.id}>
            {p.image_url ? (
              <img className="cart-thumb" src={p.image_url} alt="" />
            ) : (
              <span className="cart-thumb cart-thumb-art">🎁</span>
            )}
            <span className="proposal-main">
              <a href={p.url} target="_blank" rel="noreferrer">
                <strong>{p.title}</strong>
              </a>
              <span className="muted small">
                {p.suggester_name ? `${p.suggester_name} is getting this` : 'Already being gifted'}
                {p.child_name ? ` · for ${p.child_name}` : ''}
                {priceLabel(p.price, p.currency) ? ` · ${priceLabel(p.price, p.currency)}` : ''}
              </span>
            </span>
            <span className="claimed-badge">✓ Approved</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function SuggestGift({ slug, kids = [] }) {
  const [childId, setChildId] = useState('')
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(suggesterNameKey) ?? ''
    } catch {
      return ''
    }
  })
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [mine, setMine] = useState([])

  async function loadMine() {
    const stored = loadProposalTokens(slug)
    if (!stored.length) return
    const { data, error: err } = await supabase.functions.invoke('suggest-gift', {
      body: { mode: 'mine', slug, tokens: stored.map((t) => t.token) },
    })
    if (!err && Array.isArray(data?.proposals)) setMine(data.proposals)
  }

  useEffect(() => {
    loadMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!url.trim()) return setError('Paste the link to the gift first.')
    setBusy(true)
    const { data, error: err } = await supabase.functions.invoke('suggest-gift', {
      body: {
        mode: 'suggest',
        slug,
        url: url.trim(),
        title: title.trim(),
        name: name.trim(),
        note: note.trim(),
        child_id: childId || null,
      },
    })
    setBusy(false)
    if (err) return setError(await functionMessage(err))
    if (data?.ok === false && data?.reason === 'already_proposed') {
      return setMessage(
        data.status === 'approved'
          ? `Good eye — “${data.title}” was already suggested and approved. It's covered!`
          : `“${data.title}” has already been suggested and is waiting for the parents' decision.`
      )
    }
    if (!data?.ok || !data.proposal) return setError('Something went wrong — try again.')
    try {
      localStorage.setItem(suggesterNameKey, name.trim())
    } catch {
      // remembering the name is a nicety only
    }
    addProposalToken(slug, { id: data.proposal.id, token: data.token })
    setMine((prev) => [
      {
        id: data.proposal.id,
        title: data.proposal.title,
        url: url.trim(),
        image_url: data.proposal.image_url,
        status: 'pending',
        child_name: kids.find((k) => k.id === childId)?.name ?? null,
      },
      ...prev,
    ])
    setUrl('')
    setTitle('')
    setNote('')
    setMessage(
      'Sent! The parents will take a look — once approved, it shows here for all gift-givers so nobody doubles up.'
    )
  }

  async function withdraw(p) {
    const stored = loadProposalTokens(slug).find((t) => t.id === p.id)
    if (!stored) return
    const { data, error: err } = await supabase.functions.invoke('suggest-gift', {
      body: { mode: 'withdraw', slug, id: p.id, token: stored.token },
    })
    if (!err && data?.ok) {
      setMine((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, status: 'withdrawn' } : x))
      )
    }
  }

  return (
    <section className="proposal-public">
      <h3>💡 Want to buy something that's not on the list?</h3>
      <p className="muted">
        Paste a link to it here. The parents approve suggestions first — that way two
        people don't buy the same surprise.
      </p>
      <form className="form" onSubmit={submit}>
        <div className="row wrap">
          <label>
            For
            <select value={childId} onChange={(e) => setChildId(e.target.value)}>
              <option value="">The family</option>
              {kids.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grandma"
              maxLength={60}
            />
          </label>
        </div>
        <label>
          Link to the gift
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
          />
        </label>
        <div className="row wrap">
          <label>
            What is it?
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Tricycle"
              maxLength={120}
            />
          </label>
          <label>
            Note for the parents <span className="muted">(optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Saw this and thought of her!"
              maxLength={300}
            />
          </label>
        </div>
        <div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
        </div>
      </form>
      {message && <p className="notice ok">{message}</p>}
      {error && <p className="notice warn">{error}</p>}

      {mine.length > 0 && (
        <>
          <h4>Your suggestions</h4>
          <div className="proposal-list">
            {mine.map((p) => (
              <div className="proposal-row" key={p.id}>
                {p.image_url ? (
                  <img className="cart-thumb" src={p.image_url} alt="" />
                ) : (
                  <span className="cart-thumb cart-thumb-art">🎁</span>
                )}
                <span className="proposal-main">
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <strong>{p.title}</strong>
                  </a>
                  <span className="muted small">
                    {proposalStatusLabel(p.status)}
                    {p.child_name ? ` · for ${p.child_name}` : ''}
                  </span>
                </span>
                {p.status === 'pending' && (
                  <button type="button" onClick={() => withdraw(p)}>
                    Withdraw
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
