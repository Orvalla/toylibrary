-- 0048: tell visitors apart in the admin analytics — without
-- IPs or fingerprints.
--
-- Sessions already carry two identifiers: user_id (set by
-- analytics_touch from auth.uid(), never claimed by the
-- client) and the random visitor_id the browser keeps in
-- local storage. Until now the read RPCs flattened both into
-- a bare "signed_in" boolean, so the admin panel couldn't
-- say WHO a session belonged to.
--
-- Both read RPCs now also return, per session:
--   display_name / share_slug — joined from profiles when
--     the visit was signed in, so the panel shows the
--     account name;
--   visitor_id — so the panel can derive a stable friendly
--     nickname for guests (same browser, same nickname);
--   visitor_visits — how many sessions that visitor_id has
--     ever had, so a repeat guest reads as "visit 4", not a
--     stranger.
-- Nothing new is collected and the tables still have no
-- grants; the join happens inside the admin-gated SECURITY
-- DEFINER functions, so identities are visible only to
-- admins.

create or replace function public.analytics_live()
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
    with live as (
      select s.*, p.display_name, p.share_slug,
             (select count(*) from public.analytics_sessions v
               where v.visitor_id = s.visitor_id) as visitor_visits
        from public.analytics_sessions s
        left join public.profiles p on p.id = s.user_id
       where s.last_seen_at > now() - interval '5 minutes'
    )
    select jsonb_build_object(
      'live_count', (select count(*) from live),
      'sessions', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'host', host,
            'current_path', current_path,
            'entry_path', entry_path,
            'page_count', page_count,
            'started_at', started_at,
            'last_seen_at', last_seen_at,
            'signed_in', user_id is not null,
            'visitor_id', visitor_id,
            'display_name', display_name,
            'share_slug', share_slug,
            'visitor_visits', visitor_visits
          )
          order by last_seen_at desc
        ) from live),
        '[]'::jsonb
      )
    )
  );
end;
$$;

create or replace function public.analytics_summary(p_days int default 7)
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
          'host', sess.host,
          'entry_path', sess.entry_path,
          'current_path', sess.current_path,
          'page_count', sess.page_count,
          'started_at', sess.started_at,
          'last_seen_at', sess.last_seen_at,
          'signed_in', sess.user_id is not null,
          'visitor_id', sess.visitor_id,
          'display_name', p.display_name,
          'share_slug', p.share_slug,
          'visitor_visits', (
            select count(*) from public.analytics_sessions v
             where v.visitor_id = sess.visitor_id
          )
        ) as s
        from public.analytics_sessions sess
        left join public.profiles p on p.id = sess.user_id
        order by sess.started_at desc
        limit 20
      ) recent
    )
  ) into result;
  return result;
end;
$$;

notify pgrst, 'reload schema';
