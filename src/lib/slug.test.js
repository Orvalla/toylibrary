import { describe, expect, it } from 'vitest'
import { normalizeShareSlug, validateShareSlug } from './slug'

describe('normalizeShareSlug', () => {
  it('lowercases and hyphenates spaces and underscores', () => {
    expect(normalizeShareSlug('The Millers')).toBe('the-millers')
    expect(normalizeShareSlug('my_family  link')).toBe('my-family-link')
  })

  it('strips punctuation and collapses repeated hyphens', () => {
    expect(normalizeShareSlug("Sam's 5th Birthday!!")).toBe('sams-5th-birthday')
    expect(normalizeShareSlug('fam--ily---fun')).toBe('fam-ily-fun')
    expect(normalizeShareSlug('  --hello--  ')).toBe('hello')
  })

  it('keeps an already-legal slug untouched', () => {
    expect(normalizeShareSlug('fam-015f2077')).toBe('fam-015f2077')
  })

  it('handles empty and nullish input', () => {
    expect(normalizeShareSlug('')).toBe('')
    expect(normalizeShareSlug(null)).toBe('')
    expect(normalizeShareSlug(undefined)).toBe('')
  })
})

describe('validateShareSlug', () => {
  it('accepts ordinary slugs', () => {
    expect(validateShareSlug('the-millers')).toBeNull()
    expect(validateShareSlug('sam-5')).toBeNull()
    expect(validateShareSlug('abc')).toBeNull()
  })

  it('rejects too-short and too-long slugs', () => {
    expect(validateShareSlug('ab')).toMatch(/at least 3/)
    expect(validateShareSlug('a'.repeat(31))).toMatch(/under 30/)
  })

  it('rejects edge hyphens and doubles', () => {
    expect(validateShareSlug('-abc')).toMatch(/hyphen/)
    expect(validateShareSlug('abc-')).toMatch(/hyphen/)
    expect(validateShareSlug('a--b')).toMatch(/single hyphens/)
  })

  it('rejects reserved words', () => {
    expect(validateShareSlug('admin')).toMatch(/reserved/)
    expect(validateShareSlug('www')).toMatch(/reserved/)
    expect(validateShareSlug('toy-library')).toMatch(/reserved/)
  })

  it('allows page names now that slugs are subdomains', () => {
    // books.toylibrary.store can't collide with the /books page.
    expect(validateShareSlug('books')).toBeNull()
    expect(validateShareSlug('settings')).toBeNull()
  })

  it('rejects the empty slug with a nudge to type something', () => {
    expect(validateShareSlug('')).toMatch(/Enter a name/)
  })
})
