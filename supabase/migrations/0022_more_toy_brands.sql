-- 0022 — six more toy brands (approved by the owner 2026-10-22,
-- catalog expansion round 2): Melissa & Doug (wooden toys),
-- Little People (Fisher-Price's toddler play system, its own
-- platform — research in hidden_files/catalog-expansion-2),
-- BRIO (wooden railway), Fat Brain (own-brand originals only),
-- Lakeshore (gift collection only) and Learning Resources
-- (hand-picked consumer lines only). All physical toys:
-- always-playable like books, filed under Toys unless their
-- details say otherwise (src/lib/platforms.js).
--
-- The platform CHECKs on items and catalog_items are widened
-- exactly as 0021 did.

alter table public.catalog_items drop constraint if exists catalog_items_platform_check;
alter table public.catalog_items add constraint catalog_items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources'
  ));

alter table public.items drop constraint if exists items_platform_check;
alter table public.items add constraint items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources'
  ));

notify pgrst, 'reload schema';
