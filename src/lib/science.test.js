import { describe, expect, it } from 'vitest'
import { SCIENCE_PLATFORMS, isScienceRow } from './science'

describe('isScienceRow', () => {
  it('includes the kit-first science makers by platform', () => {
    for (const platform of ['thamesandkosmos', 'kiwico', 'elenco', 'learningresources', 'geomag', 'magtrax']) {
      expect(isScienceRow({ platform })).toBe(true)
    }
    expect(SCIENCE_PLATFORMS).toHaveLength(6)
  })

  it('splits Ravensburger: GraviTrax physics runs here, the rest not', () => {
    expect(isScienceRow({ platform: 'ravensburger', details: 'GraviTrax BASE · Starter set' })).toBe(true)
    expect(isScienceRow({ platform: 'ravensburger', details: 'GraviTrax PRO · Vertical' })).toBe(true)
    expect(isScienceRow({ platform: 'ravensburger', details: 'Puzzle · 1000 pieces' })).toBe(false)
    expect(isScienceRow({ platform: 'ravensburger', details: '' })).toBe(false)
    expect(isScienceRow({ platform: 'ravensburger' })).toBe(false)
  })

  it('leaves logic games, general education and robotics to their own shelves', () => {
    for (const platform of ['smartgames', 'thinkfun', 'lakeshore', 'sphero', 'arduino', 'osmo', 'tonies', 'books']) {
      expect(isScienceRow({ platform })).toBe(false)
    }
  })

  it('handles missing rows', () => {
    expect(isScienceRow(null)).toBe(false)
    expect(isScienceRow(undefined)).toBe(false)
    expect(isScienceRow({})).toBe(false)
  })
})
