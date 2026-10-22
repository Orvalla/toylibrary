-- Occasion reminder emails: before a child's gift occasion,
-- the account owner gets one email per occasion with the
-- child's public wishlist link ready to forward to family.
-- Sending happens in the send-occasion-reminders Edge
-- Function (Resend); this migration is the opt-out flag and
-- the dedupe log that stops an occasion being emailed twice.
alter table public.profiles
  add column if not exists occasion_reminders boolean not null default true;

create table if not exists public.occasion_reminder_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  occasion_id uuid not null references public.occasions (id) on delete cascade,
  occurrence_date date not null,
  sent_at timestamptz not null default now(),
  unique (occasion_id, occurrence_date)
);

-- Service-role only: RLS on, no client policies.
alter table public.occasion_reminder_log enable row level security;
