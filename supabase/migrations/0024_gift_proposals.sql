-- 0024 — Gift proposals (owner request 2026-10-22).
--
-- A gift-giver looking at the public share page can propose a
-- gift that ISN'T on the wishlist: they paste a product link,
-- the parents approve or deny it, and an approved proposal
-- shows on the share page ("Grandma is getting the tricycle")
-- so nobody else buys the same off-list gift.
--
-- Trust model mirrors anonymous claiming (0002): the share
-- slug is the capability, the suggester gets a one-time token
-- (only its SHA-256 hash is stored; the token lives in their
-- browser), and anonymous reads/writes happen only through
-- the suggest-gift Edge Function (service role, slug-checked)
-- and the one read RPC below. The parents manage proposals
-- from their dashboard under normal RLS.

create table public.gift_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  child_id uuid references public.children(id) on delete set null,
  title text not null,
  url text not null,
  image_url text not null default '',
  price numeric,
  currency text,
  suggester_name text not null default '',
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  token_hash text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index gift_proposals_owner_status_idx
  on public.gift_proposals (owner_id, status, created_at desc);

alter table public.gift_proposals enable row level security;

-- Parents see and decide their own proposals from the dashboard.
-- (No insert/delete policies: submissions arrive via the
-- suggest-gift function with the service role; rows leave by
-- cascade when a profile or child is removed.)
create policy gift_proposals_owner_select on public.gift_proposals
  for select using (owner_id = auth.uid());
create policy gift_proposals_owner_update on public.gift_proposals
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The public half: APPROVED proposals for a shared list, so
-- other gift-givers can see what's already being bought
-- off-list. SECURITY DEFINER like get_shared_list (0001):
-- the slug + share_enabled gate is the whole check.
create or replace function public.get_shared_proposals(p_slug text)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', gp.id, 'title', gp.title, 'url', gp.url,
             'image_url', gp.image_url, 'price', gp.price,
             'currency', gp.currency,
             'suggester_name', gp.suggester_name,
             'child_id', gp.child_id, 'child_name', ch.name,
             'created_at', gp.created_at)
           order by gp.created_at)
    from public.gift_proposals gp
    left join public.children ch on ch.id = gp.child_id
    where gp.owner_id = prof.id and gp.status = 'approved'
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.get_shared_proposals(text) to anon, authenticated;

notify pgrst, 'reload schema';
