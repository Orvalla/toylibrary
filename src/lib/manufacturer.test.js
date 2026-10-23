import { describe, expect, it } from 'vitest'
import { manufacturerSiteFor, manufacturerUrlFor } from './manufacturer'

// Direct manufacturer links: the item's own product page when
// the catalog knows it, else the maker's official store, else
// nothing. Books have no single maker site — no link beats a
// wrong one.

describe('manufacturerUrlFor', () => {
  it('prefers the exact product page', () => {
    expect(
      manufacturerUrlFor({ platform: 'tonies', product_url: 'https://us.tonies.com/products/x' })
    ).toBe('https://us.tonies.com/products/x')
  })

  it('falls back to the platform store', () => {
    expect(manufacturerUrlFor({ platform: 'haba', product_url: null })).toBe(
      'https://www.habausa.com'
    )
    expect(manufacturerUrlFor({ platform: 'littletikes' })).toBe(
      'https://www.littletikes.com'
    )
  })

  it('splits the projector platform by brand', () => {
    expect(
      manufacturerSiteFor({ platform: 'projector', title: 'Moonlite Single Story — Frozen' })
    ).toBe('https://www.mymoonlite.com')
    expect(
      manufacturerSiteFor({
        platform: 'projector',
        title: 'Story Dream Machine — The Very Hungry Caterpillar',
      })
    ).toBe('https://www.littletikes.com')
  })

  it('returns null where no maker site exists', () => {
    expect(manufacturerUrlFor({ platform: 'books', title: 'The Gruffalo' })).toBeNull()
    expect(manufacturerUrlFor({ platform: 'other', title: 'Thing' })).toBeNull()
    expect(manufacturerUrlFor(null)).toBeNull()
    expect(manufacturerUrlFor(undefined)).toBeNull()
  })
})
