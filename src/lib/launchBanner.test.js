import { describe, expect, it } from 'vitest'
import { BANNER_END, BANNER_START, isBannerWindow, laDate } from './launchBanner'

// WS2 banner date gate. Boundaries are Los Angeles wall-clock times;
// late Nov / Dec is PST (UTC-8), so 00:00 PT = 08:00Z.
describe('launch banner date gate (America/Los_Angeles)', () => {
  it('window is Nov 27 – Dec 20 2026 inclusive', () => {
    expect(BANNER_START).toBe('2026-11-27')
    expect(BANNER_END).toBe('2026-12-20')
  })

  it.each([
    ['Nov 26 23:59 PT', '2026-11-27T07:59:00Z', false],
    ['Nov 26 23:59:59.999 PT', '2026-11-27T07:59:59.999Z', false],
    ['Nov 27 00:00 PT', '2026-11-27T08:00:00Z', true],
    ['Dec 20 00:00 PT', '2026-12-20T08:00:00Z', true],
    ['Dec 20 12:00 PT', '2026-12-20T20:00:00Z', true],
    ['Dec 20 23:59 PT', '2026-12-21T07:59:00Z', true],
    ['Dec 21 00:00 PT', '2026-12-21T08:00:00Z', false],
    ['Dec 21 12:00 PT', '2026-12-21T20:00:00Z', false],
    ['launch-week midday', '2026-12-01T20:00:00Z', true],
    ['tonight (brief written)', '2026-11-12T05:37:00Z', false],
    ['same dates next year', '2027-12-01T20:00:00Z', false],
  ])('%s -> %s', (_label, iso, shown) => {
    expect(isBannerWindow(new Date(iso))).toBe(shown)
  })

  it('uses the LA date, not UTC: Nov 27 03:00Z is still Nov 26 in LA', () => {
    expect(laDate(new Date('2026-11-27T03:00:00Z'))).toBe('2026-11-26')
    expect(isBannerWindow(new Date('2026-11-27T03:00:00Z'))).toBe(false)
  })
})
