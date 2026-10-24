import { describe, expect, it } from 'vitest'
import {
  languageFitsPref,
  languageLabel,
  languagesVisible,
  normalizePrefs,
} from './language'

describe('normalizePrefs', () => {
  it('passes arrays through, filtering unknown keys', () => {
    expect(normalizePrefs(['en', 'es'])).toEqual(['en', 'es'])
    expect(normalizePrefs(['en', 'xx'])).toEqual(['en'])
    expect(normalizePrefs(['multi'])).toEqual([])
  })

  it('accepts legacy single values', () => {
    expect(normalizePrefs('es')).toEqual(['es'])
    expect(normalizePrefs('all')).toEqual([])
    expect(normalizePrefs(null)).toEqual([])
    expect(normalizePrefs(undefined)).toEqual([])
  })
})

describe('languagesVisible', () => {
  it('an empty selection shows everything', () => {
    expect(languagesVisible('es', [])).toBe(true)
    expect(languagesVisible('de', [])).toBe(true)
    expect(languagesVisible('en', [])).toBe(true)
  })

  it('a single selection behaves like the old filter', () => {
    expect(languagesVisible('en', ['en'])).toBe(true)
    expect(languagesVisible('es', ['en'])).toBe(false)
    expect(languagesVisible('de', ['en'])).toBe(false)
  })

  it('multiple selections admit each chosen language', () => {
    expect(languagesVisible('en', ['en', 'es'])).toBe(true)
    expect(languagesVisible('es', ['en', 'es'])).toBe(true)
    expect(languagesVisible('fr', ['en', 'es'])).toBe(false)
    expect(languagesVisible('it', ['en', 'it'])).toBe(true)
  })

  it('selecting Bilingual alone shows only bilingual items', () => {
    expect(languagesVisible('multi', ['multi'])).toBe(true)
    expect(languagesVisible('en', ['multi'])).toBe(false)
    expect(languagesVisible('es', ['multi'])).toBe(false)
  })

  it('bilingual editions show under any non-empty selection', () => {
    for (const sel of [['en'], ['es'], ['en', 'fr'], ['de']]) {
      expect(languagesVisible('multi', sel)).toBe(true)
    }
    expect(languagesVisible('multi', [])).toBe(true)
  })

  it('untagged rows count as English', () => {
    expect(languagesVisible(undefined, ['en'])).toBe(true)
    expect(languagesVisible(null, ['es'])).toBe(false)
  })
})

describe('languageFitsPref', () => {
  it('no preference admits everything', () => {
    expect(languageFitsPref('es', null)).toBe(true)
    expect(languageFitsPref('de', [])).toBe(true)
    expect(languageFitsPref('fr', 'all')).toBe(true)
  })

  it('a preference set admits its languages plus bilingual', () => {
    expect(languageFitsPref('es', ['es'])).toBe(true)
    expect(languageFitsPref('multi', ['es'])).toBe(true)
    expect(languageFitsPref('en', ['es'])).toBe(false)
    expect(languageFitsPref('en', ['en', 'es'])).toBe(true)
    expect(languageFitsPref('es', ['en', 'es'])).toBe(true)
    expect(languageFitsPref('fr', ['en', 'es'])).toBe(false)
  })
})

describe('languageLabel', () => {
  it('labels known keys and defaults to English', () => {
    expect(languageLabel('es')).toBe('Spanish')
    expect(languageLabel('multi')).toBe('Bilingual')
    expect(languageLabel('xx')).toBe('English')
  })
})
