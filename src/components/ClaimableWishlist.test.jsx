import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimableWishlist from './ClaimableWishlist'
import { supabase } from '../supabaseClient'

// Claiming talks to Supabase RPCs; the component tests only cover the
// rendered states, so the client is stubbed out.
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })) },
}))

const base = { platform: 'tonies', details: '', notes: '' }
const unclaimed = { ...base, id: 'a', title: 'Bluey', claimed: false, claimed_by: '' }
const claimedByOther = { ...base, id: 'b', title: 'The Gruffalo', claimed: true, claimed_by: 'Aunt Sarah' }
const claimedByMe = { ...base, id: 'c', title: 'Dragons Love Tacos', claimed: true, claimed_by: '' }

describe('ClaimableWishlist', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('offers a claim button for an unclaimed item', () => {
    render(<ClaimableWishlist slug="fam-x" items={[unclaimed]} onChanged={() => {}} />)
    expect(screen.getByText(/I'll get this — claim it/)).toBeInTheDocument()
  })

  it('shows who claimed an item taken by someone else, with no claim button', () => {
    render(<ClaimableWishlist slug="fam-x" items={[claimedByOther]} onChanged={() => {}} />)
    expect(screen.getByText(/Claimed by Aunt Sarah/)).toBeInTheDocument()
    expect(screen.queryByText(/I'll get this/)).not.toBeInTheDocument()
  })

  it('recognises my own claim from the localStorage token and offers undo', () => {
    localStorage.setItem('claim:c', 'some-token')
    render(<ClaimableWishlist slug="fam-x" items={[claimedByMe]} onChanged={() => {}} />)
    expect(screen.getByText(/You claimed this/)).toBeInTheDocument()
    expect(screen.getByText(/Undo claim/)).toBeInTheDocument()
  })

  it('shows the empty state for an empty wishlist', () => {
    render(<ClaimableWishlist slug="fam-x" items={[]} onChanged={() => {}} />)
    expect(screen.getByText(/No wishlist yet/)).toBeInTheDocument()
  })

  it('tells the claimer how long the hold lasts when the RPC returns an expiry', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: { ok: true, token: 'tok', expires_at: '2026-12-26T00:00:00+00:00' },
      error: null,
    })
    render(<ClaimableWishlist slug="fam-x" items={[unclaimed]} onChanged={() => {}} />)
    fireEvent.click(screen.getByText(/I'll get this — claim it/))
    fireEvent.click(screen.getByText(/Confirm claim/))
    expect(await screen.findByText(/Held for you until Dec 26/)).toBeInTheDocument()
  })

  it('keeps the plain confirmation when the RPC returns no expiry', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true, token: 'tok' }, error: null })
    render(<ClaimableWishlist slug="fam-x" items={[unclaimed]} onChanged={() => {}} />)
    fireEvent.click(screen.getByText(/I'll get this — claim it/))
    fireEvent.click(screen.getByText(/Confirm claim/))
    // Claim went through (form closed) but no hold-until note appears.
    await screen.findByText(/I'll get this — claim it/)
    expect(screen.queryByText(/Held for you until/)).not.toBeInTheDocument()
  })
})
