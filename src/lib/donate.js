// The PayPal donation link. Toy Library is free to use; the
// owner runs a PayPal that families can donate to, and all
// server charges come out of it (see the Support section in
// Settings and the footer link).
//
// DONATE_URL stays empty until the owner supplies the real
// PayPal link — every donate element renders only when this
// is non-empty, so the live site never shows a dead link.
// Setting the link is the whole go-live: one line, one deploy.
export const DONATE_URL = ''

export function donateUrl() {
  return DONATE_URL.trim()
}
