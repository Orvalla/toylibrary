-- Suggested age ranges for catalog items, in years (numeric so
-- half-years work: 0.5 = 6 months). NULL = no guidance. These
-- are editorial defaults by platform/format (manufacturer age
-- grades), backfilled below and applied to future ingests by
-- ingestor/ages.mjs; a store-stated age on a specific product
-- should override the default when known.
alter table public.catalog_items
  add column if not exists age_min_years numeric(3, 1),
  add column if not exists age_max_years numeric(3, 1);

-- Books: by format band (details carry the format wording).
update public.catalog_items set age_min_years = 0, age_max_years = 3
  where platform = 'books' and details ilike '%board%' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 6
  where platform = 'books' and details ilike '%picture%' and age_min_years is null;
update public.catalog_items set age_min_years = 4, age_max_years = 7
  where platform = 'books' and (details ilike '%early reader%' or details ilike '%beginning reader%' or details ilike '%first reader%') and age_min_years is null;
update public.catalog_items set age_min_years = 6, age_max_years = 11
  where platform = 'books' and details ilike '%graphic%' and age_min_years is null;
update public.catalog_items set age_min_years = 7, age_max_years = 10
  where platform = 'books' and details ilike '%chapter%' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 8
  where platform = 'books' and age_min_years is null;

-- Platform defaults (content rows first, devices overridden after).
update public.catalog_items set age_min_years = 3, age_max_years = 8
  where platform = 'tonies' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 9
  where platform = 'yoto' and age_min_years is null;
update public.catalog_items set age_min_years = 2, age_max_years = 7
  where platform = 'leapfrog' and age_min_years is null;
update public.catalog_items set age_min_years = 2, age_max_years = 6
  where platform = 'storypod' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 8
  where platform = 'lunii' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 6
  where platform = 'projector' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 10
  where platform = 'osmo' and age_min_years is null;
update public.catalog_items set age_min_years = 1, age_max_years = 5
  where platform = 'vtech' and age_min_years is null;
update public.catalog_items set age_min_years = 3, age_max_years = 8
  where platform = 'other' and age_min_years is null;

-- Device overrides (manufacturer grades for the players).
update public.catalog_items set age_min_years = 3, age_max_years = 10
  where item_type = 'device' and platform in ('tonies', 'leapfrog');
update public.catalog_items set age_min_years = 3, age_max_years = 12
  where item_type = 'device' and platform = 'yoto';
update public.catalog_items set age_min_years = 1, age_max_years = 6
  where item_type = 'device' and platform = 'projector' and title ilike '%moonlite%';
