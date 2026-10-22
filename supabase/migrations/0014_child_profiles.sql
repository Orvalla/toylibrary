-- 0014: child profiles + onboarding state.
--
-- The onboarding questionnaire (and Settings) collect, per child:
-- a gender, a birth date (age is derived, never stored, so it
-- can't go stale) and a list of interest tags. Together with the
-- devices on the child's have-list and their occasions, these
-- drive the tailored gift ideas on the dashboard.
--
-- profiles.onboarded_at marks the questionnaire as done; it's
-- stamped for every family that already exists so only new
-- sign-ups are routed through the wizard.

alter table public.children
  add column if not exists gender text not null default '';

alter table public.children
  add column if not exists birth_date date;

alter table public.children
  add column if not exists interests text[] not null default '{}';

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

update public.profiles set onboarded_at = now() where onboarded_at is null;

-- Share page RPC: same as 0013, except the children projection
-- now carries gender, birth_date and interests so the gift page
-- can talk about the child properly.
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
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'gender', c.gender,
                        'birth_date', c.birth_date, 'interests', coalesce(c.interests, '{}'))
             order by c.sort_order, c.name)
      from public.children c
      where c.owner_id = prof.id
    ), '[]'::jsonb),
    'occasions', occ,
    'next_occasion', case when jsonb_array_length(occ) > 0 then occ -> 0 else null end,
    'have', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform, 'title', i.title,
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin,
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
                 'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin,
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
