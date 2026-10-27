import { describe, expect, it } from 'vitest'
import { isArtRow } from './art'

describe('isArtRow', () => {
  it('takes every Crayola row — the platform is pure art supplies', () => {
    expect(isArtRow({ platform: 'crayola', details: 'Crayons' })).toBe(true)
    expect(isArtRow({ platform: 'crayola', details: 'Mess-free coloring set' })).toBe(true)
  })

  it("takes the mixed brands' own art lines, by their details labels", () => {
    expect(isArtRow({ platform: 'melissaanddoug', details: 'Craft & Stamp Kits' })).toBe(true)
    expect(isArtRow({ platform: 'melissaanddoug', details: 'Easels & Art Supplies' })).toBe(true)
    expect(isArtRow({ platform: 'melissaanddoug', details: 'Stickers & Sticker Books' })).toBe(true)
    expect(isArtRow({ platform: 'djeco', details: 'Water colouring set' })).toBe(true)
    expect(isArtRow({ platform: 'djeco', details: 'Finger paint tubes' })).toBe(true)
    expect(isArtRow({ platform: 'eeboo', details: 'Color pencils' })).toBe(true)
    expect(isArtRow({ platform: 'mudpuppy', details: 'Coloring Book' })).toBe(true)
  })

  it('takes the pure-art platforms whole — each was fenced to art at ingestion', () => {
    for (const platform of ['ooly', 'fabercastell', 'brightstripes', 'thepencilgrip', 'petitcollage', 'annwilliams', 'pipsticks', 'rainbowloom']) {
      expect(isArtRow({ platform, details: 'Anything' })).toBe(true)
    }
  })

  it("takes the Djeco top-up's workshop labels and Robotime's Rolife line", () => {
    expect(isArtRow({ platform: 'djeco', details: 'Cyanotype kit' })).toBe(true)
    expect(isArtRow({ platform: 'djeco', details: 'Atelier kit' })).toBe(true)
    expect(isArtRow({ platform: 'djeco', details: 'Scratch boards' })).toBe(true)
    expect(isArtRow({ platform: 'robotime', details: 'Rolife craft kit' })).toBe(true)
    expect(isArtRow({ platform: 'robotime', details: 'Rolife craft kit — Rowood wooden flower kit' })).toBe(true)
    expect(isArtRow({ platform: 'robotime', details: 'ROKR mechanical kit' })).toBe(false)
  })

  it('leaves the same brands’ non-art lines on their own shelves', () => {
    // Learning toys that merely mention colour are not art-making.
    expect(isArtRow({ platform: 'melissaanddoug', details: 'Colors & Shapes' })).toBe(false)
    expect(isArtRow({ platform: 'melissaanddoug', details: 'Wooden puzzle' })).toBe(false)
    // Djeco's toddler lines are toys, not art.
    expect(isArtRow({ platform: 'djeco', details: 'Wooden puzzle' })).toBe(false)
    expect(isArtRow({ platform: 'djeco', details: 'Teether' })).toBe(false)
    // Mudpuppy is mostly jigsaws and games.
    expect(isArtRow({ platform: 'mudpuppy', details: 'Jigsaw puzzle · 500 pieces' })).toBe(false)
    expect(isArtRow({ platform: 'mudpuppy', details: 'Board game' })).toBe(false)
    expect(isArtRow({ platform: 'eeboo', details: 'Jigsaw puzzle' })).toBe(false)
  })

  it('keeps art-tech on the STEAM shelf and everything else out', () => {
    expect(isArtRow({ platform: 'squishycircuits', details: 'Conductive dough kit' })).toBe(false)
    expect(isArtRow({ platform: 'chibitronics', details: 'Paper circuits kit' })).toBe(false)
    expect(isArtRow({ platform: 'tonies', details: 'Tonie figure' })).toBe(false)
    expect(isArtRow(null)).toBe(false)
    expect(isArtRow({})).toBe(false)
  })
})
