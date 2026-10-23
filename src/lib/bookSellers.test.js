import { describe, expect, it } from 'vitest'
import { BOOK_SELLERS, usedBookLinksFor } from './bookSellers'

describe('usedBookLinksFor', () => {
  it('returns no links for non-book items', () => {
    expect(usedBookLinksFor({ platform: 'tonies', title: 'Octopus' })).toEqual([])
    expect(usedBookLinksFor(null)).toEqual([])
    expect(usedBookLinksFor({ platform: 'books' })).toEqual([])
  })

  it('links every vetted seller for a book, title URL-encoded', () => {
    const links = usedBookLinksFor({ platform: 'books', title: "Charlotte's Web" })
    expect(links.map((l) => l.key)).toEqual(BOOK_SELLERS.map((s) => s.key))
    for (const l of links) {
      // encodeURIComponent escapes the space; the apostrophe rides
      // along raw, which the sellers' search pages accept fine.
      expect(l.href).toContain("Charlotte's%20Web")
      expect(l.href).toMatch(/^https:\/\//)
    }
    expect(links[0].href).toContain('thriftbooks.com')
    expect(links[1].href).toContain('betterworldbooks.com')
  })
})
