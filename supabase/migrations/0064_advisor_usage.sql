-- 0064 — gift advisor (WS7, "the Toy Librarian"): usage log,
-- per-IP turn counters, and the daily cost alert markers.
--
-- Spec §6 (ship-blocking). Everything here is written and read only
-- by the gift-advisor Edge Function with the service role; anon and
-- authenticated get nothing (RLS on, no policies, grants revoked).
--
-- NO transcript storage. advisor_usage keeps token counts, cost,
-- timestamps, mode and the candidate ids served, nothing the shopper
-- typed and nothing about the child. advisor_ip_counters keys on a
-- salted SHA-256 of the client IP, never the IP itself.
--
-- !! DEPLOY: written for WS7, NOT applied anywhere yet. Apply before
-- !! the gift-advisor function is deployed (the function fails closed
-- !! without it: the breaker cannot read spend, so the Librarian
-- !! rests her voice instead of calling the model).

-- ------------------------------------------------------ usage log
create table if not exists public.advisor_usage (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  day           date not null default (now() at time zone 'utc')::date,
  provider      text not null,
  model         text not null,
  mode          text not null check (mode in ('page', 'finder')),
  tokens_in     integer not null default 0 check (tokens_in >= 0),
  tokens_out    integer not null default 0 check (tokens_out >= 0),
  est_cost      numeric(12, 6) not null default 0 check (est_cost >= 0),
  candidate_ids uuid[] not null default '{}'
);
create index if not exists advisor_usage_day_idx on public.advisor_usage (day);
alter table public.advisor_usage enable row level security;
revoke all on public.advisor_usage from public, anon, authenticated;

-- ------------------------------------------------- per-IP counters
-- One row per (ip_hash, window kind, window start). The function
-- checks the hour and day windows in one atomic call.
create table if not exists public.advisor_ip_counters (
  ip_hash      text not null,
  window_kind  text not null check (window_kind in ('hour', 'day')),
  window_start timestamptz not null,
  turns        integer not null default 0,
  primary key (ip_hash, window_kind, window_start)
);
create index if not exists advisor_ip_counters_start_idx
  on public.advisor_ip_counters (window_start);
alter table public.advisor_ip_counters enable row level security;
revoke all on public.advisor_ip_counters from public, anon, authenticated;

-- --------------------------------------------- daily alert markers
-- One row per UTC day and level the first time spend crosses it:
-- 'soft' at $5, 'hard' at $15 (the breaker). Elise polls this for
-- the same-day flag to Morgan.
create table if not exists public.advisor_alerts (
  day        date not null,
  level      text not null check (level in ('soft', 'hard')),
  spend      numeric(12, 6) not null,
  created_at timestamptz not null default now(),
  primary key (day, level)
);
alter table public.advisor_alerts enable row level security;
revoke all on public.advisor_alerts from public, anon, authenticated;

-- ------------------------------------------------------- functions

-- Take one turn for this IP hash if both windows have room. Returns
-- true when allowed (and counted), false when either cap is reached.
-- A refused turn is not counted. Which window refused is not
-- returned: the caller must not be able to tell (A-2 lesson).
create or replace function public.advisor_take_turn(
  p_ip_hash  text,
  p_hour_cap int default 30,
  p_day_cap  int default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hour_start timestamptz := date_trunc('hour', now());
  day_start  timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  hour_used  int;
  day_used   int;
begin
  if p_ip_hash is null or length(p_ip_hash) < 16 then
    return false;
  end if;

  -- Serialize per IP so two concurrent turns cannot both squeeze in.
  perform pg_advisory_xact_lock(hashtext('advisor:' || p_ip_hash));

  select coalesce(turns, 0) into hour_used from public.advisor_ip_counters
   where ip_hash = p_ip_hash and window_kind = 'hour' and window_start = hour_start;
  select coalesce(turns, 0) into day_used from public.advisor_ip_counters
   where ip_hash = p_ip_hash and window_kind = 'day' and window_start = day_start;

  if coalesce(hour_used, 0) >= p_hour_cap or coalesce(day_used, 0) >= p_day_cap then
    return false;
  end if;

  insert into public.advisor_ip_counters (ip_hash, window_kind, window_start, turns)
  values (p_ip_hash, 'hour', hour_start, 1), (p_ip_hash, 'day', day_start, 1)
  on conflict (ip_hash, window_kind, window_start)
  do update set turns = public.advisor_ip_counters.turns + 1;

  -- Housekeeping: counters older than two days are dead weight.
  delete from public.advisor_ip_counters where window_start < now() - interval '2 days';
  return true;
end;
$$;

-- Today's (UTC) estimated spend, for the breaker.
create or replace function public.advisor_spend_today()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(est_cost), 0)
    from public.advisor_usage
   where day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.advisor_take_turn(text, int, int) from public, anon, authenticated;
revoke all on function public.advisor_spend_today() from public, anon, authenticated;
grant execute on function public.advisor_take_turn(text, int, int) to service_role;
grant execute on function public.advisor_spend_today() to service_role;
