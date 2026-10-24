-- 0046: self-serve account deletion.
--
-- delete_my_account() removes the CALLER's account completely:
-- the auth user, their profile (which cascades children, items,
-- occasions, relatives, gift subscribers on their lists, gift
-- proposals, reminder logs, catalog-addition logs and
-- moderation flags), their photo-scan history, their support
-- reports and screenshots, their analytics sessions, and any
-- gift-list subscriptions held under their email on OTHER
-- families' lists.
--
-- Deliberately kept: catalog items they added stay in the
-- shared catalog with added_by set NULL (the FK does that) —
-- removing them would break other families' lists, and a
-- catalog row carries no personal data beyond its title.
--
-- Screenshot files: Supabase forbids deleting storage.objects
-- rows from SQL (storage.protect_delete), so the report rows —
-- the only records that name the files — are deleted and the
-- image bytes are left unreferenced in the private, admin-only
-- bucket, mapped to nobody.
--
-- auth.uid() scopes everything — there is no parameter, so the
-- function can only ever delete the signed-in caller.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- Support reports (their screenshot_path values die with the
  -- rows; see the note at the top about the image bytes).
  delete from public.support_reports where user_id = v_uid;

  -- Photo-scan history.
  delete from public.photo_scans where user_id = v_uid;

  -- Analytics: the user's sessions and the pageviews in them.
  delete from public.analytics_pageviews pv
   using public.analytics_sessions s
   where s.user_id = v_uid
     and pv.session_id = s.session_id;
  delete from public.analytics_sessions where user_id = v_uid;

  -- Reminder subscriptions this person holds on other
  -- families' lists are keyed by email, not by account.
  if v_email is not null then
    delete from public.gift_subscribers
     where lower(email) = lower(v_email);
  end if;

  -- The profile delete cascades the family's own data.
  delete from public.profiles where id = v_uid;

  -- Finally the sign-in itself.
  delete from auth.users where id = v_uid;
end;
$$;

notify pgrst, 'reload schema';
