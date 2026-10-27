-- 0058 — abuse limits on the two anonymous write paths.
--
-- From the 2026-10-26 review follow-up (EDIT-LIST E13, E14):
--
--  E14  claim_wishlist_item: at most 30 successful claims per
--       family per rolling hour. Every claim mints exactly one
--       claim token, so this one counter is also the cap on new
--       claim tokens. (The server has no client IP to key on, so
--       the limit is per share slug.) A basket of a dozen gifts
--       fits easily; a script griefing a child's list does not.
--       There is deliberately NO parent "release" action: a
--       released item may already have been bought.
--
--  E13  Double opt-in for gift-list subscribers. A signup now
--       creates an UNCONFIRMED row; reminders go only to rows
--       with confirmed_at set, which happens when the address's
--       owner opens the link in the confirmation email.
--       Also: at most 20 new signups per family per hour, and
--       unconfirmed rows are dropped after 14 days.
--
-- !! DEPLOY ORDER: existing subscribers have no confirmed_at, so
-- !! they stop receiving reminders the moment the reminder function
-- !! is deployed with this migration. Grandfather the real ones
-- !! first (or in the same step):
-- !!   update public.gift_subscribers set confirmed_at = now()
-- !!   where confirmed_at is null and <the ones you checked>;

-- ------------------------------------------------------------ E14
create table if not exists public.claim_log (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists claim_log_profile_time_idx
  on public.claim_log (profile_id, created_at desc);
alter table public.claim_log enable row level security;
revoke all on public.claim_log from public, anon, authenticated;

-- Copy of the 0009 function plus the rate limit. Grants are kept by
-- CREATE OR REPLACE.
create or replace function public.claim_wishlist_item(
  p_slug text,
  p_item_id uuid,
  p_claimer_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target  public.items%rowtype;
  token   text;
  expires timestamptz;
  recent  int;
  -- Successful claims allowed per family per rolling hour.
  hourly_cap constant int := 30;
begin
  select i.* into target
  from public.items i
  join public.profiles p on p.id = i.owner_id
  where i.id = p_item_id
    and p.share_slug = p_slug
    and p.share_enabled
    and i.list_type = 'wishlist'
  for update of i;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if target.claimed_at is not null
     and (target.claim_expires_at is null or target.claim_expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  -- Serialise the count-then-insert per family so two parallel
  -- claims can't both slip under the cap. (Always taken after the
  -- item row lock, so there's no lock-order cycle.)
  perform pg_advisory_xact_lock(hashtextextended('claim:' || target.owner_id::text, 0));

  delete from public.claim_log
   where profile_id = target.owner_id and created_at < now() - interval '1 day';
  select count(*) into recent
    from public.claim_log
   where profile_id = target.owner_id and created_at > now() - interval '1 hour';
  if recent >= hourly_cap then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  insert into public.claim_log (profile_id) values (target.owner_id);

  token := gen_random_uuid()::text;
  expires := public.claim_expiry_for(target.child_id);

  update public.items
  set claimed_at       = now(),
      claimed_by_name  = left(coalesce(nullif(btrim(p_claimer_name), ''), ''), 60),
      claim_token_hash = encode(digest(token, 'sha256'), 'hex'),
      claim_expires_at = expires
  where id = p_item_id;

  return jsonb_build_object('ok', true, 'token', token, 'expires_at', expires);
end;
$$;

-- ------------------------------------------------------------ E13
alter table public.gift_subscribers
  add column if not exists confirmed_at    timestamptz,
  add column if not exists confirm_token   uuid not null default gen_random_uuid(),
  add column if not exists confirm_sent_at timestamptz,
  add column if not exists confirm_sends   int  not null default 0;

create unique index if not exists gift_subscribers_confirm_token_key
  on public.gift_subscribers (confirm_token);
create index if not exists gift_subscribers_profile_created_idx
  on public.gift_subscribers (profile_id, created_at);

-- Signup. Returns: 'ok' (a confirmation email is now due),
-- 'already' (this address is confirmed on this list), 'rate_limited',
-- or the old 'bad_email' / 'not_found' / 'child_required'.
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
  existing public.gift_subscribers;
  recent int;
  hourly_cap constant int := 20;
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

  perform pg_advisory_xact_lock(hashtextextended('subscribe:' || prof.id::text, 0));

  -- Never-confirmed signups don't linger.
  delete from public.gift_subscribers
   where profile_id = prof.id and confirmed_at is null
     and created_at < now() - interval '14 days';

  select * into existing from public.gift_subscribers
   where profile_id = prof.id and email = v_email;

  if existing.id is null then
    select count(*) into recent from public.gift_subscribers
     where profile_id = prof.id and created_at > now() - interval '1 hour';
    if recent >= hourly_cap then
      return 'rate_limited';
    end if;
    insert into public.gift_subscribers (profile_id, child_id, email, scope)
    values (prof.id, case when v_scope = 'child' then p_child_id end, v_email, v_scope);
    return 'ok';
  end if;

  update public.gift_subscribers
     set scope = v_scope,
         child_id = case when v_scope = 'child' then p_child_id end
   where id = existing.id;
  return case when existing.confirmed_at is null then 'ok' else 'already' end;
end;
$$;

-- Called by the send-subscriber-confirmation edge function (service
-- role only). Hands back the token to mail, or null when nothing is
-- due: no such unconfirmed signup, last mail under 10 minutes ago, or
-- 3 mails already sent in the last 24 hours. The anonymous caller of
-- the edge function learns nothing either way.
create or replace function public.next_subscriber_confirmation(p_slug text, p_email text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.gift_subscribers;
  owner_name text;
  sends int;
begin
  select gs.* into s
    from public.gift_subscribers gs
    join public.profiles p on p.id = gs.profile_id
   where p.share_slug = p_slug and p.share_enabled
     and gs.email = lower(trim(coalesce(p_email, '')))
     and gs.confirmed_at is null
   for update of gs;
  if s.id is null then
    return null;
  end if;
  select coalesce(nullif(btrim(display_name), ''), 'a family') into owner_name
    from public.profiles where id = s.profile_id;
  if s.confirm_sent_at is not null and s.confirm_sent_at > now() - interval '10 minutes' then
    return null;
  end if;
  sends := case when s.confirm_sent_at is null
                  or s.confirm_sent_at < now() - interval '1 day'
                then 0 else s.confirm_sends end;
  if sends >= 3 then
    return null;
  end if;
  update public.gift_subscribers
     set confirm_sent_at = now(), confirm_sends = sends + 1
   where id = s.id;
  return jsonb_build_object('token', s.confirm_token, 'owner_name', owner_name);
end;
$$;
revoke all on function public.next_subscriber_confirmation(text, text)
  from public, anon, authenticated;
grant execute on function public.next_subscriber_confirmation(text, text) to service_role;

-- The confirm link's landing page calls this (anon). Idempotent.
create or replace function public.confirm_gift_subscriber(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  update public.gift_subscribers
     set confirmed_at = coalesce(confirmed_at, now())
   where confirm_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
grant execute on function public.confirm_gift_subscriber(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
