// The Ko-fi donation page (live since 2026-10-25). Toy Library
// is free to use; families can donate via Ko-fi, which processes
// through the owner's Stripe, and the payouts cover the server
// charges (see the Support section in Settings and the footer
// link). Ko-fi takes no platform fee on one-time donations.
//
// Every donate element renders only when DONATE_URL is
// non-empty, so clearing this line hides them site-wide.
export const DONATE_URL = 'https://ko-fi.com/toylibrary'

export function donateUrl() {
  return DONATE_URL.trim()
}
