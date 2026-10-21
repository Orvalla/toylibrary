-- Toy Library — the catalog learns the difference between content and
-- the devices it plays on
-- Run after 0001–0009.
--
-- * catalog_items.item_type: 'content' (the default — every existing
--   row) or 'device' (the player itself: a Toniebox, a Yoto Player, a
--   LeapPad…). The Devices page browses just the devices; the catalog
--   page files them under their own category. Parents' own items are
--   freeform and don't need the column — adding a catalog device to a
--   list works exactly like adding any other catalog row.
-- * Seeds one device row per ecosystem the catalog covers, with the
--   stores' own product photos (verified live when this was written).
--   Storypod's original player is no longer in its store feed; its
--   current player, the Eddi System, stands in for that shelf.

alter table public.catalog_items
  add column if not exists item_type text not null default 'content'
  check (item_type in ('content', 'device'));

insert into public.catalog_items
  (platform, title, details, image_url, source_url, item_type, sort_order)
values
  ('tonies', 'Toniebox 2 Starter Set', 'Toniebox audio player',
   'https://cdn.shopify.com/s/files/1/0403/5431/6439/files/Sky-Blue-11002443-PLPTB2MainImageTransparent.png?v=1774884093',
   'https://us.tonies.com/products/toniebox2-sky-blue', 'device', 1),
  ('yoto', 'Yoto Player', 'Yoto Player (4th generation)',
   'https://cdn.shopify.com/s/files/1/0310/7487/7577/files/UK-Player-4-Basket_f7d1ec65-dcef-4566-afd6-5cdf12e20c7c.png?v=1788981368',
   'https://us.yotoplay.com/products/yoto-player-4', 'device', 1),
  ('yoto', 'Yoto Mini', 'Yoto Mini (4th generation)',
   'https://cdn.shopify.com/s/files/1/0310/7487/7577/files/Mini-4-Basket_110ff932-2613-41d1-b86f-a8258630db88.png?v=1788981020',
   'https://us.yotoplay.com/products/yoto-mini-4', 'device', 2),
  ('leapfrog', 'LeapPad Ultimate', 'LeapPad learning tablet',
   'https://t7.leapfrog.com/images/prod-lg/leappad-ultimate-80-602000_1.jpg',
   'https://store.leapfrog.com/en-us/store/p/leappad-ultimate/_/A-prod80-602000', 'device', 1),
  ('leapfrog', 'LeapPad Academy', 'LeapPad learning tablet',
   'https://t7.leapfrog.com/images/prod-lg/leappad-academy_80-602210_1.jpg',
   'https://store.leapfrog.com/en-us/store/p/leappad-academy/_/A-prod80-602210', 'device', 2),
  ('leapfrog', 'LeapStart', 'LeapStart interactive learning system',
   'https://t7.leapfrog.com/images/prod-lg/leapstart-preschool-success_80-602170_1.jpg',
   'https://store.leapfrog.com/en-us/store/p/leapstart-preschool-success/_/A-prod80-602170', 'device', 3),
  ('storypod', 'The Eddi System', 'Storypod audio player',
   'https://cdn.shopify.com/s/files/1/0499/3594/1800/files/eddi_player_no_bg.png?v=1773416108',
   'https://storypod.com/products/eddi-player-and-nightlight', 'device', 1),
  ('lunii', 'My Fabulous Storyteller', 'Lunii screen-free storyteller',
   'https://cdn.shopify.com/s/files/1/0644/5426/2826/files/FAH-top-01_983946e7-179b-46f8-b521-7d26c8ce5526.jpg?v=1741198514',
   'https://lunii.com/en-us/products/ma-fabrique-a-histoires-bilingue', 'device', 1),
  ('projector', 'Little Tikes Story Dream Machine', 'Story Dream Machine projector',
   'https://cdn.shopify.com/s/files/1/0539/4402/5275/files/image_65.png?v=1764098598',
   'https://www.littletikes.com/products/story-dream-machine™-dr-seuss-starter-pack', 'device', 1),
  ('projector', 'Moonlite Storytime Projector', 'Moonlite projector (clips to a phone)',
   'https://cdn.shopify.com/s/files/1/1723/9779/files/projector_box_threelittlepigs_disc_v2.webp?v=1764176356',
   'https://www.mymoonlite.com/products/the-three-little-pigs-story-with-moonlite-storytime-projector', 'device', 2),
  ('osmo', 'Osmo Base for iPad', 'Osmo base & reflector for iPad',
   'https://cdn.shopify.com/s/files/1/0790/8701/0004/files/osmo_base_ipad_2018_2bfb39fb-ed83-4ddd-b343-40d496997ad5.jpg?v=1764108255',
   'https://www.playosmo.com/products/osmo-new-base-for-ipad', 'device', 1)
on conflict (platform, title) do nothing;

-- The 0004 hand seed already contained the LeapPad Academy tablet as
-- a content row, so the seed above skips it on conflict — file it as
-- the device it is instead.
update public.catalog_items
set item_type = 'device'
where platform = 'leapfrog' and title = 'LeapPad Academy';
