# Toy Library

**Never gift the same Tonie twice.** Parents of kids with a Toniebox,
LeapPad, or storybook projector keep a list of what their child already has,
plus a wishlist — and share one link so grandparents, aunts and uncles can
check before birthdays and holidays instead of buying duplicates.

## How it works

| Piece | Tech |
| --- | --- |
| Front end | React + Vite single-page app |
| Auth & database | Supabase (Postgres + Auth) |
| Public share page | One read-only `get_shared_list(slug)` RPC — no login for gift-givers |
| Hosting | Fly.io — static files served by nginx from a small Docker image |

There is **almost no custom backend** — one small Edge Function
(`ingest-catalog`, for growing the catalog; see below) is the only
server code, and all access control still lives in the database:

- Row Level Security means a logged-in parent can only ever read/write
  their own profile and items.
- Anonymous visitors get **no table access at all**. The share page calls
  `get_shared_list()`, a `SECURITY DEFINER` function that returns only the
  have-list and wishlist for one share slug, and only while sharing is on.
- A unique index on `(owner, list, platform, normalized title, child)`
  makes the database itself refuse a true duplicate — the app turns that
  into a friendly "already on your list" message.
- **Per-child lists**: a family can have several children (plus a shared
  "Family" bucket for items with no single owner). Each child has their
  own have-list and wishlist, the dashboard filters by child, the
  catalog's owned/wishlist badges are per child, and the share page
  groups everything under "For Emma"-style headings. Duplicate
  protection is per child — Emma owning Bluey doesn't block Noah's copy.
  Deleting a child never deletes toys: their items move to Family.
- A "Mark as received" action moves a wishlist item onto the have-list
  after a holiday, so it blocks duplicates from then on.
- The share page also has a **"Check before you buy"** search that answers
  "do they already own this?" in one step.
- Everything renders as **image tiles**: items carry a photo (uploaded
  to Supabase Storage, or any image URL) with per-platform art as the
  fallback. A **browsable catalog** (`catalog_items`, seeded with the
  well-known Tonies / Yoto / LeapFrog / projector / book titles) lets parents
  tap-to-add; titles already owned show a green ✓ checkmark.
- **Parents grow the catalog themselves** ("Grow the catalog" on the
  catalog page). Two ways in: search the connected stores (Tonies,
  Yoto, Storypod, Osmo, Moonlite, Little Tikes) and tap a result, or
  paste a link to any product page and it's added automatically after
  a server-side fetch. Both go through the `ingest-catalog` Edge
  Function: it checks the caller's sign-in, fetches/extracts the
  product, and writes with the service role — clients still have no
  direct write access to `catalog_items`. Every addition is logged
  (`catalog_additions`, plus `added_by`/`source_url` on the row), and
  pasted links are fetched behind SSRF guards (public http(s) only,
  no localhost/private IPs, redirects re-validated, timeout + size
  caps).
- **Anonymous wishlist claiming** solves the mirror-image problem — two
  relatives buying the *same wishlist item*. A gift-giver claims an item
  (optional name shown, so family can coordinate); the claim is made
  through a `claim_wishlist_item()` RPC that hands back a one-time token.
  Only the token's SHA-256 hash is stored, the token lives in the
  claimer's browser, and it's required to undo the claim. Parents'
  dashboard deliberately doesn't show claim state, so gifts stay a
  surprise.
- **Occasions + claim expiry**: each child can have yearly occasions
  (birthdays, holidays — a month/day that recurs) managed in Settings.
  The share page highlights each child's next occasion and banners the
  family's nearest one, so gift-givers see what's coming. Claims are
  tied to them: a claim on a child's item holds until that child's
  nearest occasion **+ 1 day** when the occasion is within 90 days, and
  for **60 days** otherwise (family items always get 60 days). The
  claimer is told the hold-until date. Once it passes, the claim simply
  stops counting — the share RPC computes "claimed" lazily from
  `claim_expires_at`, so an expired claim never blocks a new one and
  the list stays current on its own. `expire_stale_claims()` physically
  clears stale claim fields as optional housekeeping — schedule it
  with pg_cron if you like; nothing depends on it having run.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the schema: paste each file in `supabase/migrations/` into the
   SQL Editor, in order (`0001_init.sql` through
   `0009_occasions_and_claim_expiry.sql`) — or `supabase db push` with
   the Supabase CLI. (`0005_children.sql` adds per-child lists and
   backfills existing single-child families: the profile's child
   becomes a `children` row and inherits all its items.
   `0006_yoto_platform.sql` widens the platform CHECKs to include
   Yoto, `0007_new_platforms.sql` widens them again for Storypod,
   Osmo and Lunii, `0008_user_catalog_additions.sql` adds the
   catalog provenance columns and the `catalog_additions` log, and
   `0009_occasions_and_claim_expiry.sql` adds per-child occasions
   plus claim expiry.)
3. In **Authentication → URL Configuration**, set the Site URL to your
   Fly app URL (and add `http://localhost:5173` for local dev) so email
   confirmation links land in the right place.
4. Copy the project URL and the **anon / public** key from
   **Settings → API**. (The `service_role` key is never shipped to
   clients — its only use is inside the Edge Function below, where
   the Supabase runtime provides it automatically.)
5. Deploy the catalog Edge Function (the "Grow the catalog" section
   on the catalog page calls it):

   ```bash
   supabase functions deploy ingest-catalog
   ```

   No new secrets to set: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` are all provided by the Edge runtime.
   The function rejects unauthenticated calls, so the catalog can
   only grow while a parent is signed in.

### 2. Run locally

**Option A — against your hosted Supabase project:**

```bash
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5173
```

**Option B — fully local with the Supabase CLI (Docker required):**

```bash
supabase start               # local Postgres + Auth + Studio
supabase db reset            # applies migrations + supabase/seed.sql
npm install && npm run dev
```

The seed creates a demo family so you can click through immediately:

- Login: `demo@example.com` / `demo-password`
- Two demo children (Emma and Noah) with items split between them and
  Family, so the per-child grouping shows on both pages. Emma also
  has a birthday occasion (Nov 3), which the share page highlights.
- Share page: `/s/fam-demo` (includes one pre-claimed wishlist item;
  its undo token is the literal string `demo-token`, and the claim
  expires the day after Emma's birthday, 2026-11-04)
- Local Supabase values for `.env.local` are printed by `supabase start`
  (API URL `http://localhost:54321` plus the local anon key).

### Tests & CI

```bash
npm test                     # Vitest + Testing Library (88 tests)
```

GitHub Actions: `.github/workflows/ci.yml` runs the tests and a
production build on every push/PR (with placeholder Supabase values —
CI never talks to a live project). `.github/workflows/deploy.yml`
deploys to Fly on pushes to `main`, using the `FLY_API_TOKEN`,
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` repo secrets.

## Catalog ingestor

`ingestor/` keeps `catalog_items` stocked with real products and cover
images, pulled from the manufacturers' own stores:

- **Tonies** — the us.tonies.com Shopify feed (`/products.json`),
  filtered to content figures: no Tonieboxes, bundles, or accessories.
- **Moonlite** — the mymoonlite.com Shopify feed, single stories only.
- **Little Tikes Story Dream Machine** — the littletikes.com Shopify
  feed, filtered by title to the Dream Machine story collections and
  cartridges (they share the `projector` platform with Moonlite, told
  apart by their `Dream Machine …` details): no projector-hardware
  packs, plush, or cases.
- **Yoto** — the us.yotoplay.com Shopify feed, physical cards and card
  packs only: no players, player bundles, accessories, or digital-only
  cards.
- **Storypod** — the storypod.com Shopify feed, the collectible content
  line only (Craftie figures, tokens, books, card sets, learning sets,
  content bundles): no player sleeves, standalone plush, or the Eddi
  device listings.
- **Osmo** — the playosmo.com Shopify feed, standalone games only
  (Detective Agency, the Math Wizard games, Genius Numbers/Words/
  Tangram, Monster, Pizza Co., the Little Genius piece games): no
  starter kits, bases, reflectors, cases, or the bundles that
  duplicate the singles.
- **Lunii** — lunii.com is a Next.js storefront with no feed (and the
  us.lunii.com subdomain doesn't resolve), so the adapter reads the
  store's product sitemap (`/api/products-sitemap.xml`), keeps the
  `/en-us/products/` pages, and takes title + image from each page's
  og tags. Content albums are titled "… | Audiobooks | Lunii"; the
  Storyteller/FLAM device packs, rentals, gift subscriptions and
  headphones aren't, and are dropped. Only the US storefront is
  ingested — the French line is never mixed in.
- **LeapFrog** — store.leapfrog.com embeds page 1 of its catalog as
  JSON (`PAGE_DATA`: 24 of 415 items, 18 pages) but offers no working
  server-side pagination (query params return an empty storefront
  shell, and its search API host no longer resolves), so the adapter
  takes page 1 from `PAGE_DATA` and snowball-crawls product pages for
  the rest — each page carries `og:title`/`og:image` and links ~10
  more products.

```bash
node ingestor/run.mjs                          # writes ingestor/out/catalog.json
node ingestor/run.mjs --sql ingestor/out/catalog.generated.sql
node ingestor/run.mjs --only tonies            # one source
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node ingestor/run.mjs --apply                # upsert into catalog_items
```

Sources run independently — one store being down doesn't block the
others — and rows are deduped on (platform, normalised title).

## Growing the catalog (parents, in the app)

The ingestor stocks the well-known titles, but no feed run catches
everything. The catalog page therefore ends with a **"Can't find a
product? Grow the catalog"** section (signed-in parents only):

- **Search stores** — type a name and the `ingest-catalog` Edge
  Function asks the connected Shopify stores (Tonies, Yoto, Storypod,
  Osmo, Moonlite, and Little Tikes' Dream Machine line) via their
  public search suggestions. Tap **Add to catalog** on a result and
  it's in — for every family, immediately.
- **Paste a link** — paste any product-page URL. The function fetches
  it server-side: Shopify product links are read via their
  `/products/<handle>.json` JSON; other pages are parsed for JSON-LD
  product data, falling back to Open Graph tags. Stores known to the
  ingestor map to their platform; anything else lands as `other`.

Safety, briefly: the function validates the caller's JWT before
doing anything (401 otherwise) and writes with the service role, so
the client-side "no writes to `catalog_items`" rule still holds.
Fetched URLs are SSRF-guarded — http(s) only, no localhost,
`.local`, or private/reserved IP literals, every redirect hop
re-validated, ~8s timeout, ~2MB body cap. Duplicates are refused by
the existing `(platform, title)` unique constraint and reported back
as "already in the catalog". Each addition is attributed:
`catalog_items.added_by` / `source_url`, plus a row in the
`catalog_additions` log (readable only by the parent who made it).

Live run, 2026-10-21: **3,205 catalog rows, every one with an image** —
Tonies 384, Yoto 1,568, LeapFrog 282, Moonlite 81, Little Tikes
(Story Dream Machine) 61, Storypod 284, Osmo 20, Lunii 525.

### 3. Deploy to Fly.io

```bash
fly launch --no-deploy       # keep the included fly.toml; pick your app name/region
fly deploy \
  --build-arg VITE_SUPABASE_URL=https://YOUR-REF.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=your-anon-key
```

The Supabase values are inlined into the JS bundle at build time. That's
safe by design: they are public identifiers, and Row Level Security plus
the share RPC are what actually protect the data.

## Project layout

```
src/
  supabaseClient.js     Supabase client (public anon key)
  lib/auth.jsx          Session context (sign up / in / out)
  lib/platforms.js      Tonies, Yoto, Storypod, LeapPad, Lunii, projector, Osmo, VTech, books, other
  lib/occasions.js      Occasion dates + claim-expiry rule (mirrors the 0009 SQL)
  pages/HomePage.jsx    Landing page
  pages/AuthPages.jsx   Login + signup (names feed the profile trigger)
  pages/PasswordPages.jsx  Forgot password, reset landing, 404
  pages/DashboardPage.jsx  Have list + wishlist manager, share link, on/off toggle
  pages/SettingsPage.jsx   Names, children, occasions + regenerate share link
  pages/PublicListPage.jsx Gift-giver share page + "check before you buy" + occasion highlights
  components/ClaimableWishlist.jsx  Wishlist with anonymous claim/undo
  components/GrowCatalog.jsx  "Grow the catalog": search stores / paste a link
  **/*.test.*           Vitest suites (platforms, ItemList, claiming states, extract helpers, occasions)
ingestor/              Catalog ingestor (see "Catalog ingestor" above)
supabase/config.toml   Supabase CLI project (local stack + auth settings)
supabase/functions/ingest-catalog/  Edge Function behind "Grow the catalog" (index.ts + pure extract.js helpers)
supabase/seed.sql      Demo family for local dev (never run hosted)
supabase/migrations/0001_init.sql   Tables, RLS, signup trigger, share RPC
supabase/migrations/0002_claims.sql Claim columns + claim/unclaim RPCs
supabase/migrations/0003_regenerate_slug.sql  Retire + remint a share link
supabase/migrations/0004_catalog_and_images.sql  Item photos, catalog table + seed, storage bucket
supabase/migrations/0005_children.sql  Children table, per-child items + duplicate guard, share RPC v5
supabase/migrations/0006_yoto_platform.sql  'yoto' added to the platform CHECKs on items + catalog_items
supabase/migrations/0007_new_platforms.sql  'storypod', 'osmo' and 'lunii' added to the platform CHECKs
supabase/migrations/0008_user_catalog_additions.sql  Catalog provenance columns + catalog_additions log
supabase/migrations/0009_occasions_and_claim_expiry.sql  Occasions table, claim_expires_at, expiry-aware claim/share RPCs
.github/workflows/     CI (test + build) and Fly deploy
Dockerfile / nginx.conf / fly.toml  Fly.io deployment (SPA fallback routing)
```

## Ideas for v2

- Barcode/ISBN lookup when adding books.
