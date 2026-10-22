import { PLATFORMS } from '../lib/platforms'

// The platform's brand mark for chips, tabs and section
// headers: the real product logo where we have one (public/
// logos/), on a brand-color badge when the logo itself is
// white/monochrome, and the platform emoji as the fallback
// for the generic shelves (books, projector, other).
export default function PlatformMark({ platform, className = '' }) {
  const entry = PLATFORMS.find((p) => p.key === platform)
  if (!entry) return null
  if (entry.logo && entry.logoBg) {
    return (
      <span className={`plat-badge ${className}`} style={{ background: entry.logoBg }} aria-hidden="true">
        <img src={entry.logo} alt="" loading="lazy" />
      </span>
    )
  }
  if (entry.logo) {
    return <img className={`plat-logo ${className}`} src={entry.logo} alt="" loading="lazy" aria-hidden="true" />
  }
  return (
    <span className={`plat-emoji ${className}`} aria-hidden="true">
      {entry.emoji}
    </span>
  )
}
