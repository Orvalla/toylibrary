// The Christmas launch announcement on the apex homepage (WS2,
// 2026-11-11). Shown while the America/Los_Angeles calendar date is
// within the window, inclusive at both ends; dismissible per browser.

export const BANNER_TIME_ZONE = 'America/Los_Angeles'
export const BANNER_START = '2026-11-27'
export const BANNER_END = '2026-12-20'
export const BANNER_DISMISS_KEY = 'tl:banner:christmas-2026:dismissed'

// The calendar date (YYYY-MM-DD) in Los Angeles at instant `now`.
export function laDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANNER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// True when `now` falls on a Los Angeles date inside the window.
// ISO dates compare correctly as strings.
export function isBannerWindow(now = new Date()) {
  const d = laDate(now)
  return d >= BANNER_START && d <= BANNER_END
}
