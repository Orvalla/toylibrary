-- Dutch + Russian catalog languages (loose-ends round
-- 2026-10-28). The Lunii language re-derivation (maker
-- metafield language_code, harvested per album) found five
-- albums whose real languages the 0039 vocabulary cannot
-- express: four Dutch ('nl') and one Russian ('ru'), all
-- mis-coded 'en'. Admit both codes to the catalog check,
-- and to the profile preference check so a family can
-- actually prefer them (0042's subset rule).

alter table public.catalog_items
  drop constraint if exists catalog_items_language_check;

alter table public.catalog_items
  add constraint catalog_items_language_check
  check (language in ('en', 'es', 'fr', 'de', 'it', 'multi', 'nl', 'ru'));

alter table public.profiles
  drop constraint if exists profiles_language_pref_check;

alter table public.profiles
  add constraint profiles_language_pref_check
  check (language_pref <@ array['en', 'es', 'fr', 'de', 'it', 'nl', 'ru']::text[]);
