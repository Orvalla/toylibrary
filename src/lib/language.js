// Catalog languages (migration 0039). Every catalog row
// carries a language; 'multi' marks bilingual editions, which
// are usable in any of their languages. Parents set a
// language preference on their profile: it seeds the
// catalog's language filter and shapes recommendations —
// a parent who picks English stops being shown Spanish or
// German books they can't read aloud (owner's rule,
// 2026-10-23).

export const CATALOG_LANGUAGES = [
  { key: 'en', label: 'English', flag: '🇬🇧' },
  { key: 'es', label: 'Spanish', flag: '🇪🇸' },
  { key: 'fr', label: 'French', flag: '🇫🇷' },
  { key: 'de', label: 'German', flag: '🇩🇪' },
  { key: 'it', label: 'Italian', flag: '🇮🇹' },
  { key: 'multi', label: 'Bilingual', flag: '🌐' },
]

// What a parent can pick in Settings. 'all' = no preference.
export const LANGUAGE_PREFS = [
  { key: 'en', label: 'English' },
  { key: 'es', label: 'Spanish' },
  { key: 'fr', label: 'French' },
  { key: 'de', label: 'German' },
  { key: 'all', label: 'No preference — show everything' },
]

export function languageLabel(key) {
  return CATALOG_LANGUAGES.find((l) => l.key === key)?.label ?? 'English'
}

// Does an item in `itemLang` show under the language filter
// `selected`? 'all' shows everything; bilingual editions
// show under every specific language (they genuinely work
// in each). Rows with no tag yet count as English (the
// column default).
export function languageVisible(itemLang, selected) {
  if (!selected || selected === 'all') return true
  const lang = itemLang || 'en'
  if (lang === 'multi') return true
  return lang === selected
}

// Recommendations rule, same shape as the filter: a stated
// preference admits that language plus bilingual editions.
export function languageFitsPref(itemLang, pref) {
  if (!pref || pref === 'all') return true
  return languageVisible(itemLang, pref)
}
