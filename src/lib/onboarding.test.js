import { describe, expect, it } from 'vitest'
import { HOLIDAYS, INTERESTS, ageLabel, ageYears } from './onboarding'

describe('ageYears / ageLabel', () => {
  const today = new Date(2026, 9, 21) // Oct 21, 2026

  it('counts whole years, respecting the birthday boundary', () => {
    expect(ageYears('2022-10-21', today)).toBe(4)
    expect(ageYears('2022-10-22', today)).toBe(3)
    expect(ageYears('2022-01-01', today)).toBe(4)
    expect(ageYears('2026-10-21', today)).toBe(0)
  })

  it('is null without a usable date', () => {
    expect(ageYears('', today)).toBe(null)
    expect(ageYears(null, today)).toBe(null)
    expect(ageYears('garbage', today)).toBe(null)
    expect(ageYears('2030-01-01', today)).toBe(null)
  })

  it('labels ages the way a parent would say them', () => {
    expect(ageLabel('2026-05-01', today)).toBe('under 1 year old')
    expect(ageLabel('2025-05-01', today)).toBe('1 year old')
    expect(ageLabel('2021-05-01', today)).toBe('5 years old')
    expect(ageLabel('', today)).toBe('')
  })
})

describe('questionnaire data', () => {
  it('every holiday has a plausible month/day', () => {
    for (const h of HOLIDAYS) {
      expect(h.month).toBeGreaterThanOrEqual(1)
      expect(h.month).toBeLessThanOrEqual(12)
      expect(h.day).toBeGreaterThanOrEqual(1)
      expect(h.day).toBeLessThanOrEqual(31)
    }
  })

  it('every interest has keywords for the recommender', () => {
    for (const i of INTERESTS) {
      expect(i.keywords.length).toBeGreaterThan(2)
    }
  })
})
