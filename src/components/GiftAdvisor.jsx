import { useState } from 'react'
import ToyLibrarian, { useAdvisorVisible } from './ToyLibrarian'
import { MASCOT_SRC, probeAdvisor } from '../lib/advisorClient'
import './ToyLibrarian.css'

// Gift-page door to the Toy Librarian (WS7 spec §1, page mode).
// PublicListPage mounts this with the page's own data: the share
// slug and the children the page already lists (id + first name).
// Nothing else about the child is read here; the function loads
// the rest server-side from the same slug.
//
// Renders nothing while the advisor is off, and (owner ruling
// 2026-11-13) nothing for non-admins until the advisor_public
// flag opens her to everyone (spec §8 + migration 0067).

export default function GiftAdvisor({ slug, kids = [], probe = probeAdvisor, send }) {
  const enabled = useAdvisorVisible(probe)
  const [open, setOpen] = useState(false)
  const [childId, setChildId] = useState(kids.length === 1 ? kids[0].id : null)

  if (!enabled || !slug) return null

  if (!open) {
    return (
      <div className="gift-advisor-open">
        <img src={MASCOT_SRC} alt="" width="44" height="44" loading="lazy" />
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Ask the Toy Librarian for a gift idea
        </button>
      </div>
    )
  }

  const child = kids.find((k) => k.id === childId) ?? null
  return (
    <div className="gift-advisor">
      {kids.length > 1 && (
        <div className="librarian-kids" role="group" aria-label="Who are you shopping for?">
          <span className="muted small">Shopping for:</span>
          {kids.map((k) => (
            <button
              key={k.id}
              type="button"
              className="librarian-chip"
              aria-pressed={k.id === childId}
              onClick={() => setChildId(k.id)}
            >
              {k.name}
            </button>
          ))}
        </div>
      )}
      <ToyLibrarian
        mode="page"
        slug={slug}
        childId={child?.id ?? null}
        childName={child?.name ?? ''}
        {...(send ? { send } : {})}
      />
    </div>
  )
}
