# Catalog completeness — gaps, sources, the sweep

The program that keeps the catalog *filled in*, not just *ingested*:
ratings, bundle contents, photos, manufacturer links, ages. Companion
to `docs/CRAWLERS.md` (endpoint specs and the fetch discipline this
program inherits unchanged). Recon and build evidence lives in the
goal workspace (`hidden_files/completeness/` — RECON.md, ratings-build/,
bundles/, photos-report.md). Started 2026-10-25.

## 1. Gap state at program start (measured 2026-10-25)

19,553 rows. Rated 6,224 (32%). Bundles 616, contents mapped 152.
Images missing 58. `product_url` missing 1,333 (1,263 of them books —
by design, §5). `age_no_data` 202 after the same-day iron-out
(482 → 202; see the iron-out report). Unrated was never a scraping
problem in general — it is a *per-brand source* problem: almost no
unrated major publishes a rating+count pair in static HTML, and each
brand hides its ratings behind a different widget (or has none).

## 2. Ratings — the route per brand

A rating is written only with a count behind it. Value-without-count
pairs are withheld, always.

| Route | Brands | Status |
|---|---|---|
| Static parse (built, live) | Moonlite (Klaviyo `MetafieldReviews` in the viewed-product blob; the stale Okendo pair in the same blob is never read), HABA (Yotpo page vars), eeBoo (Shopify reviews metafield), Ravensburger.us (scoped parse of `#productDetailShowReviewsForm` — recommendation cards carry identical blocks), Mudpuppy (Judge.me `jdgm-prev-badge` data attributes — server-rendered, **not** JS-only as first recon thought; the shop-wide `data-shop-*` aggregate is structurally excluded) | Extractors in `ingestor/lib/store-rating-extractors.mjs`, dispatched by `backfill-ratings-stores.mjs --platform` |
| Bazaarvoice | Melissa & Doug (997), Crayola (232), Little Tikes/Dream Machine (~170) | **DEAD.** The "classic" pattern rides BV's BFD front door; cold replays are refused (`400 Bv-Bfd-Token is not sent or invalid`; 401 for Crayola/Little Tikes). Same per-session-token failure as Tonies (CRAWLERS.md §10). All three brands → retailer wave |
| Okendo | Thames & Kosmos | **DRY.** 14/14 sampled pages (12 flagship kits + recon's games) carry 0.0/0 or no metafield at all. No extractor built |
| BGG feed | §9 | Token-gated; owner slated 2026-10-25 ("anything best for BGG waits for the API") |
| Retailer wave | §2.1 | The only route for brands with no storefront review system |
| No viable source | Lovevery (23) | The only static figure is a program-wide aggregate (4.91/22,540, identical on every kit). Writing it per-SKU would be fabrication. Stays unrated honestly |

### 2.1 The retailer wave (~3,300 rows, runs last)

Different-source harvest under the blocked-store gates (exact-variant
match, explicit figure, corroboration for single-surface finds — the
Walmart pattern proven 2026-10-25). Composition, in run order:

1. **Thames & Kosmos kits (~198)** — owner-priority brand; heavy mass
   retail presence. (Its 88 games ride BGG instead.)
2. **The BV trio** — Melissa & Doug 997, Crayola 232 (+ its 69
   un-aged rows ride the same harvest for ages), Dream Machine ~170.
3. **The six no-source brands** — Lunii 526, Hape 384, LeapFrog 292,
   Janod 281, Le Toy Van 227, Uncle Goose 189. Their own storefronts
   have no review system at all; there is nothing to teach or parse.
4. **Ravensburger puzzles** and other parse residue.

### 2.2 Results so far (live, 2026-10-25)

Dry-verified then applied through `set_ratings`; every figure below
DB-verified after the run: HABA 90/118, eeBoo 57/116, Moonlite 72/89
fetched (192 projector rows have no URL on file — §10),
Ravensburger 59/371 (312 honest zeros — its native reviews are
mostly empty), BRIO 36/204 (168 zero-count), Mudpuppy 209/330.
**First pass total: +523 ratings → 6,747/19,553 rated (34.5%)**,
popularity rescored. Withheld on the count rule: 366
value-without-count pairs across the six platforms.

## 3. Bundles — mechanism and leak fixes

Contents are mapped only at the **exact-count bar**: stated count,
extracted names, and resolved singles must agree; partial extractions
are reported as failures, never written. The extractor
(`ingestor/lib/bundle-contents.mjs`, generalizing `bundles.mjs`'s
three signals — bold-title lists, strict description scan, series-stem
match — plus per-platform patterns) emits manifests; application is a
separate reviewed step.

**Exclusion classes** (flagged `bundle_contents_no_data`, migration
0054 — the `age_no_data` precedent): quantity packs of one item
(KiwiCo party packs, eeBoo "(6)" assortments), gift/display sets with
no enumerable contents, one-work-split-across-media packs whose
per-part contents are not published, bundles whose maker page is
dead. The flag keeps "not yet tried" and "tried, not published"
distinct so the sweep never re-queues hopeless rows.

**Leak fixes (live, commit b316e39):**

| Entry path | Fix |
|---|---|
| Weekly ingest | `isBundleRow` signal in `lib/sources.mjs` (the knowledge already existed in `detailsByType`); new packs insert with `is_bundle=true`; bounded contents step (Step 1b) over just-inserted bundles |
| ingest-catalog (Search stores / Paste a link / collection import) | `insertCatalogRows` persists `is_bundle` from the type signal `extract.js` already computes. No contents crawling in the request path — the gaps view + sweep own contents |
| Admin waves | Contents pass is the standard final step over the wave's new bundle rows (`stores-rescan.mjs` + shared extractor) |

**Catch-up state:** 169/616 mapped (T&K 14, KiwiCo 2, eeBoo 1 applied
2026-10-25 from dry manifests; 11 flagged no-data). The two big
queues are structural, not extraction problems: for most Yoto (274)
and Tonies (39) packs the contents have **no single catalog rows to
point at** (only 23 of 234 Yoto multi-id bundles fully resolve) —
catch-up there means creating pack-exclusive content rows, as the
original bundle wave did for Tonies story rows. That is a
catalog-growth decision, sized separately when the sweep reaches
those brands. M&D bundles are weak prose (1/3 borderline) — expect
low yield. Seven bundle contents across T&K/KiwiCo/eeBoo reference
singles that were never ingested; they sit on the sweep's discovery
list.

## 4. The queue definition

`catalog_completeness_gaps` (view, migration 0054): per-platform
counts for unrated, unmapped bundles (excluding no-data-flagged),
missing image, missing product_url (non-books), age_no_data. The
sweep's rotation and the /admin counters both read this one view —
a row's gaps are always derivable from the catalog itself, so no
entry path has to remember to flag anything; the hooks in §3 make
rows complete sooner, the sweep guarantees they don't stay
incomplete forever.

## 5. Manufacturer links

Rule (owner, 2026-10-21): direct product-page links only — no
catalog/storefront fallback; a row whose maker no longer lists the
product shows no link. Books never carry one (they carry source
links instead). 2026-10-25 backfill: 46 rows whose `source_url`
already was the maker's product page (Tonies 35, Osmo/Yoto/Lunii/
Storypod/LeapFrog singles, one Moonlite) copied to `product_url`.
Residue: 24 non-book rows with no maker page on file (Tonies 8,
projector 8, LeapFrog 6, VTech 2 — one projector row's only source
is a retailer, which does not count). Individual research, queued
in the sweep.

## 6. Photos

34 of the 58 image-less rows filled 2026-10-25 (verified: 58 → 24).
Every candidate was download-verified **and visually checked** —
byte checks alone would have shipped 20+ wrong covers (Open Library
title search mis-attaches; Blackwell's serves a mascot placeholder
at HTTP 200; retailer "Image Unavailable" graphics). Book covers
only by the book's own ISBN. Residue: 19 recent Nosy Crow board
books (no jacket file exists for their ISBNs anywhere yet — re-run
the ISBN ladder in a few months as jackets propagate) + 5
discontinued items with no published photo. Side fixes: 4 mangled
titles (baked-in HTML entities ×3, a "(35)" artifact).

## 7. Ages residue (202)

Composition: Crayola art supplies 69 (retailer wave, §2.1), Capstone
Games hobby titles 66 + AEG 14 + Stonemaier bundles 3 (BGG
manufacturer ages, §9), Uncle Goose decor 33 (maker-labelled "not a
toy" — honestly age-less, stays), GTG/Sentinel 17 (BGG where listed).
House rule stands: BGG's *manufacturer-suggested* age is the
maker-stated one; its *community* age is not used.

## 8. The recurring sweep — `completeness.yml`

Modeled on `enrich.yml`: `workflow_dispatch` (`brand`, `dry`) +
Wednesdays ~15:23 UTC (offset from Monday's ingest). Rotation has
**no stored cursor**: each run reads the gaps view, walks the §2
rollout order, and takes the first brand(s) with remaining gaps that
fit the budget (~3,500 calls / 120 min, estate discipline via
specall). Per brand visit: ratings via its route → bundle contents
manifests → image/product-url top-ups → popularity rescore **only**
when ratings filled > 0. A brand's first visit is dry-first
(Phase 2/3 gate pattern). Reports go to the step summary + a
workflow artifact in the round-report shape; /admin counters compute
live from the gaps view. Routes not yet built are explicit stub
steps with report lines, never silent skips. BGG brands are excluded
from the rotation until §9 lands.

## 9. The BGG slate (token-gated)

One integration — BGG thing data (average rating + `usersrated` as
the count; manufacturer-suggested ages ride along) matched per
catalog row — covers ~1,890 game rows: Devir 616, Asmodee 303,
Thames & Kosmos games 88, Renegade 176, AEG 139, Capstone Games 137,
Blue Orange 115, GTG 58, Stonemaier 56, Ravensburger games slice.
Watcher: `bgg-approval-watch` cron (checks Gmail every 6h, stops
2026-11-22); the owner's one step is creating the API token. The
matcher should be built so the token is the only blocker.
Fallbacks if match rates disappoint: Renegade/AEG BigCommerce
microdata (parses today, thin counts); a Judge.me extractor of the
Mudpuppy shape for Asmodee *if* its theme server-renders the badge
(BGG stays primary there regardless).

## 10. Open items / known residue

- Projector URL recovery: 192 rows have no `source_url` (Dream
  Machine/Moonlite split unknown until recovered) — precondition
  for their ratings and links.
- Yoto/Tonies pack-exclusive content rows: catalog-growth decision
  pending (§3).
- Two book source-link identity warts: *Frog Town: Airport*'s
  `source_url` points at the wrong OL work (Arthur Hailey's novel;
  the row is the Nosy Crow book, cover correct by ISBN); *The Lady
  and the Unicorn*'s `source_url` is the Chevalier novel's OL work
  while its `product_url`/cover are the Chronicle picture book.
  Recommendation: repoint both to the children's books.
- Nosy Crow photo re-run in a few months (§6).
- The retailer wave (§2.1) is the program's largest remaining build.
