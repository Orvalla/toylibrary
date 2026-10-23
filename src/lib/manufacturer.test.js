import { describe, expect, it } from 'vitest'
import { manufacturerNameFor, manufacturerUrlFor, siteNameForUrl } from './manufacturer'

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

// The label names the site the link goes to (owner request
// 2026-10-23): books link to Open Library, not "Books"; BRIO
// links into Ravensburger's store, so the label says so.
describe('manufacturerNameFor', () => {
  it('names the site a book links to, not the Books platform', () => {
    expect(
      manufacturerNameFor({ platform: 'books', product_url: 'https://openlibrary.org/works/OL123W' })
    ).toBe('Open Library')
  })

  it('names the parent store for brands sold through it', () => {
    expect(
      manufacturerNameFor({ platform: 'brio', product_url: 'https://www.ravensburger.us/products/railway' })
    ).toBe('Ravensburger')
    expect(
      manufacturerNameFor({ platform: 'thinkfun', product_url: 'https://www.ravensburger.us/products/rush-hour' })
    ).toBe('Ravensburger')
    expect(
      manufacturerNameFor({ platform: 'littlepeople', product_url: 'https://shop.mattel.com/products/x' })
    ).toBe('Mattel')
  })

  it('names the maker store for direct-platform items', () => {
    expect(
      manufacturerNameFor({ platform: 'haba', product_url: 'https://www.habausa.com/products/x' })
    ).toBe('HABA')
    expect(
      manufacturerNameFor({ platform: 'devir', product_url: 'https://deviramericas.com/products/x' })
    ).toBe('Devir')
  })

  it('falls back to a tidied domain for unknown stores', () => {
    expect(siteNameForUrl('https://www.somenichetoys.com/products/x')).toBe('Somenichetoys')
    expect(siteNameForUrl('https://shop.example-store.co.uk/products/x')).toBe('Example-store')
  })

  it('is null when there is no product page', () => {
    expect(manufacturerNameFor({ platform: 'books', product_url: null })).toBeNull()
    expect(manufacturerNameFor({ platform: 'books' })).toBeNull()
    expect(manufacturerNameFor(null)).toBeNull()
  })
})
