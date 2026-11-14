-- 0067 — Feature flags (owner ruling 2026-11-13).
--
-- A tiny public-read flag table so a feature can ship dark,
-- preview to admins, and open to everyone without a redeploy.
-- First flag: 'advisor_public' — the Toy Librarian (WS7) is
-- live but visible to admin accounts only until this flips.
--
-- Reads are public on purpose: the flag names who may SEE a
-- feature, it carries no data. Writes have no client policies
-- at all; the only door is the admin RPC below, which reuses
-- the migration-0031 guard (profiles.is_admin, checked
-- server-side by caller_is_admin()).

create table if not exists public.feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

grant select on public.feature_flags to anon, authenticated;
-- Belt and braces alongside the missing write policies below:
-- no direct writes for client roles, ever.
revoke insert, update, delete on public.feature_flags from anon, authenticated;

create policy "feature flags: public read"
  on public.feature_flags for select
  using (true);
-- Deliberately NO insert/update/delete policies: with RLS on,
-- client writes are denied by default; only the SECURITY
-- DEFINER RPC below (and the service role) can change a flag.

-- ----------------------------------------------------- writes
create or replace function public.admin_set_feature_flag(
  p_key text, p_enabled boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  insert into public.feature_flags (key, enabled, updated_at)
  values (p_key, p_enabled, now())
  on conflict (key) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at;
end;
$$;

-- ------------------------------------------------------- seed
insert into public.feature_flags (key, enabled)
values ('advisor_public', false)
on conflict do nothing;
