import { useCallback, useEffect, useState } from 'react'

// A guided tour of the dashboard: a bottom card that walks
// the parent through the features that matter, scrolling
// each section into view and ringing it with a highlight.
// Anchored steps whose section isn't on the page are skipped
// (gift ideas only exist with a child picked, say); the
// opening and closing steps have no anchor and always show.
// If NO anchored step exists the page has nothing to point
// at, so the tour closes itself instead. Anchors are
// data-tour attributes; Esc / arrow keys navigate too.

const STEPS = [
  {
    anchor: null,
    title: 'Welcome to your library 👋',
    body: 'Sixty seconds, one idea: list what your kids have, share one link, and let family shop the wishlist — claiming what they’ll buy, so nobody doubles up. Here’s the map.',
  },
  {
    anchor: 'share',
    title: 'This link is the whole trick 🔗',
    body: 'Send it to grandparents, aunts, uncles — anyone who buys gifts. No account needed: they see the wishlist and what you already own, they can claim a gift (“I’m getting this”) so two people never buy the same thing, and they can gather picks into a little gift basket. Before each birthday or holiday we’ll email a gentle reminder with the link.',
  },
  {
    anchor: 'lists',
    title: 'Two lists, that’s it',
    body: '“We have it” is everything on your shelves. “Wishlist” is what you’d love them to receive. Gift-givers only ever shop from the wishlist side — the have-list is their duplicate shield.',
  },
  {
    anchor: 'children',
    title: 'One list per child',
    body: 'Each child gets their own have-list and wishlist, and their age and interests steer the suggestions. Pick Family for the shared shelf.',
  },
  {
    anchor: 'add',
    title: 'Add things by hand',
    body: 'Type anything — a yard-sale find, a hand-me-down, the book from the school fair. It lands on whichever list is open above.',
  },
  {
    anchor: 'photo',
    title: '…or snap a photo 📸',
    body: 'Photograph a whole shelf — books, games, story toys — and we’ll spot what’s in it. You confirm before anything is added, and your photo itself is never shown to anyone. Ten scans a day.',
  },
  {
    anchor: 'ideas',
    title: 'Gift ideas that fit',
    body: 'Suggestions follow the players your child owns, the shelves you’ve already filled, and their age — never younger than they are today, because they’ll grow into the rest. One tap puts an idea on the wishlist.',
  },
  {
    anchor: 'proposals',
    title: 'Family can suggest, you decide',
    body: 'From your gift page, relatives can propose a gift that isn’t on the list. It waits here for your yes or no — nobody else sees it until you approve it.',
  },
  {
    anchor: 'catalog',
    title: 'Browse everything 📚',
    body: 'Thousands of toys, games, science kits and books — including a full Book Library, from first picture books to Young Adult — with age guides and, where stores publish real ones, ratings. The filters fold away once you’ve picked a shelf.',
  },
  {
    anchor: null,
    title: 'That’s the whole map 🎉',
    body: 'Add what’s on the shelf, share the link, and let the claims roll in. You can replay this tour any time from Settings. Happy gifting!',
  },
]

export default function TourGuide({ onClose }) {
  // Anchors are measured AFTER mount, in an effect: during
  // the render pass the dashboard's own DOM isn't committed
  // yet, so querying then would find nothing and every
  // anchored step would vanish.
  const [steps, setSteps] = useState(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const kept = STEPS.filter(
      (s) => !s.anchor || document.querySelector(`[data-tour="${s.anchor}"]`)
    )
    // Anchorless bookends alone are pointless — nothing to
    // point at means this isn't the dashboard; close quietly.
    setSteps(kept.some((s) => s.anchor) ? kept : [])
  }, [])

  useEffect(() => {
    if (steps && !steps.length) onClose()
  }, [steps, onClose])

  const step = steps?.[Math.min(index, Math.max(steps.length - 1, 0))]
  const last = steps ? index >= steps.length - 1 : false

  const go = useCallback(
    (delta) => {
      if (!steps) return
      setIndex((i) => Math.min(Math.max(i + delta, 0), steps.length - 1))
    },
    [steps]
  )

  useEffect(() => {
    if (!step) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') (last ? onClose() : go(1))
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, last, go, onClose])

  useEffect(() => {
    if (!step?.anchor) return undefined
    const el = document.querySelector(`[data-tour="${step.anchor}"]`)
    if (!el) return undefined
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    el.classList.add('tour-highlight')
    return () => el.classList.remove('tour-highlight')
  }, [step])

  if (!step) return null

  return (
    <div className="tour-overlay">
      <div className="tour-card" role="dialog" aria-modal="false" aria-label="Guided tour">
        <p className="tour-count">
          Step {index + 1} of {steps.length}
        </p>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={i} className={i === index ? 'tdot on' : i < index ? 'tdot done' : 'tdot'} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="linklike" onClick={onClose}>
            Skip tour
          </button>
          <span className="tour-nav">
            {index > 0 && (
              <button className="btn btn-small btn-ghost" onClick={() => go(-1)}>
                Back
              </button>
            )}
            <button
              className="btn btn-small"
              onClick={() => (last ? onClose() : go(1))}
            >
              {last ? 'Finish 🎉' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
