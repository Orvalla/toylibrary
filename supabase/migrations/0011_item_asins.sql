-- 0011: per-item Amazon ASINs, so "Buy on Amazon" can deep-link
-- straight to the product page (amazon.com/dp/<asin>) instead of a
-- search. The ASIN is resolved in batches by
-- ingestor/backfill-asins.mjs; rows without one keep the search
-- link. items.asin is copied from the catalog row when a parent
-- adds from the catalog, and backfilled by title match below (and
-- on each resolver run).

alter table public.catalog_items
  add column if not exists asin text;

alter table public.items
  add column if not exists asin text;

-- Any existing list item whose catalog twin already has an ASIN
-- inherits it.
update public.items i
set asin = c.asin
from public.catalog_items c
where i.asin is null
  and c.asin is not null
  and i.platform = c.platform
  and lower(i.title) = lower(c.title);

-- Share page RPC, identical to 0009 except both item projections
-- now carry 'asin' for the gift-giver page's Amazon links.
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
               'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin,
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
                 'details', i.details, 'notes', i.notes, 'image_url', i.image_url, 'asin', i.asin,
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
grant execute on function public.get_shared_list(text) to anon, authenticated;
