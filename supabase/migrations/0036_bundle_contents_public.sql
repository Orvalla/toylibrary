-- Anonymous shopping (owner request 2026-10-23): guests can
-- browse the catalog without an account. catalog_items already
-- has a public-read policy that respects the hidden flag; the
-- bundle map is the one piece of pure catalog metadata still
-- fenced to signed-in users. It carries no user data — just
-- which catalog rows ship inside which bundle — so open it to
-- anon reads as well. (Table grant + a permissive policy; the
-- signed-in policy stays as-is.)

grant select on public.bundle_contents to anon;

create policy "bundle contents: anon read"
  on public.bundle_contents
  for select
  to anon
  using (true);
