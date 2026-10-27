import { describe, expect, it } from 'vitest'
import { findOwned, normalizeForMatch, ownedAdvice } from './ownedMatch'

const have = [
  { id: '1', title: 'Paw Patrol — Chase', details: 'Character Tonie', child_name: 'Sam' },
  { id: '2', title: 'Pokémon: Pikachu & Friends', details: 'Yoto card', child_name: 'Noah' },
  { id: '3', title: 'The Very Hungry Caterpillar', details: 'Story Tonie', child_name: null },
]

describe('normalizeForMatch', () => {
  it('folds case, accents, punctuation and ampersands', () => {
    expect(normalizeForMatch('Pokémon: Pikachu & Friends')).toBe('pokemon pikachu and friends')
    expect(normalizeForMatch('  Paw Patrol — Chase ')).toBe('paw patrol chase')
  })
})

describe('findOwned', () => {
  it('finds a title typed without the dash (the original false "you\'re clear")', () => {
    expect(findOwned(have, 'Paw Patrol Chase').map((i) => i.id)).toEqual(['1'])
  })

  it('ignores accents, case and word order', () => {
    expect(findOwned(have, 'pokemon pikachu').map((i) => i.id)).toEqual(['2'])
    expect(findOwned(have, 'chase paw').map((i) => i.id)).toEqual(['1'])
  })

  it('matches on details too', () => {
    expect(findOwned(have, 'yoto').map((i) => i.id)).toEqual(['2'])
  })

  it('returns an empty list (not null) when nothing matches', () => {
    expect(findOwned(have, 'Bluey')).toEqual([])
  })

  it('declines to judge empty or one-letter queries', () => {
    expect(findOwned(have, '')).toBeNull()
    expect(findOwned(have, '   ')).toBeNull()
    expect(findOwned(have, 'a')).toBeNull()
  })

  it('copes with a missing have list', () => {
    expect(findOwned(undefined, 'paw')).toEqual([])
  })
})

describe('ownedAdvice', () => {
  it('names the children whose shelf holds it', () => {
    expect(ownedAdvice([have[0]])).toBe('best pick something else for Sam.')
    expect(ownedAdvice([have[0], have[1]])).toBe('best pick something else for Sam / Noah.')
  })

  it('stays generic for family items', () => {
    expect(ownedAdvice([have[2]])).toBe('best pick something else.')
  })
})
