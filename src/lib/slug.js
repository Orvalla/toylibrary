// Custom share slugs: a family's gift-giver link is
// {origin}/s/<slug>. Auto-generated slugs (fam-015f2077) are hard
// to say out loud, so parents can pick their own in Settings.
// These helpers mirror the server rules in migration 0012
// (set_share_slug + the profiles_share_slug_format check) so the
// UI can clean up and vet a choice before the round-trip.

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'about', 'books', 'brand', 'catalog',
  'dashboard', 'devices', 'forgot-password', 'help', 'login',
  'privacy', 'reset-password', 's', 'settings', 'share',
  'signup', 'support', 'terms', 'toy-library', 'toylibrary',
  'unsubscribe', 'welcome', 'www',
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
