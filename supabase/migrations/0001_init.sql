-- Toy Library — initial schema
-- Run in the Supabase SQL editor, or with the Supabase CLI:
--   supabase db push
--
-- Design notes
-- ------------
-- * One `profiles` row per auth user, created by a trigger on sign-up.
-- * Every toy/story lives in `items`, on exactly one of two lists:
--   'have' (already owned — the anti-duplicate list) or 'wishlist'.
-- * Row Level Security: users can only ever touch their own rows.
-- * Gift-givers are anonymous, so they get NO direct table access.
--   The public share page reads through get_shared_list(slug), a
--   SECURITY DEFINER function that returns only the two lists for one
--   profile, and only while sharing is enabled.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  child_name   text not null default '',
  share_slug   text not null unique,
  share_enabled boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------- items
create table public.items (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  list_type       text not null check (list_type in ('have', 'wishlist')),
  -- The platform families this product exists for. Extend freely.
  platform        text not null check (platform in
                    ('tonies', 'leapfrog', 'projector', 'vtech', 'books', 'other')),
  title           text not null,
  -- Series / character / cartridge detail, e.g. "Creative Tonie" or "Paw Patrol".
  details         text not null default '',
  notes           text not null default '',
  -- Normalised title used for duplicate detection.
  normalized_title text generated always as (lower(btrim(title))) stored,
  created_at      timestamptz not null default now()
);

create index items_owner_list_idx on public.items (owner_id, list_type);

-- One copy of a title per platform per list: the database itself refuses
-- the exact duplicate this product exists to prevent. The app catches the
-- violation and shows a friendly "already on your list" message.
create unique index items_no_duplicates_idx
  on public.items (owner_id, list_type, platform, normalized_title);

-- ------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.items    enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "items: all own"
  on public.items for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Deliberately no policies for the anon role: anonymous visitors can only
-- reach data through get_shared_list() below.

-- ------------------------------------------------------------ share slugs
create or replace function public.generate_share_slug()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := 'fam-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from public.profiles where share_slug = candidate);
  end loop;
  return candidate;
end;
$$;

-- -------------------------------------------------------- sign-up trigger
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
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------- public share page read
-- Returns one JSON document for the share page:
--   { child_name, display_name, have: [...], wishlist: [...] }
-- Returns NULL when the slug doesn't exist or sharing is switched off,
-- so the page can show a single "this link isn't available" state.
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
               'id', i.id, 'platform', i.platform,
               'title', i.title, 'details', i.details, 'notes', i.notes)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform,
               'title', i.title, 'details', i.details, 'notes', i.notes)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_shared_list(text) to anon, authenticated;
