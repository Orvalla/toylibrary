import { describe, expect, it } from 'vitest'
import { addToCart, cartEntryFor, cartHas, loadCart, removeFromCart, saveCart } from './cart'

const item = {
  id: 'item-1',
  title: 'Blippi Tonie',
  platform: 'tonies',
  details: 'Tonie figure',
  image_url: 'https://example.com/blippi.jpg',
  asin: 'B0EXAMPLE1',
  child_name: 'Sam',
  claimed: false,
}

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  }
}

describe('cart entries', () => {
  it('snapshots only the fields the drawer renders', () => {
    expect(cartEntryFor(item)).toEqual({
      id: 'item-1',
      title: 'Blippi Tonie',
      platform: 'tonies',
      details: 'Tonie figure',
      image_url: 'https://example.com/blippi.jpg',
      asin: 'B0EXAMPLE1',
      child_name: 'Sam',
    })
  })

  it('adds an item once — a second add is a no-op', () => {
    const once = addToCart([], item)
    const twice = addToCart(once, item)
    expect(twice).toHaveLength(1)
    expect(cartHas(twice, 'item-1')).toBe(true)
  })

  it('removes by id and leaves everything else', () => {
    const entries = addToCart(addToCart([], item), { ...item, id: 'item-2', title: 'Other' })
    const after = removeFromCart(entries, 'item-1')
    expect(after.map((e) => e.id)).toEqual(['item-2'])
    expect(cartHas(after, 'item-1')).toBe(false)
  })
})

describe('cart storage', () => {
  it('round-trips through storage under a per-slug key', () => {
    const storage = memoryStorage()
    saveCart('fam-x', addToCart([], item), storage)
    expect(loadCart('fam-x', storage)).toHaveLength(1)
    expect(loadCart('someone-else', storage)).toEqual([])
  })

  it('treats missing or corrupt storage as an empty cart', () => {
    const storage = memoryStorage()
    expect(loadCart('fam-x', storage)).toEqual([])
    storage.setItem('giftcart:fam-x', '{not json')
    expect(loadCart('fam-x', storage)).toEqual([])
    storage.setItem('giftcart:fam-x', JSON.stringify([{ no_id: true }, null, 'junk']))
    expect(loadCart('fam-x', storage)).toEqual([])
  })
})
