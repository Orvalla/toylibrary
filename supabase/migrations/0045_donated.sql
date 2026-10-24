-- 0045: supporter ("donated") flag on families.
--
-- Toy Library is free; the owner is opening a PayPal that
-- families can donate to, and all server charges come out of
-- it. A family that has donated gets profiles.donated = true,
-- set by the site admin from /admin once a donation lands
-- (there is no PayPal webhook — the flag is flipped by hand).
--
-- The flag exists to unlock limits: the first consumer is the
-- photo-scan cap in the identify-items Edge Function (10/day
-- standard, higher for supporters — the constants live there).
-- It rides along on the profile the owner already reads
-- (select *), so Settings can thank supporters with no extra
-- fetch. It is deliberately NOT exposed on the public share
-- page.

alter table public.profiles
  add column donated boolean not null default false;

-- Admin-only: flip a family's supporter flag by account email.
create or replace function public.admin_set_donated(p_email text, p_donated boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_row public.profiles%rowtype;
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  select id into v_user
    from auth.users
   where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no account with that email';
  end if;
  update public.profiles
     set donated = p_donated
   where id = v_user
   returning * into v_row;
  if v_row.id is null then
    raise exception 'that account has no profile';
  end if;
  return jsonb_build_object(
    'display_name', v_row.display_name,
    'slug', v_row.share_slug,
    'donated', v_row.donated
  );
end;
$$;

notify pgrst, 'reload schema';
