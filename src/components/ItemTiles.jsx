import ItemTile from './ItemTile'
import BundleNote from './BundleNote'
import { PLATFORMS, platformEmoji, platformLabel } from '../lib/platforms'

// Read-only tile grid grouped by platform — used for the share page's
// have list. (The wishlist needs claim buttons, so it has its own
// tile component; the dashboard has an editable variant.)
export default function ItemTiles({ items, emptyText }) {
  if (!items.length) return <p className="empty">{emptyText}</p>

  const byPlatform = items.reduce((acc, item) => {
    ;(acc[item.platform] ??= []).push(item)
    return acc
  }, {})
  const ordered = PLATFORMS.map((p) => p.key).filter((k) => byPlatform[k])

  return (
    <div>
      {ordered.map((platform) => (
        <section key={platform} className="platform-group">
          <h3>
            {platformEmoji(platform)} {platformLabel(platform)}
          </h3>
          <div className="tile-grid">
            {byPlatform[platform].map((item) => (
              <ItemTile key={item.id} item={item}>
                <BundleNote info={item.bundle} name={item.child_name} platform={item.platform} />
              </ItemTile>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
