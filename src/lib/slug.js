// Custom share slugs: a family's gift-giver link is
// <slug>.toylibrary.store. Auto-generated slugs (fam-015f2077)
// are hard to say out loud, so parents can pick their own in
// Settings. These helpers mirror the server rules in
// migration 0038 (set_share_slug) so the UI can clean up and
// vet a choice before the round-trip.
//
// Since slugs became subdomains (2026-10-23), page names no
// longer need fencing — a family called "books" can't collide
// with the /books page from books.toylibrary.store. Only
// infrastructure-flavoured names stay reserved, so a family
// subdomain never impersonates a service address.
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'billing', 'blog',
  'cdn', 'help', 'login', 'mail', 'media', 'pay', 'secure',
  'shop', 'signup', 'static', 'store', 'support', 'toy-library',
  'toylibrary', 'unsubscribe', 'www',
])

// Turn whatever the parent typed ("The Millers!", "my_family")
// into the closest legal slug ("the-millers", "my-family").
export function normalizeShareSlug(input) {
  return String(input ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Returns null when the (already normalized) slug is acceptable,
// or a parent-friendly sentence explaining what to fix.
export function validateShareSlug(slug) {
  if (!slug) return 'Enter a name for your link first.'
  if (slug.length < 3) return 'Use at least 3 characters.'
  if (slug.length > 30) return 'Keep it under 30 characters.'
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return 'Letters, numbers and hyphens only — and no hyphen at the start or end.'
  }
  if (slug.includes('--')) return 'Use single hyphens, not doubles.'
  if (RESERVED_SLUGS.has(slug)) return 'That one is reserved — try another.'
  return null
}
