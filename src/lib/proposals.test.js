import { describe, expect, it } from 'vitest'
import {
  addProposalToken,
  loadProposalTokens,
  priceLabel,
  proposalStatusLabel,
} from './proposals'

// The suggester-side token store (src/lib/proposals.js): the
// only client state a proposal needs. A token proves "this
// browser suggested that" — losing or corrupting it must
// degrade to "no suggestions here", never crash the page.
function fakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  }
}

describe('proposal token storage', () => {
  it('round-trips tokens per slug', () => {
    const s = fakeStorage()
    expect(loadProposalTokens('fam-x', s)).toEqual([])
    addProposalToken('fam-x', { id: 'p1', token: 'tok-1' }, s)
    addProposalToken('fam-x', { id: 'p2', token: 'tok-2' }, s)
    expect(loadProposalTokens('fam-x', s)).toEqual([
      { id: 'p2', token: 'tok-2' },
      { id: 'p1', token: 'tok-1' },
    ])
    expect(loadProposalTokens('other-slug', s)).toEqual([])
  })

  it('replaces a duplicate id instead of stacking', () => {
    const s = fakeStorage()
    addProposalToken('fam-x', { id: 'p1', token: 'old' }, s)
    addProposalToken('fam-x', { id: 'p1', token: 'new' }, s)
    expect(loadProposalTokens('fam-x', s)).toEqual([{ id: 'p1', token: 'new' }])
  })

  it('tolerates corrupt storage', () => {
    const s = fakeStorage()
    s.setItem('gift-proposals:fam-x', '{not json')
    expect(loadProposalTokens('fam-x', s)).toEqual([])
    s.setItem('gift-proposals:fam-x', '[{"nope":true},42]')
    expect(loadProposalTokens('fam-x', s)).toEqual([])
  })
})

describe('labels', () => {
  it('status labels speak plainly', () => {
    expect(proposalStatusLabel('pending')).toMatch(/Waiting/)
    expect(proposalStatusLabel('approved')).toMatch(/Approved/)
    expect(proposalStatusLabel('denied')).toMatch(/Not approved/)
    expect(proposalStatusLabel('withdrawn')).toMatch(/Withdrawn/)
  })

  it('formats prices and hides unknown ones', () => {
    expect(priceLabel(24.99, 'USD')).toBe('$24.99')
    expect(priceLabel(null, 'USD')).toBe('')
    expect(priceLabel(undefined)).toBe('')
  })
})
