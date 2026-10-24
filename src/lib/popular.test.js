import { describe, expect, it } from 'vitest'
import { effectiveScore, fallbackScore, popularityIndex, sortByPopularity } from './popular'

const row = (id, platform, title, sort_order, popularity_score = null) => ({
  id,
  platform,
  title,
  sort_order,
  popularity_score,
})

describe('popularityIndex', () => {
  it('ranks rows within their own platform by catalog order', () => {
    const catalog = [
      row('t2', 'tonies', 'Second Tonie', 50),
      row('h1', 'haba', 'First HABA', 3),
      row('t1', 'tonies', 'First Tonie', 10),
      row('h2', 'haba', 'Second HABA', 9000),
    ]
    const index = popularityIndex(catalog)
    expect(index.ranks.get('t1')).toBe(0)
    expect(index.ranks.get('t2')).toBe(1)
    expect(index.ranks.get('h1')).toBe(0)
    expect(index.sizes.get('tonies')).toBe(2)
    expect(index.sizes.get('haba')).toBe(2)
  })
})

describe('fallbackScore', () => {
  it('is the within-brand percentile of list order, weighted 0.40', () => {
    const catalog = [
      row('a', 'tonies', 'A', 1),
      row('b', 'tonies', 'B', 2),
      row('c', 'tonies', 'C', 3),
      row('d', 'tonies', 'D', 4),
    ]
    const index = popularityIndex(catalog)
    expect(fallbackScore(catalog[0], index)).toBeCloseTo(0.4)
    expect(fallbackScore(catalog[1], index)).toBeCloseTo(0.3)
    expect(fallbackScore(catalog[3], index)).toBeCloseTo(0.1)
  })
})

describe('sortByPopularity', () => {
  it('with no scores yet, interleaves brands — every #1 before any #2', () => {
    const catalog = [
      row('t1', 'tonies', 'Tonie One', 1),
      row('t2', 'tonies', 'Tonie Two', 2),
      row('t3', 'tonies', 'Tonie Three', 3),
      row('h1', 'haba', 'HABA One', 4),
      row('h2', 'haba', 'HABA Two', 5),
    ]
    const sorted = sortByPopularity(catalog, popularityIndex(catalog))
    // Fallback scores: t1 .40, h1 .40, t2 .267, h2 .20, t3 .133;
    // the .40 tie breaks by brand registry (tonies first).
    expect(sorted.map((r) => r.id)).toEqual(['t1', 'h1', 't2', 'h2', 't3'])
  })

  it('a stored unified score outranks the list-order fallback', () => {
    const catalog = [
      row('t1', 'tonies', 'Maker Favorite', 1),
      row('t2', 'tonies', 'Sleeper Hit', 2, 0.83),
      row('t3', 'tonies', 'Dud', 3, 0.05),
    ]
    const sorted = sortByPopularity(catalog, popularityIndex(catalog))
    expect(sorted.map((r) => r.id)).toEqual(['t2', 't1', 't3'])
    expect(effectiveScore(catalog[1], popularityIndex(catalog))).toBe(0.83)
  })

  it('does not bury a later-ingested brand: its #1 stands with the other #1s', () => {
    const catalog = [
      row('h1', 'haba', 'HABA One', 1),
      row('h2', 'haba', 'HABA Two', 2),
      row('e1', 'eeboo', 'eeBoo One', 9648),
    ]
    const sorted = sortByPopularity(catalog, popularityIndex(catalog))
    expect(sorted.map((r) => r.id)).toEqual(['h1', 'e1', 'h2'])
  })
})
