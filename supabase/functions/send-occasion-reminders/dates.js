// Pure date / send-spread helpers for send-occasion-reminders.
// Kept free of Deno and network imports so vitest can cover them
// (src/lib/reminderDates.test.js) — the reminder pipeline had no
// tests at all before this file existed.

// Every reminder must land at least this many days before the occasion.
export const MIN_LEAD_DAYS = 14
// Spread shape: BASE_SPREAD_DAYS slot days ending exactly MIN_LEAD_DAYS
// before the occasion; one extra slot day (and one more day of window)
// per FAMILIES_PER_DAY senders beyond the base, capped at MAX_SPREAD_DAYS.
export const BASE_SPREAD_DAYS = 4
export const MAX_SPREAD_DAYS = 14
export const FAMILIES_PER_DAY = 100

// The last valid day of a month (month is 1–12).
function lastDayOf(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Next occurrence of a month/day on or after `from` (calendar dates
// handled as UTC midnights to keep it timezone-simple). Feb 29 clamps
// to Feb 28 only in years without a Feb 29 — matching the SQL
// next_occasion_date (migration 0009) and src/lib/occasions.js.
export function nextOccurrence(month, day, from) {
  const y = from.getUTCFullYear()
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const inYear = (year) => new Date(Date.UTC(year, month - 1, Math.min(day, lastDayOf(year, month))))
  let d = inYear(y)
  if (d.getTime() < start) d = inYear(y + 1)
  return d
}

// A family's stable slot in the send spread: FNV-1a over the profile
// id, so the assignment is deterministic across runs and needs no
// storage.
export function spreadSlot(id, spreadDays) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % spreadDays
}

// Adaptive spread: one slot day per FAMILIES_PER_DAY reminder-enabled
// families, floored at BASE_SPREAD_DAYS and capped at MAX_SPREAD_DAYS.
export function spreadDaysFor(senderCount) {
  return Math.min(MAX_SPREAD_DAYS, Math.max(BASE_SPREAD_DAYS, Math.ceil(senderCount / FAMILIES_PER_DAY)))
}

// The window is the spread plus the fixed minimum lead, so the last
// slot always fires exactly MIN_LEAD_DAYS before the occasion.
export function windowDaysFor(spreadDays) {
  return MIN_LEAD_DAYS + spreadDays - 1
}

// May a family in `slot` be mailed today for an occasion `daysAway` out?
export function isSendableToday(daysAway, windowDays, slot) {
  return daysAway <= windowDays - slot
}

// Plain-text -> HTML-safe. Names, labels and display names are
// parent-controlled strings that end up in emails to third parties.
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
