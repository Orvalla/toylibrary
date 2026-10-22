import { describe, expect, it } from 'vitest'
import { ageFits, ageLabelFor, inAgeBand } from './ages'

describe('ageLabelFor', () => {
  it('formats ranges, halves, and open ends', () => {
    expect(ageLabelFor({ age_min_years: 3, age_max_years: 6 })).toBe('Ages 3–6')
    expect(ageLabelFor({ age_min_years: 0.5, age_max_years: 3 })).toBe('Ages 6 mo–3')
    expect(ageLabelFor({ age_min_years: 4, age_max_years: null })).toBe('Ages 4+')
    expect(ageLabelFor({ age_min_years: null, age_max_years: null })).toBe('')
    expect(ageLabelFor({})).toBe('')
  })
})

describe('ageFits', () => {
  const entry = { age_min_years: 3, age_max_years: 6 }
  it('checks the range inclusively', () => {
    expect(ageFits(entry, 3)).toBe(true)
    expect(ageFits(entry, 6)).toBe(true)
    expect(ageFits(entry, 2)).toBe(false)
    expect(ageFits(entry, 7)).toBe(false)
  })
  it('no guidance or no age is not a fit', () => {
    expect(ageFits({}, 4)).toBe(false)
    expect(ageFits(entry, null)).toBe(false)
  })
})

describe('inAgeBand', () => {
  it('uses overlap, so a wide range appears in several bands', () => {
    const wide = { age_min_years: 3, age_max_years: 9 }
    expect(inAgeBand(wide, '3-4')).toBe(true)
    expect(inAgeBand(wide, '7-9')).toBe(true)
    expect(inAgeBand(wide, '0-2')).toBe(false)
    expect(inAgeBand(wide, '10+')).toBe(false)
  })
  it('unknown band matches everything; no age data matches no band', () => {
    expect(inAgeBand({ age_min_years: 3, age_max_years: 6 }, 'nope')).toBe(true)
    expect(inAgeBand({}, '3-4')).toBe(false)
  })
})
