import { amazonUrlFor } from '../lib/amazon'
import { bundleHeadline } from '../lib/bundles'

// The coverage note shown on a bundle tile: how much of the set
// the child already has, and what's still missing. For
// gift-givers the missing pieces are buy links (complete the
// set instead of re-buying it); on the parent's own lists the
// caller passes `onHave` and each missing piece becomes a
// one-tap "mark as have" instead — the parent isn't shopping,
// they're tidying their own shelves. `info` is the
// { total, owned, missing } shape both the share RPC and
// lib/bundles produce.
export default function BundleNote({ info, name, platform, onHave }) {
  if (!info || !info.total) return null
  // Owning none of the pieces makes the note pure noise — the
  // "still missing" list is just the whole set the tile itself
  // already shows. The note earns its space from the first
  // owned piece on (progress + what completes the set).
  if (!info.owned) return null
  const complete = info.owned >= info.total
  return (
    <div className="bundle-note">
      <p className="bundle-line">
        🧺 {bundleHeadline({ name, owned: info.owned, total: info.total, platform })}
      </p>
      {complete ? (
        <p className="bundle-missing">That completes the set ✓ — no need to buy this one.</p>
      ) : (
        info.missing?.length > 0 &&
        (onHave ? (
          <p className="bundle-missing">
            Still missing — tap one to mark it as have:{' '}
            {info.missing.map((m, i) => (
              <span key={`${m.platform}-${m.title}`}>
                {i > 0 && ' · '}
                <button type="button" className="bundle-have" onClick={() => onHave(m)}>
                  {m.title} ✓
                </button>
              </span>
            ))}
          </p>
        ) : (
          <p className="bundle-missing">
            Still missing:{' '}
            {info.missing.map((m, i) => (
              <span key={`${m.platform}-${m.title}`}>
                {i > 0 && ' · '}
                <a href={amazonUrlFor(m)} target="_blank" rel="sponsored nofollow noopener">
                  {m.title} ↗
                </a>
              </span>
            ))}
          </p>
        ))
      )}
    </div>
  )
}
