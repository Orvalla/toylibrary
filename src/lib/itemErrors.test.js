import { describe, expect, it } from 'vitest'
import { alreadyOwnedMessage, isAlreadyOwned } from './itemErrors'

describe('itemErrors', () => {
  it('recognises the already_owned violation from migration 0057', () => {
    expect(isAlreadyOwned({ code: '23505', message: 'already_owned' })).toBe(true)
  })

  it('does not treat an ordinary duplicate as already owned', () => {
    expect(
      isAlreadyOwned({ code: '23505', message: 'duplicate key value violates unique constraint "items_no_duplicates_idx"' }),
    ).toBe(false)
    expect(isAlreadyOwned(null)).toBe(false)
  })

  it('names the title in the message', () => {
    expect(alreadyOwnedMessage('Bluey')).toContain('“Bluey”')
  })
})
