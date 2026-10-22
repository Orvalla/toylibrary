import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryOf } from './categories'

describe('categoryOf', () => {
  it('files catalog devices under Devices, whatever the details say', () => {
    expect(
      categoryOf({ platform: 'tonies', item_type: 'device', details: 'Toniebox audio player' })
    ).toBe('Devices')
    expect(
      categoryOf({ platform: 'leapfrog', item_type: 'device', details: 'LeapPad learning tablet' })
    ).toBe('Devices')
    // Even when the details text would otherwise claim it.
    expect(
      categoryOf({ platform: 'osmo', item_type: 'device', details: 'Osmo game base' })
    ).toBe('Devices')
  })

  it('files everything on the books platform under Books', () => {
    expect(categoryOf({ platform: 'books', details: 'Picture book' })).toBe('Books')
    expect(categoryOf({ platform: 'books', details: '' })).toBe('Books')
  })

  it('reads figures from the details text', () => {
    expect(categoryOf({ platform: 'tonies', details: 'Tonie figure' })).toBe('Figures')
    expect(categoryOf({ platform: 'storypod', details: 'Craftie figure' })).toBe('Figures')
    expect(categoryOf({ platform: 'tonies', details: 'Character Tonie' })).toBe('Audio & more')
  })

  it('reads books from the details text on other platforms', () => {
    expect(categoryOf({ platform: 'leapfrog', details: 'LeapStart book' })).toBe('Books')
    expect(categoryOf({ platform: 'vtech', details: 'Interactive book' })).toBe('Books')
    expect(categoryOf({ platform: 'storypod', details: 'Picture Books' })).toBe('Books')
  })

  it('files physical-toy platforms under Toys unless details say game or book', () => {
    expect(categoryOf({ platform: 'magnatiles', details: 'Building set · 32 pieces' })).toBe('Toys')
    expect(categoryOf({ platform: 'lovevery', details: 'Play kit' })).toBe('Toys')
    expect(categoryOf({ platform: 'haba', details: 'Wooden pull toy' })).toBe('Toys')
    expect(categoryOf({ platform: 'haba', details: 'Board game' })).toBe('Games')
    expect(categoryOf({ platform: 'smartgames', details: 'Logic game · 1 player' })).toBe('Games')
    // The fallback must not leak onto the audio platforms.
    expect(categoryOf({ platform: 'yoto', details: 'Story collection' })).toBe('Audio & more')
  })

  it('reads cards from the details text', () => {
    expect(categoryOf({ platform: 'yoto', details: 'Yoto Card' })).toBe('Cards')
    expect(categoryOf({ platform: 'storypod', details: 'Card Sets' })).toBe('Cards')
  })

  it('reads games from the details text', () => {
    expect(categoryOf({ platform: 'osmo', details: 'Osmo game' })).toBe('Games')
    expect(categoryOf({ platform: 'leapfrog', details: 'Game cartridge' })).toBe('Games')
  })

  it('falls back to Audio & more for audio-first content and unknowns', () => {
    expect(categoryOf({ platform: 'lunii', details: 'Story album' })).toBe('Audio & more')
    expect(categoryOf({ platform: 'projector', details: 'Story reel' })).toBe('Audio & more')
    expect(categoryOf({ platform: 'storypod', details: 'Token' })).toBe('Audio & more')
    expect(categoryOf({ platform: 'tonies', details: '' })).toBe('Audio & more')
    expect(categoryOf({})).toBe('Audio & more')
    expect(categoryOf(null)).toBe('Audio & more')
  })

  it('only ever returns one of the seven categories', () => {
    const samples = [
      { platform: 'tonies', item_type: 'device' },
      { platform: 'books' },
      { platform: 'tonies', details: 'Tonie figure' },
      { platform: 'leapfrog', details: 'LeapStart book' },
      { platform: 'yoto', details: 'Yoto Card' },
      { platform: 'osmo', details: 'Osmo game' },
      { platform: 'lunii', details: 'Story album' },
    ]
    for (const s of samples) expect(CATEGORIES).toContain(categoryOf(s))
    expect(CATEGORIES).toHaveLength(7)
  })
})
