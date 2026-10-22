import { projectorGroups } from '../lib/projector'

// A platform section's tile grid. Every platform renders one flat
// grid — except the story projectors, which split into Moonlite /
// Dream Machine sub-groups with their own headings: the two systems
// are incompatible and a family owns one of them, so the split is
// how owners scan straight to their projector. renderItem(item)
// supplies the tile (each surface decorates tiles differently).
export default function PlatformGrid({ platform, items, renderItem }) {
  if (platform !== 'projector') {
    return <div className="tile-grid">{items.map(renderItem)}</div>
  }
  return projectorGroups(items).map((group) => (
    <div key={group.key ?? 'other'}>
      {group.label && (
        <h4 className="subgroup-title">
          {group.emoji} {group.label}
        </h4>
      )}
      <div className="tile-grid">{group.items.map(renderItem)}</div>
    </div>
  ))
}
