import { describe, expect, it } from 'vitest'
import { STEAM_PLATFORMS, isSteamRow } from './steam'

describe('isSteamRow', () => {
  it('includes the electronics and robotics makers', () => {
    for (const platform of ['elenco', 'arduino', 'ozobot', 'circuitmess', 'cubelets', 'engino']) {
      expect(isSteamRow({ platform })).toBe(true)
    }
  })

  it('includes the established science and logic lines', () => {
    for (const platform of ['thamesandkosmos', 'kiwico', 'osmo', 'smartgames', 'thinkfun']) {
      expect(isSteamRow({ platform })).toBe(true)
    }
  })

  it('leaves traditional art and audio content to their own zones', () => {
    for (const platform of ['crayola', 'djeco', 'tonies', 'yoto', 'books']) {
      expect(isSteamRow({ platform })).toBe(false)
    }
  })

  it('handles missing rows and has no duplicate platforms', () => {
    expect(isSteamRow(null)).toBe(false)
    expect(isSteamRow({})).toBe(false)
    expect(new Set(STEAM_PLATFORMS).size).toBe(STEAM_PLATFORMS.length)
  })
})
