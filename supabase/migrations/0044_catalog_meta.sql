-- 0044: catalog version stamp for the browser cache.
--
-- Every catalog load used to download all ~18k rows (~1.5 MB
-- gzipped) because the client had no way to know whether its
-- copy was still good. catalog_meta is a one-row table holding
-- a version counter; a statement-level trigger bumps it on ANY
-- catalog_items insert/update/delete (bulk ingests bump once
-- per statement, not per row), so every writer — the weekly
-- ingest, the ingest-catalog function, admin actions, a
-- parent adding a product — invalidates browser caches with
-- no client or server code having to remember.
--
-- The browser reads the version (one tiny request), compares
-- it with the version stamped on its IndexedDB copy, and only
-- re-downloads the catalog when they differ. See
-- src/lib/catalogCache.js.

create table public.catalog_meta (
  id int primary key check (id = 1),
  version bigint not null,
  updated_at timestamptz not null default now()
);

insert into public.catalog_meta (id, version) values (1, 1);

create or replace function public.bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.catalog_meta
     set version = version + 1, updated_at = now()
   where id = 1;
  return null;
end;
$$;

create trigger catalog_items_bump_version
  after insert or update or delete on public.catalog_items
  for each statement execute function public.bump_catalog_version();

alter table public.catalog_meta enable row level security;

-- World-readable (the version is not a secret — the catalog
-- itself is public); writes happen only through the trigger.
create policy "catalog_meta public read"
  on public.catalog_meta for select
  to anon, authenticated
  using (true);
