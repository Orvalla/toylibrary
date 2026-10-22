-- 0023 — Little Tikes gets its own platform (owner request
-- 2026-10-22). Until now littletikes.com mapped to the shared
-- projector platform with a Dream-Machine-only filter, so a
-- pasted Little Tikes collection of ordinary toys (the
-- learn-play collection: walkers, activity garden, balance
-- bike) added nothing at all. The store is a general toy
-- store: its toys now file under 'littletikes' (Toys category,
-- always-playable like the other physical-toy platforms),
-- while the Dream Machine line stays on the projector shelf —
-- the ingest-catalog function splits per product by title.
-- Existing projector rows are all Dream Machine / Moonlite
-- content and do not move.
--
-- The platform CHECKs on items and catalog_items are widened
-- exactly as 0021/0022 did.

alter table public.catalog_items drop constraint if exists catalog_items_platform_check;
alter table public.catalog_items add constraint catalog_items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources', 'littletikes'
  ));

alter table public.items drop constraint if exists items_platform_check;
alter table public.items add constraint items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources', 'littletikes'
  ));

notify pgrst, 'reload schema';
