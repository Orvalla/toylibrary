-- Share links become subdomains only (owner decision
-- 2026-10-23): <slug>.toylibrary.store replaces both
-- toylibrary.store/<slug> and /s/<slug>, so a family name can
-- never collide with a future site page. Page names therefore
-- leave the reserved list; only infrastructure-flavoured
-- names stay fenced, so a family subdomain never impersonates
-- a service address. The client mirror lives in
-- src/lib/slug.js (RESERVED_SLUGS).

create or replace function public.set_share_slug(p_slug text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  slug text := lower(trim(coalesce(p_slug, '')));
  updated_slug text;
  reserved text[] := array[
    'admin', 'api', 'app', 'assets', 'auth', 'billing', 'blog',
    'cdn', 'help', 'login', 'mail', 'media', 'pay', 'secure',
    'shop', 'signup', 'static', 'store', 'support', 'toy-library',
    'toylibrary', 'unsubscribe', 'www'
  ];
begin
  if slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or slug like '%--%' then
    raise exception 'invalid_slug';
  end if;
  if slug = any (reserved) then
    raise exception 'reserved_slug';
  end if;

  begin
    update public.profiles
    set share_slug = slug
    where id = auth.uid()
    returning share_slug into updated_slug;
  exception when unique_violation then
    raise exception 'slug_taken';
  end;

  if updated_slug is null then
    raise exception 'no profile for current user';
  end if;

  return updated_slug;
end;
$$;
