import { describe, expect, it } from 'vitest'
import { PLATFORMS, platformEmoji, platformLabel } from './platforms'

describe('platforms', () => {
  it('has a label and emoji for every platform key the database allows', () => {
    // Must stay in sync with the CHECK constraints in the migrations
    // (0001_init.sql as widened by 0006_yoto_platform.sql,
    // 0007_new_platforms.sql, 0021_new_toy_platforms.sql and
    // 0022_more_toy_brands.sql, 0023_littletikes_platform.sql,
    // 0027_older_kids_platforms.sql,
    // 0028_round3_platforms.sql,
    // 0030_board_game_platforms.sql).
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
      'melissaanddoug',
      'littlepeople',
      'brio',
      'fatbrain',
      'lakeshore',
      'learningresources',
      'littletikes',
      'thamesandkosmos',
      'thinkfun',
      'ravensburger',
      'kiwico',
      'eeboo',
      'mudpuppy',
      'sphero',
      'asmodee',
      'pandasaurus',
      'renegade',
      'floodgate',
      'catan',
      'blueorange',
      'iello',
      'capstone',
      'explodingkittens',
      'hachette',
      'goliath',
      'relatable',
      'buffalogames',
      'spinmaster',
      'devir',
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
