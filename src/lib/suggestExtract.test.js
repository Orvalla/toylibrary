import { describe, expect, it } from 'vitest'
import {
  extractProductFacts,
  isSafeFetchUrl,
  normalizeGiftUrl,
} from '../../supabase/functions/suggest-gift/extract'

// Pins for the suggest-gift function's pure helpers: the SSRF
// guard (visitor-pasted URLs get fetched server-side), the
// product-fact extraction (title / picture / price), and the
// duplicate-detection normalisation.

describe('isSafeFetchUrl', () => {
  it('allows public https pages', () => {
    expect(isSafeFetchUrl('https://www.littletikes.com/products/cozy-coupe')).toBe(true)
  })
  it('blocks private and loopback addresses', () => {
    expect(isSafeFetchUrl('http://192.168.1.10/admin')).toBe(false)
    expect(isSafeFetchUrl('http://127.0.0.1/')).toBe(false)
    expect(isSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeFetchUrl('http://localhost:8000/')).toBe(false)
  })
  it('blocks non-http schemes and credentialed URLs', () => {
    expect(isSafeFetchUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeFetchUrl('https://user:pass@example.com/')).toBe(false)
  })
})

describe('extractProductFacts', () => {
  it('reads name, image and price from a JSON-LD Product', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Cozy Coupe",
       "image":"https://cdn.example.com/coupe.jpg",
       "offers":{"@type":"Offer","price":64.99,"priceCurrency":"USD"}}
    </script>`
    expect(extractProductFacts(html)).toEqual({
      title: 'Cozy Coupe',
      image_url: 'https://cdn.example.com/coupe.jpg',
      price: 64.99,
      currency: 'USD',
    })
  })

  it("uses an AggregateOffer's lowPrice", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Train Set",
       "offers":{"@type":"AggregateOffer","lowPrice":19.5,"priceCurrency":"USD"}}
    </script>`
    expect(extractProductFacts(html)?.price).toBe(19.5)
  })

  it('falls back to Open Graph for title and image', () => {
    const html = `<meta property="og:title" content="Wooden Tricycle">
                  <meta property="og:image" content="https://cdn.example.com/trike.jpg">`
    expect(extractProductFacts(html)).toEqual({
      title: 'Wooden Tricycle',
      image_url: 'https://cdn.example.com/trike.jpg',
      price: null,
      currency: null,
    })
  })

  it('returns null when the page says nothing usable', () => {
    expect(extractProductFacts('<html><body>hello</body></html>')).toBeNull()
    expect(extractProductFacts('')).toBeNull()
  })
})

describe('normalizeGiftUrl', () => {
  it('strips tracking parameters, fragments and trailing slashes', () => {
    expect(normalizeGiftUrl('https://Shop.example.com/p/trike/?utm_source=mail&ref=gp#reviews')).toBe(
      'https://shop.example.com/p/trike'
    )
  })
  it('keeps meaningful query parameters', () => {
    expect(normalizeGiftUrl('https://example.com/item?id=42')).toBe(
      'https://example.com/item?id=42'
    )
  })
})
