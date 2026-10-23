import { describe, expect, it } from 'vitest'
import { manufacturerUrlFor } from './manufacturer'

// Direct manufacturer links are product pages or nothing
// (owner's ruling 2026-10-22): no storefront/catalog fallback,
// so an item whose exact page is unknown — mostly stock the
// maker's store no longer lists — shows no manufacturer link
// rather than a generic one.

describe('manufacturerUrlFor', () => {
  it('returns the exact product page when known', () => {
    expect(
      manufacturerUrlFor({ platform: 'tonies', product_url: 'https://us.tonies.com/products/x' })
    ).toBe('https://us.tonies.com/products/x')
    expect(
      manufacturerUrlFor({
        platform: 'projector',
        product_url: 'https://www.mymoonlite.com/products/reel',
      })
    ).toBe('https://www.mymoonlite.com/products/reel')
  })

  it('returns null when the exact page is unknown — no catalog fallback', () => {
    expect(manufacturerUrlFor({ platform: 'haba', product_url: null })).toBeNull()
    expect(manufacturerUrlFor({ platform: 'tonies' })).toBeNull()
    expect(manufacturerUrlFor({ platform: 'littletikes', product_url: '' })).toBeNull()
  })

  it('returns null for books, other, and missing items', () => {
    expect(manufacturerUrlFor({ platform: 'books', title: 'The Gruffalo' })).toBeNull()
    expect(manufacturerUrlFor({ platform: 'other', title: 'Thing' })).toBeNull()
    expect(manufacturerUrlFor(null)).toBeNull()
    expect(manufacturerUrlFor(undefined)).toBeNull()
  })
})
