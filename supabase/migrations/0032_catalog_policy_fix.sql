-- 0032 — Fix the 0031 catalog policy: it referenced profiles
-- directly, and the anon/authenticated roles have no table grant
-- on profiles (revoked in 0019), so every catalog read failed
-- with 42501. Route the admin check through the SECURITY
-- DEFINER helper instead — same semantics, no grant needed.

drop policy if exists "catalog: public read" on public.catalog_items;
create policy "catalog: public read"
  on public.catalog_items for select
  using (
    not hidden
    or added_by = auth.uid()
    or public.caller_is_admin()
  );

notify pgrst, 'reload schema';
