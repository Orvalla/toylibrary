-- 0062 — round-2 residue (owner decisions O6, B8).
--
--  O6  add-mode (store-search adds, ingest-catalog mode 'add') gets its
--      own daily budget: 100 genuine creations per user per UTC day,
--      taken and refunded atomically in the database exactly like the
--      url-mode budget of 0060 (separate table + functions, so the two
--      budgets never share a counter). The function takes 1 unit
--      around the insert and refunds it when nothing was created
--      (row already in the catalog, blocked title, insert failure).
--
--  B8  catalog_items.base_price_usd / base_price_checked_at (0059) are an
--      internal deal-spotting anchor. anon and authenticated held
--      table-level SELECT on catalog_items, so both columns were
--      readable over REST. Fix: swap the table-level SELECT for a
--      column-level SELECT on every OTHER column. Row visibility (RLS,
--      0032) is unchanged; service_role keeps its table-level access;
--      writes were already revoked for anon/authenticated (0019).
--
--      !! Consequences of column-level grants — read before adding
--      !! columns to catalog_items or querying it from the browser:
--      !!   * `select *` (or an unspecified select list) on catalog_items
--      !!     by anon/authenticated now fails with "permission denied".
--      !!     List columns explicitly (src/lib/catalogFetch.js
--      !!     CATALOG_COLUMNS).
--      !!   * A column added to catalog_items later is NOT readable by
--      !!     anon/authenticated until its migration says
--      !!       grant select (new_col) on public.catalog_items
--      !!         to anon, authenticated;
--      !!     and no migration may re-grant table-level SELECT.
--      !!     src/lib/catalogGrants.test.js enforces both in CI.
--
--      The grant list is built from information_schema at migration
--      time so it covers every column that exists in the live database,
--      including any added outside the migration files.

-- ------------------------------------------------ O6. add-mode quota
create table if not exists public.add_quota (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  used    int  not null default 0 check (used >= 0),
  primary key (user_id, day)
);
alter table public.add_quota enable row level security;
revoke all on public.add_quota from public, anon, authenticated;

create or replace function public.add_quota_left(p_user uuid, p_cap int)
returns int
language sql stable security definer set search_path = public
as $$
  select greatest(0, p_cap - coalesce(
    (select used from public.add_quota
      where user_id = p_user and day = (now() at time zone 'utc')::date), 0));
$$;

-- Take up to p_want units; returns how many were granted. The row lock
-- serialises concurrent callers (same pattern as take_url_quota).
create or replace function public.take_add_quota(p_user uuid, p_want int, p_cap int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  u int;
  granted int;
begin
  if p_want <= 0 then
    return 0;
  end if;
  insert into public.add_quota (user_id, day) values (p_user, today)
    on conflict do nothing;
  select used into u from public.add_quota
   where user_id = p_user and day = today for update;
  granted := greatest(0, least(p_want, p_cap - u));
  update public.add_quota set used = u + granted
   where user_id = p_user and day = today;
  delete from public.add_quota where user_id = p_user and day < today - 7;
  return granted;
end;
$$;

create or replace function public.refund_add_quota(p_user uuid, p_n int)
returns void
language sql security definer set search_path = public
as $$
  update public.add_quota
     set used = greatest(0, used - greatest(p_n, 0))
   where user_id = p_user and day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.add_quota_left(uuid, int) from public, anon, authenticated;
revoke all on function public.take_add_quota(uuid, int, int) from public, anon, authenticated;
revoke all on function public.refund_add_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.add_quota_left(uuid, int) to service_role;
grant execute on function public.take_add_quota(uuid, int, int) to service_role;
grant execute on function public.refund_add_quota(uuid, int) to service_role;

-- ------------------------------------------- B8. base price privacy
do $$
declare
  cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'catalog_items'
     and column_name not in ('base_price_usd', 'base_price_checked_at');

  revoke select on public.catalog_items from public, anon, authenticated;
  execute format(
    'grant select (%s) on public.catalog_items to anon, authenticated', cols);
end;
$$;

-- The only supported way for a signed-in admin to read the anchor.
-- (service_role scripts read the table directly.)
create or replace function public.admin_catalog_prices(p_platform text default null)
returns table (
  id uuid,
  platform text,
  title text,
  base_price_usd numeric,
  base_price_checked_at date
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  return query
    select ci.id, ci.platform, ci.title, ci.base_price_usd, ci.base_price_checked_at
      from public.catalog_items ci
     where ci.base_price_usd is not null
       and (p_platform is null or ci.platform = p_platform)
     order by ci.platform, ci.title;
end;
$$;
revoke all on function public.admin_catalog_prices(text) from public, anon;
grant execute on function public.admin_catalog_prices(text) to authenticated;

notify pgrst, 'reload schema';
