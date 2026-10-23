-- 0031 — Site admin + catalog moderation (owner request 2026-10-23).
--
-- The owner gets an /admin page over the user-grown catalog:
--   * a log of every catalog addition any parent made
--     (catalog_additions, migration 0008, gains a stable item link
--     and a needs_review flag),
--   * one-click removal of an addition's catalog row,
--   * a "private" toggle: catalog_items.hidden — the row leaves
--     everyone else's catalog but stays in the adder's (their own
--     list copies in `items` are untouched either way),
--   * automatic review flagging: when ingest-catalog screens out
--     an inappropriate add attempt, it writes a moderation_flags
--     row and sets needs_review on ALL of that account's
--     additions, so the owner can sweep their whole history.
--
-- Admin power lives in profiles.is_admin + SECURITY DEFINER RPCs
-- that check it; no client-facing table policies are widened.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.catalog_items
  add column if not exists hidden boolean not null default false;

alter table public.catalog_additions
  add column if not exists catalog_item_id uuid references public.catalog_items (id) on delete set null,
  add column if not exists needs_review boolean not null default false;

-- Backfill the item link for additions already logged (exact
-- platform + case-insensitive title is how the app joins them).
update public.catalog_additions a
set catalog_item_id = c.id
from public.catalog_items c
where a.catalog_item_id is null
  and c.platform = a.platform
  and lower(c.title) = lower(a.title);

-- The owner's own account.
update public.profiles set is_admin = true
where id = '9dbd5f45-bd90-4293-ba7a-f0fad7555db2';

-- ---------------------------------------------------- flag log
create table public.moderation_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  detail     text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index moderation_flags_user_idx
  on public.moderation_flags (user_id, created_at desc);
alter table public.moderation_flags enable row level security;
-- No client policies: only the service role (ingest-catalog) writes,
-- and only the admin RPCs below read.

-- ------------------------------------------- private-row privacy
-- Replace the wide-open catalog read: hidden rows are visible only
-- to the parent who added them and to admins. SECURITY DEFINER
-- RPCs and the service role are unaffected.
drop policy if exists "catalog: public read" on public.catalog_items;
create policy "catalog: public read"
  on public.catalog_items for select
  using (
    not hidden
    or added_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

-- ------------------------------------------------------ helpers
create or replace function public.caller_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  );
$$;

-- -------------------------------------------------- admin reads
create or replace function public.admin_additions(
  p_limit int default 100,
  p_offset int default 0,
  p_flagged_only boolean default false
)
returns table (
  addition_id uuid,
  created_at timestamptz,
  user_id uuid,
  user_name text,
  user_slug text,
  platform text,
  title text,
  source_url text,
  catalog_item_id uuid,
  image_url text,
  hidden boolean,
  needs_review boolean,
  item_gone boolean
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  return query
  select a.id, a.created_at, a.user_id,
         coalesce(p.display_name, ''), coalesce(p.share_slug, ''),
         a.platform, a.title, a.source_url, a.catalog_item_id,
         c.image_url, coalesce(c.hidden, false), a.needs_review,
         (a.catalog_item_id is null or c.id is null)
  from public.catalog_additions a
  join public.profiles p on p.id = a.user_id
  left join public.catalog_items c on c.id = a.catalog_item_id
  where (not p_flagged_only or a.needs_review)
  order by a.needs_review desc, a.created_at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.admin_flags()
returns table (
  flag_id uuid,
  created_at timestamptz,
  user_id uuid,
  user_name text,
  user_slug text,
  detail text,
  resolved_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  return query
  select f.id, f.created_at, f.user_id,
         coalesce(p.display_name, ''), coalesce(p.share_slug, ''),
         f.detail, f.resolved_at
  from public.moderation_flags f
  join public.profiles p on p.id = f.user_id
  order by (f.resolved_at is not null), f.created_at desc
  limit 200;
end;
$$;

-- ------------------------------------------------- admin actions
create or replace function public.admin_remove_catalog_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  delete from public.bundle_contents
  where bundle_id = p_item_id or content_id = p_item_id;
  delete from public.catalog_items where id = p_item_id;
end;
$$;

create or replace function public.admin_set_catalog_private(
  p_item_id uuid, p_private boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  update public.catalog_items set hidden = p_private where id = p_item_id;
end;
$$;

create or replace function public.admin_set_addition_review(
  p_addition_id uuid, p_needs_review boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  update public.catalog_additions
  set needs_review = p_needs_review where id = p_addition_id;
end;
$$;

-- Clearing a user: every addition of theirs leaves the review
-- queue and their open moderation flags are marked resolved.
create or replace function public.admin_clear_user_review(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  update public.catalog_additions
  set needs_review = false where user_id = p_user_id;
  update public.moderation_flags
  set resolved_at = now()
  where user_id = p_user_id and resolved_at is null;
end;
$$;

notify pgrst, 'reload schema';
