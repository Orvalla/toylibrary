import { beforeEach, describe, expect, it } from 'vitest'
import {
  affiliateSuppressed,
  amazonUrlFor,
  effectiveTag,
  noteSharePageVisit,
  suppressAffiliate,
} from './amazon'

describe('amazonUrlFor', () => {
  it('builds an Amazon search URL from the title plus the platform brand word', () => {
    expect(amazonUrlFor({ platform: 'tonies', title: 'Bluey' }, '')).toBe(
      'https://www.amazon.com/s?k=Bluey%20Tonies'
    )
    expect(amazonUrlFor({ platform: 'yoto', title: 'The Gruffalo' }, '')).toBe(
      'https://www.amazon.com/s?k=The%20Gruffalo%20Yoto'
    )
    expect(amazonUrlFor({ platform: 'leapfrog', title: 'LeapPad: Paw Patrol' }, '')).toBe(
      'https://www.amazon.com/s?k=LeapPad%3A%20Paw%20Patrol%20LeapFrog'
    )
    expect(amazonUrlFor({ platform: 'projector', title: 'Goodnight Moon' }, '')).toBe(
      'https://www.amazon.com/s?k=Goodnight%20Moon%20Moonlite%20Little%20Tikes'
    )
  })

  it('adds no brand word for books and other platforms', () => {
    expect(amazonUrlFor({ platform: 'books', title: 'Dragons Love Tacos' }, '')).toBe(
      'https://www.amazon.com/s?k=Dragons%20Love%20Tacos'
    )
    expect(amazonUrlFor({ platform: 'other', title: 'Some Toy' }, '')).toBe(
      'https://www.amazon.com/s?k=Some%20Toy'
    )
    expect(amazonUrlFor({ platform: 'mystery', title: 'Some Toy' }, '')).toBe(
      'https://www.amazon.com/s?k=Some%20Toy'
    )
  })

  it('URL-encodes titles with characters Amazon would choke on', () => {
    expect(amazonUrlFor({ platform: 'tonies', title: 'Rock & Roll “Fun” 100%' }, '')).toBe(
      'https://www.amazon.com/s?k=Rock%20%26%20Roll%20%E2%80%9CFun%E2%80%9D%20100%25%20Tonies'
    )
  })

  it('appends the affiliate tag only when one is configured', () => {
    const item = { platform: 'osmo', title: 'Monster' }
    expect(amazonUrlFor(item, 'toylibrary0e-20')).toBe(
      'https://www.amazon.com/s?k=Monster%20Osmo&tag=toylibrary0e-20'
    )
    expect(amazonUrlFor(item, '')).not.toContain('tag=')
    expect(amazonUrlFor(item, undefined)).not.toContain('tag=')
    expect(amazonUrlFor(item, null)).not.toContain('tag=')
  })

  it('goes straight to the product page when the item has an ASIN', () => {
    const item = { platform: 'tonies', title: 'Blippi', asin: 'B0CXYZ1234' }
    expect(amazonUrlFor(item, 'toylibrary0e-20')).toBe(
      'https://www.amazon.com/dp/B0CXYZ1234?tag=toylibrary0e-20'
    )
    expect(amazonUrlFor(item, '')).toBe('https://www.amazon.com/dp/B0CXYZ1234')
  })

  it('ignores malformed ASINs and falls back to search', () => {
    for (const asin of ['B0CXYZ123', 'b0cxyz1234!', 'not-an-asin', 42, null]) {
      expect(amazonUrlFor({ platform: 'yoto', title: 'Cards', asin }, '')).toBe(
        'https://www.amazon.com/s?k=Cards%20Yoto'
      )
    }
  })

  it('accepts a lowercase ASIN by normalising it', () => {
    expect(amazonUrlFor({ platform: 'books', title: 'X', asin: 'b0cxyz1234' }, '')).toBe(
      'https://www.amazon.com/dp/B0CXYZ1234'
    )
  })
})

describe('no-affiliate browsers', () => {
  const item = { platform: 'tonies', title: 'Bluey', asin: 'B0EXAMPLE1' }

  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps the tag until the flag is set', () => {
    expect(amazonUrlFor(item, 'mytag-20')).toContain('tag=mytag-20')
    suppressAffiliate()
    expect(affiliateSuppressed()).toBe(true)
    // Even with an explicit tag argument the default-path links
    // go through effectiveTag; amazonUrlFor with an explicit
    // tag still honours it — suppression works by the CALLER
    // (the default parameter) resolving to no tag.
    expect(effectiveTag('mytag-20')).toBeUndefined()
  })

  it('default links drop the tag once suppressed, for dp and search URLs', () => {
    suppressAffiliate()
    expect(amazonUrlFor(item)).toBe('https://www.amazon.com/dp/B0EXAMPLE1')
    expect(amazonUrlFor({ platform: 'tonies', title: 'Bluey' })).toBe(
      'https://www.amazon.com/s?k=Bluey%20Tonies'
    )
  })

  it('noteSharePageVisit sets the flag only for opted-out families', () => {
    noteSharePageVisit({ no_affiliate: false })
    expect(affiliateSuppressed()).toBe(false)
    noteSharePageVisit({ no_affiliate: true })
    expect(affiliateSuppressed()).toBe(true)
    // And never unsets it — the flag is permanent per browser.
    noteSharePageVisit({ no_affiliate: false })
    expect(affiliateSuppressed()).toBe(true)
  })
})
