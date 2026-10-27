import { describe, expect, it } from 'vitest'
import { ratingPatch } from './rating-patch.mjs'
import { extractAggregateRating } from '../../supabase/functions/ingest-catalog/extract.js'

describe('ratingPatch', () => {
  it('passes a rating with a positive integer count', () => {
    expect(ratingPatch({ rating: 4.7, rating_count: 2648 })).toEqual({ rating: 4.7, rating_count: 2648 })
  })

  it('refuses a rating without a usable count', () => {
    expect(ratingPatch({ rating: 4.7, rating_count: null })).toBeNull()
    expect(ratingPatch({ rating: 4.7 })).toBeNull()
    expect(ratingPatch({ rating: 4.7, rating_count: 0 })).toBeNull()
    expect(ratingPatch({ rating: 4.7, rating_count: 12.5 })).toBeNull()
  })

  it('refuses nothing-at-all and non-numeric ratings', () => {
    expect(ratingPatch(null)).toBeNull()
    expect(ratingPatch({ rating: Number.NaN, rating_count: 5 })).toBeNull()
  })

  // Regression: weekly.mjs once read `.count` and silently dropped it.
  it('accepts exactly what extractAggregateRating returns', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"X","aggregateRating":{"@type":"AggregateRating","ratingValue":4.6,"reviewCount":40}}
    </script>`
    expect(ratingPatch(extractAggregateRating(html))).toEqual({ rating: 4.6, rating_count: 40 })
  })
})
