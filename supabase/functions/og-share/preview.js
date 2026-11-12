// Pure preview-card logic for og-share (WS2, 2026-11-11).
//
// Kept in plain JS with no Deno or Supabase imports so the vitest
// suite can test exactly what a crawler receives, and so the gift
// page itself (PublicListPage) can use the same title for the
// browser tab: a phone's share sheet sends document.title along
// with the link, so tab and preview card should match.
//
// The only family data used here is what the public gift page
// already shows anyone with the link: the display name and the
// children's first names.

export const OG_IMAGE = 'https://toylibrary.store/og.png'
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const OG_IMAGE_ALT = 'Toy Library: one shared gift list so nobody buys the same present twice'

export const GENERIC = {
  title: 'Toy Library — fewer duplicate gifts, happier holidays',
  description:
    'See what the kids are wishing for, check what they already have, and claim a gift so nothing gets bought twice.',
}

// "The Millers" -> "The Millers'", "Emma" -> "Emma's".
export function possessive(name) {
  const n = String(name ?? '').trim()
  if (!n) return ''
  return /s$/i.test(n) ? `${n}'` : `${n}'s`
}

// ["Emma"] -> "Emma"; ["Emma", "Leo"] -> "Emma and Leo";
// ["Emma", "Leo", "Ava"] -> "Emma, Leo and Ava".
export function joinNames(names) {
  const list = (names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

// The card title. It names whoever the family called itself
// (profiles.display_name); when that's blank, the children.
export function shareTitle({ displayName, childNames } = {}) {
  const owner = String(displayName ?? '').trim() || joinNames(childNames)
  return owner ? `${possessive(owner)} Toy Library — gift page` : 'Toy Library — gift page'
}

// The card description: an invitation to come and claim.
export function shareDescription({ childNames } = {}) {
  const list = (childNames ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)
  const tail = 'and claim a gift so nobody buys the same one twice.'
  if (!list.length) return `You're invited: see what's on this family's wishlist ${tail}`
  const verb = list.length === 1 ? 'is' : 'are'
  return `You're invited: see what ${joinNames(list)} ${verb} wishing for, ${tail}`
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// The only hosts a preview may point at: the apex, or a clean
// slug label under it (same shape og-share already accepts).
export function previewUrl(slug) {
  return /^[a-z0-9-]{1,64}$/.test(slug ?? '')
    ? `https://${slug}.toylibrary.store/`
    : 'https://toylibrary.store/'
}

// The tiny HTML page a link-preview crawler receives.
export function renderPreviewHtml({ title, description, url }) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const u = escapeHtml(url)
  const img = escapeHtml(OG_IMAGE)
  const alt = escapeHtml(OG_IMAGE_ALT)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="canonical" href="${u}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Toy Library" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${u}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:secure_url" content="${img}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
<meta property="og:image:alt" content="${alt}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
<meta name="twitter:image:alt" content="${alt}" />
</head>
<body>
<p><a href="${u}">${t}</a> — ${d}</p>
</body>
</html>`
}

// Everything og-share decides, given what it looked up.
// `profile` is null when the slug is unknown or sharing is off:
// that family gets the generic card, never a hint it exists.
export function buildPreview({ slug, profile, childNames }) {
  const url = previewUrl(slug)
  if (!profile) return { title: GENERIC.title, description: GENERIC.description, url }
  return {
    title: shareTitle({ displayName: profile.display_name, childNames }),
    description: shareDescription({ childNames }),
    url,
  }
}
