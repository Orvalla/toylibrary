-- Toy Library — anonymous wishlist claiming
-- Run after 0001_init.sql (SQL editor or `supabase db push`).
--
-- The mirror-image duplicate problem: the have-list stops people buying
-- what's already owned, but two relatives can still both buy the SAME
-- wishlist item. Claiming fixes that without accounts for gift-givers:
--
-- * A claim is just claimed_at + an optional display name on the item.
-- * The claimer receives a one-time random token; only its SHA-256 hash
--   is stored. The token lives in the claimer's browser (localStorage)
--   and is required to undo the claim — nobody else can release it.
-- * All anonymous access goes through SECURITY DEFINER functions, same
--   as the share page: anon still has no direct table access.
-- * Surprise preservation: get_shared_list() exposes only a boolean
--   `claimed` (and the name the claimer chose to show). The parent's
--   dashboard does not render claim state.

alter table public.items
  add column claimed_at       timestamptz,
  add column claimed_by_name  text not null default '',
  add column claim_token_hash text;

-- ---------------------------------------------------- share page (updated)
-- Same as 0001 except wishlist entries now carry `claimed` / `claimed_by`.
create or replace function public.get_shared_list(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles%rowtype;
begin
  select * into prof
  from public.profiles
  where share_slug = p_slug and share_enabled;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'child_name',   prof.child_name,
    'display_name', prof.display_name,
    'have', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform,
               'title', i.title, 'details', i.details, 'notes', i.notes)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'have'
    ), '[]'::jsonb),
    'wishlist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'platform', i.platform,
               'title', i.title, 'details', i.details, 'notes', i.notes,
               'claimed', i.claimed_at is not null,
               'claimed_by', i.claimed_by_name)
             order by i.platform, i.title)
      from public.items i
      where i.owner_id = prof.id and i.list_type = 'wishlist'
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------ claim
-- Claims one wishlist item for an anonymous gift-giver.
-- Returns:
--   { ok: true,  token: '<keep this to undo>' }
--   { ok: false, reason: 'already_claimed' | 'not_available' }
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
  target public.items%rowtype;
  token  text;
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

  if target.claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  token := gen_random_uuid()::text;

  update public.items
  set claimed_at       = now(),
      claimed_by_name  = left(coalesce(nullif(btrim(p_claimer_name), ''), ''), 60),
      claim_token_hash = encode(digest(token, 'sha256'), 'hex')
  where id = p_item_id;

  return jsonb_build_object('ok', true, 'token', token);
end;
$$;

-- ---------------------------------------------------------------- unclaim
-- Releases a claim. Only the browser holding the original token can do
-- this, which is what stops one relative un-claiming another's gift.
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
  set claimed_at = null, claimed_by_name = '', claim_token_hash = null
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

grant execute on function public.claim_wishlist_item(text, uuid, text)   to anon, authenticated;
grant execute on function public.unclaim_wishlist_item(text, uuid, text) to anon, authenticated;
