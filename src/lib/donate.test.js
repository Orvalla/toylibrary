import { describe, expect, it } from 'vitest'
import { DONATE_URL, donateUrl } from './donate'

describe('donateUrl', () => {
  it('mirrors the configured link, trimmed', () => {
    expect(donateUrl()).toBe(DONATE_URL.trim())
    expect(typeof donateUrl()).toBe('string')
  })

  it('is either empty (donate UI hidden) or an https link', () => {
    if (donateUrl() !== '') {
      expect(donateUrl()).toMatch(/^https:\/\//)
    }
  })
})
