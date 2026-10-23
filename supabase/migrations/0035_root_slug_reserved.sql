-- Share links go root-level (toylibrary.store/<slug>) as of the
-- short-link change: every app route name becomes a potential
-- slug collision, so set_share_slug's reserved list grows the
-- route names that weren't fenced yet (books, welcome,
-- unsubscribe — plus 'brand' for the static brand page). The
-- client mirror lives in src/lib/slug.js (RESERVED_SLUGS).

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
    'admin', 'api', 'app', 'about', 'books', 'brand', 'catalog',
    'dashboard', 'devices', 'forgot-password', 'help', 'login',
    'privacy', 'reset-password', 's', 'settings', 'share',
    'signup', 'support', 'terms', 'toy-library', 'toylibrary',
    'unsubscribe', 'welcome', 'www'
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
