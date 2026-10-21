-- Toy Library — regenerate share slug
-- Run after 0001_init.sql and 0002_claims.sql.
--
-- Lets a parent retire a share link that has been forwarded too widely
-- and mint a fresh one. Runs as SECURITY INVOKER: the profiles RLS
-- policy ("update own") is what scopes the UPDATE to the caller's row.

create or replace function public.regenerate_share_slug()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_slug text;
begin
  new_slug := public.generate_share_slug();

  update public.profiles
  set share_slug = new_slug
  where id = auth.uid();

  if not found then
    raise exception 'no profile for current user';
  end if;

  return new_slug;
end;
$$;

grant execute on function public.regenerate_share_slug() to authenticated;
