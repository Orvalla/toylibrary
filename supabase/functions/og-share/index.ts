// og-share — per-family link previews for gift-page subdomains.
//
// A family's share link is https://<slug>.toylibrary.store, and
// the people who receive it (grandparents, in a text message)
// decide whether to tap from the preview card. The SPA serves
// one static index.html for every host, so crawlers used to get
// the same generic title for every family. nginx (see the
// repo's nginx.conf) sends requests for "/" from known crawler
// user agents on family subdomains here instead; this function
// answers with a tiny HTML page carrying that family's own
// Open Graph tags. Humans never see it — they get the real app.
//
// Public by design (verify_jwt is OFF): the only data it emits
// is the display name and children's first names of a family
// whose share page is already public — the same things the
// gift page itself shows anyone with the link.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const GENERIC = {
  title: 'Toy Library — fewer duplicate gifts, happier holidays',
  description:
    'See what the kids are wishing for, check what they already have, and claim a gift so nothing gets bought twice.',
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function page(title: string, description: string, url: string) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Toy Library" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:image" content="https://toylibrary.store/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="https://toylibrary.store/og.png" />
</head>
<body>
<p><a href="${escapeHtml(url)}">${t}</a> — ${d}</p>
</body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') ?? '').toLowerCase()
  const pageUrl = slug ? `https://${slug}.toylibrary.store/` : 'https://toylibrary.store/'

  if (!/^[a-z0-9-]{1,64}$/.test(slug) || !SUPABASE_SERVICE_ROLE_KEY) {
    return page(GENERIC.title, GENERIC.description, pageUrl)
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: profile } = await admin
      .from('profiles')
      .select('id, display_name')
      .eq('share_slug', slug)
      .eq('share_enabled', true)
      .single()
    if (!profile) return page(GENERIC.title, GENERIC.description, pageUrl)

    const { data: kids } = await admin
      .from('children')
      .select('name')
      .eq('owner_id', profile.id)
      .order('sort_order')
      .order('name')
      .limit(3)
    const names = (kids ?? []).map((k) => k.name).filter(Boolean)
    const family = profile.display_name?.trim() || 'A family'
    const title = `${family} · Toy Library gift lists`
    const description = names.length
      ? `See what's on ${names.join(' and ')}'s wishlist, check what they already have, and claim a gift so nothing gets bought twice.`
      : GENERIC.description
    return page(title, description, pageUrl)
  } catch {
    return page(GENERIC.title, GENERIC.description, pageUrl)
  }
})
