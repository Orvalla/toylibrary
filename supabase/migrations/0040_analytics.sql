-- First-party analytics (owner request 2026-10-23): the admin
-- page shows live viewership and per-visit behavior — pages
-- visited, session duration — without any third-party
-- tracker. Deliberately privacy-light: no IPs, no user
-- agents, no cross-site anything; a random visitor id in the
-- browser's local storage is the only identifier, and rows
-- are reachable ONLY through the two admin-gated read RPCs
-- below (no table grants at all). Writes go through one
-- validating SECURITY DEFINER RPC.

create table public.analytics_sessions (
  session_id uuid primary key,
  visitor_id uuid not null,
  user_id uuid,
  host text not null default '',
  entry_path text not null default '/',
  current_path text not null default '/',
  page_count int not null default 0,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.analytics_pageviews (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  visitor_id uuid not null,
  path text not null,
  created_at timestamptz not null default now()
);

create index analytics_sessions_last_seen_idx
  on public.analytics_sessions (last_seen_at desc);
create index analytics_sessions_started_idx
  on public.analytics_sessions (started_at desc);
create index analytics_pageviews_created_idx
  on public.analytics_pageviews (created_at desc);

alter table public.analytics_sessions enable row level security;
alter table public.analytics_pageviews enable row level security;
-- No policies and no grants: the tables are reachable only
-- via the SECURITY DEFINER functions below.

-- One write path for the client tracker. 'view' records a
-- pageview and upserts the session; 'beat' only refreshes
-- last_seen_at (the ~30s heartbeat that makes durations and
-- live presence work). auth.uid() attributes signed-in
-- visits without the client claiming an identity.
create function public.analytics_touch(
  p_session uuid,
  p_visitor uuid,
  p_host text,
  p_path text,
  p_kind text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session is null or p_visitor is null then
    return;
  end if;
  if p_kind = 'view' then
    insert into public.analytics_sessions (
      session_id, visitor_id, user_id, host,
      entry_path, current_path, page_count, last_seen_at
    ) values (
      p_session, p_visitor, auth.uid(), left(coalesce(p_host, ''), 120),
      left(coalesce(p_path, '/'), 300), left(coalesce(p_path, '/'), 300),
      1, now()
    )
    on conflict (session_id) do update set
      current_path = excluded.current_path,
      page_count = public.analytics_sessions.page_count + 1,
      last_seen_at = now(),
      user_id = coalesce(public.analytics_sessions.user_id, excluded.user_id);
    insert into public.analytics_pageviews (session_id, visitor_id, path)
    values (p_session, p_visitor, left(coalesce(p_path, '/'), 300));
  else
    update public.analytics_sessions
    set last_seen_at = now()
    where session_id = p_session;
  end if;
end;
$$;

revoke all on function public.analytics_touch(uuid, uuid, text, text, text) from public;
grant execute on function public.analytics_touch(uuid, uuid, text, text, text)
  to anon, authenticated;

-- Live presence for the admin page: sessions seen in the
-- last five minutes, most recent first.
create function public.analytics_live()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  return (
    select jsonb_build_object(
      'live_count', count(*),
      'sessions', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'host', host,
            'current_path', current_path,
            'entry_path', entry_path,
            'page_count', page_count,
            'started_at', started_at,
            'last_seen_at', last_seen_at,
            'signed_in', user_id is not null
          )
          order by last_seen_at desc
        ),
        '[]'::jsonb
      )
    )
    from public.analytics_sessions
    where last_seen_at > now() - interval '5 minutes'
  );
end;
$$;

revoke all on function public.analytics_live() from public;
grant execute on function public.analytics_live() to authenticated;

-- Windowed totals + top pages + recent sessions for the
-- admin page, in one round trip.
create function public.analytics_summary(p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 90)));
  result jsonb;
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 90)),
    'visitors', (
      select count(distinct visitor_id) from public.analytics_sessions
      where started_at >= since
    ),
    'sessions', (
      select count(*) from public.analytics_sessions where started_at >= since
    ),
    'pageviews', (
      select count(*) from public.analytics_pageviews where created_at >= since
    ),
    'avg_pages', (
      select coalesce(round(avg(page_count)::numeric, 1), 0)
      from public.analytics_sessions where started_at >= since
    ),
    'avg_minutes', (
      select coalesce(round(avg(extract(epoch from (last_seen_at - started_at)) / 60)::numeric, 1), 0)
      from public.analytics_sessions where started_at >= since
    ),
    'top_pages', (
      select coalesce(jsonb_agg(t), '[]'::jsonb)
      from (
        select path, count(*) as views
        from public.analytics_pageviews
        where created_at >= since
        group by path
        order by views desc
        limit 10
      ) t
    ),
    'recent_sessions', (
      select coalesce(jsonb_agg(s), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'host', host,
          'entry_path', entry_path,
          'current_path', current_path,
          'page_count', page_count,
          'started_at', started_at,
          'last_seen_at', last_seen_at,
          'signed_in', user_id is not null
        ) as s
        from public.analytics_sessions
        order by started_at desc
        limit 20
      ) recent
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.analytics_summary(int) from public;
grant execute on function public.analytics_summary(int) to authenticated;
