import { KINDS } from '../lib/kinds'

// The main shelves, as big friendly buttons above the brand
// chips: Books / Board games / Story devices / Toys & play.
// `counts` maps kind key -> rows in it (computed by the
// browser from the full catalog, so the numbers don't shrink
// as other filters narrow).
export default function KindBar({ counts, value, onChange }) {
  return (
    <div className="kind-bar" role="group" aria-label="Main shelves">
      {KINDS.map((k) => (
        <button
          key={k.key}
          className={value === k.key ? 'kind-btn active' : 'kind-btn'}
          onClick={() => onChange(k.key)}
          aria-pressed={value === k.key}
        >
          <span className="kind-emoji" aria-hidden="true">
            {k.emoji}
          </span>
          {k.label}
          {counts?.[k.key] != null && (
            <span className="kind-count">{counts[k.key].toLocaleString('en-US')}</span>
          )}
        </button>
      ))}
    </div>
  )
}
