import { describe, expect, it } from 'vitest'
import {
  claimExpiryFor,
  daysUntil,
  formatISODate,
  formatOccasionLine,
  nearestOccasion,
  nextOccurrence,
} from './occasions'

const d = (y, m, day) => new Date(y, m - 1, day)
const ymd = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]

describe('nextOccurrence', () => {
  it('returns today when the occasion is today', () => {
    expect(ymd(nextOccurrence(11, 3, d(2026, 10, 21)))).toEqual([2026, 11, 3])
    expect(ymd(nextOccurrence(10, 21, d(2026, 10, 21)))).toEqual([2026, 10, 21])
  })

  it('wraps into next year once the date has passed (Dec → Jan)', () => {
    expect(ymd(nextOccurrence(1, 5, d(2026, 12, 20)))).toEqual([2027, 1, 5])
    expect(ymd(nextOccurrence(11, 3, d(2026, 12, 26)))).toEqual([2027, 11, 3])
  })

  it('clamps Feb 29 to Feb 28 in non-leap years, keeps it in leap years', () => {
    expect(ymd(nextOccurrence(2, 29, d(2025, 1, 10)))).toEqual([2025, 2, 28])
    expect(ymd(nextOccurrence(2, 29, d(2024, 1, 10)))).toEqual([2024, 2, 29])
    // Even looking from after February in a non-leap year, the clamp
    // applies to the following year too.
    expect(ymd(nextOccurrence(2, 29, d(2025, 3, 1)))).toEqual([2026, 2, 28])
  })
})

describe('daysUntil', () => {
  it('counts whole days, 0 for the same day', () => {
    expect(daysUntil(d(2026, 11, 3), d(2026, 10, 21))).toBe(13)
    expect(daysUntil(d(2026, 10, 21), d(2026, 10, 21))).toBe(0)
    expect(daysUntil(d(2027, 1, 5), d(2026, 12, 20))).toBe(16)
  })
})

describe('nearestOccasion', () => {
  const sams = [
    { label: 'Christmas', month: 12, day: 25 },
    { label: 'Birthday', month: 11, day: 3 },
  ]

  it('picks the soonest of several occasions', () => {
    const best = nearestOccasion(sams, d(2026, 10, 21))
    expect(best.label).toBe('Birthday')
    expect(ymd(best.date)).toEqual([2026, 11, 3])
    expect(best.daysUntil).toBe(13)
  })

  it('wraps the year when choosing (all dates passed → next year)', () => {
    const best = nearestOccasion(sams, d(2026, 12, 26))
    expect(best.label).toBe('Birthday')
    expect(ymd(best.date)).toEqual([2027, 11, 3])
  })

  it('returns null with no occasions', () => {
    expect(nearestOccasion([], d(2026, 10, 21))).toBeNull()
    expect(nearestOccasion(null, d(2026, 10, 21))).toBeNull()
  })
})

describe('claimExpiryFor', () => {
  it('holds until the day after a near occasion (within 90 days)', () => {
    const exp = claimExpiryFor([{ label: 'Birthday', month: 11, day: 3 }], d(2026, 10, 21))
    expect(ymd(exp)).toEqual([2026, 11, 4])
  })

  it('treats exactly 90 days away as within the window', () => {
    // Aug 5 → Nov 3 is exactly 90 days.
    const exp = claimExpiryFor([{ label: 'Birthday', month: 11, day: 3 }], d(2026, 8, 5))
    expect(ymd(exp)).toEqual([2026, 11, 4])
  })

  it('falls back to 60 days when the occasion is further out', () => {
    const exp = claimExpiryFor([{ label: 'Christmas', month: 12, day: 25 }], d(2026, 1, 1))
    expect(ymd(exp)).toEqual([2026, 3, 2])
  })

  it('falls back to 60 days with no occasions (family items)', () => {
    expect(ymd(claimExpiryFor([], d(2026, 10, 21)))).toEqual([2026, 12, 20])
  })
})

describe('formatOccasionLine', () => {
  const sam = { childName: 'Sam', label: 'Birthday', month: 11, day: 3 }

  it('formats "Name\'s label · Mon D · in N days"', () => {
    expect(formatOccasionLine(sam, d(2026, 10, 21))).toBe("Sam's birthday · Nov 3 · in 13 days")
  })

  it('says today and tomorrow instead of counts', () => {
    expect(formatOccasionLine(sam, d(2026, 11, 3))).toBe("Sam's birthday · Nov 3 · today")
    expect(formatOccasionLine(sam, d(2026, 11, 2))).toBe("Sam's birthday · Nov 3 · tomorrow")
  })

  it('works from the share RPC shape (ISO date + days_until)', () => {
    const rpc = { child_name: 'Sam', label: 'Birthday', date: '2026-11-03', days_until: 13 }
    expect(formatOccasionLine(rpc, d(2026, 10, 21))).toBe("Sam's birthday · Nov 3 · in 13 days")
  })

  it('omits the name when there is no child (family occasion)', () => {
    expect(formatOccasionLine({ label: 'Christmas', month: 12, day: 25 }, d(2026, 12, 20))).toBe(
      'Christmas · Dec 25 · in 5 days'
    )
  })
})

describe('formatISODate', () => {
  it('formats ISO dates and timestamps without timezone shifting', () => {
    expect(formatISODate('2026-12-26')).toBe('Dec 26')
    expect(formatISODate('2026-12-26T00:00:00+00:00')).toBe('Dec 26')
    expect(formatISODate('')).toBe('')
  })
})
