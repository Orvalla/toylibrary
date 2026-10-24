import { amazonUrlFor } from '../lib/amazon'
import { bundleHeadline } from '../lib/bundles'

// The coverage note shown on a bundle tile: how much of the set
// the child already has, and buy links for just the missing
// pieces (so a gift-giver can complete the set instead of
// re-buying it). `info` is the { total, owned, missing } shape
// both the share RPC and lib/bundles produce.
export default function BundleNote({ info, name, platform }) {
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
        info.missing?.length > 0 && (
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
        )
      )}
    </div>
  )
}
