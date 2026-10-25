# Crawlers, specs, and discovery

How Toy Library gets data out of other people's websites — what exists
today, what hurts, and the restructure that fixes it: **learned endpoint
specs**, taught by [api-anything](https://github.com/goodnight000/api-anything)
in a real browser, executed by our own disciplined caller.

Status: PROGRAM COMPLETE (2026-10-25). The architecture in §2–§7 is
live: Phase 2 shipped the specall caller, the specs registry, and the
teach pipeline and migrated Yoto (§8.1, §10); Phase 3 unified the
remaining transports, wired Storypod, and integrated the registry
into weekly (§8.4, §10 close-out). §7 is the standing front door for
new sources. §10's decisions were all taken by the owner on
2026-10-24 (each per its recommendation).

---

## 0. Invariants (never traded for efficiency)

Every crawl in this repo, spec-driven or not, keeps these:

1. **Identifying user-agent.** One canonical string for spec-driven
   crawls: `ToyLibraryIngestor/1.0 (contact via toylibrary.store)`.
   We never impersonate a shopper's browser to fetch data we publish.
2. **≥ 350 ms spacing per host**, requests to one host serialized.
3. **3-strike host abandonment**: three consecutive 403/429 responses
   and the host's queue is dropped for the run (resumable next run —
   rated/filled rows leave the queue, so a rerun continues).
4. **A rating is written only with a review count behind it.**
   Honest zeros (a product with no reviews) leave the row unrated.
5. **Ages come only from the maker**, never guessed, never inferred
   from a sibling product. No published age → the item is skipped or
   lands without one, per the flow's existing rule.
6. **No invented products or prices.** Prices are never extracted
   anywhere in the estate (deliberate — see `extract.js`, which reads
   zero price fields).
7. **Production writes only via the established paths**: GitHub
   Actions jobs over PostgREST with the service key, bulk writes via
   the `set_ratings` / `set_popularity_scores` RPCs. Every migrated
   source is proven by a dry-run diff before its live run.

---

## 1. Inventory — what crawls what, today

### 1a. Weekly-maintained catalog adapters (`ingestor/lib/sources.mjs`)

Eight sources run every Monday via `ingestor/weekly.mjs`
(delta-only inserts; existing rows are never edited):

| Source | Platform(s) | Mechanism | Notes |
|---|---|---|---|
| tonies | tonies (483) | Shopify `/products.json` | Native feed. Optimal. |
| yoto | yoto (1,572) | Shopify `/products.json` | Native feed. Optimal. |
| storypod | storypod (286) | Shopify `/products.json` | Native feed. Optimal. |
| osmo | osmo (25) | Shopify `/products.json` | Native feed. Optimal. |
| moonlite | projector (part of 343) | Shopify `/products.json` | Native feed. Optimal. |
| littletikes | projector (part) | Shopify `/products.json` + title rules | Native feed. Optimal. |
| leapfrog | leapfrog (292) | **Bespoke HTML**: seed pages → harvest `/store/p/` links → fetch each page → `og:title`/`og:image` | Magento store, no feed, sitemap omits products. Discovery is heuristic — a product not linked from a seed page is silently missed. ~292 page fetches per scan. **Worst adapter in the estate.** |
| lunii | lunii (526) | **Bespoke HTML**: products sitemap → fetch each page → og tags + title-shape filter | Next.js storefront, no feed. Sitemap makes discovery complete, but ~535 page fetches per scan for two fields. |

### 1b. Everything else in the catalog (52 platforms, 18,448 rows)

The other ~44 platforms (Melissa & Doug 997, Devir 608, PlanToys 500,
Hape 384, Ravensburger 371, board-game publishers, KiwiCo, Lakeshore,
the art round's new Crayola 94, …) arrived via **one-off sourcing
rounds**: bespoke planner crawls whose output was a manifest applied
once. They have **no retained adapter and no weekly maintenance** —
new products from those makers reach the catalog only when someone
runs another round. Books (7,242) are the exception: they came from
official APIs (Open Library, Google Books, NYT Books) via
`ingestor/top-books.mjs` / `modern-books.mjs` / `books-expansion.mjs`.

### 1c. Ratings

| Path | Mechanism | Coverage today |
|---|---|---|
| `ingestor/backfill-ratings-stores.mjs` | Per-host queues over stored product URLs; `extractAggregateRating` (JSON-LD) over static HTML; writes via `set_ratings` RPC | 1,228 store rows rated of ~11,100 non-book rows |
| `ingestor/weekly.mjs` step 2 | Same JSON-LD extraction, bounded 300/run, budget spent only on 6 Shopify hosts | top-up only |
| `ingestor/backfill-ratings-books.mjs` | Open Library `/works/<id>/ratings.json` (+ OL search for unlinked rows) | 3,524 of 7,242 books |
| Yoto via Trustpilot | **Solved by the api-anything pilot, not yet wired** — see §8.1 | **0 of 1,572** |

### 1d. Images, ASINs, scoring (consumers, not sources)

- `ingestor/backfill-images.mjs` — fallback chain for blank
  `image_url`: ingestor's own catalog map → the row's source page
  (OG/JSON-LD) → store suggest search → whole-store feeds → Open
  Library covers (opt-in flag). 58 rows remain blank (sources
  exhausted; platform-art fallback covers them in the UI).
- `ingestor/backfill-asins.mjs` — one DuckDuckGo HTML search per
  item, strict title-match gate; Amazon itself is never fetched.
- `ingestor/popularity.mjs` — not a crawler: recomputes
  `popularity_score` from catalog data (ratings coverage feeds its
  review component, so crawler wins show up there).

### 1e. The live `ingest-catalog` Edge Function (user-driven imports)

Separate from the batch estate: signed-in parents grow the catalog
via *Search stores* (parallel fan-out to 6 Shopify
`/search/suggest.json` endpoints) and *Paste a link* (Shopify
`/products/<handle>.json` → JSON-LD → Open Graph → product-link
crawl, all regex-over-HTML via the shared `extract.js`). It reuses
`extractAggregateRating` from `extract.js` for a ≤12-row rating
enrichment on bulk imports. Per-store knowledge (type→details maps,
title-strip rules, age-tag parsing) is **duplicated** between
`extract.js` and `ingestor/lib/sources.mjs` and has already diverged.

### 1f. Pain evidence (the reasons for this restructure)

- **P1 — Datacenter-IP blocks.** The 2026-10-24 enrichment run on
  Actions: many hosts 403/429'd the runner IPs after ~50 pages and
  hit the 3-strike stop (~3,900 pages skipped: Melissa & Doug 946,
  PlanToys 488, Tender Leaf 320…). A local-connection retry recovered
  832 ratings — but also proved most of those stores publish **zero**
  ratings in static HTML anyway. Specs don't fix IP reputation;
  they fix *request economy* (fewer, smaller requests per datum),
  which is the part we control.
- **P2 — Stored URLs rot silently.** Yoto restructured
  `/products/<handle>` → `/players/<handle>` for its players; the
  catalog's 1,572 `source_url`s still point at the old shape
  (redirects mask it — for now). Handle-based API calls are immune
  to path restructuring; page scrapes are not.
- **P3 — Client-side review widgets hide ratings.** Trustpilot
  (Yoto), Bazaarvoice (Tonies), Okendo (Storypod) load ratings at
  runtime; static HTML has none. The pilot proved the Trustpilot
  request is a stable unauthenticated GET (see §8.1). Bazaarvoice
  and Okendo are uncaptured.
- **P4 — Frozen maps.** `ingest-catalog`'s host→platform map knows
  19 hosts / 8 brands while the catalog has 52 platforms; pasted
  links from newer brands land in `other`. Adding a brand touches
  ~5 places (DB platform CHECKs, app registry + logo, manufacturer
  host map, ingest host map, sources/specs).
- **P5 — Transport discipline is per-script, not shared.**
  `lib/http.mjs` has retry/backoff but no per-host spacing and no
  strike model — in `weekly.mjs` a failing source fails wholesale
  ("skipped, retried next week"). Four different UA strings exist
  across the estate (`ToyLibraryIngestor/1.0 …` ×2 variants,
  `ToyLibraryBot/1.0`, `ToyLibrary/1.0`); all identify us, none is
  canonical.
- **P6 — Bespoke adapters are HTML-shape bets.** LeapFrog's link
  harvest, Lunii's title-shape filter, `extract.js`'s regexes over
  JSON-LD blocks / meta attribute order / `<a href>` shapes — each
  breaks silently on a store redesign, degrading to empty results
  rather than errors (search errors are swallowed per store in the
  Edge Function by design).

---

## 2. Architecture

Three parts, with a hard line between *learning* and *executing*:

```
            ┌──────────────────────── TEACH (Actions, browser) ───────────────┐
            │  teach.yml → api-anything capture/add → learned site JSON        │
            │  → convert.mjs (our headers policy, provenance) → SPEC PR      │
            └──────────────────────────────┬───────────────────────────────────┘
                                           │ reviewed + merged
                                           ▼
   ingestor/specs/<slug>.json   ← the contract (versioned, in-repo)
                                           │
                                           ▼
            ┌──────────────────────── EXECUTE (our runtime) ──────────────────┐
            │  specall.mjs — our UA, ≥350 ms/host, 3 strikes, typed extract  │
            │  consumers: backfill-ratings-stores, weekly.mjs, round tools   │
            └──────────────────────────────┬───────────────────────────────────┘
                                           │ health stats per run
                                           ▼
                        drift detected → re-teach proposal (PR), never silent rot
```

- **api-anything's role: discovery + teach only.** It observes what
  a page actually does (the pilot's decisive win: an invisible SEO
  TrustBox static analysis had dismissed), and produces the learned
  request template. It is pinned by commit in the teach workflow,
  exactly as the pilot pinned it.
- **Our runtime executes the spec.** §4's caller decision records
  why we do not call through the tool at runtime.
- **Specs are reviewed like code.** A spec lands (or changes) only
  via a pull request whose body carries the teach evidence
  (captured request, verification samples). Merging is what makes a
  spec live.

## 3. The spec format — `ingestor/specs/<slug>.json`

One JSON file per learned endpoint. Versioned by `spec_version`;
unknown fields are rejected by the loader (a spec is a contract,
not a scratchpad). Field design borrows api-anything's proven
machinery (slots, response `shape` fingerprint, `public` constants)
and adds what it lacks: parameter *bindings* (where a value comes
from in our crawl), catalog field mapping, and full provenance.

```jsonc
{
  "spec_version": 1,
  "id": "yoto-trustpilot-rating",          // slug; also the filename
  "platform": "yoto",
  "purpose": "ratings",                    // ratings | listings | detail | ages | images
  "status": "active",                      // active | suspect | retired
  "description": "Trustpilot product-review aggregate per Yoto product.",

  "steps": [
    // Most specs have exactly one step. A step's outputs bind the
    // next step's params (here: per-product variant SKUs first).
    {
      "name": "resolve-skus",
      "request": {
        "method": "POST",
        "url": "https://yoto-usa.myshopify.com/api/2025-10/graphql.json",
        "headers": { "content-type": "application/json" },
        "body": "{\"query\":\"...product(handle:$h){variants(first:50){nodes{sku}}}\",\"variables\":{\"h\":\"{handle}\"}}"
      },
      "params": [
        { "name": "handle", "bind": { "from": "row.source_url", "take": "last_path_segment" } }
      ],
      "extract": { "format": "json", "path": "data.product.variants.nodes",
                   "pick": { "skus": "[].sku" } }
    },
    {
      "name": "rating",
      "request": {
        "method": "GET",
        "url": "https://widget.trustpilot.com/trustbox-data/5763bccae0a06d08e809ecbb?businessUnitId=5e90bde3fd8fc80001d20050&locale=en-UK&sku={skus}&reviewsPerPage=10",
        "headers": {}
      },
      "params": [
        { "name": "skus", "bind": { "from": "step.resolve-skus.skus", "join": "," } }
      ],
      "extract": {
        "format": "json",
        "path": "productReviewsSummary",
        "pick": { "rating": "starsAverage", "rating_count": "numberOfReviews.total" },
        "shape": { "starsAverage": "number", "numberOfReviews.total": "number" }
      }
    }
  ],

  "fields": { "rating": "rating", "rating_count": "rating_count" },
  "write_rule": "rating_only_with_count_gt_0",

  "provenance": {
    "taught_at": "2026-10-24",
    "taught_from": "https://us.yotoplay.com/products/ohana-means-family",
    "tool": { "name": "api-anything", "version": "0.1.0",
              "commit": "441e50905acea35f407127c2b8a4032e969288f7" },
    "teach_run": "https://github.com/Orvalla/toylibrary/actions/runs/40154238602",
    "verified_samples": [
      { "input": "Mini variant set", "expect": "4.7 / 2013", "at": "2026-10-24" },
      { "input": "PRP4XX05512 (no reviews)", "expect": "honest zeros", "at": "2026-10-24" }
    ]
  }
}
```

Format rules:

- **Params are bound, never free-floating.** A param's `bind.from`
  is one of: `row.<catalog field>` (with a `take` transform:
  `last_path_segment`, `host`, …), `const` (a literal in the spec —
  public constants only, e.g. a Trustpilot business-unit id or a
  site's published widget key, mirroring api-anything's `public[]`),
  or `step.<name>.<field>` from an earlier step. Secrets never
  appear in a spec; a source that needs one is out of scope for
  specs entirely.
- **Headers are policy, not data.** Specs do not carry captured
  browser headers. `specall` sends our canonical UA and
  `accept: application/json` (or as the step declares); a spec may
  declare `content-type` and public-constant headers only.
- **`extract.shape`** is the drift fingerprint: the set of
  key-paths + types the response carried at teach time (§6).
- **`extract` reuses estate semantics** where shapes coincide:
  a step whose response is schema.org JSON-LD maps through the
  same rules as `extract.js`'s `aggRatingOf` (0–5 rescale, count
  parsing) — one definition of what a rating is, in one place.
- **Native sources are registered, not specced.** Shopify-feed and
  official-API sources get a line in `ingestor/specs/native.json`
  (`platform → mechanism`), so the estate has one machine-readable
  inventory; `lib/sources.mjs` remains their executable truth.

## 4. The runtime caller — `ingestor/lib/specall.mjs`

**Decision: we execute specs ourselves; we do not call through
api-anything at runtime.** Evidence (from the pinned tool's source,
2026-10-24 research):

- It has **no call-time header/UA override** in its CLI, MCP, or
  library API. Calls replay the captured browser's headers
  byte-for-byte — a shopper's Chrome UA, `sec-*` and all. The only
  workarounds are editing the stored spec's UA (tier-1 HTTP only,
  and any heal/re-teach silently overwrites it with the capturing
  browser's) or wrapping its `fetch` via a library injection seam.
  Both contradict invariant 1 by default and by drift.
- Its pacing (≥1 s/site) is **per-process and tier-1 only** —
  parallel CLI runs are unpaced against each other; browser tiers
  are unpaced entirely. Our crawls are multi-process by design
  (parallel host queues), so the guarantee we need can't be its.
- Its failure model differs from ours on purpose: 429 is classified
  and reported (never retried, never struck), and "blocked"
  *escalates* transport tiers. Ours abandons the host at 3 strikes.
  Neither is wrong; ours is the posture we've committed to.

`specall.mjs` therefore implements exactly the estate's existing
discipline as a shared module (today it lives, diverged, inside
`backfill-ratings-stores.mjs`'s `crawlHost`):

- `createSpecCaller({ ua, minIntervalMs = 350, maxStrikes = 3 })`
  → per-host queues: serialized requests per host, ≥ interval
  between request starts, strike counter per host (403/429 →
  strike; success resets), host dropped at `maxStrikes` with the
  remainder reported as `skipped_stopped` (same stats vocabulary
  as the current crawler, so run summaries stay comparable).
- `callSpec(caller, spec, row)` → resolves bindings, runs the
  step chain, applies `extract` + `fields`, returns a typed result
  (`{ ok, values, stats }`) — never writes anything itself.
  Consumers keep their own write paths (RPCs, delta-only inserts).
- `verifySpec(caller, spec)` → replays `provenance.verified_samples`
  and checks the response still matches `extract.shape`
  (≥ 50% of shape key-paths present with matching types — the
  drift rule api-anything's classifier uses, adopted deliberately).
- Failures are classified like the current estate's stats:
  `http_blocked`, `fetch_failed`, `empty_extract`, `shape_drift` —
  counted per spec per run (§6 consumes them).
- Unit-tested in the estate's style (`ingestor/lib/*.test.mjs`,
  vitest) with a fake transport: pacing, strikes, binding
  resolution, extraction, and drift classification all covered
  without network.

## 5. The teach pipeline — `.github/workflows/teach.yml`

Generalizes the pilot's harness (which lives on branch
`pilot/api-anything`; preserve it as the reference implementation).
Two facts shape the design: workflows on the **default branch can
be dispatched** (the pilot's branch-only workflow could not — it
had to run on push), and capture artifacts are **heavy and
sensitive** (the pilot's home-dir artifact was 63 MB and captures
store cookie values).

- **Trigger:** `workflow_dispatch` on main. Inputs: `mode`
  (`outline` | `teach` | `reteach`), `site`, `op`, `trigger_url`
  (with `{param}` placeholders), `example` / `example2` (two
  genuinely different arg sets — required for the tool to separate
  params from nonces), `match` pin, exactly one response recipe
  (`extract`+`pick`, or `html`, or `embedded`), optional `steps`
  JSON / `soft_from` for pages that fire the request only after
  interaction.
- **Job:** checkout → install pinned api-anything (commit env,
  `npm ci` + pack-install, as the pilot) → locate system Chrome
  (runner's `google-chrome`; Playwright chromium as fallback) →
  run the mode's driver → upload **only** the outline JSON, the
  learned site JSON, and the teach report (never `~/.api-anything`
  wholesale, never the browser profile or session store).
- **`outline` mode** = discovery scouting (§7): capture with
  `--outline`, artifact the ranked request candidates + response
  summaries. A human/agent reads it and chooses the request +
  recipe for `teach`.
- **`teach` mode:** `capture` ×2 (one per example) → `add --from`
  with the chosen request → `call` with a **fresh input that was
  not an example** (the tool's own verification contract) →
  `convert.mjs` maps the learned site JSON into our spec format:
  request template + slots → `steps`/`params` (bindings filled in
  by the teach driver from the mode inputs, since binding sources
  are our knowledge, not the tool's), captured headers **dropped**
  in favor of §3 header policy, `public` constants carried over,
  `shape` retained, provenance stamped (tool version + commit,
  capture ids, this run's URL, the verification samples just
  observed) → opens a **spec PR** containing the spec file + a
  teach report (samples table, request economy: calls per datum,
  response sizes).
- **`reteach` mode** = `teach` seeded from the existing spec's
  provenance (same trigger/examples). The converter **freezes the
  contract** — params, bindings, extract, fields — and accepts only
  wire-template changes (URL/headers/body/slots), mirroring the
  tool's own heal contract. A reteach that needs a contract change
  fails the conversion and says so; that's a human design task,
  not a heal.

## 6. Healing — drift becomes a proposal, never silent rot

Every spec consumer reports per-spec, per-run stats (calls,
filled, `empty_extract`, `http_blocked`, `fetch_failed`,
`shape_drift`) into its normal run summary (the weekly job already
appends its summary to `$GITHUB_STEP_SUMMARY`; spec lines join it).

A spec is marked **`suspect`** — in its file, by a small automated
commit or by the run's report, per Phase 3's integration — when
any of these trip over a rolling window (default: the last 2 runs
or 200 calls, whichever is larger):

- `shape_drift` on the verify samples or in ≥ 25% of live calls;
- `empty_extract` rate ≥ 3× the rate recorded at teach time
  (stored in provenance) with ≥ 50 calls;
- the host's strike rule fires on the spec's endpoint host in
  2 consecutive runs.

While `suspect`, consumers **stop using the spec** and fall back
to whatever they did before it (adapter, static-HTML path, or
nothing — stated per spec in its consumer), and a `reteach`
dispatch is proposed with the failing stats attached. The reteach
PR's diff is the review surface: wire-template-only changes with
passing fresh-input verification can merge on the usual review;
anything else gets human design attention. A spec that fails
reteach twice is `retired` and its source returns to the
discovery queue (§7) — the failure is a reported event with
numbers, not a quiet degradation.

## 7. New-source discovery intake

The way every future source is evaluated (this replaces ad-hoc
round reconnaissance):

1. **Classify (≤ 3 requests).** Probe for a native feed first:
   Shopify `/products.json`? An official API (the OL/GB/NYT
   pattern)? A documented feed/sitemap with complete enumeration?
   → native; register in `native.json`; done. Specs are only for
   what has no feed.
2. **Outline.** Dispatch `teach.yml` in `outline` mode against
   the maker's own storefront (a listing page + a product page).
   Read the candidates: does the site's own frontend fetch
   listings / product detail / ratings as data requests? Which
   fields ride along (ages? images? SKUs?)?
3. **Teach + sample.** Teach the promising ops; run them over a
   sample (first ~50 products) and measure: listings completeness
   vs the visible storefront, % with maker-published ages, % with
   images, % with ratings (+counts), age distribution against our
   bands, duplicates vs the live catalog (platform + normalized
   title). Request economy: calls + bytes per product, vs the
   HTML-scrape equivalent.
4. **Go / no-go report**, in the established round-report shape
   (per-source kept / skipped / why, feasibility notes, the kept
   list). Owner decides.
5. **On go:** the spec PR (§5) plus the platform-wiring checklist
   — DB platform CHECK migration, app `PLATFORMS` registry entry
   + brand logo, manufacturer host map, `ingest-catalog`
   host→platform entry, `native.json`/spec registration, and the
   popularity rescore after the first fill. (The 2026-10-24
   Crayola round is the worked example of this checklist being
   done by hand; intake makes it a form.)

Politeness applies to discovery too: outline/teach runs are a
handful of page loads, and sampling honors the same spacing —
discovery never becomes an unannounced bulk crawl.

**Standing front door (program close-out, 2026-10-25):** this intake
is how every new source joins the estate from now on — no new
bespoke crawler is written without walking these steps first.

## 8. Migration plan (Phase 2, in order, each gated)

### 8.1 Yoto ratings via the Trustpilot spec (folds in the approved wiring)

- Spec: §3's worked example. One nuance the pilot established and
  the plan keeps: the SKU set must be **the product's own variant
  SKUs** (Storefront GraphQL `variants[].sku` per handle — immune
  to the /products/→/players/ restructure, since the handle is the
  last path segment either way). The widget's page-level
  `data-sku` attribute is **pooled across products** and must not
  be used verbatim: it would hand the Mini row the pooled
  4.7/2,820 instead of its own 4.7/2,013, and pooled card sets
  would misattribute outright.
- Caller path: a `yoto` branch in `backfill-ratings-stores.mjs`
  alongside the static-HTML path, both feeding the existing
  `set_ratings` flush. GraphQL calls queue on `yoto-usa.myshopify.com`,
  rating calls on `widget.trustpilot.com` — two host queues, each
  with the standard discipline.
- **Gate:** dry-run against the pilot's samples first — Mini
  variant set → 4.7 with count ≈ 2,013 (counts drift up naturally;
  stars + count must be in family), Player PRP3 set → 4.8/≈807,
  'Ohana card → 4.5/2, PRP4 set → honest zeros (row stays
  unrated). Then the full 1,572-row pass on Actions
  (`enrich.yml`-style dispatch), then a popularity rescore, then
  report the coverage delta (rated before/after, % of Yoto rows
  whose SKUs carry any Trustpilot reviews).

### 8.2 One HTML-scraped adapter: LeapFrog

LeapFrog is the pick (Lunii is the runner-up): its discovery is
the only *incomplete-by-construction* one in the estate (nav-link
harvesting can silently miss products), and Magento storefronts
typically expose the data the adapter scrapes for (a storefront
GraphQL or search-backend request) — exactly what an outline
capture can confirm or kill in one run.

- **Gate:** outline first. If no learnable request beats the
  adapter, we stop and say so. If one does: teach, build the spec,
  and **dry-run diff** the spec's listing output against the
  current adapter's over the same storefront — same or better
  item count, titles, images, or the migration doesn't happen.
  (Age yield can't regress: the adapter provides none — ages come
  from `lib/ages.mjs` platform defaults downstream either way.)

### 8.3 Tonies (Bazaarvoice) / Storypod (Okendo) widget captures

Samples-first, per the pilot pattern: outline + teach on Actions,
report verified sample ratings (with the widget's per-site public
key/config treated as a spec `const` binding — the `public[]`
concept), and **no full run** until samples are reported. If a
widget's request turns out to need a session or rotating token,
that's the one case that reopens the runtime-adoption question —
with evidence, for that platform only.

### Phase 3 integration

- `weekly.mjs` consults the spec registry: Yoto's ratings top-up
  switches to the spec path (its JSON-LD budget goes to hosts that
  still need it); any future spec'd source joins the same way.
  Adapters remain the fallback for every spec'd source.
- `backfill-ratings-stores.mjs`'s host-queue machinery is replaced
  by `specall`'s caller for its static-HTML path too (same
  discipline, one implementation), keeping its stats vocabulary.
- Discovery intake (§7) becomes the documented front door;
  `native.json` + `specs/` together are the estate's inventory,
  and this doc is updated with Phase 2/3's measured numbers
  (requests per source before/after, failure modes removed).

### 8.4 Phase 3 results (2026-10-25, coordinator-verified)

- **One transport.** `backfill-ratings-stores.mjs`'s HTML path now
  runs on specall's caller; the script's own fetchPage/crawlHost
  queue is deleted. The Yoto spec runner was extracted to
  `ingestor/lib/yoto-spec.mjs` and is shared by the backfill and
  weekly. Equivalence proof for the swap: before/after dry-runs
  over the same 44-row snapshot produced **byte-identical
  stdout** (fetched 43, blocked 0, failed 1, rated 0 on both —
  that host, Guidecraft, publishes no JSON-LD ratings). The
  extraction/write code moved verbatim; post-refactor dry-runs
  over KiwiCo's unrated residue fetched 20/20 with rated 0
  because those pages carry no JSON-LD rating at all (rated
  KiwiCo pages still do — spot-checked live), i.e. the residue
  is non-yielding, not unextracted.
- **Storypod via the hand-authored Yotpo spec** (§10). Sample
  gate 5/5 under `verifySpec` (The Gruffalo 5.0/5, The Little
  Engine Collection 5.0/5, Owl iCraftie 5.0/2; The Eddi System
  and Riley Raccoon honest zeros). Full-queue dry run: 286 rows
  → 193 rated / 92 honest zeros / 1 unresolved projected, 571
  calls, 0 drift. Production: the Actions attempt was
  host-blocked after 56 rows (3 strikes, runner egress; 40
  written, 226 skipped — the discipline working as designed),
  and the pass was completed from the local connection with the
  same script and the same `set_ratings` RPC (+153). Final,
  SQL-verified: **Storypod 0 → 193/286 rated (67.5%)**, 92
  honest zeros, 1 unresolved; popularity rescored (reviews
  component 6,203).
- **Weekly integration.** Step 2 partitions Yoto rows to the
  spec path (shared `rateYotoRows`, `set_ratings` flush, bounded
  by the existing budget); any spec failure — load error,
  non-`active` status, runner error — restores the full unrated
  list to the JSON-LD queue, reproducing the pre-change queue
  exactly. The JSON-LD path itself moved onto a shared specall
  caller (the hand-rolled fetch + last-host delay are gone); the
  `★ ratings:` summary line is unchanged. Data caveat: the
  preserved selection currently admits **zero** Yoto content
  rows — only 4 Yoto rows carry a `source_url` in
  `catalog_items` at all (all devices); the backfill gets Yoto
  URLs from `ingestor/out/catalog.json`. The branch is therefore
  dormant-but-correct: it activates automatically if Yoto
  `source_url`s are ever populated, and Monday's scheduled run
  is unaffected either way (full `--dry` run green, no writes).

## 9. Non-goals (explicit)

- **Shopify `/products.json` sources stay as-is** — registered
  `native`, never specced. A public feed beats a learned template
  on every axis.
- **Official APIs stay as-is**: Open Library (book ratings +
  ingestion), Google Books, NYT Books. Likewise the books
  ingestors built on them.
- **The `ingest-catalog` Edge Function is not rewritten** in this
  program. Its suggest endpoints are Shopify-native; its
  divergences from the batch estate (P4/P5) are documented here,
  and the discovery checklist (§7.5) now covers its host map when
  a platform is added — but unifying the two estates' per-store
  knowledge is a separate project if it ever happens.
- **No runtime dependency on api-anything** (§4), no browser in
  any production crawl path, no spec for a source that needs a
  secret.
- ASIN resolution (search-engine based, human-gated by design)
  and image backfill's fallback chain keep their mechanisms;
  they consume spec outputs where a spec exists (e.g. a listings
  spec's images) but are not themselves specced.

## 10. Decisions for the owner — ALL DECIDED 2026-10-24

The owner took all three decisions, each per the design's
recommendation ("Go with all three recommendations", 2026-10-24).
They are recorded here as settled; Phase 2 executes under them.

1. **Yoto SKU binding** (§8.1): per-variant SKUs via the
   Storefront GraphQL (pilot evidence; two calls per product,
   correct attribution) — vs the page's pooled `data-sku` (one
   call, wrong counts for pooled products). *Recommendation:
   GraphQL binding.* **DECIDED: GraphQL binding.**
2. **Spec-change gate** (§5/§6): every spec lands via PR review;
   should a *reteach* PR whose diff is wire-template-only **and**
   whose fresh-input verification passes be auto-mergeable, or
   does every spec change wait for a human/agent review?
   *Recommendation: review for new specs and contract changes;
   auto-merge allowed for wire-only reteaches that pass
   verification — that's what makes healing faster than rot.*
   **DECIDED: as recommended — wire-only reteach PRs with
   passing fresh-input verification may auto-merge; everything
   else is reviewed.**
3. **Caller ownership** (§4): build `specall.mjs` and keep
   api-anything teach-only — vs adopting the tool's runtime with
   a spec-file UA edit (tier-1 only; heals overwrite the UA; its
   pacing/strike model isn't ours). *Recommendation: specall —
   this is the pilot's verdict, now backed by the tool's source.*
   **DECIDED: build `specall.mjs`; api-anything stays teach-only.**

### Phase 2 execution notes (2026-10-24, coordinator-verified live)

- The §3 GraphQL step works **unauthenticated** against
  `yoto-usa.myshopify.com` today (shop + product/variants queries
  answered with no storefront token). The yoto branch treats a
  GraphQL `product: null` (handle retired or not published to the
  Storefront channel) as "fall back to the same store's
  `/products/<handle>.js` variants" — same per-variant SKU data,
  same binding semantics — and only a double miss leaves the row
  unresolved.
- The rating step was re-verified end-to-end before any wiring:
  Mini set (PRMNXX02845/46/47 + PRMNXX04904) → 4.7 / 2,013;
  Player PRP3 set → 4.8 / 807; 'Ohana (CRSTXX02617, resolved via
  GraphQL) → 4.5 / 2; PRP4XX05512 → honest zeros. All exact
  against the pilot.
- **Known attribution limit:** the legacy player review sets
  (Mini PRMNXX028xx, Player PRP3) belong to store products Yoto
  has since retired (their handles resolve nowhere — US GraphQL
  null, US .js 404, UK listing 404). Under the sanctioned binding
  those two catalog rows stay unrated; the sets' aggregates
  remain reachable only via the pooled page `data-sku` the
  design rejected. The card catalog — the bulk of Yoto — resolves
  cleanly per-variant.

### Phase 2 results (2026-10-24/25)

- **§8.0 Foundations — SHIPPED** (commits 406437a + af3c59a):
  `ingestor/lib/specall.mjs` (27 tests), the specs registry
  (`ingestor/specs/` incl. `native.json`), and the generalized
  teach pipeline (`.github/workflows/teach.yml` +
  `ingestor/teach/`, 16 converter tests; suite 55 files / 439
  tests green).
- **§8.1 Yoto — MIGRATED, gate passed.** Sample gate: verifySpec
  4/4 live (Mini 4.7/2,013 · PRP3 4.8/807 · 'Ohana full chain
  4.5/2 · PRP4 honest zeros); dry-run over 11 real rows → 7
  rated / 2 honest zeros / 2 unresolved. Full pass (Actions run
  40157222671, ~9.5 min): 1,572 rows, 1,571 queued (1 row has no
  URL anywhere), **1,258 rated (0 → 80.0% of Yoto)**, 279 honest
  zeros, 34 unresolved, 3,142 calls (exactly 2 per row: one
  GraphQL + one Trustpilot), 0 blocked, 0 shape drift. Request
  economy: the old HTML path spent 1 page fetch per row for a
  guaranteed miss (Yoto publishes no rating in HTML); the spec
  spends 2 calls per row and lands a rating for 80% of rows.
  Popularity rescore followed (run 40158003205).
- **§8.2 LeapFrog — STOPPED at the outline gate, by design.**
  Outline capture (teach run 40158005754) on
  `store.leapfrog.com/en-us/store/c` ranked exactly 5
  candidates; none carries product data the adapter lacks: the
  only JSON API candidate is `/rest/V1/data/…` (session/site
  config), the rest are message bundles, a cookie-policy page,
  and the page document itself — whose embedded PAGE_DATA block
  (24 products of 415 total, page 1 only) the adapter already
  parses. The remaining ~390 products are reachable only by
  crawling per-product pages (the adapter's snowball), and the
  pagination API the page config points at
  (storeapi.leapfrog.com) does not resolve in public DNS. No
  learnable request beats the adapter, so no spec, no migration;
  LeapFrog stays `bespoke-html` in `native.json`.
- **§8.3 Storypod — widget is Yotpo, not Okendo** (the §8.3
  premise named Okendo; the outline evidence overrides it).
  Discovery succeeded: outline capture (run 40158094046) caught
  the real request on the Eddi product page —
  `GET api-cdn.yotpo.com/v3/storefront/store/<public store
  key>/product/<shopify product id>/ratings`, a stable
  unauthenticated GET returning
  `{bottomline:{averageScore, totalReviews}}`. Verified samples
  (direct calls reproducing the endpoint exactly): The Gruffalo
  **5.0 / 5**, The Little Engine Collection **5.0 / 5**, Owl
  iCraftie **5.0 / 2**, The Eddi System **honest zeros**, Riley
  Raccoon **honest zeros**. No full run (per §8.3). Teach,
  however, failed twice (runs 40158271630, 40158393379): on
  Craftie/book pages the widget's fetch never enters the tool's
  ranked candidate set (it did on the Eddi player page), and
  the tool's trigger steps have no scroll action to force the
  lazy load (click/fill/press/wait/goto only — an 8 s wait did
  not help). Phase 3 note: a production Yotpo spec is
  hand-authorable exactly like Yoto's — step 1 resolves the
  Shopify product id from the row's handle via
  `/products/<handle>.js`, step 2 is the ratings GET with the
  store key as a `const`; convert.mjs emits single-step specs
  only, so this was never teach-producible as-is.
- **§8.3 Tonies — Bazaarvoice is session-gated; this is the
  documented runtime exception.** Outline (run 40158092073)
  caught the widget's requests in-browser (200s): the
  `apps.bazaarvoice.com/bfd/v1/clients/tonies/…/products.json`
  aggregate call keyed by Shopify product id (confirmed:
  9220712398999 = the sampled product's `.js` id). Replayed
  outside a browser it cannot work: bare GET → **401
  Unauthorized**; with Origin/Referer → **400 "'Bv-Bfd-Token'
  is not sent or invalid"**. The token is minted by BV's loader
  JS per session — not a public constant — so no spec our
  caller can execute exists, and a teach would only borrow the
  token from its capture (verification would false-green). Per
  §8.3 this reopens the runtime-adoption question **for Tonies
  only**, with this evidence; no teach was run and no samples
  are claimed. (BV's classic Conversations API would need a
  passkey only Tonies can issue.)

### Phase 3 close-out — final program numbers (2026-10-25)

**Rated coverage (SQL-verified at each step):**

| Point | Rated | Catalog | % |
|---|---|---|---|
| Before the restructure (post-enrichment baseline) | 4,752 | 18,448 | 25.8% |
| After Phase 2 (Yoto via Trustpilot spec) | 6,010 | 18,448 | 32.6% |
| After Phase 3 (Storypod via Yotpo spec) | **6,203** | 18,448 | **33.6%** |

Program gain: **+1,451 rated rows (+30.5%)**, entirely from the
two client-side-widget platforms that sat at 0 under HTML
crawling (Yoto 0 → 1,258 of 1,572; Storypod 0 → 193 of 286).

**Request economy (calls per rated datum):**

| Path | Calls | Rated | Calls/datum |
|---|---|---|---|
| Yoto via spec (GraphQL + Trustpilot) | 3,142 | 1,258 | 2.50 |
| Storypod via spec (`.js` + Yotpo), clean run | 571 | 193 | 2.96 |
| Store HTML from local egress (retry) | 5,326 | 832 | 6.40 |
| Store HTML from Actions egress (enrichment) | 10,871 | 372 | 29.2 |
| Yoto via HTML (any egress) | 1,571 | 0 | ∞ — guaranteed miss |

Specs run at exactly 2.00 calls/row; the per-datum figure above
2.0 is the honest-zero share (products with no reviews cost the
same 2 calls and correctly stay unrated). Actions egress remains
the weak link for bulk work — it was host-blocked mid-pass on
both the store crawl and the first Storypod attempt — while the
spec endpoints themselves never blocked on either egress.

**Failure modes retired:**

- Three divergent implementations of the UA / 350 ms spacing /
  3-strike discipline (backfill host-queue, weekly's ad-hoc
  fetch loop, specall) → **one** (`specall`), shared by the
  backfill, weekly, and every spec.
- Guaranteed-miss page fetches for widget platforms, in both the
  crawls and weekly's top-up budget.
- Pooled-SKU rating misattribution (Yoto page `data-sku` pooled
  2,820 reviews across products; the spec binds each product's
  own variant SKUs — Mini's own set is 2,013).
- Silent spec rot: drift now surfaces as `spec_*_shape_drift`
  stats and sample-gate failures (`--verify-specs` re-verifies
  all 9 samples before every ratings run), with the §5/§6
  reteach path behind it.
- Ratings bound to scraped page URLs, which break silently on
  storefront restructures; specs bind to handles/ids instead.

**What remains bespoke, and why:**

- **LeapFrog** ratings/listings adapter — the §8.2 outline
  verdict: no learnable request beats it; registered
  `bespoke-html` in `native.json`.
- **Lunii** adapter — sitemap-complete but fetch-heavy;
  registered `bespoke-html`.
- **Weekly's JSON-LD extraction** for hosts with no spec — the
  extraction is bespoke, the transport is specall's.
- **Books** — official APIs (Open Library / Google Books);
  never specced by design.
- **`ingest-catalog` Edge Function** — user-driven imports, out
  of scope for the restructure by design.
- **Tonies ratings — DECIDED / PARKED (owner, 2026-10-24).**
  The runtime-adoption exception for the session-gated
  Bazaarvoice token (evidence directly above) was put to the
  owner and **declined**: Tonies' **483 rows stay unrated by
  owner decision**. Not pending; revisit only if the owner
  raises it.

**Teach/reteach pipeline coherence (verified at close-out):**
`teach.yml` is on main with outline/teach/reteach modes and the
artifact-hygiene rules from §5; `ingestor/teach/convert.mjs`
still enforces the contract freeze (a reteach may replace wire
bindings/paths only — purpose, write rule, and field keys are
frozen), and auto-merge remains gated on reteach + wire-only +
fresh-input verification, exactly as decided in §10. Both
production specs verify green under `--verify-specs`.

**Open follow-ups (outside this program):** Djeco detail
fetches from an Actions runner (toddler-art round); the three
egress-blocked hosts (Fat Brain, Learning Resources, VTech,
~150 rows) remain reachable only from non-runner connections.

**Resolved 2026-10-24 (post-close-out):** Yoto `source_url`
backfilled in `catalog_items` from the ingestor snapshot —
1,571 of 1,572 rows now carry their store URL (the one missing
row has no URL in any source), so weekly's Step-2 selection
admits Yoto rows and the §8.4 spec branch does live top-ups
from the 2026-10-26 run on.

## 11. Blocked-store discovery (2026-10-25) — LR + VTech outlines

Owner-approved discovery pass (teach.yml outline mode, Actions
egress) for the two blocked stores with plausible hidden endpoints:

- **Learning Resources** — DEAD END confirmed. learningresources.com
  serves a DataDome challenge (HTTP 403, 781-byte stub) to the
  runner browser; the product page never loads, so no ratings
  endpoint is observable (run 40206012567; outline verdict
  "blocked: DataDome challenge page"). The Salsify experience
  pages partially load from the local connection but carry no
  ratings (8 fetched, 0 present). No maker-side route remains.
- **VTech** — NO SPEC EXISTS. vtechkids.com loads fully in a real
  browser (194 KB server-rendered document, 138 requests, run
  40206016050) but fires NO ratings/review-widget request at all —
  the only XHRs are cookie-consent calls. Any rating on the page
  is baked into the HTML, and VTech's edge refuses plain-HTTP
  clients from both egresses (sandbox re-check 2026-10-25:
  connection dropped). Not specall-executable; the only maker-side
  route would be real-browser fetching (the §10 exception class).

REMAINING ROUTE for both (plus Fat Brain, §10-adjacent): ratings
from a DIFFERENT SOURCE — retailer review aggregates. Walmart
demonstrably carries these products' ratings with counts (sample:
VTech Animal Rhymes Music Book 4.7 / 215+ reviews, largely
Bazaarvoice-syndicated from the maker's own review pool). Owner
decision pending; until then all three stores stay unrated and the
weekly top-up keeps retrying them cheaply.
