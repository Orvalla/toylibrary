import { describe, expect, it } from 'vitest'
import {
  bundleHeadline,
  bundleInfoFor,
  cascadeContentRows,
  indexCatalog,
  indexContents,
  itemKey,
  ownedKeysForBucket,
} from './bundles'

describe('bundleHeadline', () => {
  it('names the child and uses the platform noun', () => {
    expect(bundleHeadline({ name: 'Alex', owned: 3, total: 4, platform: 'tonies' })).toBe(
      'Alex already has 3 of the 4 figures in this collection'
    )
    expect(bundleHeadline({ name: 'Noah', owned: 0, total: 6, platform: 'books' })).toBe(
      'Noah already has 0 of the 6 books in this collection'
    )
    expect(bundleHeadline({ name: 'Alex', owned: 2, total: 5, platform: 'yoto' })).toBe(
      'Alex already has 2 of the 5 cards in this collection'
    )
  })

  it('speaks for the family on shared bundles', () => {
    expect(bundleHeadline({ name: 'Family', owned: 1, total: 4, platform: 'projector' })).toBe(
      'The family already has 1 of the 4 story reels in this collection'
    )
    expect(bundleHeadline({ name: null, owned: 1, total: 4, platform: 'osmo' })).toBe(
      'The family already has 1 of the 4 games in this collection'
    )
  })
})

const catalog = [
  { id: 'b1', platform: 'tonies', title: 'Goosebumps Book Tonies - 4 Pack', details: 'Tonie bundle', is_bundle: true, asin: null, image_url: 'pack.jpg' },
  { id: 'c1', platform: 'tonies', title: 'Goosebumps: Night of the Living Dummy', details: 'Audiobook Tonie', is_bundle: false },
  { id: 'c2', platform: 'tonies', title: 'Goosebumps: Say Cheese and Die!', details: 'Audiobook Tonie', is_bundle: false },
  { id: 'c3', platform: 'tonies', title: 'Goosebumps: The Haunted Mask', details: 'Audiobook Tonie', is_bundle: false },
  { id: 'x1', platform: 'tonies', title: 'Bluey', details: 'Tonie figure', is_bundle: false },
]
const contentsRows = [
  { bundle_id: 'b1', content_id: 'c1' },
  { bundle_id: 'b1', content_id: 'c2' },
  { bundle_id: 'b1', content_id: 'c3' },
]

describe('ownedKeysForBucket', () => {
  const items = [
    { list_type: 'have', platform: 'tonies', title: 'Goosebumps: Night of the Living Dummy', child_id: 'kid-a' },
    { list_type: 'have', platform: 'tonies', title: 'Bluey', child_id: null },
    { list_type: 'have', platform: 'tonies', title: 'Goosebumps: Say Cheese and Die!', child_id: 'kid-b' },
    { list_type: 'wishlist', platform: 'tonies', title: 'Goosebumps: The Haunted Mask', child_id: 'kid-a' },
  ]

  it("counts the child's own rows plus Family rows, never a sibling's or wishlist rows", () => {
    const keys = ownedKeysForBucket(items, 'kid-a')
    expect(keys.has(itemKey('tonies', 'Goosebumps: Night of the Living Dummy'))).toBe(true)
    expect(keys.has(itemKey('tonies', 'Bluey'))).toBe(true) // Family row
    expect(keys.has(itemKey('tonies', 'Goosebumps: Say Cheese and Die!'))).toBe(false) // sibling's
    expect(keys.has(itemKey('tonies', 'Goosebumps: The Haunted Mask'))).toBe(false) // wishlist only
  })

  it('counts everyone for a Family bundle', () => {
    const keys = ownedKeysForBucket(items, null)
    expect(keys.size).toBe(3)
  })
})

describe('bundleInfoFor', () => {
  const { byId } = indexCatalog(catalog)
  const contentsByBundle = indexContents(contentsRows)
  const twin = catalog[0]

  it('reports owned and missing for a partial set', () => {
    const owned = new Set([itemKey('tonies', 'Goosebumps: Night of the Living Dummy')])
    const info = bundleInfoFor({ twin, contentsByBundle, catalogById: byId, ownedKeys: owned })
    expect(info.total).toBe(3)
    expect(info.owned).toBe(1)
    expect(info.missing.map((m) => m.title)).toEqual([
      'Goosebumps: Say Cheese and Die!',
      'Goosebumps: The Haunted Mask',
    ])
  })

  it('is null for non-bundles and unmapped bundles', () => {
    expect(
      bundleInfoFor({ twin: catalog[4], contentsByBundle, catalogById: byId, ownedKeys: new Set() })
    ).toBe(null)
    expect(
      bundleInfoFor({ twin: { ...twin, id: 'nope' }, contentsByBundle, catalogById: byId, ownedKeys: new Set() })
    ).toBe(null)
  })
})

describe('cascadeContentRows', () => {
  const { byId } = indexCatalog(catalog)
  const contentsByBundle = indexContents(contentsRows)

  it('builds have rows for the contents not already owned', () => {
    const rows = cascadeContentRows({
      entry: catalog[0],
      contentsByBundle,
      catalogById: byId,
      ownedKeys: new Set([itemKey('tonies', 'Goosebumps: Night of the Living Dummy')]),
      ownerId: 'owner-1',
      childId: 'kid-a',
    })
    expect(rows.map((r) => r.title)).toEqual([
      'Goosebumps: Say Cheese and Die!',
      'Goosebumps: The Haunted Mask',
    ])
    expect(rows[0]).toMatchObject({ list_type: 'have', child_id: 'kid-a', owner_id: 'owner-1' })
  })

  it('adds nothing when everything is already owned', () => {
    const owned = new Set(catalog.slice(1, 4).map((c) => itemKey(c.platform, c.title)))
    expect(
      cascadeContentRows({
        entry: catalog[0],
        contentsByBundle,
        catalogById: byId,
        ownedKeys: owned,
        ownerId: 'o',
        childId: null,
      })
    ).toEqual([])
  })
})
