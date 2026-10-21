-- Toy Library — per-child lists
-- Run after 0001–0004.
--
-- * A profile can now have several children (public.children). Every
--   item optionally belongs to one child via items.child_id; NULL means
--   "Family" — shared by everyone, not tied to a single kid.
-- * Deleting a child never deletes toys: items.child_id is
--   ON DELETE SET NULL, so its items fall back to Family.
-- * Duplicate protection becomes per-child: the same title may exist
--   once per child (plus once for Family), never twice for the same one.
-- * Existing single-child families are backfilled: a profile that had a
--   child_name gets one children row with that name, and all of its
--   existing items are assigned to that child — that was their library.

-- ---------------------------------------------------------------- children
create table public.children (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create index children_owner_idx on public.children (owner_id);

alter table public.children enable row level security;

create policy "children: all own"
  on public.children for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ------------------------------------------------------------- items link
alter table public.items
  add column child_id uuid references public.children (id) on delete set null;

create index items_child_idx on public.items (child_id);

-- ------------------------------------------- duplicates are per-child now
drop index public.items_no_duplicates_idx;

-- A plain unique index would treat NULL child_id rows as all distinct,
-- so Family items could still duplicate. Keying the Family bucket on
-- the all-zeros UUID via coalesce keeps one copy per title there too.
create unique index items_no_duplicates_idx
  on public.items (
    owner_id, list_type, platform, normalized_title,
    coalesce(child_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------- backfill
insert into public.children (owner_id, name, sort_order)
select p.id, p.child_name, 0
from public.profiles p
where p.child_name <> '';

-- At this point every owner has at most the one backfilled child, so a
-- plain owner join assigns the whole existing library to that child.
update public.items i
set child_id = c.id
from public.children c
where c.owner_id = i.owner_id
  and i.child_id is null;

-- ------------------------------------------- share page RPC (per-child)
-- Same shape as 0004, plus:
--   * top-level 'children': [{id, name}] in display order, so the share
--     page can group the lists per child;
--   * every item gains 'child_id' and 'child_name' (null for Family).
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
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
             order by c.sort_order, c.name)
      from public.children c
      where c.owner_id = prof.id
    ), '[]'::jsonb),
    'have', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url,
               'child_id', i.child_id, 'child_name', ch.name)
             order by i.platform, i.title)
      from public.items i
      left join public.children ch on ch.id = i.child_id
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url,
               'claimed', i.claimed_at is not null,
               'claimed_by', i.claimed_by_name,
               'child_id', i.child_id, 'child_name', ch.name)
             order by i.platform, i.title)
      from public.items i
      left join public.children ch on ch.id = i.child_id
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------- sign-ups get a child
-- Replace the 0001 trigger function: a profile created with a
-- child_name also gets its first children row, so brand-new families
-- start with that kid's list ready instead of everything landing in
-- Family until they visit Settings.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, child_name, share_slug)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.raw_user_meta_data ->> 'child_name', ''),
    public.generate_share_slug()
  );
  if coalesce(new.raw_user_meta_data ->> 'child_name', '') <> '' then
    insert into public.children (owner_id, name)
    values (new.id, new.raw_user_meta_data ->> 'child_name');
  end if;
  return new;
end;
$$;
