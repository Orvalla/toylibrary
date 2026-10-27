-- 0060 — round-2 review fixes for the link-paste flow (b5b8754).
--
--  1. catalog_items.pending_review: "waiting for an admin to publish"
--     is its own flag. /admin used to treat EVERY hidden row as a
--     pending link-paste addition, which also listed rows the owner
--     had deliberately made private or hidden for other reasons,
--     with a Publish button. url-mode inserts now set both
--     hidden and pending_review; Publish clears both.
--  2. url_add_quota: the per-parent daily budget for link-paste
--     creations, taken/refunded atomically. The previous count of
--     catalog_additions (a) let parallel requests read the same
--     remaining figure and each insert a full batch, and (b) went
--     quietly short when a log insert failed.
--
-- Service-role only, called by the ingest-catalog function.

-- ------------------------------------------------ 1. pending_review
alter table public.catalog_items
  add column if not exists pending_review boolean not null default false;

create index if not exists catalog_items_pending_review_idx
  on public.catalog_items (title) where pending_review;

-- Rows already waiting when this ships: hidden link-paste additions
-- logged since the url-mode change went live (2026-10-27). Hidden rows
-- from before that date were hidden for other reasons and stay out.
update public.catalog_items ci
   set pending_review = true
 where ci.hidden
   and ci.added_by is not null
   and exists (
     select 1 from public.catalog_additions a
      where a.catalog_item_id = ci.id
        and a.created_at >= date '2026-10-27'
   );

create or replace function public.admin_publish_catalog_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  update public.catalog_items
     set hidden = false, pending_review = false
   where id = p_item_id;
end;
$$;
grant execute on function public.admin_publish_catalog_item(uuid) to authenticated;

-- ------------------------------------------------ 2. daily url quota
create table if not exists public.url_add_quota (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  used    int  not null default 0 check (used >= 0),
  primary key (user_id, day)
);
alter table public.url_add_quota enable row level security;
revoke all on public.url_add_quota from public, anon, authenticated;

-- How much of today's (UTC) budget is left.
create or replace function public.url_quota_left(p_user uuid, p_cap int)
returns int
language sql stable security definer set search_path = public
as $$
  select greatest(0, p_cap - coalesce(
    (select used from public.url_add_quota
      where user_id = p_user and day = (now() at time zone 'utc')::date), 0));
$$;

-- Take up to p_want units; returns how many were granted. The row lock
-- serialises concurrent callers, so parallel requests can't each be
-- granted the same remaining allowance.
create or replace function public.take_url_quota(p_user uuid, p_want int, p_cap int)
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
  insert into public.url_add_quota (user_id, day) values (p_user, today)
    on conflict do nothing;
  select used into u from public.url_add_quota
   where user_id = p_user and day = today for update;
  granted := greatest(0, least(p_want, p_cap - u));
  update public.url_add_quota set used = u + granted
   where user_id = p_user and day = today;
  delete from public.url_add_quota where user_id = p_user and day < today - 7;
  return granted;
end;
$$;

-- Give back units that weren't used (duplicates skipped, link already in the catalog).
create or replace function public.refund_url_quota(p_user uuid, p_n int)
returns void
language sql security definer set search_path = public
as $$
  update public.url_add_quota
     set used = greatest(0, used - greatest(p_n, 0))
   where user_id = p_user and day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.url_quota_left(uuid, int) from public, anon, authenticated;
revoke all on function public.take_url_quota(uuid, int, int) from public, anon, authenticated;
revoke all on function public.refund_url_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.url_quota_left(uuid, int) to service_role;
grant execute on function public.take_url_quota(uuid, int, int) to service_role;
grant execute on function public.refund_url_quota(uuid, int) to service_role;

notify pgrst, 'reload schema';
