-- 0021 — four new catalog platforms (approved by the owner
-- 2026-10-22): HABA (wooden toys + first games), Magna-Tiles
-- (magnetic building sets), SmartGames (single-player logic
-- games) and Lovevery (Montessori play kits). These are
-- physical toys, not player content — the app treats them as
-- always-playable like books (src/lib/platforms.js
-- ALWAYS_PLAYABLE) and files them under the Toys category
-- unless their details say game/book.
--
-- The platform CHECKs on items and catalog_items are widened
-- exactly as 0006/0007 did for earlier platforms.

alter table public.catalog_items drop constraint if exists catalog_items_platform_check;
alter table public.catalog_items add constraint catalog_items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery'
  ));

alter table public.items drop constraint if exists items_platform_check;
alter table public.items add constraint items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery'
  ));

notify pgrst, 'reload schema';
