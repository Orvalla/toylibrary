import { manufacturerUrlFor } from '../lib/manufacturer'
import { platformLabel } from '../lib/platforms'

// The direct manufacturer link shown next to the Amazon link
// on item tiles (owner request 2026-10-22): the item's own
// product page when the catalog knows it, otherwise the
// maker's official store. Renders nothing for platforms with
// no maker site (books, other).
export default function ManufacturerLink({ item }) {
  const url = manufacturerUrlFor(item)
  if (!url) return null
  const maker = platformLabel(item.platform).split(' / ')[0]
  const label = item.product_url ? `🏭 At ${maker} ↗` : `🏭 ${maker} site ↗`
  return (
    <a className="linklike manufacturer-link" href={url} target="_blank" rel="noopener">
      {label}
    </a>
  )
}
