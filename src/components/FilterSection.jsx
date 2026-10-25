import { useState } from 'react'

// One collapsible filter group: a header row (group name +
// the current selection as a one-line summary + a chevron)
// and the chip row when open. The summary keeps a folded
// section informative — "Platform · Books" still says where
// you are.
export function FilterSection({ id, label, summary, open, onToggle, children }) {
  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-section-head"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="filter-section-label">{label}</span>
        <span className="filter-section-summary">{summary}</span>
        <span className="filter-section-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

// One outer collapsible section (owner request 2026-10-24):
// whole groups of controls — the catalog's filter sections,
// the dashboard's add-by-hand form — start folded to this
// single header row, so a page opens on content, not controls.
// The header keeps a one-line summary (plus an optional badge)
// so the folded group still says what's set inside it.
export function FilterGroup({ label, summary, badge = null, tourId, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="filter-section" data-tour={tourId}>
      <button
        type="button"
        className="filter-section-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filter-section-label">{label}</span>
        <span className="filter-section-summary">{summary}</span>
        {badge != null && <span className="filter-group-badge">{badge}</span>}
        <span className="filter-section-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="filter-group-body">{children}</div>}
    </div>
  )
}
