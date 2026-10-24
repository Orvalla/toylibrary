import { createRef } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Turnstile from './Turnstile'

// A fake Turnstile API: render captures its options so the test
// can fire the success callback the way Cloudflare would.
const fakeApi = {
  render: vi.fn((el, opts) => {
    fakeApi.lastOpts = opts
    return 'widget-1'
  }),
  reset: vi.fn(),
  remove: vi.fn(),
}

vi.mock('../lib/captcha', () => ({
  TURNSTILE_SITE_KEY: 'test-site-key',
  captchaConfigured: () => true,
  loadTurnstile: () => Promise.resolve(fakeApi),
}))

describe('Turnstile component', () => {
  it('renders the widget with the site key and hands out single-use tokens', async () => {
    const ref = createRef()
    render(<Turnstile ref={ref} />)
    await waitFor(() => expect(fakeApi.render).toHaveBeenCalled())
    expect(fakeApi.lastOpts.sitekey).toBe('test-site-key')
    // The widget is pinned to the light theme: Cloudflare's
    // default ("auto") follows the visitor's device color
    // scheme and renders a black box in our light forms on
    // dark-mode phones.
    expect(fakeApi.lastOpts.theme).toBe('light')

    // No token yet: consume() waits for the check to pass.
    const pending = ref.current.consume()
    fakeApi.lastOpts.callback('tok-1')
    await expect(pending).resolves.toBe('tok-1')

    // The next token must be a fresh one (tokens are single-use):
    // passing the check again yields tok-2, not tok-1 twice.
    const second = ref.current.consume()
    fakeApi.lastOpts.callback('tok-2')
    await expect(second).resolves.toBe('tok-2')
  })
})

describe('Turnstile without a site key', () => {
  it('renders nothing and consume resolves empty', async () => {
    vi.resetModules()
    vi.doMock('../lib/captcha', () => ({
      TURNSTILE_SITE_KEY: '',
      captchaConfigured: () => false,
      loadTurnstile: () => Promise.reject(new Error('should not load')),
    }))
    const { default: FreshTurnstile } = await import('./Turnstile')
    const ref = createRef()
    const { container } = render(<FreshTurnstile ref={ref} />)
    expect(container.firstChild).toBeNull()
    await expect(ref.current.consume()).resolves.toBe('')
    vi.doUnmock('../lib/captcha')
  })
})
