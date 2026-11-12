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
//
// The card wording and HTML live in preview.js (pure, tested by
// the vitest suite in src/lib/ogShare.test.js); this file only
// does the lookups.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildPreview, renderPreviewHtml } from './preview.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function respond(preview: { title: string; description: string; url: string }) {
  return new Response(renderPreviewHtml(preview), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  // nginx passes the slug as a header (see nginx.conf for why);
  // the ?slug= form stays for direct calls and debugging.
  const slug = (req.headers.get('x-family-slug') ?? url.searchParams.get('slug') ?? '')
    .toLowerCase()
    .trim()

  if (!/^[a-z0-9-]{1,64}$/.test(slug) || !SUPABASE_SERVICE_ROLE_KEY) {
    return respond(buildPreview({ slug, profile: null, childNames: [] }))
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: profile } = await admin
      .from('profiles')
      .select('id, display_name')
      .eq('share_slug', slug)
      .eq('share_enabled', true)
      .single()
    if (!profile) return respond(buildPreview({ slug, profile: null, childNames: [] }))

    const { data: kids } = await admin
      .from('children')
      .select('name')
      .eq('owner_id', profile.id)
      .order('sort_order')
      .order('name')
      .limit(3)
    const childNames = (kids ?? []).map((k: { name: string }) => k.name).filter(Boolean)
    return respond(buildPreview({ slug, profile, childNames }))
  } catch {
    return respond(buildPreview({ slug, profile: null, childNames: [] }))
  }
})
