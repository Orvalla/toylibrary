import { manufacturerUrlFor } from '../lib/manufacturer'
import { platformLabel } from '../lib/platforms'

// The direct manufacturer link shown next to the Amazon link
// on item tiles (owner request 2026-10-22): the item's own
// product page at the maker's store. Direct pages only —
// items without one render nothing here (the owner ruled out
// linking to a maker's general catalog).
export default function ManufacturerLink({ item }) {
  const url = manufacturerUrlFor(item)
  if (!url) return null
  const maker = platformLabel(item.platform).split(' / ')[0]
  return (
    <a className="linklike manufacturer-link" href={url} target="_blank" rel="noopener">
      {`🏭 At ${maker} ↗`}
    </a>
  )
}
