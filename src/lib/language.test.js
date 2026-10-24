import { describe, expect, it } from 'vitest'
import { languageFitsPref, languageLabel, languageVisible } from './language'

describe('languageVisible', () => {
  it('shows everything under All', () => {
    expect(languageVisible('es', 'all')).toBe(true)
    expect(languageVisible('de', 'all')).toBe(true)
    expect(languageVisible('en', 'all')).toBe(true)
  })

  it('an English filter hides Spanish and German items', () => {
    expect(languageVisible('en', 'en')).toBe(true)
    expect(languageVisible('es', 'en')).toBe(false)
    expect(languageVisible('de', 'en')).toBe(false)
    expect(languageVisible('fr', 'en')).toBe(false)
  })

  it('bilingual editions show under every specific language', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'it']) {
      expect(languageVisible('multi', lang)).toBe(true)
    }
    expect(languageVisible('multi', 'multi')).toBe(true)
  })

  it('untagged rows count as English', () => {
    expect(languageVisible(undefined, 'en')).toBe(true)
    expect(languageVisible(null, 'es')).toBe(false)
  })
})

describe('languageFitsPref', () => {
  it('no preference admits everything', () => {
    expect(languageFitsPref('es', null)).toBe(true)
    expect(languageFitsPref('de', 'all')).toBe(true)
  })

  it('a preference admits its language plus bilingual', () => {
    expect(languageFitsPref('es', 'es')).toBe(true)
    expect(languageFitsPref('multi', 'es')).toBe(true)
    expect(languageFitsPref('en', 'es')).toBe(false)
    expect(languageFitsPref('en', 'en')).toBe(true)
    expect(languageFitsPref('es', 'en')).toBe(false)
  })
})

describe('languageLabel', () => {
  it('labels known keys and defaults to English', () => {
    expect(languageLabel('es')).toBe('Spanish')
    expect(languageLabel('multi')).toBe('Bilingual')
    expect(languageLabel('xx')).toBe('English')
  })
})
