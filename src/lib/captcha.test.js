import { afterEach, describe, expect, it, vi } from 'vitest'

// The shipped site key is empty until the Cloudflare widget
// exists; these tests pin the unconfigured behavior the auth
// forms rely on (submit without a token, exactly as before) and
// the one-time script load.
describe('captcha lib', () => {
  afterEach(() => {
    delete window.turnstile
    document.head.innerHTML = ''
    vi.resetModules()
  })

  it('reports unconfigured while the site key is empty', async () => {
    const { TURNSTILE_SITE_KEY, captchaConfigured } = await import('./captcha')
    expect(TURNSTILE_SITE_KEY).toBe('')
    expect(captchaConfigured()).toBe(false)
  })

  it('resolves immediately when the API object is already present', async () => {
    window.turnstile = { render: () => 'w' }
    const { loadTurnstile } = await import('./captcha')
    await expect(loadTurnstile()).resolves.toBe(window.turnstile)
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('injects the script once and resolves when it loads', async () => {
    const { loadTurnstile } = await import('./captcha')
    const p1 = loadTurnstile()
    const p2 = loadTurnstile()
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toContain('challenges.cloudflare.com/turnstile')
    window.turnstile = { render: () => 'w' }
    scripts[0].dispatchEvent(new Event('load'))
    await expect(p1).resolves.toBe(window.turnstile)
    await expect(p2).resolves.toBe(window.turnstile)
  })
})
