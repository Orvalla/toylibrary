-- Toy Library — Storypod, Osmo and Lunii join the platform families
-- Run after 0001–0006.
--
-- * 'storypod', 'osmo' and 'lunii' become valid platforms on both
--   items (parents' lists) and catalog_items (the browsable catalog
--   the ingestor stocks). Each is a collectible-content ecosystem with
--   the same gift-duplicate problem as Tonies and Yoto:
--     storypod — Craftie figures, tokens and books for the Storypod
--                audio player.
--     osmo     — standalone Osmo games (the physical piece sets).
--     lunii    — story albums for the Lunii Storyteller.
-- * Same defensive drop + re-add as 0006, with the full key list.
--   Keep the list in step with src/lib/platforms.js — a test guards
--   the drift.

alter table public.items
  drop constraint if exists items_platform_check;

alter table public.items
  add constraint items_platform_check
  check (platform in
    ('tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books', 'other',
     'storypod', 'osmo', 'lunii'));

alter table public.catalog_items
  drop constraint if exists catalog_items_platform_check;

alter table public.catalog_items
  add constraint catalog_items_platform_check
  check (platform in
    ('tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books', 'other',
     'storypod', 'osmo', 'lunii'));
