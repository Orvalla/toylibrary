// Cloudflare Turnstile — the bot check on the auth forms.
//
// The SITE key is public by design (it ships in every visitor's
// page), so it lives here as a constant rather than a build-time
// env var: one less thing a deploy can silently drop. The SECRET
// key never touches this repo — it goes straight into the
// Supabase project's Auth settings, where the auth server uses
// it to verify the tokens this widget produces.
//
// While the site key is empty the widget renders nothing and
// forms submit without a token, exactly as before. The server
// side must only be switched on (Auth → captcha settings) AFTER
// a build carrying the real key is live, or every login breaks.

export const TURNSTILE_SITE_KEY = '0x4AAAAAAFjdeLKnTVPYkhrg'

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export function captchaConfigured() {
  return TURNSTILE_SITE_KEY.length > 0
}

let scriptPromise = null

// Load the Turnstile script once and resolve with window.turnstile.
// Safe to call from every widget instance; later calls share the
// first load. Rejects if the script cannot load (offline, blocker),
// so the widget can surface a visible message instead of a form
// that silently never submits.
export function loadTurnstile() {
  if (typeof window !== 'undefined' && window.turnstile) {
    return Promise.resolve(window.turnstile)
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile)
        else reject(new Error('Turnstile loaded without an API object'))
      }
      script.onerror = () => reject(new Error('Turnstile script failed to load'))
      document.head.appendChild(script)
    })
    // A failed load should not poison later attempts (e.g. the
    // user disables their blocker and retries).
    scriptPromise.catch(() => {
      scriptPromise = null
    })
  }
  return scriptPromise
}
