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
//
// Each user is limited to 10 scans per rolling 24 hours
// (photo_scans, migration 0015): the count is checked before
// the vision call and the scan is recorded after a successful
// one, so a provider hiccup never eats a user's scan. When the
// limit is hit the answer is { configured: true, limited: true,
// items: [] } and the UI explains the wait.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const SCAN_LIMIT = 10
const SCAN_WINDOW_MS = 24 * 60 * 60 * 1000
const MODEL = Deno.env.get('VISION_MODEL') ?? 'gpt-4o'
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
  // Physical toys & games (catalog rounds 2026-10-22): a shelf
  // photo today is as likely to hold game boxes and kits as
  // story toys, and the catalog matcher's platform bonus only
  // works if the vision pass can name the brand.
  'haba',
  'magnatiles',
  'smartgames',
  'lovevery',
  'melissaanddoug',
  'littlepeople',
  'brio',
  'fatbrain',
  'lakeshore',
  'learningresources',
  'littletikes',
  'thamesandkosmos',
  'thinkfun',
  'ravensburger',
  'kiwico',
  'eeboo',
  'mudpuppy',
  'sphero',
  // Board game publishers (2026-10-23): game-night shelves and
  // closet stacks — the box lid or spine usually prints the
  // publisher's name/logo, which is what decides the platform.
  'asmodee',
  'pandasaurus',
  'renegade',
  'floodgate',
  'catan',
  'blueorange',
  'iello',
  'capstone',
  'explodingkittens',
  'hachette',
  'goliath',
  'relatable',
  'buffalogames',
  'spinmaster',
  'devir',
  // Round-4 wooden & classic toy brands (2026-10-23).
  'plantoys',
  'hape',
  'janod',
  'letoyvan',
  'tenderleaf',
  'greentoys',
  'manhattantoy',
  'tegu',
  'guidecraft',
  'unclegoose',
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

const PROMPT = `You are helping a parent catalogue a child's books and story toys from a photo — often a bookshelf. List every DISTINCT physical product you can identify in the image:

BOOKS (usually the bulk of a shelf photo): work systematically — shelf by shelf, left to right, reading every spine and cover you can.
- title: exactly as printed on the spine or cover. If only part is legible, give the legible part and lower your confidence — a partial title beats skipping the book.
- author: the author's name as printed, whenever it is visible. This matters: it disambiguates series and sequels. Use "" when no author is visible.
- A run of books from one series still counts book by book — list each distinct title once.

PHYSICAL TOYS & GAMES: branded game boxes, construction sets, science kits, puzzles and coding robots — use the product's printed name and set platform to the brand: haba, magnatiles, smartgames, lovevery, melissaanddoug, littlepeople, brio, fatbrain, lakeshore, learningresources, littletikes, thamesandkosmos, thinkfun, ravensburger, kiwico, eeboo, mudpuppy, sphero. A Ravensburger game or GraviTrax box is "ravensburger" (a ThinkFun-branded game is "thinkfun"); a Thames & Kosmos kit is "thamesandkosmos". Wooden and classic toy brands also appear on shelves: plantoys, hape, janod, letoyvan, tenderleaf, greentoys, manhattantoy, tegu, guidecraft, unclegoose (Uncle Goose blocks, Tegu magnetic wooden blocks) — use the brand printed on the toy or box.
BOARD GAMES: a board game collection photo shows box lids and spines stacked on shelves or in a closet — read each box's printed title and set platform to the publisher printed on the box: asmodee (incl. Ticket to Ride, CATAN studio editions, Zombicide, Arkham Horror, Spot It!/Dobble), pandasaurus, renegade, floodgate, catan (any CATAN-branded box), blueorange (Kingdomino, Gobblet), iello (King of Tokyo), capstone, explodingkittens (Exploding Kittens, Throw Throw Burrito), hachette (Gigamic, Scorpion Masqué and other Hachette Board Games studios), goliath (Sequence, Rummikub, Pressman games), relatable (family editions only), buffalogames, spinmaster (Spin Master Games line), devir. A HABA, Ravensburger, ThinkFun or SmartGames box stays haba / ravensburger / thinkfun / smartgames. If no publisher is legible, use the game title alone with platform "other".

STORY TOYS:
- Tonie or Creative Tonie figures — title is the character or franchise shown, e.g. "Paw Patrol — Chase", "Blippi"
- Yoto cards — use the card's printed title
- Little Tikes Story Dream Machine story cartridges/books — use the story title
- LeapFrog / LeapPad books and cartridges — use the printed title
- Storypod audio figures and cards, Lunii story packs, Osmo games

Rules: one entry per physical product (a product appearing twice is listed once); use the title as printed when legible, otherwise the character/franchise name; do not list generic toys, furniture, people, or the storage/shelf itself; if you cannot identify any products, return an empty list.

Respond with JSON only, no other text:
{"items": [{"title": "...", "author": "...", "platform": "books", "confidence": 0.9}]}
platform is one of: tonies, yoto, leapfrog, projector, storypod, lunii, osmo, books, vtech, haba, magnatiles, smartgames, lovevery, melissaanddoug, littlepeople, brio, fatbrain, lakeshore, learningresources, littletikes, thamesandkosmos, thinkfun, ravensburger, kiwico, eeboo, mudpuppy, sphero, asmodee, pandasaurus, renegade, floodgate, catan, blueorange, iello, capstone, explodingkittens, hachette, goliath, relatable, buffalogames, spinmaster, devir, plantoys, hape, janod, letoyvan, tenderleaf, greentoys, manhattantoy, tegu, guidecraft, unclegoose, other. author is only for books — omit it, or use "", for anything else. confidence is 0 to 1 — how sure you are of that identification.`

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

    // The daily limit. Counting goes through the service role:
    // photo_scans has RLS on and no client policies by design.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const windowStart = new Date(Date.now() - SCAN_WINDOW_MS).toISOString()
    const { count: usedToday, error: countError } = await admin
      .from('photo_scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', windowStart)
    if (countError) {
      console.error('photo_scans count failed', countError)
      return json({ error: 'Could not check your scan count — try again.' }, 500)
    }
    if ((usedToday ?? 0) >= SCAN_LIMIT) {
      return json({ configured: true, limited: true, limit: SCAN_LIMIT, items: [] })
    }

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
    // Record the scan only now that it succeeded. A failed
    // insert shouldn't swallow a good result — log and move on.
    const { error: insertError } = await admin
      .from('photo_scans')
      .insert({ user_id: user.id })
    if (insertError) console.error('photo_scans insert failed', insertError)
    return json({
      configured: true,
      items,
      scansLeft: Math.max(0, SCAN_LIMIT - (usedToday ?? 0) - 1),
    })
  } catch (err) {
    console.error('identify-items failed', err)
    return json({ error: 'Something went wrong reading that photo.' }, 500)
  }
})
