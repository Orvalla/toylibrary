-- 0029 — Per-child grow-into window (owner request 2026-10-23):
-- how far above a child's current age gift suggestions may
-- aim. NULL = the default (3 years). 0 = only items for the
-- child's age right now. Parents set it per child in Settings;
-- lib/recommend.js reads it for the dashboard shortlist (hard
-- exclusion beyond the window) and the catalog Suggested sort
-- (beyond-window items sink like aged-out ones).

alter table public.children
  add column if not exists grow_into_years integer;

alter table public.children
  drop constraint if exists children_grow_into_years_range;
alter table public.children
  add constraint children_grow_into_years_range
  check (grow_into_years is null or (grow_into_years >= 0 and grow_into_years <= 10));

notify pgrst, 'reload schema';
