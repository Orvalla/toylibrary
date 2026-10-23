import { describe, expect, it } from 'vitest'
import { bookInStage, primaryStageOf } from './books'

// Reading stages overlap the way age bands do; a book with no
// age guidance belongs to no stage but still lists everywhere.

describe('book stages', () => {
  it('places a picture book and a YA novel at opposite ends', () => {
    const picture = { age_min_years: 0, age_max_years: 4 }
    expect(bookInStage(picture, 'picture')).toBe(true)
    expect(bookInStage(picture, 'ya')).toBe(false)
    expect(primaryStageOf(picture)?.key).toBe('picture')

    const ya = { age_min_years: 12, age_max_years: 18 }
    expect(bookInStage(ya, 'ya')).toBe(true)
    expect(bookInStage(ya, 'middle')).toBe(true) // 12 overlaps both
    expect(bookInStage(ya, 'picture')).toBe(false)
    expect(primaryStageOf(ya)?.key).toBe('ya')
  })

  it('puts a middle-grade novel in middle and chapter, not YA-only shelves', () => {
    const mg = { age_min_years: 8, age_max_years: 12 }
    expect(bookInStage(mg, 'middle')).toBe(true)
    expect(bookInStage(mg, 'chapter')).toBe(true)
    expect(primaryStageOf(mg)?.key).toBe('middle')
  })

  it('handles missing ages', () => {
    expect(bookInStage({}, 'picture')).toBe(false)
    expect(bookInStage({}, 'nope')).toBe(true) // unknown stage = no filter
    expect(primaryStageOf({})).toBeNull()
  })
})
