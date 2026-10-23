-- 0034 — Gift-buyer email signups on the public list (owner
-- request 2026-10-23).
--
-- A visitor on a family's share page can leave an email and be
-- reminded before that child's occasions. How wide the signup
-- reaches is the PARENT's choice in Settings:
--   profiles.subscriber_family_scope = false (default): the
--     signup binds to the one child picked on the page;
--   true: one signup covers all the family's children.
-- The scope is snapshotted onto the subscription at signup time
-- (later Settings flips don't silently widen old signups).
--
-- Anonymous write path is one SECURITY DEFINER RPC that
-- validates the slug like get_shared_list does; the table itself
-- has RLS on and no client policies. Reminder delivery joins the
-- existing send-occasion-reminders run as a third dedupe stream
-- (subscriber_id in occasion_reminder_log, mirroring 0020's
-- relative_id), and unsubscribing mirrors the relatives' token
-- flow (unsubscribe_gift_subscriber + the /unsubscribe page).

alter table public.profiles
  add column if not exists subscriber_family_scope boolean not null default false;

create table public.gift_subscribers (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  child_id          uuid references public.children (id) on delete cascade,
  email             text not null,
  scope             text not null check (scope in ('child', 'family')),
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  unique (profile_id, email)
);
create index gift_subscribers_profile_idx
  on public.gift_subscribers (profile_id);
alter table public.gift_subscribers enable row level security;

alter table public.occasion_reminder_log
  add column if not exists subscriber_id uuid
    references public.gift_subscribers (id) on delete cascade;

create unique index if not exists occasion_reminder_log_subscriber_key
  on public.occasion_reminder_log (occasion_id, occurrence_date, subscriber_id)
  where subscriber_id is not null;

-- -------------------------------------------- subscribe (anon)
create or replace function public.subscribe_gift_list(
  p_slug text, p_email text, p_child_id uuid default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  prof public.profiles;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_scope text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return 'bad_email';
  end if;
  select * into prof from public.profiles
  where share_slug = p_slug and share_enabled;
  if prof.id is null then
    return 'not_found';
  end if;
  v_scope := case when prof.subscriber_family_scope then 'family' else 'child' end;
  if v_scope = 'child' then
    if p_child_id is null
       or not exists (
         select 1 from public.children c
         where c.id = p_child_id and c.owner_id = prof.id
       ) then
      return 'child_required';
    end if;
  end if;
  insert into public.gift_subscribers (profile_id, child_id, email, scope)
  values (prof.id, case when v_scope = 'child' then p_child_id end, v_email, v_scope)
  on conflict (profile_id, email)
  do update set scope = excluded.scope, child_id = excluded.child_id;
  return 'ok';
end;
$$;

-- The share page needs to know which signup form to render
-- (one email box, or email + child picker) without exposing the
-- profiles table: a slug-keyed boolean, same gate as the list.
create or replace function public.gift_list_family_scope(p_slug text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select subscriber_family_scope from public.profiles
     where share_slug = p_slug and share_enabled),
    false);
$$;

-- ------------------------------------------ unsubscribe (anon)
create or replace function public.unsubscribe_gift_subscriber(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  delete from public.gift_subscribers where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

notify pgrst, 'reload schema';
