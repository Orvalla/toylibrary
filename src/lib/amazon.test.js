import { describe, expect, it } from 'vitest'
import { amazonUrlFor } from './amazon'

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
})
