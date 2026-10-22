-- Photo scan accounting for the identify-items Edge Function:
-- one row per completed scan, so the function can hold each
-- user to 10 scans per rolling 24 hours. Service-role only —
-- RLS is on with no policies, so clients can neither read nor
-- forge scan history; the Edge Function (which validates the
-- caller's JWT first) does all reads and writes.
create table if not exists public.photo_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists photo_scans_user_recent_idx
  on public.photo_scans (user_id, created_at desc);

alter table public.photo_scans enable row level security;
