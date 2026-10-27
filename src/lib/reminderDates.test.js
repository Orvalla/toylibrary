import { describe, expect, it } from 'vitest'
import {
  esc,
  isSendableToday,
  nextOccurrence,
  spreadDaysFor,
  spreadSlot,
  windowDaysFor,
  MIN_LEAD_DAYS,
} from '../../supabase/functions/send-occasion-reminders/dates.js'

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d))
const ymd = (date) => [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]

describe('nextOccurrence (reminder function)', () => {
  it('returns today when the occasion is today, wraps into next year when past', () => {
    expect(ymd(nextOccurrence(10, 26, utc(2026, 10, 26)))).toEqual([2026, 10, 26])
    expect(ymd(nextOccurrence(1, 5, utc(2026, 12, 20)))).toEqual([2027, 1, 5])
  })

  it('keeps Feb 29 in leap years and clamps to Feb 28 otherwise (matches SQL + client)', () => {
    expect(ymd(nextOccurrence(2, 29, utc(2028, 1, 10)))).toEqual([2028, 2, 29])
    expect(ymd(nextOccurrence(2, 29, utc(2027, 1, 10)))).toEqual([2027, 2, 28])
    // After Feb 28 in a non-leap year the next one is the following Feb 28…
    expect(ymd(nextOccurrence(2, 29, utc(2027, 3, 1)))).toEqual([2028, 2, 29])
    // …and after a leap day it clamps again.
    expect(ymd(nextOccurrence(2, 29, utc(2028, 3, 1)))).toEqual([2029, 2, 28])
  })
})

describe('send spread', () => {
  it('floors at 4 slot days and widens by one per 100 senders past 400', () => {
    expect(spreadDaysFor(0)).toBe(4)
    expect(spreadDaysFor(400)).toBe(4)
    expect(spreadDaysFor(401)).toBe(5)
    expect(spreadDaysFor(10_000)).toBe(14)
  })

  it('assigns every family a stable slot inside the spread', () => {
    for (const spread of [4, 5, 14]) {
      for (let i = 0; i < 200; i++) {
        const id = `0b6c1e5a-0000-4000-8000-${String(i).padStart(12, '0')}`
        const slot = spreadSlot(id, spread)
        expect(slot).toBeGreaterThanOrEqual(0)
        expect(slot).toBeLessThan(spread)
        expect(spreadSlot(id, spread)).toBe(slot)
      }
    }
  })

  // The product promise: with the job running every day, nobody's
  // first send is less than MIN_LEAD_DAYS before the occasion.
  it('never sends a family later than MIN_LEAD_DAYS out when the job runs daily', () => {
    for (const senders of [10, 450, 1500]) {
      const spread = spreadDaysFor(senders)
      const windowDays = windowDaysFor(spread)
      for (let slot = 0; slot < spread; slot++) {
        let firstSendDaysAway = null
        for (let daysAway = windowDays; daysAway >= 0; daysAway--) {
          if (isSendableToday(daysAway, windowDays, slot)) {
            firstSendDaysAway = daysAway
            break
          }
        }
        expect(firstSendDaysAway).toBeGreaterThanOrEqual(MIN_LEAD_DAYS)
      }
    }
  })
})

describe('esc', () => {
  it('neutralises markup in parent-controlled strings', () => {
    expect(esc('<a href="https://evil.test">Sam</a> & co')).toBe(
      '&lt;a href=&quot;https://evil.test&quot;&gt;Sam&lt;/a&gt; &amp; co',
    )
    expect(esc("O'Brien")).toBe('O&#39;Brien')
    expect(esc(null)).toBe('')
  })
})
