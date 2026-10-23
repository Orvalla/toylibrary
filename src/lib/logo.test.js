import { describe, expect, it } from 'vitest'
import { faviconUrlFor, storeLogoUrlFor } from './logo'

describe('faviconUrlFor', () => {
  it('builds a favicon-service URL from the product page host', () => {
    expect(faviconUrlFor('https://www.somenichetoys.com/products/x')).toBe(
      'https://www.google.com/s2/favicons?domain=www.somenichetoys.com&sz=128'
    )
    expect(faviconUrlFor('https://openlibrary.org/works/OL123W')).toBe(
      'https://www.google.com/s2/favicons?domain=openlibrary.org&sz=128'
    )
  })

  it('is null for unusable URLs', () => {
    expect(faviconUrlFor('not a url')).toBeNull()
    expect(faviconUrlFor('')).toBeNull()
    expect(faviconUrlFor(null)).toBeNull()
    expect(faviconUrlFor(undefined)).toBeNull()
  })
})

describe('storeLogoUrlFor', () => {
  it('prefers the stamped logo, then the product-page favicon', () => {
    expect(
      storeLogoUrlFor({ logo_url: 'https://cdn.example/icon.png', product_url: 'https://x.com/p' })
    ).toBe('https://cdn.example/icon.png')
    expect(storeLogoUrlFor({ product_url: 'https://x.com/p' })).toBe(
      'https://www.google.com/s2/favicons?domain=x.com&sz=128'
    )
  })

  it('is null when the item links nowhere', () => {
    expect(storeLogoUrlFor({})).toBeNull()
    expect(storeLogoUrlFor(null)).toBeNull()
  })
})
