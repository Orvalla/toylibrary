-- 0054 — Catalog completeness program (2026-10-25): the bundle
-- counterpart of 0053's age_no_data flag, plus the gaps view the
-- recurring completeness sweep (ingestor/bundle-contents.mjs,
-- .github/workflows/completeness.yml) and the /admin counters
-- read as their single queue definition.
--
-- bundle_contents_no_data marks a bundle whose contents were
-- ATTEMPTED and are genuinely not published in extractable form:
-- quantity packs of one item (KiwiCo party packs, eeBoo "(6)"
-- assortments), one work split across media with no per-part
-- contents stated, and bundles whose maker page is gone. Without
-- the flag the sweep would re-queue those rows forever; with it,
-- "not yet tried" and "tried, not published" stay distinct —
-- exactly the age_no_data precedent.
--
-- catalog_completeness_gaps exposes per-platform counts for every
-- gap class the program tracks. Aggregate counts only — no row
-- data, no user data — over the already-public catalog, so the
-- view needs no policy of its own. "Unmapped bundles" excludes
-- no-data-flagged rows; books are excluded from the product_url
-- gap (their maker-link slot is by design — books carry source
-- links instead, owner ruling 2026-10-21).

alter table public.catalog_items
  add column if not exists bundle_contents_no_data boolean not null default false;

create or replace view public.catalog_completeness_gaps as
select
  ci.platform,
  count(*) as total_rows,
  count(*) filter (where ci.rating is null) as unrated,
  count(*) filter (
    where ci.is_bundle
      and not ci.bundle_contents_no_data
      and not exists (
        select 1 from public.bundle_contents bc where bc.bundle_id = ci.id
      )
  ) as unmapped_bundles,
  count(*) filter (where ci.is_bundle and ci.bundle_contents_no_data) as bundles_no_data,
  count(*) filter (where ci.image_url = '') as missing_image,
  count(*) filter (
    where ci.platform <> 'books' and (ci.product_url is null or ci.product_url = '')
  ) as missing_product_url,
  count(*) filter (where ci.age_no_data) as age_no_data
from public.catalog_items ci
group by ci.platform;

notify pgrst, 'reload schema';
