-- Toy Library — users grow the catalog themselves
-- Run after 0001–0007.
--
-- Until now catalog_items was stocked only by the offline ingestor
-- (service role). Parents kept hitting titles the ingestor hadn't
-- picked up, so the catalog page now grows itself:
--
-- * catalog_items gains provenance columns: source_url (the store
--   page the row came from) and added_by (the parent who added it).
--   Ingestor rows keep both null.
-- * catalog_additions is an append-only audit log of who added what,
--   written by the ingest-catalog Edge Function.
--
-- All writes still go through the service role: the Edge Function
-- validates the caller's JWT, fetches/validates the product page
-- server-side (with SSRF guards), and only then inserts. RLS here
-- just lets a parent read back their own addition history.

alter table public.catalog_items
  add column if not exists source_url text,
  add column if not exists added_by uuid references public.profiles (id) on delete set null;

-- ------------------------------------------------------- addition log
create table public.catalog_additions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null,
  title      text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create index catalog_additions_user_idx
  on public.catalog_additions (user_id, created_at desc);

alter table public.catalog_additions enable row level security;

create policy "catalog_additions: read own"
  on public.catalog_additions for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose: only the Edge Function
-- (service role, which bypasses RLS) writes rows, after validating
-- the request. Parents can see their own history but never forge it.
