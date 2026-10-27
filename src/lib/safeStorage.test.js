import { describe, expect, it } from 'vitest'
import { safeGet, safeRemove, safeSet } from './safeStorage'

const throwing = {
  getItem() { throw new Error('SecurityError') },
  setItem() { throw new Error('QuotaExceededError') },
  removeItem() { throw new Error('SecurityError') },
}

const memory = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  }
}

describe('safeStorage', () => {
  it('reads, writes and removes when storage works', () => {
    const s = memory()
    expect(safeSet('k', 'v', s)).toBe(true)
    expect(safeGet('k', s)).toBe('v')
    safeRemove('k', s)
    expect(safeGet('k', s)).toBeNull()
  })

  it('never throws when storage is blocked', () => {
    expect(safeGet('k', throwing)).toBeNull()
    expect(safeSet('k', 'v', throwing)).toBe(false)
    expect(() => safeRemove('k', throwing)).not.toThrow()
  })

  it('treats missing storage as empty', () => {
    expect(safeGet('k', undefined)).toBeNull()
  })
})
