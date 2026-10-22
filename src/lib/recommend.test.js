import { describe, expect, it } from 'vitest'
import { recommendForChild } from './recommend'
import { itemKey } from './bundles'

const today = new Date(2026, 9, 21)
const catalog = [
  { id: 'd1', platform: 'tonies', title: 'Toniebox 2', details: 'Player', item_type: 'device', sort_order: 1 },
  { id: 't1', platform: 'tonies', title: 'Dinosaur Roar Tonie', details: 'Tonie figure', sort_order: 20 },
  { id: 't2', platform: 'tonies', title: 'Bluey', details: 'Tonie figure', sort_order: 10 },
  { id: 't3', platform: 'tonies', title: 'Rocket to the Moon Tonie', details: 'Tonie figure', sort_order: 30 },
  { id: 'y1', platform: 'yoto', title: 'Space Explorers', details: 'Yoto Card', sort_order: 5 },
  { id: 'b1', platform: 'books', title: 'The Dinosaur That Pooped a Planet', details: 'Picture book', sort_order: 100 },
  { id: 'b2', platform: 'books', title: 'Goodnight Moon', details: 'Board book', sort_order: 101 },
  { id: 'b3', platform: 'books', title: 'The Dragonet Prophecy', details: 'Chapter book', sort_order: 102 },
]
const child = { name: 'Alex', birth_date: '2021-06-01', interests: ['dinosaurs', 'space'] }
const base = {
  catalog,
  child,
  ownedPlatforms: new Set(['tonies']),
  ownedKeys: new Set(),
  wishlistKeys: new Set(),
  today,
}

describe('recommendForChild', () => {
  it('only suggests content for owned devices, plus books and projector', () => {
    const recs = recommendForChild(base)
    expect(recs.map((r) => r.id)).not.toContain('y1') // no Yoto player
    expect(recs.map((r) => r.id)).not.toContain('d1') // never a device
  })

  it('ranks interest matches first and excludes owned/wished items', () => {
    const recs = recommendForChild({
      ...base,
      ownedKeys: new Set([itemKey('tonies', 'Dinosaur Roar Tonie')]),
    })
    const titles = recs.map((r) => r.title)
    expect(titles).not.toContain('Dinosaur Roar Tonie')
    // Two interest hits (dinosaur + planet) plus the picture-book
    // age fit beats a single space hit.
    expect(titles[0]).toBe('The Dinosaur That Pooped a Planet')
    expect(titles).toContain('Rocket to the Moon Tonie')
  })

  it('fits book formats to the age band (5yo → picture over board/chapter)', () => {
    const recs = recommendForChild({ ...base, ownedPlatforms: new Set() })
    const ids = recs.map((r) => r.id)
    expect(ids.indexOf('b1')).toBeLessThan(ids.indexOf('b3'))
    expect(ids.indexOf('b1')).toBeLessThan(ids.indexOf('b2'))
  })

  it('respects the limit and falls back gracefully with no interests', () => {
    const recs = recommendForChild({ ...base, child: { ...child, interests: [] }, limit: 2 })
    expect(recs).toHaveLength(2)
    // No interest signal: the age-fit picture book leads, then the
    // front of the catalog by sort order.
    expect(recs.map((r) => r.id)).toEqual(['b1', 't2'])
  })
})
