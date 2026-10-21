-- 0012: memorable share links.
--
-- Parents can replace the auto-generated share slug (fam-015f2077)
-- with their own — e.g. /s/the-millers — so the gift-giver link is
-- easy to say out loud and to retype from a paper invitation.
--
-- Two layers:
--   * a CHECK constraint keeps every slug well-formed no matter
--     which client writes it (the signup generator's fam-<hex>
--     output already complies);
--   * set_share_slug() is the friendly path the Settings page
--     calls: it validates, rejects reserved words, and translates
--     a uniqueness clash into a 'slug_taken' error the UI can
--     phrase kindly. SECURITY INVOKER like regenerate_share_slug:
--     the profiles RLS policy scopes the update to the caller.

alter table public.profiles
  add constraint profiles_share_slug_format
  check (
    share_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    and share_slug not like '%--%'
  );

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
    'admin', 'api', 'app', 'about', 'catalog', 'dashboard',
    'devices', 'forgot-password', 'help', 'login', 'privacy',
    'reset-password', 's', 'settings', 'share', 'signup',
    'support', 'terms', 'toy-library', 'toylibrary', 'www'
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

grant execute on function public.set_share_slug(text) to authenticated;
