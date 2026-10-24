import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}))

import { sessionId, visitorId } from './analytics'

describe('analytics ids', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('visitor id is stable across calls', () => {
    const a = visitorId()
    expect(a).toBeTruthy()
    expect(visitorId()).toBe(a)
  })

  it('session id persists within the idle window', () => {
    const t0 = 1_000_000_000_000
    const a = sessionId(t0)
    expect(sessionId(t0 + 5 * 60 * 1000)).toBe(a)
  })

  it('session id rolls over after 30 idle minutes', () => {
    const t0 = 1_000_000_000_000
    const a = sessionId(t0)
    const b = sessionId(t0 + 31 * 60 * 1000)
    expect(b).not.toBe(a)
  })
})
