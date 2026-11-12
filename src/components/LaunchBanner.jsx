import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BANNER_DISMISS_KEY, isBannerWindow } from '../lib/launchBanner'
import { shareSlugFromHost } from '../lib/hostSlug'
import { safeGet, safeSet } from '../lib/safeStorage'

// Christmas launch announcement (WS2). Rendered only by HomePage,
// which only exists on the apex: App renders family subdomains as
// the gift page alone. The host check below is a second guard so
// a gift page can never show it even if the component is reused.
export default function LaunchBanner({ now, hostname } = {}) {
  const [dismissed, setDismissed] = useState(() => safeGet(BANNER_DISMISS_KEY) === '1')
  const host = hostname ?? globalThis.location?.hostname ?? ''
  if (dismissed || shareSlugFromHost(host) || !isBannerWindow(now ?? new Date())) return null

  return (
    <aside className="launch-banner" role="region" aria-label="Announcement">
      <p className="launch-banner-text">
        🎁 Toy Library is open for Christmas — make your family's gift page, share one link, and
        let family claim the gifts.
      </p>
      <div className="launch-banner-actions">
        <Link className="btn btn-small" to="/welcome">
          Set up my library
        </Link>
        <button
          type="button"
          className="linklike tap launch-banner-close"
          aria-label="Dismiss announcement"
          onClick={() => {
            safeSet(BANNER_DISMISS_KEY, '1')
            setDismissed(true)
          }}
        >
          ✕
        </button>
      </div>
    </aside>
  )
}
