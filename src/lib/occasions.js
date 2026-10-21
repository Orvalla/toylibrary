// Occasion dates + the claim-expiry rule, in pure JS.
//
// Mirrors the SQL in supabase/migrations/0009_occasions_and_claim_expiry.sql:
// occasions (birthdays, holidays) recur every year on a month/day, Feb 29
// clamps to Feb 28 in non-leap years, and a wishlist claim holds until
// the child's next occasion (+ 1 day) when that occasion is within
// 90 days — otherwise it holds for 60 days. Family items (no child, so
// no occasions) always take the 60-day branch.

const MS_PER_DAY = 86_400_000
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function clampDay(year, month, day) {
  // Day 0 of the following month is the last day of `month` (1-based).
  return Math.min(day, new Date(year, month, 0).getDate())
}

// The next date (today or later) with the given month/day.
export function nextOccurrence(month, day, from = new Date()) {
  const start = startOfDay(from)
  const year = start.getFullYear()
  let candidate = new Date(year, month - 1, clampDay(year, month, day))
  if (candidate < start) {
    candidate = new Date(year + 1, month - 1, clampDay(year + 1, month, day))
  }
  return candidate
}

// Whole days from `from` to `date` (both read at local midnight, so DST
// transitions don't skew the count).
export function daysUntil(date, from = new Date()) {
  return Math.round((startOfDay(date) - startOfDay(from)) / MS_PER_DAY)
}

// The soonest of a child's occasions: { ...occasion, date, daysUntil },
// or null when the child has none.
export function nearestOccasion(occasions, from = new Date()) {
  if (!occasions?.length) return null
  let best = null
  for (const occ of occasions) {
    const date = nextOccurrence(occ.month, occ.day, from)
    if (!best || date < best.date) {
      best = { ...occ, date, daysUntil: daysUntil(date, from) }
    }
  }
  return best
}

// When a claim made `from` today stops holding: the child's nearest
// occasion + 1 day if it's within 90 days, else from + 60 days.
export function claimExpiryFor(occasions, from = new Date()) {
  const nearest = nearestOccasion(occasions, from)
  if (nearest && nearest.daysUntil <= 90) {
    const d = new Date(nearest.date)
    d.setDate(d.getDate() + 1)
    return d
  }
  const d = startOfDay(from)
  d.setDate(d.getDate() + 60)
  return d
}

export function formatMonthDay(month, day) {
  return `${MONTHS_SHORT[month - 1]} ${day}`
}

// Formats the date part of an ISO date / timestamp string ('2026-11-03'
// or the timestamptz the RPC returns) as 'Nov 3', in the date's own
// terms — no timezone shifting.
export function formatISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  return formatMonthDay(Number(m[2]), Number(m[3]))
}

// "Alex's birthday" from { childName: 'Alex', label: 'Birthday' }.
// Without a child name it's just the label ("Christmas").
export function occasionTitle(occ) {
  const name = occ?.childName ?? occ?.child_name ?? occ?.name
  const label = occ?.label ?? ''
  if (!name) return label
  if (!label) return name
  return `${name}'s ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

export function occasionWhen(days) {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

// "Alex's birthday · Nov 3 · in 13 days"
// Accepts an occasion carrying a computed `date` (Date or ISO string)
// or raw { month, day }, and a precomputed daysUntil/days_until
// (the share RPC sends both) or computes them from `from`.
export function formatOccasionLine(occ, from = new Date()) {
  let date = null
  let days = occ?.daysUntil ?? occ?.days_until
  if (occ?.date instanceof Date) {
    date = occ.date
  } else if (typeof occ?.date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(occ.date)
    if (m) date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  } else if (occ?.month && occ?.day) {
    date = nextOccurrence(occ.month, occ.day, from)
  }
  if (days == null && date) days = daysUntil(date, from)
  const parts = [occasionTitle(occ)]
  if (date) parts.push(formatMonthDay(date.getMonth() + 1, date.getDate()))
  if (days != null) parts.push(occasionWhen(days))
  return parts.filter(Boolean).join(' · ')
}
