import { describe, expect, it } from 'vitest'
import { PLATFORMS, platformEmoji, platformLabel } from './platforms'

describe('platforms', () => {
  it('has a label and emoji for every platform key the database allows', () => {
    // Must stay in sync with the CHECK constraints in the migrations
    // (0001_init.sql as widened by 0006_yoto_platform.sql,
    // 0007_new_platforms.sql and 0021_new_toy_platforms.sql).
    const dbKeys = [
      'tonies',
      'leapfrog',
      'projector',
      'vtech',
      'books',
      'other',
      'yoto',
      'storypod',
      'osmo',
      'lunii',
      'haba',
      'magnatiles',
      'smartgames',
      'lovevery',
    ]
    expect(PLATFORMS.map((p) => p.key).sort()).toEqual(dbKeys.sort())
    for (const p of PLATFORMS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.emoji.length).toBeGreaterThan(0)
    }
  })

  it('falls back gracefully for unknown keys', () => {
    expect(platformLabel('nope')).toBe('nope')
    expect(platformEmoji('nope')).toBe('🎁')
  })
})
