import { describe, expect, it } from 'vitest'
import {
  createBookResolver,
  createProductImageFetcher,
  openLibraryCover,
  openLibraryResolution,
  storeImageFor,
} from './productImage'

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

describe('openLibraryResolution', () => {
  const docs = [
    { title: 'The Wild Robot', author_name: ['Peter Brown'], cover_i: 111, key: '/works/OL1W' },
    { title: 'The Wild Robot Escapes', author_name: ['Peter Brown'], cover_i: 222, key: '/works/OL2W' },
    { title: 'The Wild Robot', author_name: ['Someone Else'], cover_i: 333, key: '/works/OL3W' },
  ]

  it('resolves title + author to the full work identity', () => {
    const r = openLibraryResolution(docs, {
      title: 'The Wild Robot',
      author: 'Peter Brown',
      platform: 'books',
    })
    expect(r.title).toBe('The Wild Robot')
    expect(r.author).toBe('Peter Brown')
    expect(r.image_url).toBe('https://covers.openlibrary.org/b/id/111-M.jpg')
    expect(r.work_url).toBe('https://openlibrary.org/works/OL1W')
  })

  it('lets the author disambiguate a weaker title read', () => {
    // Spine read dropped a word; the author surname carries it.
    const r = openLibraryResolution(docs, {
      title: 'Wild Robot',
      author: 'Brown',
      platform: 'books',
    })
    expect(r?.work_url).toBe('https://openlibrary.org/works/OL1W')
  })

  it('returns null when nothing is close, or only coverless docs match', () => {
    expect(
      openLibraryResolution(docs, { title: 'Completely Different', platform: 'books' })
    ).toBeNull()
    expect(
      openLibraryResolution([{ title: 'The Wild Robot', key: '/works/OL9W' }], {
        title: 'The Wild Robot',
        platform: 'books',
      })
    ).toBeNull()
  })
})

describe('createBookResolver', () => {
  it('searches Open Library by title and author', async () => {
    const seen = []
    const resolveBook = createBookResolver({
      fetchJson: async (url) => {
        seen.push(url)
        return {
          docs: [
            { title: 'Hatchet', author_name: ['Gary Paulsen'], cover_i: 7, key: '/works/OL7W' },
          ],
        }
      },
    })
    const r = await resolveBook({ title: 'Hatchet', author: 'Gary Paulsen', platform: 'books' })
    expect(r.title).toBe('Hatchet')
    expect(seen[0]).toContain('title=Hatchet')
    expect(seen[0]).toContain('author=Gary+Paulsen')
  })

  it('never throws — a failed lookup resolves to null', async () => {
    const resolveBook = createBookResolver({
      fetchJson: async () => {
        throw new Error('offline')
      },
    })
    expect(await resolveBook({ title: 'Hatchet', platform: 'books' })).toBeNull()
  })
})
