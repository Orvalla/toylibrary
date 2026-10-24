-- Multiple language selections (owner request 2026-10-23,
-- hours after 0039 shipped single-select): a bilingual
-- family reads in English AND Spanish, so the preference
-- becomes a SET. profiles.language_pref turns into a text
-- array of language keys; an empty set means "no preference
-- — show everything" (the old 'all'). New profiles still
-- start with English, as in 0039. Bilingual ('multi') items
-- are not a preference value: they fit every set, by the
-- rule in lib/language.js.

alter table public.profiles
  drop constraint if exists profiles_language_pref_check;

alter table public.profiles
  alter column language_pref drop default;

alter table public.profiles
  alter column language_pref type text[]
  using (
    case
      when language_pref = 'all' then '{}'::text[]
      else array[language_pref]
    end
  );

alter table public.profiles
  alter column language_pref set default '{en}'::text[];

alter table public.profiles
  alter column language_pref set not null;

alter table public.profiles
  add constraint profiles_language_pref_check
  check (language_pref <@ array['en', 'es', 'fr', 'de', 'it']::text[]);
