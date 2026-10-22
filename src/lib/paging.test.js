import { describe, expect, it } from 'vitest'
import { PAGE_SIZES, clampPage, pageNumbers, pageSlice } from './paging'

describe('pageSlice', () => {
  const items = Array.from({ length: 100 }, (_, i) => i + 1)
  it('slices the requested page and reports the counts', () => {
    const p2 = pageSlice(items, 2, 24)
    expect(p2.pageItems).toHaveLength(24)
    expect(p2.pageItems[0]).toBe(25)
    expect(p2.page).toBe(2)
    expect(p2.pageCount).toBe(5)
    expect(p2.total).toBe(100)
  })
  it('the last page holds the remainder', () => {
    expect(pageSlice(items, 5, 24).pageItems).toEqual([97, 98, 99, 100])
  })
  it('clamps an out-of-range page instead of showing nothing', () => {
    expect(pageSlice(items, 99, 24).page).toBe(5)
    expect(pageSlice(items, 0, 24).page).toBe(1)
    expect(pageSlice([], 3, 24)).toEqual({ pageItems: [], page: 1, pageCount: 1, total: 0 })
  })
  it('offers sensible page sizes', () => {
    expect(PAGE_SIZES).toEqual([24, 48, 96])
  })
})

describe('clampPage', () => {
  it('keeps the page within 1..pageCount', () => {
    expect(clampPage(3, 100, 24)).toBe(3)
    expect(clampPage(6, 100, 24)).toBe(5)
    expect(clampPage(-2, 100, 24)).toBe(1)
  })
})

describe('pageNumbers', () => {
  it('lists everything for a short run', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5])
  })
  it('elides the middle of a long run, keeping edges and neighbours', () => {
    expect(pageNumbers(12, 40)).toEqual([1, 2, '…', 11, 12, 13, '…', 39, 40])
    expect(pageNumbers(1, 40)).toEqual([1, 2, '…', 39, 40])
    expect(pageNumbers(40, 40)).toEqual([1, 2, '…', 39, 40])
    expect(pageNumbers(4, 40)).toEqual([1, 2, 3, 4, 5, '…', 39, 40])
  })
})
