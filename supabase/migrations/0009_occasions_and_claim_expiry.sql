-- Toy Library — occasions + claim expiry
-- Run after 0001–0008.
--
-- * Each child can have yearly occasions (public.occasions): a birthday,
--   Christmas, any month/day that repeats every year. The share page
--   highlights each child's next one so gift-givers know what's coming.
-- * Wishlist claims now expire (items.claim_expires_at). A claim holds
--   until the item's child's nearest occasion + 1 day when that
--   occasion is within 90 days, and for 60 days otherwise (family
--   items included). After the expiry the claim stops counting
--   everywhere — the share page treats it as unclaimed and a new
--   gift-giver can claim — so lists stay current without parents
--   having to tidy up after every holiday.

-- ---------------------------------------------------------------- occasions
create table public.occasions (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.children (id) on delete cascade,
  label      text not null,
  month      smallint not null check (month between 1 and 12),
  -- Feb 29 is allowed and clamps to Feb 28 in non-leap years (see
  -- next_occasion_date); other months refuse impossible days.
  day        smallint not null check (
    day between 1 and
      case month
        when 2 then 29
        when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
        else 31
      end
  ),
  created_at timestamptz not null default now()
);

create index occasions_child_idx on public.occasions (child_id);

alter table public.occasions enable row level security;

-- Owners reach occasions only through their own children.
create policy "occasions: all own via child"
  on public.occasions for all
  using (exists (
    select 1 from public.children c
    where c.id = occasions.child_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.children c
    where c.id = occasions.child_id and c.owner_id = auth.uid()
  ));

-- ------------------------------------------------------------ claim expiry
alter table public.items
  add column claim_expires_at timestamptz;

-- The next date (today or later) with the given month/day. Feb 29
-- clamps to Feb 28 in years without one.
create or replace function public.next_occasion_date(
  p_month int,
  p_day int,
  p_from date default current_date
)
returns date
language plpgsql
immutable
as $$
declare
  y int := extract(year from p_from)::int;
  candidate date;
begin
  candidate := make_date(y, p_month, 1)
    + (least(p_day, extract(day from (make_date(y, p_month, 1) + interval '1 month - 1 day'))::int) - 1);
  if candidate < p_from then
    y := y + 1;
    candidate := make_date(y, p_month, 1)
      + (least(p_day, extract(day from (make_date(y, p_month, 1) + interval '1 month - 1 day'))::int) - 1);
  end if;
  return candidate;
end;
$$;

-- The canonical claim-expiry rule: for a child with occasions, the
-- nearest one's date + 1 day when it's within 90 days; 60 days from
-- today otherwise (and always for family items, p_child_id null).
-- The result is date-granular: start of the expiry day, so a claim
-- holds through the day before it.
create or replace function public.claim_expiry_for(p_child_id uuid)
returns timestamptz
language plpgsql
stable
as $$
declare
  nearest date;
begin
  if p_child_id is not null then
    select min(public.next_occasion_date(o.month, o.day))
    into nearest
    from public.occasions o
    where o.child_id = p_child_id;
  end if;

  if nearest is not null and nearest - current_date <= 90 then
    return (nearest + 1)::timestamptz;
  end if;
  return (current_date + 60)::timestamptz;
end;
$$;

-- A claim is ACTIVE only while claimed and unexpired. Expired claims
-- are filtered lazily everywhere below, so correctness never depends
-- on the sweeper (expire_stale_claims) having run.
--   active := claimed_at is not null
--             and (claim_expires_at is null or claim_expires_at > now())

-- ------------------------------------------------------------------ claim
-- Same contract as 0002, plus: sets claim_expires_at per the rule,
-- returns it, and treats an expired existing claim as no claim at all
-- (the new claim simply overwrites it).
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

-- ---------------------------------------------------------------- unclaim
-- Same as 0002, and also clears the expiry.
create or replace function public.unclaim_wishlist_item(
  p_slug text,
  p_item_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.items i
  set claimed_at = null, claimed_by_name = '', claim_token_hash = null,
      claim_expires_at = null
  from public.profiles p
  where p.id = i.owner_id
    and p.share_slug = p_slug
    and p.share_enabled
    and i.id = p_item_id
    and i.claim_token_hash = encode(digest(p_token, 'sha256'), 'hex');

  get diagnostics updated = row_count;

  if updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'token_mismatch');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------------------- sweeper
-- Housekeeping only: physically clears expired claims so the items
-- table doesn't accumulate stale claim state. The lazy filtering above
-- already treats them as unclaimed, so this never affects behaviour —
-- run it from pg_cron if you like, or by hand after a big holiday.
create or replace function public.expire_stale_claims()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cleared int;
begin
  update public.items
  set claimed_at = null, claimed_by_name = '', claim_token_hash = null,
      claim_expires_at = null
  where claim_expires_at is not null
    and claim_expires_at <= now();

  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

-- The sweeper is owner/cron tooling, not part of the public surface.
revoke execute on function public.expire_stale_claims() from public;

grant execute on function public.claim_wishlist_item(text, uuid, text)   to anon, authenticated;
grant execute on function public.unclaim_wishlist_item(text, uuid, text) to anon, authenticated;

-- ------------------------------------------- share page RPC (occasions)
-- Same shape as 0005, plus:
--   * wishlist 'claimed' uses the active-claim rule — an expired claim
--     reads as unclaimed and its claimed_by is omitted;
--   * top-level 'occasions': one entry per child that has occasions —
--     that child's NEAREST upcoming one {child_id, child_name, label,
--     date (ISO), days_until}, nearest child first;
--   * top-level 'next_occasion': the single nearest entry across all
--     children (same shape), or null.
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
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url,
               'child_id', i.child_id, 'child_name', ch.name)
             order by i.platform, i.title)
      from public.items i
      left join public.children ch on ch.id = i.child_id
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id, 'platform', i.platform, 'title', i.title,
                 'details', i.details, 'notes', i.notes, 'image_url', i.image_url,
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
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;
