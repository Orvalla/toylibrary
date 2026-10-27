import { describe, expect, it } from 'vitest'
import { defaultChildId, subscribePayload, subscribeResultMessage } from './giftSubscribe'

describe('giftSubscribe', () => {
  it('binds per-child signups to the picked child, family signups to none', () => {
    expect(subscribePayload({ slug: 'fam', email: ' a@b.co ', familyScope: false, childId: 'k1' })).toEqual({
      p_slug: 'fam',
      p_email: 'a@b.co',
      p_child_id: 'k1',
    })
    expect(
      subscribePayload({ slug: 'fam', email: 'a@b.co', familyScope: true, childId: 'k1' }).p_child_id,
    ).toBeNull()
  })

  it('maps RPC codes to visitor words', () => {
    // 'ok' = pending: it must tell the visitor to confirm, never claim they're subscribed yet.
    expect(subscribeResultMessage('ok', { familyScope: true })).toContain('confirm')
    expect(subscribeResultMessage('ok', { familyScope: true })).not.toContain("You're in")
    expect(subscribeResultMessage('already')).toContain('already signed up')
    expect(subscribeResultMessage('rate_limited')).toContain('try again')
    expect(subscribeResultMessage('ok', { childName: 'Sam' })).toContain("Sam's")
    expect(subscribeResultMessage('bad_email')).toContain("doesn't look")
    expect(subscribeResultMessage('child_required')).toContain('Pick a child')
    expect(subscribeResultMessage('not_found')).toContain("didn't work")
  })

  it('defaults to the first child', () => {
    expect(defaultChildId([{ id: 'a' }, { id: 'b' }])).toBe('a')
    expect(defaultChildId([])).toBeNull()
    expect(defaultChildId(undefined)).toBeNull()
  })
})
