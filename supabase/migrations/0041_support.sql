-- Support inbox (owner request 2026-10-23): a footer link
-- lets anyone file a bug report or a feature suggestion.
-- Bug reports carry a screenshot of the page as it looked
-- when they clicked (captured client-side before the form
-- opens). Everything lands in a private inbox only the
-- admin can read, through caller_is_admin-gated RPCs.

create table public.support_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  email text,
  kind text not null check (kind in ('bug', 'feature')),
  message text not null check (char_length(message) between 1 and 4000),
  page_url text,
  screenshot_path text,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'done'))
);

create index support_reports_created_idx
  on public.support_reports (created_at desc);

alter table public.support_reports enable row level security;

-- Anyone may file a report (signed in or not); nobody reads
-- the table directly — the admin RPCs below are the only
-- read path.
create policy support_reports_insert on public.support_reports
  for insert to anon, authenticated
  with check (
    char_length(message) between 1 and 4000
    and kind in ('bug', 'feature')
    and (email is null or char_length(email) <= 200)
    and (page_url is null or char_length(page_url) <= 600)
  );

-- Private bucket for the screenshots.
insert into storage.buckets (id, name, public)
values ('support-shots', 'support-shots', false)
on conflict (id) do nothing;

-- Anyone may upload a screenshot for their report; only the
-- admin may read or delete them (storage policies can use
-- the same SECURITY DEFINER admin helper as table policies).
create policy support_shots_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'support-shots');

create policy support_shots_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'support-shots' and public.caller_is_admin());

create policy support_shots_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'support-shots' and public.caller_is_admin());

create function public.support_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  return (
    select coalesce(jsonb_agg(r order by created_at desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', id,
        'created_at', created_at,
        'kind', kind,
        'message', message,
        'email', email,
        'page_url', page_url,
        'screenshot_path', screenshot_path,
        'user_agent', user_agent,
        'status', status,
        'signed_in', user_id is not null
      ) as r, created_at
      from public.support_reports
      order by created_at desc
      limit 100
    ) latest
  );
end;
$$;

revoke all on function public.support_list() from public;
grant execute on function public.support_list() to authenticated;

create function public.support_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  if p_status not in ('new', 'done') then
    raise exception 'bad status';
  end if;
  update public.support_reports set status = p_status where id = p_id;
end;
$$;

revoke all on function public.support_set_status(uuid, text) from public;
grant execute on function public.support_set_status(uuid, text) to authenticated;

create function public.support_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not an admin';
  end if;
  delete from public.support_reports where id = p_id;
end;
$$;

revoke all on function public.support_delete(uuid) from public;
grant execute on function public.support_delete(uuid) to authenticated;
