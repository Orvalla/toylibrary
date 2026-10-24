// Catalog languages (migrations 0039 + 0042). Every catalog
// row carries a language; 'multi' marks bilingual editions,
// which are usable in any of their languages. Parents pick
// a SET of languages in Settings (a bilingual family reads
// in English AND Spanish): the set seeds the catalog's
// language filter — where chips toggle freely — and shapes
// recommendations. Items outside the set are not shown;
// bilingual editions fit every set (owner's rule, 2026-10-23).

export const CATALOG_LANGUAGES = [
  { key: 'en', label: 'English', flag: '🇬🇧' },
  { key: 'es', label: 'Spanish', flag: '🇪🇸' },
  { key: 'fr', label: 'French', flag: '🇫🇷' },
  { key: 'de', label: 'German', flag: '🇩🇪' },
  { key: 'it', label: 'Italian', flag: '🇮🇹' },
  { key: 'multi', label: 'Bilingual', flag: '🌐' },
]

// What a parent can pick as a preference — every real
// language, not 'multi' (bilingual items ride along free).
export const PREF_LANGUAGES = CATALOG_LANGUAGES.filter((l) => l.key !== 'multi')

export function languageLabel(key) {
  return CATALOG_LANGUAGES.find((l) => l.key === key)?.label ?? 'English'
}

const PREF_KEYS = new Set(PREF_LANGUAGES.map((l) => l.key))

// A stored or passed preference may be an array of keys
// (current), a single key or 'all' (legacy), or nothing.
// Normalize to a clean array; empty means "no preference".
export function normalizePrefs(pref) {
  if (!pref) return []
  const list = Array.isArray(pref) ? pref : [pref]
  return list.filter((k) => PREF_KEYS.has(k))
}

// Does an item in `itemLang` show when `selected` languages
// are chosen? An empty selection shows everything; a
// bilingual item shows under any non-empty selection (it
// genuinely works in each of its languages). Untagged rows
// count as English (the column default). The selection is a
// filter value, so it may itself contain 'multi' (show me
// bilingual editions); stored preferences never do.
export function languagesVisible(itemLang, selected) {
  const sel = Array.isArray(selected) ? selected : normalizePrefs(selected)
  if (!sel || sel.length === 0) return true
  const lang = itemLang || 'en'
  if (lang === 'multi') return true
  return sel.includes(lang)
}

// Recommendations rule, same shape as the filter: a stated
// preference set admits those languages plus bilingual.
export function languageFitsPref(itemLang, pref) {
  return languagesVisible(itemLang, pref)
}
