import { describe, expect, it } from 'vitest'
import { createProductImageFetcher, openLibraryCover, storeImageFor } from './productImage'

// Unmatched photo-scan detections borrow the product's real
// picture (store photo / book cover) — never the parent's
// shelf photo. These tests pin the picking rules.
describe('storeImageFor', () => {
  const candidates = [
    { platform: 'tonies', title: 'Paw Patrol — Chase', image_url: 'https://img/chase.png' },
    { platform: 'yoto', title: 'Bluey', image_url: 'https://img/bluey-card.png' },
  ]
  it('picks the word-matching candidate image', () => {
    expect(storeImageFor(candidates, { title: 'Chase', platform: 'tonies' })).toBe(
      'https://img/chase.png'
    )
  })
  it('returns empty when nothing matches well enough', () => {
    expect(storeImageFor(candidates, { title: 'Mystery Gadget', platform: 'other' })).toBe('')
    expect(storeImageFor([], { title: 'Chase', platform: 'tonies' })).toBe('')
  })
})

describe('openLibraryCover', () => {
  it('builds the cover URL for the matching doc', () => {
    const docs = [
      { title: 'The Very Hungry Caterpillar', cover_i: 7835968 },
      { title: 'Other Book', cover_i: 12 },
    ]
    expect(openLibraryCover(docs, { title: 'The Very Hungry Caterpillar', platform: 'books' })).toBe(
      'https://covers.openlibrary.org/b/id/7835968-M.jpg'
    )
  })
  it('ignores docs without covers and mismatches', () => {
    expect(openLibraryCover([{ title: 'Some Book' }], { title: 'Some Book', platform: 'books' })).toBe('')
    expect(
      openLibraryCover([{ title: 'Zebra Tales', cover_i: 5 }], { title: 'Giraffe Songs', platform: 'books' })
    ).toBe('')
  })
})

describe('createProductImageFetcher', () => {
  it('routes books to Open Library and other platforms to the stores', async () => {
    const fetchProductImage = createProductImageFetcher({
      searchStores: async () => [
        { platform: 'tonies', title: 'Chase', image_url: 'https://img/chase.png' },
      ],
      fetchJson: async () => ({ docs: [{ title: 'The Very Hungry Caterpillar', cover_i: 7835968 }] }),
    })
    await expect(fetchProductImage({ title: 'Chase', platform: 'tonies' })).resolves.toBe(
      'https://img/chase.png'
    )
    await expect(
      fetchProductImage({ title: 'The Very Hungry Caterpillar', platform: 'books' })
    ).resolves.toContain('7835968')
  })
  it('never throws — a failed hunt just means no picture', async () => {
    const fetchProductImage = createProductImageFetcher({
      searchStores: async () => {
        throw new Error('boom')
      },
      fetchJson: async () => {
        throw new Error('boom')
      },
    })
    await expect(fetchProductImage({ title: 'X', platform: 'tonies' })).resolves.toBe('')
    await expect(fetchProductImage({ title: 'X', platform: 'books' })).resolves.toBe('')
  })
})
