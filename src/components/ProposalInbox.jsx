import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { priceLabel, proposalStatusLabel } from '../lib/proposals'

// The parents' gift-proposal inbox (migration 0024): family
// suggest off-list gifts from the share page; each waits here
// for a yes or no. Approving publishes it on the share page
// ("Grandma is getting this") so nobody else buys the same
// thing. Rows are the owner's own — plain RLS reads/updates,
// no RPC needed.
export default function ProposalInbox({ kids = [] }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const kidName = (p) => kids.find((k) => k.id === p.child_id)?.name ?? null

  async function load() {
    const { data, error: err } = await supabase
      .from('gift_proposals')
      .select('*')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setRows(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function decide(p, status) {
    setError('')
    const decided_at = status === 'pending' ? null : new Date().toISOString()
    const { error: err } = await supabase
      .from('gift_proposals')
      .update({ status, decided_at })
      .eq('id', p.id)
    if (err) return setError(err.message)
    setRows((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, status, decided_at } : x))
    )
  }

  // Withdrawn proposals were retracted by the suggester — the
  // parents never need to see them.
  const visible = (rows ?? []).filter((p) => p.status !== 'withdrawn')
  const waiting = visible.filter((p) => p.status === 'pending')
  const decided = visible.filter((p) => p.status !== 'pending').slice(0, 10)

  return (
    <section className="card proposal-inbox">
      <h2>
        🎁 Gift proposals
        {waiting.length > 0 && <span className="count-badge">{waiting.length} waiting</span>}
      </h2>
      <p className="muted">
        Family can suggest gifts that aren't on the wishlist from your share page.
        Approved ones appear there, so nobody else buys the same gift.
      </p>
      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No suggestions yet — they'll land here for a yes or no.</p>
      ) : (
        <>
          {waiting.length === 0 && <p className="muted">All caught up — nothing waiting.</p>}
          <div className="proposal-list">
            {waiting.map((p) => (
              <div className="proposal-row" key={p.id}>
                {p.image_url ? (
                  <img className="cart-thumb" src={p.image_url} alt="" />
                ) : (
                  <span className="cart-thumb cart-thumb-art">🎁</span>
                )}
                <span className="proposal-main">
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <strong>{p.title}</strong> ↗
                  </a>
                  <span className="muted small">
                    {p.suggester_name ? `from ${p.suggester_name}` : 'from a gift-giver'}
                    {kidName(p) ? ` · for ${kidName(p)}` : ' · for the family'}
                    {priceLabel(p.price, p.currency)
                      ? ` · ${priceLabel(p.price, p.currency)}`
                      : ''}
                  </span>
                  {p.note && <span className="small">“{p.note}”</span>}
                </span>
                <span className="proposal-actions">
                  <button type="button" className="primary" onClick={() => decide(p, 'approved')}>
                    ✓ Approve
                  </button>
                  <button type="button" onClick={() => decide(p, 'denied')}>
                    ✕ Deny
                  </button>
                </span>
              </div>
            ))}
          </div>
          {decided.length > 0 && (
            <>
              <h3>Decided</h3>
              <div className="proposal-list">
                {decided.map((p) => (
                  <div className="proposal-row" key={p.id}>
                    {p.image_url ? (
                      <img className="cart-thumb" src={p.image_url} alt="" />
                    ) : (
                      <span className="cart-thumb cart-thumb-art">🎁</span>
                    )}
                    <span className="proposal-main">
                      <strong>{p.title}</strong>
                      <span className="muted small">
                        {proposalStatusLabel(p.status)}
                        {p.suggester_name ? ` · from ${p.suggester_name}` : ''}
                      </span>
                    </span>
                    <button type="button" onClick={() => decide(p, 'pending')}>
                      Reconsider
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
