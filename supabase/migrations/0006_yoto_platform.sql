-- Toy Library — Yoto joins the platform families
-- Run after 0001–0005.
--
-- * 'yoto' becomes a valid platform on both items (parents' lists)
--   and catalog_items (the browsable catalog the ingestor stocks).
--   Yoto Cards are collectible audio cards for a screen-free player —
--   the same gift-duplicate problem as Tonies, so they get a family
--   of their own instead of disappearing into 'other'.
-- * The inline CHECKs from 0001/0004 carry the Postgres default names
--   items_platform_check / catalog_items_platform_check; drop them
--   defensively and re-add with the full key list. Keep the list in
--   step with src/lib/platforms.js — a test guards the drift.

alter table public.items
  drop constraint if exists items_platform_check;

alter table public.items
  add constraint items_platform_check
  check (platform in
    ('tonies', 'leapfrog', 'projector', 'vtech', 'books', 'other', 'yoto'));

alter table public.catalog_items
  drop constraint if exists catalog_items_platform_check;

alter table public.catalog_items
  add constraint catalog_items_platform_check
  check (platform in
    ('tonies', 'leapfrog', 'projector', 'vtech', 'books', 'other', 'yoto'));
