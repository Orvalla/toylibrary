import { describe, expect, it } from 'vitest'
import { inKind, kindOf } from './kinds'

describe('kindOf', () => {
  it('books platform is Books', () => {
    expect(kindOf({ platform: 'books', details: 'Picture book' })).toBe('books')
  })

  it('board-game publishers are Board games', () => {
    expect(kindOf({ platform: 'asmodee', details: 'Board game' })).toBe('games')
    expect(kindOf({ platform: 'catan', details: 'Board game' })).toBe('games')
    expect(kindOf({ platform: 'devir', details: 'Juego de mesa' })).toBe('games')
  })

  it('a game from a general brand counts as a board game', () => {
    expect(kindOf({ platform: 'haba', details: 'Board game' })).toBe('games')
    expect(kindOf({ platform: 'smartgames', details: 'Logic game' })).toBe('games')
    expect(kindOf({ platform: 'eeboo', details: 'Card game' })).toBe('games')
  })

  it('story ecosystems keep their games and devices', () => {
    expect(kindOf({ platform: 'tonies', details: 'Tonie figure' })).toBe('story')
    expect(kindOf({ platform: 'yoto', details: 'Yoto Card' })).toBe('story')
    expect(kindOf({ platform: 'leapfrog', details: 'Game cartridge' })).toBe('story')
    expect(kindOf({ platform: 'projector', details: 'Story reel' })).toBe('story')
    expect(kindOf({ platform: 'tonies', item_type: 'device', details: 'Toniebox' })).toBe('story')
  })

  it('physical toys land in Toys & play', () => {
    expect(kindOf({ platform: 'melissaanddoug', details: 'Wooden play set' })).toBe('toys')
    expect(kindOf({ platform: 'brio', details: 'Train set' })).toBe('toys')
    expect(kindOf({ platform: 'vtech', details: 'Touch and Learn book' })).toBe('toys')
    expect(kindOf(null)).toBe('toys')
  })

  it('inKind passes everything for all', () => {
    expect(inKind({ platform: 'catan' }, 'all')).toBe(true)
    expect(inKind({ platform: 'catan' }, 'games')).toBe(true)
    expect(inKind({ platform: 'catan' }, 'books')).toBe(false)
  })
})
