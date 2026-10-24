-- 0047: private storage bucket for the weekly database backup.
--
-- The free Supabase plan has no automated backups, and every
-- family's lists exist in exactly one database. The backup job
-- (.github/workflows/backup.yml → ingestor/backup.mjs) exports
-- every public table + the auth user list to one gzipped JSON
-- bundle and stores it here, keeping the newest 8.
--
-- The bucket is private with NO storage policies: only the
-- service role (which bypasses RLS) can read or write it, which
-- in practice means the backup job and the site owner working
-- through the dashboard. A backup holds personal data — treat
-- downloads accordingly.

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
