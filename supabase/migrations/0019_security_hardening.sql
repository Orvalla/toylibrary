-- 0019 — security hardening from the 2026-10-21 overnight audit.
--
-- Until now anon/authenticated carried Supabase's default
-- full-privilege GRANTs on every public table (INSERT/UPDATE/
-- DELETE/TRUNCATE included) and only RLS stood behind them. RLS
-- was verified correct, but least privilege says the grants
-- should match what the policies actually exercise:
--
--   anon          SELECT on catalog_items (the shared product
--                 catalog is public data) + EXECUTE on the
--                 share/claim RPCs. Nothing else.
--   authenticated exactly the DML the "own rows" policies use;
--                 read-only on catalog_items / bundle_contents /
--                 catalog_additions; nothing on photo_scans
--                 (the Edge Function's service role owns it).
--
-- TRUNCATE/REFERENCES/TRIGGER go away for both roles (PostgREST
-- never uses them, and TRUNCATE ignores RLS entirely).

revoke insert, update, delete, truncate, references, trigger
  on public.catalog_items from anon, authenticated;
revoke all on public.items, public.children, public.occasions,
  public.profiles, public.catalog_additions, public.bundle_contents,
  public.photo_scans from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.bundle_contents, public.catalog_additions from authenticated;
revoke insert, delete, truncate, references, trigger
  on public.profiles from authenticated;
revoke all on public.photo_scans from authenticated;
revoke truncate, references, trigger
  on public.items, public.children, public.occasions from authenticated;

-- Trigger/maintenance functions were callable as RPCs by anyone
-- (Postgres grants EXECUTE to PUBLIC by default). A trigger does
-- not need the grant to fire — handle_new_user still runs on
-- signup (verified live after this change) — and
-- expire_stale_claims only ever needs a privileged caller.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.expire_stale_claims() from public, anon, authenticated;

-- The item-images bucket accepts uploads from any signed-in
-- user into their own folder; cap the blast radius: photos
-- only, 10 MB max (was: any type, any size).
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/*']
where id = 'item-images';

notify pgrst, 'reload schema';
