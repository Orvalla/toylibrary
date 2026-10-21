-- Toy Library — LOCAL DEV SEED ONLY. Never run against a hosted project.
--
-- Creates a demo account so `supabase start && supabase db reset` gives
-- you something to click through immediately:
--
--   Login:    demo@example.com / demo-password
--   Share:    /s/fam-demo
--
-- The auth.users insert fires the handle_new_user trigger, which creates
-- the profile; we then pin its slug to a known value, add two children
-- (Emma and Noah), and add sample items split between them and Family.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'demo@example.com',
  crypt('demo-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Demo Parent","child_name":"Emma"}',
  now(), now()
) on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"demo@example.com"}',
  'email',
  '11111111-1111-1111-1111-111111111111',
  now(), now(), now()
) on conflict do nothing;

update public.profiles
set share_slug = 'fam-demo', display_name = 'Demo Parent', child_name = 'Emma'
where id = '11111111-1111-1111-1111-111111111111';

-- Fixed UUIDs so re-running the seed doesn't create duplicate children.
insert into public.children (id, owner_id, name, sort_order) values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'Emma', 0),
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'Noah', 1)
on conflict (id) do nothing;

-- Emma's birthday (recurs every Nov 3): the share page highlights it,
-- and claims on her wishlist items expire the day after it.
insert into public.occasions (id, child_id, label, month, day) values
  ('44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', 'Birthday', 11, 3)
on conflict (id) do nothing;

-- child_id NULL = Family: shared by everyone, not one kid's shelf.
insert into public.items (owner_id, child_id, list_type, platform, title, details) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'have', 'tonies', 'The Very Hungry Caterpillar', 'Story Tonie'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'have', 'tonies', 'Paw Patrol — Chase', 'Character Tonie'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'have', 'leapfrog', 'LeapPad: Letter Factory Adventures', 'Game cartridge'),
  ('11111111-1111-1111-1111-111111111111', null, 'have', 'projector', 'Goodnight Moon', 'Story cartridge'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'wishlist', 'tonies', 'Bluey', 'Character Tonie'),
  ('11111111-1111-1111-1111-111111111111', null, 'wishlist', 'projector', 'The Gruffalo', 'Story cartridge'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'wishlist', 'books', 'Dragons Love Tacos', 'Picture book')
on conflict do nothing;

-- One wishlist item pre-claimed, so the claimed state is visible on the
-- share page. Undo token is the literal string 'demo-token' (only its
-- SHA-256 hash is stored, exactly like a real claim). The claim expires
-- the day after Emma's birthday, matching the claim-expiry rule.
update public.items
set claimed_at = now(),
    claimed_by_name = 'Aunt Sarah',
    claim_token_hash = encode(digest('demo-token', 'sha256'), 'hex'),
    claim_expires_at = '2026-11-04T00:00:00Z'::timestamptz
where owner_id = '11111111-1111-1111-1111-111111111111'
  and list_type = 'wishlist'
  and title = 'Bluey';
