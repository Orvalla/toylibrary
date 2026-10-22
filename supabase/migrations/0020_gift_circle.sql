-- 0020 — gift circle: the family members and friends who gift
-- a family's children, and how to reach them before occasions.
--
-- Contact details live ONLY here — owner-scoped RLS, no anon
-- access, never on the public share page. Email is the channel
-- Toy Library can send on a schedule (the send-occasion-
-- reminders function mails relatives directly, each with an
-- unsubscribe token link). Instagram/Facebook handles can't be
-- messaged by an app cold — Meta only lets accounts reply to
-- people who messaged them first — so the handles feed one-tap
-- chat links in Settings instead (see src/lib/giftCircle.js).
--
-- A relative with no relative_children rows is linked to ALL
-- the owner's children; rows narrow them to specific kids
-- (e.g. a godparent who only gifts one child).

create table public.relatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  email text,
  instagram text,
  facebook text,
  notify_email boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index relatives_owner_idx on public.relatives (owner_id);

create table public.relative_children (
  relative_id uuid not null references public.relatives (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  primary key (relative_id, child_id)
);

alter table public.relatives enable row level security;
alter table public.relative_children enable row level security;

create policy "relatives: all own"
  on public.relatives for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "relative_children: all own"
  on public.relative_children for all
  using (exists (
    select 1 from public.relatives r
    where r.id = relative_id and r.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.relatives r
    where r.id = relative_id and r.owner_id = auth.uid()
  ));

-- Least-privilege grants, mirroring 0019's end state: no anon
-- access at all; authenticated gets exactly the DML its
-- policies exercise.
revoke all on public.relatives, public.relative_children from anon;
revoke truncate, references, trigger
  on public.relatives, public.relative_children from authenticated;
grant select, insert, update, delete
  on public.relatives, public.relative_children to authenticated;

-- Reminder dedupe becomes per-recipient: the owner digest and
-- each relative's email log separately, so one being sent never
-- suppresses the other.
alter table public.occasion_reminder_log
  add column if not exists relative_id uuid
    references public.relatives (id) on delete cascade;

alter table public.occasion_reminder_log
  drop constraint if exists occasion_reminder_log_occasion_id_occurrence_date_key;

create unique index if not exists occasion_reminder_log_owner_key
  on public.occasion_reminder_log (occasion_id, occurrence_date)
  where relative_id is null;

create unique index if not exists occasion_reminder_log_relative_key
  on public.occasion_reminder_log (occasion_id, occurrence_date, relative_id)
  where relative_id is not null;

-- Public unsubscribe: a relative has no account; the token from
-- their email is the credential. Returns true when it stopped
-- emails for someone.
create or replace function public.unsubscribe_relative(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.relatives
  set notify_email = false
  where unsubscribe_token = p_token and notify_email;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.unsubscribe_relative(uuid) from public;
grant execute on function public.unsubscribe_relative(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
