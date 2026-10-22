import { describe, expect, it } from 'vitest'
import { giftMessage, instagramLink, messengerLink, normalizeHandle } from './giftCircle'

describe('normalizeHandle', () => {
  it('passes a bare handle through', () => {
    expect(normalizeHandle('aunt.jen')).toBe('aunt.jen')
    expect(normalizeHandle('UncleBob_2')).toBe('UncleBob_2')
  })

  it('strips a leading @', () => {
    expect(normalizeHandle('@aunt.jen')).toBe('aunt.jen')
  })

  it('extracts the handle from profile URLs', () => {
    expect(normalizeHandle('https://www.instagram.com/aunt.jen/')).toBe('aunt.jen')
    expect(normalizeHandle('instagram.com/aunt.jen?igsh=xyz')).toBe('aunt.jen')
    expect(normalizeHandle('https://www.facebook.com/aunt.jen')).toBe('aunt.jen')
    expect(normalizeHandle('https://m.me/auntjen')).toBe('auntjen')
    expect(normalizeHandle('https://ig.me/m/auntjen')).toBe('auntjen')
  })

  it('rejects things that are not handles', () => {
    expect(normalizeHandle('')).toBe('')
    expect(normalizeHandle(null)).toBe('')
    expect(normalizeHandle('Aunt Jen')).toBe('')
    expect(normalizeHandle('jen@example.com')).toBe('')
  })
})

describe('chat links', () => {
  it('builds an m.me link from a facebook username', () => {
    expect(messengerLink('auntjen')).toBe('https://m.me/auntjen')
    expect(messengerLink('https://www.facebook.com/aunt.jen')).toBe('https://m.me/aunt.jen')
  })

  it('builds an instagram profile link', () => {
    expect(instagramLink('@aunt.jen')).toBe('https://instagram.com/aunt.jen')
  })

  it('returns null without a usable handle', () => {
    expect(messengerLink('')).toBeNull()
    expect(instagramLink('not a handle')).toBeNull()
  })
})

describe('giftMessage', () => {
  it('greets the relative, names the sender and carries the link', () => {
    const msg = giftMessage({
      relativeName: 'Aunt Jen',
      ownerName: 'Morgan',
      kidsLabel: 'Sam',
      link: 'https://x.test/s/sam',
    })
    expect(msg).toContain('Hi Aunt Jen!')
    expect(msg).toContain("It's Morgan.")
    expect(msg).toContain("Sam's wishlist")
    expect(msg).toContain('https://x.test/s/sam')
  })

  it('still reads fine without names', () => {
    const msg = giftMessage({ kidsLabel: 'Sam and Sam', link: 'https://x.test/s/f' })
    expect(msg.startsWith('Hi!')).toBe(true)
    expect(msg).toContain("Sam and Sam's wishlist")
  })
})
