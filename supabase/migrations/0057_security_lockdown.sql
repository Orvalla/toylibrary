-- 0057 — security lockdown from the 2026-10-26 code review.
--
-- See EDIT-LIST.md (E1, E2, E9, E10, E11). Everything here is
-- additive or a function replacement; no data is rewritten.
--
--   1. profiles: users can no longer change their own is_admin /
--      donated (RLS limits rows, not columns).
--   2. get_shared_list: the public payload no longer carries a
--      child's gender, birth date or interests.
--   3. items: child_id must belong to the caller; a title already
--      on a child's HAVE list can't be added to that child's
--      wishlist (so it can't be claimed either).
--   4. catalog_items: a rating needs a review count behind it
--      (Rule 3), enforced by trigger on write; set_ratings skips
--      pairs without a count.

-- ---------------------------------------------- 1. profile column guard
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  -- PostgREST runs client requests as the 'authenticated' / 'anon'
  -- roles. SECURITY DEFINER admin RPCs run as the function owner and
  -- the service role is its own role, so both pass through untouched.
  if current_user in ('authenticated', 'anon') then
    new.is_admin := old.is_admin;
    new.donated  := old.donated;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

revoke execute on function public.guard_profile_privileged_columns()
  from public, anon, authenticated;

-- ------------------------------------------------ 2. public share payload
create or replace function public.get_shared_list(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles%rowtype;
  occ  jsonb;
begin
  select * into prof
  from public.profiles
  where share_slug = p_slug and share_enabled;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(e order by (e ->> 'days_until')::int), '[]'::jsonb)
  into occ
  from (
    select jsonb_build_object(
             'child_id', c.id, 'child_name', c.name,
             'label', best.label,
             'date', best.nd,
             'days_until', best.nd - current_date) as e
    from public.children c
    join lateral (
      select o.label, public.next_occasion_date(o.month, o.day) as nd
      from public.occasions o
      where o.child_id = c.id
      order by nd
      limit 1
    ) best on true
    where c.owner_id = prof.id
  ) s;

  return jsonb_build_object(
    'child_name',   prof.child_name,
    'display_name', prof.display_name,
    'no_affiliate', coalesce(prof.no_affiliate, false),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
             order by c.sort_order, c.name)
      from public.children c
      where c.owner_id = prof.id
    ), '[]'::jsonb),
    'occasions', occ,
    'next_occasion', case when jsonb_array_length(occ) > 0 then occ -> 0 else null end,
    'have', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin, 'product_url', i.product_url,
               'is_bundle', coalesce(twin.is_bundle, false),
               'bundle', bd.bundle_json,
               'child_id', i.child_id, 'child_name', ch.name)
             order by i.platform, i.title)
      from public.items i
      left join public.children ch on ch.id = i.child_id
      left join public.catalog_items twin
        on twin.platform = i.platform and lower(twin.title) = lower(i.title)
      left join lateral (
        select jsonb_build_object(
          'total', (select count(*) from public.bundle_contents bc
                    where bc.bundle_id = twin.id),
          'owned', (select count(*)
                    from public.bundle_contents bc
                    join public.catalog_items cc on cc.id = bc.content_id
                    where bc.bundle_id = twin.id
                      and exists (
                        select 1 from public.items oi
                        where oi.owner_id = prof.id and oi.list_type = 'have'
                          and oi.platform = cc.platform
                          and lower(oi.title) = lower(cc.title)
                          and (oi.child_id = i.child_id or oi.child_id is null
                               or i.child_id is null))),
          'missing', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'title', m.title, 'platform', m.platform,
                     'asin', m.asin, 'image_url', m.image_url))
            from (
              select cc.title, cc.platform, cc.asin, cc.image_url
              from public.bundle_contents bc
              join public.catalog_items cc on cc.id = bc.content_id
              where bc.bundle_id = twin.id
                and not exists (
                  select 1 from public.items oi
                  where oi.owner_id = prof.id and oi.list_type = 'have'
                    and oi.platform = cc.platform
                    and lower(oi.title) = lower(cc.title)
                    and (oi.child_id = i.child_id or oi.child_id is null
                         or i.child_id is null))
              order by cc.title
              limit 12
            ) m), '[]'::jsonb)
        ) as bundle_json
      ) bd on twin.is_bundle
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id, 'platform', i.platform, 'title', i.title,
                 'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin, 'product_url', i.product_url,
                 'is_bundle', coalesce(twin.is_bundle, false),
                 'bundle', bd.bundle_json,
                 'claimed', i.claimed_at is not null
                            and (i.claim_expires_at is null or i.claim_expires_at > now()),
                 'child_id', i.child_id, 'child_name', ch.name)
               || case
                    when i.claimed_at is not null
                         and (i.claim_expires_at is null or i.claim_expires_at > now())
                    then jsonb_build_object('claimed_by', i.claimed_by_name)
                    else '{}'::jsonb
                  end
             order by i.platform, i.title)
      from public.items i
      left join public.children ch on ch.id = i.child_id
      left join public.catalog_items twin
        on twin.platform = i.platform and lower(twin.title) = lower(i.title)
      left join lateral (
        select jsonb_build_object(
          'total', (select count(*) from public.bundle_contents bc
                    where bc.bundle_id = twin.id),
          'owned', (select count(*)
                    from public.bundle_contents bc
                    join public.catalog_items cc on cc.id = bc.content_id
                    where bc.bundle_id = twin.id
                      and exists (
                        select 1 from public.items oi
                        where oi.owner_id = prof.id and oi.list_type = 'have'
                          and oi.platform = cc.platform
                          and lower(oi.title) = lower(cc.title)
                          and (oi.child_id = i.child_id or oi.child_id is null
                               or i.child_id is null))),
          'missing', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'title', m.title, 'platform', m.platform,
                     'asin', m.asin, 'image_url', m.image_url))
            from (
              select cc.title, cc.platform, cc.asin, cc.image_url
              from public.bundle_contents bc
              join public.catalog_items cc on cc.id = bc.content_id
              where bc.bundle_id = twin.id
                and not exists (
                  select 1 from public.items oi
                  where oi.owner_id = prof.id and oi.list_type = 'have'
                    and oi.platform = cc.platform
                    and lower(oi.title) = lower(cc.title)
                    and (oi.child_id = i.child_id or oi.child_id is null
                         or i.child_id is null))
              order by cc.title
              limit 12
            ) m), '[]'::jsonb)
        ) as bundle_json
      ) bd on twin.is_bundle
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_shared_list(text) to anon, authenticated;

-- ------------------------------------- 3. items: ownership + owned wishlist
drop policy if exists "items: all own" on public.items;
create policy "items: all own"
  on public.items for all
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and (
      child_id is null
      or exists (
        select 1 from public.children c
        where c.id = child_id and c.owner_id = auth.uid()
      )
    )
  );

create or replace function public.block_owned_wishlist_insert()
returns trigger
language plpgsql
as $$
begin
  if new.list_type = 'wishlist' and exists (
    select 1 from public.items h
    where h.owner_id = new.owner_id
      and h.list_type = 'have'
      and h.platform = new.platform
      and h.normalized_title = lower(btrim(new.title))
      and coalesce(h.child_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(new.child_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    -- 23505 so existing clash handling in the app keeps working; the
    -- message lets the dashboard say it precisely.
    raise exception 'already_owned' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists items_block_owned_wishlist on public.items;
create trigger items_block_owned_wishlist
  before insert on public.items
  for each row execute function public.block_owned_wishlist_insert();

revoke execute on function public.block_owned_wishlist_insert()
  from public, anon, authenticated;

-- ------------------------------------------------ 4. ratings need counts
-- Enforced by a trigger rather than a CHECK: a NOT VALID CHECK still
-- fires on every UPDATE of a legacy bad row (hide, popularity, ...),
-- whereas this only looks when rating / rating_count are written.
-- A rating without a positive review count is stored as unrated
-- ("unrated-and-honest beats rated-and-invented"). No carve-out for
-- 0/0: the Claude↔Elise review (2026-10-26) confirmed no writer ever
-- stores a 0/0 row — the backfill only counts honest zeros — so the
-- carve-out was dead permissiveness contradicting set_ratings.
create or replace function public.enforce_rating_needs_count()
returns trigger
language plpgsql
as $$
begin
  if new.rating is not null
     and coalesce(new.rating_count, 0) <= 0 then
    new.rating := null;
    new.rating_count := null;
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_items_rating_needs_count on public.catalog_items;
create trigger catalog_items_rating_needs_count
  before insert or update of rating, rating_count on public.catalog_items
  for each row execute function public.enforce_rating_needs_count();

revoke execute on function public.enforce_rating_needs_count()
  from public, anon, authenticated;
-- Legacy rows are untouched; find them with:
--   select count(*) from public.catalog_items
--    where rating is not null and coalesce(rating_count, 0) = 0;

create or replace function public.set_ratings(p_updates jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.catalog_items c
     set rating = u.rating,
         rating_count = u.rating_count,
         source_url = coalesce(u.source_url, c.source_url)
    from jsonb_to_recordset(p_updates) as u(
           id uuid, rating numeric, rating_count int, source_url text)
   where c.id = u.id
     and u.rating is not null
     and u.rating between 0 and 5
     and coalesce(u.rating_count, 0) > 0;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.set_ratings(jsonb) from public, anon, authenticated;
grant execute on function public.set_ratings(jsonb) to service_role;

notify pgrst, 'reload schema';
