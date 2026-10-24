import { describe, expect, it } from 'vitest'
import { visitorLabel } from './visitorLabel'

describe('visitorLabel', () => {
  it('is stable: the same visitor id always gets the same nickname', () => {
    const id = 'a9b89fed-6c8c-4d3a-88d3-1e4890ef62a9'
    expect(visitorLabel(id)).toBe(visitorLabel(id))
    expect(visitorLabel(id)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ · [0-9A-F]{4}$/)
  })

  it('differentiates different visitors', () => {
    const labels = new Set(
      [
        '11111111-2222-3333-4444-555555555555',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '123e4567-e89b-12d3-a456-426614174000',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      ].map(visitorLabel),
    )
    expect(labels.size).toBeGreaterThan(1)
  })

  it('falls back gracefully without an id', () => {
    expect(visitorLabel(null)).toBe('Unknown guest')
    expect(visitorLabel('')).toBe('Unknown guest')
    expect(visitorLabel(undefined)).toBe('Unknown guest')
  })
})
