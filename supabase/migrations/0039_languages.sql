-- Languages (owner request 2026-10-23): every catalog row
-- carries its language so parents can shop in theirs — and a
-- parent who picks English stops seeing Spanish/German books
-- they can't read to their kids. 'multi' marks bilingual
-- editions (usable in every language). Profiles carry the
-- parent's preference, which seeds the catalog's language
-- filter and shapes recommendations.
--
-- The backfill (applied separately from
-- language-backfill.sql) re-tags the ~620 rows with clear
-- Spanish/French/German/Italian evidence (publisher markers
-- + title stopwords); everything else stays 'en'.

alter table public.catalog_items
  add column language text not null default 'en';

alter table public.catalog_items
  add constraint catalog_items_language_check
  check (language in ('en', 'es', 'fr', 'de', 'it', 'multi'));

alter table public.profiles
  add column language_pref text not null default 'en';

alter table public.profiles
  add constraint profiles_language_pref_check
  check (language_pref in ('en', 'es', 'fr', 'de', 'all'));
