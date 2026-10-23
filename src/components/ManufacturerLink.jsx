import { manufacturerNameFor, manufacturerUrlFor } from '../lib/manufacturer'

// The direct manufacturer link shown next to the Amazon link
// on item tiles (owner request 2026-10-22): the item's own
// product page at the maker's store. Direct pages only —
// items without one render nothing here (the owner ruled out
// linking to a maker's general catalog). The label names the
// site the link goes to (Open Library for books, Ravensburger
// for BRIO…), not the item's platform.
export default function ManufacturerLink({ item }) {
  const url = manufacturerUrlFor(item)
  const maker = manufacturerNameFor(item)
  if (!url || !maker) return null
  return (
    <a className="linklike manufacturer-link" href={url} target="_blank" rel="noopener">
      {`🏭 At ${maker} ↗`}
    </a>
  )
}
