import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimableWishlist from './ClaimableWishlist'
import GiftCart from './GiftCart'
import { supabase } from '../supabaseClient'

// WS2 audit (2026-11-11): when a claim's hold ran out, the claimer's
// "You claimed this" silently turned back into a claim button. Now
// the browser that still holds the token says the claim ended.
// Test family: Emma Miller / millers only.
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })) },
}))

const item = { id: 'w1', title: 'Wished Tonie', platform: 'tonies', details: '', notes: '', claimed: false, claimed_by: '', child_name: 'Emma' }

describe('lapsed claim note', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.rpc.mockReset()
  })

  it('wishlist tile: a leftover token on an open item says the claim ended and offers claim again', () => {
    localStorage.setItem('claim:w1', 'old-token')
    render(<ClaimableWishlist slug="millers" items={[item]} onChanged={() => {}} />)
    expect(screen.getByText(/earlier claim on this has ended/)).toBeInTheDocument()
    expect(screen.getByText(/I'll get this — claim it/)).toBeInTheDocument()
  })

  it('wishlist tile: no token, no lapsed note', () => {
    render(<ClaimableWishlist slug="millers" items={[item]} onChanged={() => {}} />)
    expect(screen.queryByText(/earlier claim/)).toBeNull()
  })

  it('wishlist tile: a fresh claim does not flash the lapsed note before the list reloads', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: true, token: 'tok', expires_at: '2026-12-26T00:00:00+00:00' },
      error: null,
    })
    // onChanged does nothing, so the item stays claimed:false — the
    // exact in-between state a slow reload leaves on screen.
    render(<ClaimableWishlist slug="millers" items={[item]} onChanged={() => {}} />)
    fireEvent.click(screen.getByText(/I'll get this — claim it/))
    fireEvent.click(screen.getByText(/Confirm claim/))
    expect(await screen.findByText(/Next: buy it with the link below/)).toBeInTheDocument()
    expect(screen.queryByText(/earlier claim/)).toBeNull()
  })

  it('basket row: a leftover token on an open item says the claim ended', () => {
    localStorage.setItem('claim:w1', 'old-token')
    render(
      <GiftCart
        entries={[{ id: 'w1', title: 'Wished Tonie', platform: 'tonies', image_url: '', child_name: 'Emma' }]}
        slug="millers"
        liveById={new Map([['w1', item]])}
        onChanged={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/earlier claim on this has ended/)).toBeInTheDocument()
  })

  it('claim-path controls carry the 44px tap-target class', () => {
    render(<ClaimableWishlist slug="millers" items={[item]} onChanged={() => {}} />)
    const claimBtn = screen.getByText(/I'll get this — claim it/)
    expect(claimBtn).toHaveClass('tap')
    fireEvent.click(claimBtn)
    expect(screen.getByText(/Confirm claim/)).toHaveClass('tap')
    expect(screen.getByText('Cancel')).toHaveClass('tap')
    expect(screen.getByText('Cancel').closest('.tile-actions')).toHaveClass('gift-actions')
  })
})
