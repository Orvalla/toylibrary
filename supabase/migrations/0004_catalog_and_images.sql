-- Toy Library — tiles, images, and a browsable catalog
-- Run after 0001–0003.
--
-- * items.image_url: a photo of the item (uploaded to Storage, or any
--   image URL). Tiles fall back to platform art when it's empty.
-- * catalog_items: reference data — the well-known titles per platform
--   that parents browse and tap to add, instead of typing. Publicly
--   readable (it's a catalog, not user data); only service_role writes.
-- * Storage bucket 'item-images': public read, each user writes only
--   under their own uid/ folder.

alter table public.items
  add column if not exists image_url text not null default '';

-- ---------------------------------------------------------------- catalog
create table public.catalog_items (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null check (platform in
               ('tonies', 'leapfrog', 'projector', 'vtech', 'books', 'other')),
  title      text not null,
  details    text not null default '',
  image_url  text not null default '',
  sort_order int  not null default 0,
  unique (platform, title)
);

alter table public.catalog_items enable row level security;

create policy "catalog: public read"
  on public.catalog_items for select
  using (true);
-- No insert/update/delete policies: writes happen via migrations or the
-- dashboard with the service role, never from the app.

insert into public.catalog_items (platform, title, details, sort_order) values
  -- Tonies audio characters
  ('tonies', 'Paw Patrol — Chase', 'Character Tonie', 10),
  ('tonies', 'Paw Patrol — Skye', 'Character Tonie', 11),
  ('tonies', 'Bluey', 'Character Tonie', 12),
  ('tonies', 'Peppa Pig', 'Character Tonie', 13),
  ('tonies', 'The Very Hungry Caterpillar', 'Story Tonie', 14),
  ('tonies', 'The Gruffalo', 'Story Tonie', 15),
  ('tonies', 'Disney Frozen — Elsa', 'Character Tonie', 16),
  ('tonies', 'Disney The Lion King', 'Story Tonie', 17),
  ('tonies', 'CoComelon', 'Songs Tonie', 18),
  ('tonies', 'Hey Duggee', 'Character Tonie', 19),
  ('tonies', 'Octonauts', 'Character Tonie', 20),
  ('tonies', 'Sesame Street — Elmo', 'Character Tonie', 21),
  ('tonies', 'Creative Tonie', 'Record your own audio', 22),
  -- LeapFrog
  ('leapfrog', 'LeapPad: Letter Factory Adventures', 'Game cartridge', 10),
  ('leapfrog', 'LeapStart: Alphabet Adventures', 'LeapStart book', 11),
  ('leapfrog', 'LeapStart: Daily Routines', 'LeapStart book', 12),
  ('leapfrog', 'LeapStart: Preschool Success', 'LeapStart book', 13),
  ('leapfrog', 'Tag Reader: Green Eggs and Ham', 'Tag book', 14),
  ('leapfrog', 'LeapPad: Paw Patrol', 'Game cartridge', 15),
  -- Storybook projector (Moonlite and similar)
  ('projector', 'Goodnight Moon', 'Story reel', 10),
  ('projector', 'The Very Hungry Caterpillar', 'Story reel', 11),
  ('projector', 'Llama Llama Red Pajama', 'Story reel', 12),
  ('projector', 'Guess How Much I Love You', 'Story reel', 13),
  ('projector', 'If You Give a Mouse a Cookie', 'Story reel', 14),
  ('projector', 'The Tale of Peter Rabbit', 'Story reel', 15),
  ('projector', 'Corduroy', 'Story reel', 16),
  -- VTech
  ('vtech', 'Musical Rhymes Book', 'Interactive book', 10),
  ('vtech', 'Rhyme and Discover Book', 'Interactive book', 11),
  -- Books
  ('books', 'Dragons Love Tacos', 'Picture book', 10),
  ('books', 'Where the Wild Things Are', 'Picture book', 11),
  ('books', 'Goodnight Moon', 'Board book', 12),
  ('books', 'Brown Bear, Brown Bear, What Do You See?', 'Board book', 13),
  ('books', 'The Day the Crayons Quit', 'Picture book', 14),
  ('books', 'Giraffes Can''t Dance', 'Picture book', 15),
  ('books', 'Love You Forever', 'Picture book', 16)
on conflict (platform, title) do nothing;

-- Real cover art for a few books via Open Library's public cover service
-- (stable ISBN-based URLs). Everything else starts blank and gets a
-- photo the first time a parent uploads one or an admin fills it in.
update public.catalog_items set image_url = 'https://covers.openlibrary.org/b/isbn/9780803736801-L.jpg' where platform = 'books' and title = 'Dragons Love Tacos';
update public.catalog_items set image_url = 'https://covers.openlibrary.org/b/isbn/9780060254926-L.jpg' where platform = 'books' and title = 'Where the Wild Things Are';
update public.catalog_items set image_url = 'https://covers.openlibrary.org/b/isbn/9780060171198-L.jpg' where platform = 'books' and title = 'Goodnight Moon';
update public.catalog_items set image_url = 'https://covers.openlibrary.org/b/isbn/9780805047905-L.jpg' where platform = 'books' and title = 'Brown Bear, Brown Bear, What Do You See?';

-- ------------------------------------------------------- image storage
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

create policy "item-images: public read"
  on storage.objects for select
  using (bucket_id = 'item-images');

create policy "item-images: owners write in own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "item-images: owners update own folder"
  on storage.objects for update
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "item-images: owners delete own folder"
  on storage.objects for delete
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------- share page RPC (adds images)
create or replace function public.get_shared_list(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles%rowtype;
begin
  select * into prof
  from public.profiles
  where share_slug = p_slug and share_enabled;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'child_name',   prof.child_name,
    'display_name', prof.display_name,
    'have', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url,
               'claimed', i.claimed_at is not null,
               'claimed_by', i.claimed_by_name)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;
