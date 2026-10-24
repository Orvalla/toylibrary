import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY, captchaConfigured, loadTurnstile } from '../lib/captcha'

// The Turnstile widget for one auth form.
//
// Parents hold a ref and call `await ref.current.consume()` inside
// their submit handler, right before the Supabase auth call, then
// pass the returned string as options.captchaToken. Tokens are
// single-use, so consume() hands each one out exactly once and
// resets the widget to mint the next; a form that calls two auth
// endpoints in a row (Settings change-password) just consumes
// twice. When no site key is configured, consume() resolves ''
// and the form behaves exactly as it did before Turnstile.
//
// A failed check is loud, not silent: if the script cannot load
// (ad blockers commonly block challenges.cloudflare.com), the
// form shows a note telling the visitor what to do.
const Turnstile = forwardRef(function Turnstile(_props, ref) {
  const boxRef = useRef(null)
  const apiRef = useRef(null)
  const widgetIdRef = useRef(null)
  const tokenRef = useRef('')
  const waitersRef = useRef([])
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!captchaConfigured()) return undefined
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !boxRef.current) return
        apiRef.current = turnstile
        widgetIdRef.current = turnstile.render(boxRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          // Cloudflare's default theme is "auto", which follows
          // the visitor's phone/browser color scheme — on a
          // dark-mode phone the widget renders black inside our
          // light lavender forms. The site has no dark theme,
          // so pin the widget to light to match the page.
          theme: 'light',
          callback: (token) => {
            // A token goes to exactly one consumer: if a consume()
            // is already waiting, hand it over directly; only park
            // it when nobody is waiting yet.
            const waiter = waitersRef.current.shift()
            if (waiter) waiter.resolve(token)
            else tokenRef.current = token
          },
          'expired-callback': () => {
            tokenRef.current = ''
          },
          'error-callback': () => {
            tokenRef.current = ''
            const waiters = waitersRef.current.splice(0)
            waiters.forEach((w) => w.reject(new Error('captcha-error')))
          },
        })
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
      if (apiRef.current && widgetIdRef.current != null) {
        try {
          apiRef.current.remove(widgetIdRef.current)
        } catch {
          // Widget already gone; nothing to clean up.
        }
      }
      widgetIdRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    // Resolve with a fresh, unconsumed token. If the widget has
    // one waiting, take it and reset for the next call; otherwise
    // wait for the visitor to pass the check (30s timeout).
    consume() {
      if (!captchaConfigured()) return Promise.resolve('')
      if (tokenRef.current) {
        const token = tokenRef.current
        tokenRef.current = ''
        apiRef.current?.reset(widgetIdRef.current)
        return Promise.resolve(token)
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject }
        waitersRef.current.push(waiter)
        setTimeout(() => {
          const i = waitersRef.current.indexOf(waiter)
          if (i >= 0) {
            waitersRef.current.splice(i, 1)
            reject(new Error('captcha-timeout'))
          }
        }, 30000)
      })
    },
  }))

  if (!captchaConfigured()) return null
  return (
    <div className="turnstile-box">
      <div ref={boxRef} />
      {loadError && (
        <p className="error">
          The human check couldn't load. If you use an ad blocker, please allow
          challenges.cloudflare.com for this site, then reload the page.
        </p>
      )}
    </div>
  )
})

export default Turnstile
