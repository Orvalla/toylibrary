// identify-items — what's in this photo?
//
// The dashboard's "Add from a photo" flow sends one downscaled
// shelf photo (a data URL) and gets back the story-toy products a
// vision model can identify in it: [{ title, platform,
// confidence }]. The client matches those detections against the
// catalog and lets the parent confirm before anything is added —
// this function writes nothing itself.
//
// Requires a signed-in user (same JWT check as ingest-catalog).
// The vision call uses OPENAI_API_KEY from the function's secret
// environment; without it the function answers
// { configured: false, items: [] } so the UI can say photo
// scanning isn't switched on instead of failing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const MODEL = Deno.env.get('VISION_MODEL') ?? 'gpt-4o-mini'
// The client downscales to ≤1024px JPEG (~a few hundred KB); this
// cap is headroom, not an invitation.
const MAX_IMAGE_CHARS = 4_500_000
const MAX_ITEMS = 40

const PLATFORM_KEYS = [
  'tonies',
  'yoto',
  'leapfrog',
  'projector',
  'vtech',
  'books',
  'other',
  'storypod',
  'osmo',
  'lunii',
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const PROMPT = `You are helping a parent catalogue a child's story toys from a photo. List every DISTINCT physical story-toy product you can identify in the image:
- Tonie or Creative Tonie figures — title is the character or franchise shown, e.g. "Paw Patrol — Chase", "Blippi"
- Yoto cards — use the card's printed title
- Little Tikes Story Dream Machine story cartridges/books — use the story title
- LeapFrog / LeapPad books and cartridges — use the printed title
- Storypod audio figures and cards, Lunii story packs, Osmo games
- Printed picture books — use the book's title

Rules: one entry per physical product (a product appearing twice is listed once); use the title as printed when legible, otherwise the character/franchise name; do not list generic toys, furniture, people, or the storage/shelf itself; if you cannot identify any story-toy products, return an empty list.

Respond with JSON only, no other text:
{"items": [{"title": "...", "platform": "tonies", "confidence": 0.9}]}
platform is one of: tonies, yoto, leapfrog, projector, storypod, lunii, osmo, books, vtech, other. confidence is 0 to 1 — how sure you are of that identification.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Please sign in first.' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Your session has expired — sign in again.' }, 401)
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Expected a JSON request body.' }, 400)
    }
    const image = typeof body?.image === 'string' ? body.image : ''
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)) {
      return json({ error: 'Send one photo as a JPEG, PNG or WebP data URL.' }, 400)
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return json({ error: 'That photo is too large — try a smaller one.' }, 413)
    }

    if (!OPENAI_API_KEY) return json({ configured: false, items: [] })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      console.error('vision provider error', res.status, await res.text().catch(() => ''))
      return json({ error: 'The photo service had a hiccup — please try again.' }, 502)
    }
    const payload = await res.json()
    let parsed: any = {}
    try {
      parsed = JSON.parse(payload?.choices?.[0]?.message?.content ?? '{}')
    } catch {
      return json({ error: 'Could not read that photo — try another one.' }, 502)
    }
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : []
    const items = rawItems
      .filter((i: any) => i && typeof i.title === 'string' && i.title.trim())
      .slice(0, MAX_ITEMS)
      .map((i: any) => ({
        title: String(i.title).trim().slice(0, 200),
        platform: PLATFORM_KEYS.includes(i.platform) ? i.platform : 'other',
        confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0)),
      }))
    return json({ configured: true, items })
  } catch (err) {
    console.error('identify-items failed', err)
    return json({ error: 'Something went wrong reading that photo.' }, 500)
  }
})
