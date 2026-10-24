// Subdomain share links are THE share links (owner decision
// 2026-10-23): a family's gift page lives at
// <slug>.toylibrary.store and nowhere else — the old
// toylibrary.store/<slug> and /s/<slug> paths are gone, so a
// family name can never collide with a future site page.
// App.jsx reads the subdomain and renders the gift page in
// place; the URL in the visitor's browser stays the subdomain.

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

// The one canonical share URL for a family's slug.
export function shareUrlFor(slug) {
  return `https://${slug}.toylibrary.store`
}
