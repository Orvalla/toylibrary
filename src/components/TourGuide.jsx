import { useEffect, useState } from 'react'

// A lightweight guided tour: a bottom card that walks the
// parent through the dashboard's key spots, scrolling each
// one into view and ringing it with a highlight. Steps whose
// anchor isn't on the page (gift ideas only exist once a
// child is picked, say) are skipped automatically. Anchors
// are data-tour attributes on the dashboard's sections.

const STEPS = [
  {
    anchor: 'share',
    title: 'This is the whole trick 👋',
    body: 'Your gift-giver link. Send it to grandparents, aunts, uncles — anyone who buys gifts. They see the wishlist and what you already own, so no duplicates.',
  },
  {
    anchor: 'lists',
    title: 'Two lists, that’s it',
    body: '“We have it” is everything on your shelves. “Wishlist” is what you’d love the kids to get. Gift-givers only ever shop from the wishlist side.',
  },
  {
    anchor: 'children',
    title: 'One list per child',
    body: 'Each child gets their own have-list and wishlist. Switch between them here — or pick Family for shared toys.',
  },
  {
    anchor: 'add',
    title: 'Add things by hand',
    body: 'Type anything — a book from a yard sale, a hand-me-down player. It lands on whichever list is open above.',
  },
  {
    anchor: 'photo',
    title: '…or snap a photo 📸',
    body: 'Photograph a shelf or a pile of Tonies and we’ll spot the story toys in it. You confirm before anything is added. Ten scans a day.',
  },
  {
    anchor: 'ideas',
    title: 'Gift ideas that fit',
    body: 'Suggestions based on the players your child owns, their age, and what they’re into. One tap puts an idea on the wishlist.',
  },
  {
    anchor: 'catalog',
    title: 'Browse the whole catalog',
    body: 'Thousands of Tonies, Yoto cards, books and more, with age guides and ratings. Tap to add the ones already on your shelf.',
  },
]

export default function TourGuide({ onClose }) {
  // Anchors are measured AFTER mount, in an effect: during
  // the render pass the dashboard's own DOM isn't committed
  // yet, so querying then would find nothing and the tour
  // would close itself instantly.
  const [steps, setSteps] = useState(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setSteps(STEPS.filter((s) => document.querySelector(`[data-tour="${s.anchor}"]`)))
  }, [])

  useEffect(() => {
    if (steps && !steps.length) onClose()
  }, [steps, onClose])

  const step = steps?.[Math.min(index, Math.max(steps.length - 1, 0))]

  useEffect(() => {
    if (!step) return undefined
    const el = document.querySelector(`[data-tour="${step.anchor}"]`)
    if (!el) return undefined
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    el.classList.add('tour-highlight')
    return () => el.classList.remove('tour-highlight')
  }, [step])

  if (!step) return null
  const last = index >= steps.length - 1

  return (
    <div className="tour-overlay">
      <div className="tour-card" role="dialog" aria-modal="false" aria-label="Guided tour">
        <p className="tour-count">
          Step {index + 1} of {steps.length}
        </p>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="linklike" onClick={onClose}>
            Skip tour
          </button>
          <span className="tour-nav">
            {index > 0 && (
              <button className="btn btn-small btn-ghost" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              className="btn btn-small"
              onClick={() => (last ? onClose() : setIndex(index + 1))}
            >
              {last ? 'Finish 🎉' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
