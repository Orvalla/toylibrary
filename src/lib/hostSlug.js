// Subdomain share links: millers.toylibrary.store should land a
// gift-giver on the same page as toylibrary.store/millers. The SPA
// host only serves one app, so main.jsx reads the subdomain and
// redirects to the canonical path form — the visitor's browser
// ends up in exactly one place, and carts/claims (stored per
// origin) never split across two addresses.

const SHARE_HOST_SUFFIX = '.toylibrary.store'
const NON_SLUG_LABELS = new Set(['www'])

// A hostname -> its share slug, or null when the host is the
// apex, www, a dev host, or anything that isn't a clean slug
// label under toylibrary.store.
export function shareSlugFromHost(hostname) {
  const host = String(hostname ?? '').toLowerCase()
  if (!host.endsWith(SHARE_HOST_SUFFIX)) return null
  const label = host.slice(0, -SHARE_HOST_SUFFIX.length)
  if (!label || label.includes('.')) return null
  if (NON_SLUG_LABELS.has(label)) return null
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(label)) return null
  return label
}
