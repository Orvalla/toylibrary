import { describe, expect, it } from 'vitest'
import { bestMatch, matchScore, titleWords } from './photoMatch'

const catalog = [
  { id: 'c1', platform: 'tonies', title: 'Paw Patrol: Chase', details: 'Character Tonie' },
  { id: 'c2', platform: 'tonies', title: 'Bluey', details: 'Character Tonie' },
  { id: 'c3', platform: 'books', title: 'The Cat in the Hat', details: 'Picture book' },
  { id: 'c4', platform: 'projector', title: 'Dr. Seuss Cat in The Hat Collection', details: 'Dream Machine story collection' },
  { id: 'c5', platform: 'books', title: 'Goodnight Moon', details: 'Board book' },
]

describe('titleWords', () => {
  it('drops branding and filler words', () => {
    expect([...titleWords('The Cat in the Hat')].sort()).toEqual(['cat', 'hat'])
    expect([...titleWords('Paw Patrol — Chase Tonie')].sort()).toEqual(['chase', 'patrol', 'paw'])
  })
})

describe('bestMatch', () => {
  it('matches a detection to the same product despite punctuation', () => {
    const m = bestMatch({ title: 'Paw Patrol — Chase', platform: 'tonies', confidence: 0.9 }, catalog)
    expect(m?.entry.id).toBe('c1')
    expect(m.score).toBeGreaterThanOrEqual(1)
  })

  it('uses the platform guess to break a title tie', () => {
    const asBook = bestMatch({ title: 'Cat in the Hat', platform: 'books', confidence: 0.8 }, catalog)
    expect(asBook?.entry.id).toBe('c3')
    const asCartridge = bestMatch(
      { title: 'Cat in the Hat', platform: 'projector', confidence: 0.8 },
      catalog
    )
    expect(asCartridge?.entry.id).toBe('c4')
  })

  it('matches a partial title when the distinctive words line up', () => {
    const m = bestMatch({ title: 'Goodnight Moon book', platform: 'books', confidence: 0.7 }, catalog)
    expect(m?.entry.id).toBe('c5')
  })

  it('returns null when nothing is close', () => {
    expect(
      bestMatch({ title: 'Quantum Physics for Babies', platform: 'books', confidence: 0.9 }, catalog)
    ).toBeNull()
    expect(matchScore({ title: 'Bluey', platform: 'tonies' }, catalog[4])).toBe(0)
  })

  // The Dream Machine failure (2026-10-24): a photo of Story
  // Dream Machine cartridges produced confident "found in the
  // catalog" hits on the same stories' picture books. A named
  // platform confines matching to that platform's shelf.
  it('never matches a cartridge detection to the picture book of the same story', () => {
    const booksOnly = [
      { id: 'b1', platform: 'books', title: 'Elmo Goes to School', details: 'Board book' },
      { id: 'b2', platform: 'books', title: 'The Very Quiet Cricket', details: 'Picture book' },
    ]
    expect(
      bestMatch({ title: 'Elmo Goes to School', platform: 'projector', confidence: 0.95 }, booksOnly)
    ).toBeNull()
    expect(
      bestMatch({ title: 'The Very Quiet Cricket', platform: 'projector', confidence: 0.9 }, booksOnly)
    ).toBeNull()
  })

  it('matches a cartridge to its projector row despite the series prefix', () => {
    const withCartridge = [
      { id: 'b1', platform: 'books', title: 'Mister Seahorse', details: 'Picture book' },
      {
        id: 'p1',
        platform: 'projector',
        title: 'World of Eric Carle: Mister Seahorse',
        details: 'Dream Machine story cartridge',
      },
    ]
    const m = bestMatch(
      { title: 'Mister Seahorse', platform: 'projector', confidence: 0.9 },
      withCartridge
    )
    expect(m?.entry.id).toBe('p1')
    // And the same photo read as a book still finds the book.
    const asBook = bestMatch(
      { title: 'Mister Seahorse', platform: 'books', confidence: 0.9 },
      withCartridge
    )
    expect(asBook?.entry.id).toBe('b1')
  })

  it('a platform-less detection still searches every shelf', () => {
    const m = bestMatch({ title: 'Goodnight Moon', platform: 'other', confidence: 0.8 }, catalog)
    expect(m?.entry.id).toBe('c5')
  })

  it('rows with no platform of their own stay eligible (Open Library docs)', () => {
    const docs = [{ id: 'ol1', title: 'The Very Hungry Caterpillar', cover_i: 42 }]
    const m = bestMatch({ title: 'The Very Hungry Caterpillar', platform: 'books' }, docs)
    expect(m?.entry.id).toBe('ol1')
  })
})
