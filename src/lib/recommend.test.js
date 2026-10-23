import { describe, expect, it } from 'vitest'
import {
  affinityFromItems,
  affinityScore,
  recommendForChild,
  sortBySuggestions,
} from './recommend'
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
const child = { name: 'Sam', birth_date: '2021-06-01', interests: ['dinosaurs', 'space'] }
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

  it('never recommends an aged-out item, however well it matches', () => {
    const agedCatalog = [
      { id: 'baby', platform: 'books', title: 'Baby Dinosaurs Board Book', details: 'Board book', sort_order: 1, age_min_years: 0, age_max_years: 1 },
      { id: 'older', platform: 'books', title: 'Dinosaur Atlas', details: 'Picture book', sort_order: 2, age_min_years: 6, age_max_years: 9 },
      { id: 'fit', platform: 'books', title: 'Dinosaur Tales', details: 'Picture book', sort_order: 3, age_min_years: 3, age_max_years: 6 },
    ]
    const recs = recommendForChild({ ...base, catalog: agedCatalog, ownedPlatforms: new Set() })
    const ids = recs.map((r) => r.id)
    // Sam is 5: the 0–1 baby book is out entirely, even with
    // the dinosaur interest hit. The 6–9 atlas stays — she'll
    // grow into it.
    expect(ids).not.toContain('baby')
    expect(ids).toContain('older')
    expect(ids).toContain('fit')
  })

  it('respects the limit and falls back gracefully with no interests', () => {
    const recs = recommendForChild({ ...base, child: { ...child, interests: [] }, limit: 2 })
    expect(recs).toHaveLength(2)
    // No interest signal: the age-fit picture book leads, then the
    // front of the catalog by sort order.
    expect(recs.map((r) => r.id)).toEqual(['b1', 't2'])
  })
})

describe('sortBySuggestions', () => {
  it('floats platform fit + interests + age fit up, and keeps everything', () => {
    const sorted = sortBySuggestions(catalog, {
      child,
      ownedPlatforms: new Set(['tonies']),
      today,
    })
    // Nothing is hidden by a sort — even the device stays.
    expect(sorted).toHaveLength(catalog.length)
    // b1: books fit (+4) + two interest hits, dinosaur & planet
    // (+6) + picture-book age fit (+2) = 12. t1/t3: tonies fit
    // (+4) + one interest hit (+3) = 7, sort order breaks the
    // tie. d1/t2/b2/b3: platform fit only (+4). y1: a space hit
    // (+3) but no Yoto player in the house.
    expect(sorted.map((r) => r.id)).toEqual(['b1', 't1', 't3', 'd1', 't2', 'b2', 'b3', 'y1'])
  })

  it('aged-out items sink below everything, slightly-older items stay put', () => {
    const agedCatalog = [
      { id: 'baby', platform: 'books', title: 'Baby Dinosaurs Board Book', details: 'Board book', sort_order: 1, age_min_years: 0, age_max_years: 1 },
      { id: 'older', platform: 'books', title: 'Dinosaur Atlas', details: 'Picture book', sort_order: 2, age_min_years: 6, age_max_years: 9 },
      { id: 'fit', platform: 'books', title: 'Dinosaur Tales', details: 'Picture book', sort_order: 3, age_min_years: 3, age_max_years: 6 },
    ]
    const sorted = sortBySuggestions(agedCatalog, {
      child,
      ownedPlatforms: new Set(),
      today,
    })
    // Nothing is hidden by a sort, but the baby book — despite
    // the interest hit — lands last, below the in-range and
    // grow-into items.
    expect(sorted).toHaveLength(3)
    expect(sorted.map((r) => r.id)).toEqual(['fit', 'older', 'baby'])
  })

  it('with no child signals it falls back to catalog order', () => {
    const sorted = sortBySuggestions(catalog, {
      child: { name: 'X', birth_date: null, interests: [] },
      ownedPlatforms: new Set(),
      today,
    })
    // Only the always-allowed platforms (books, projector) get
    // the fit term, so books lead in sort order, then the rest
    // by sort order.
    expect(sorted.map((r) => r.id)).toEqual(['b1', 'b2', 'b3', 'd1', 'y1', 't2', 't1', 't3'])
  })
})

describe('library affinity (owner request 2026-10-22)', () => {
  const library = [
    { platform: 'books', title: 'Percy Jackson and the Lightning Thief', list_type: 'have' },
    { platform: 'ravensburger', title: 'GraviTrax Starter Set', list_type: 'have' },
    { platform: 'ravensburger', title: 'GraviTrax Expansion Bridges', list_type: 'have' },
    { platform: 'ravensburger', title: 'GraviTrax Expansion Tunnels', list_type: 'have' },
  ]
  const affinity = affinityFromItems(library)

  it('rewards same-series titles strongly and ignores owned ones', () => {
    const nextBook = { platform: 'books', title: 'Percy Jackson and the Sea of Monsters' }
    expect(affinityScore(nextBook, affinity, new Set())).toBeGreaterThanOrEqual(4)
    const owned = { platform: 'books', title: 'Percy Jackson and the Lightning Thief' }
    expect(
      affinityScore(owned, affinity, new Set([itemKey(owned.platform, owned.title)]))
    ).toBe(0)
  })

  it('adds a collecting-platform bonus at 3+ owned', () => {
    // 'Labyrinth' shares no words with the library, but the
    // child collects Ravensburger (3 items) → +1.
    expect(affinityScore({ platform: 'ravensburger', title: 'Labyrinth' }, affinity, new Set())).toBe(1)
    expect(affinityScore({ platform: 'tonies', title: 'Labyrinth' }, affinity, new Set())).toBe(0)
  })

  it('floats the next series book to the top of recommendations', () => {
    const catalog = [
      { platform: 'books', title: 'A Totally Unrelated Novel', details: 'Chapter book', sort_order: 1 },
      { platform: 'books', title: 'Percy Jackson and the Sea of Monsters', details: 'Chapter book', sort_order: 2 },
    ]
    const recs = recommendForChild({
      catalog,
      child: { birth_date: '2016-06-01', interests: [] },
      ownedPlatforms: new Set(),
      ownedKeys: new Set([itemKey('books', 'Percy Jackson and the Lightning Thief')]),
      wishlistKeys: new Set(),
      affinity,
    })
    expect(recs[0].title).toBe('Percy Jackson and the Sea of Monsters')
  })
})

describe('grow-into window', () => {
  it('keeps slightly-older items, drops far-older ones from recommendations', () => {
    const catalog = [
      { platform: 'books', title: 'Near Future Read', details: 'Chapter book', age_min_years: 7, age_max_years: 9, sort_order: 1 },
      { platform: 'books', title: 'Teen Novel', details: 'Young adult', age_min_years: 12, age_max_years: 18, sort_order: 2 },
    ]
    const recs = recommendForChild({
      catalog,
      child: { birth_date: '2022-01-01', interests: [] }, // age 4 at the fixed test "today" below
      ownedPlatforms: new Set(),
      ownedKeys: new Set(),
      wishlistKeys: new Set(),
      today: new Date(2026, 0, 1), // local constructor — age exactly 4
    })
    const titles = recs.map((r) => r.title)
    expect(titles).toContain('Near Future Read') // 7 = 4 + 3, inside the window
    expect(titles).not.toContain('Teen Novel')
  })
})
