import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GiftCart from './GiftCart'
import { supabase } from '../supabaseClient'

// Claiming talks to Supabase RPCs; stub the client out.
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: { ok: true, token: 'tok-1' }, error: null })) },
}))

// The cart's "Open all" used to loop window.open over every
// entry; browsers block all but the first popup per tap, so
// only one item ever opened. The fix is a launch list: the
// first item opens from the tap, the rest become per-item
// buttons. These tests pin that behavior.
const entries = [
  { id: 'a', title: 'Bluey', platform: 'books', image_url: '', child_name: 'Sam' },
  { id: 'b', title: 'The Gruffalo', platform: 'books', image_url: '', child_name: 'Sam' },
]

describe('GiftCart open-all launch list', () => {
  beforeEach(() => {
    window.open = vi.fn(() => ({}))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens only the first item from the tap and switches to the launch list', () => {
    render(<GiftCart entries={entries} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 2 on Amazon/))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open.mock.calls[0][0]).toContain('amazon')
    expect(screen.getByText(/1 of 2 opened/)).toBeInTheDocument()
    // The still-unopened item offers its own open button.
    expect(screen.getByText('Open on Amazon ↗')).toBeInTheDocument()
  })

  it('checks items off as their buttons are tapped and finishes with a Done state', () => {
    render(<GiftCart entries={entries} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 2 on Amazon/))
    fireEvent.click(screen.getByText('Open on Amazon ↗'))
    expect(screen.getByText(/All opened/)).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('a one-item cart just opens it, with no launch list', () => {
    render(<GiftCart entries={[entries[0]]} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 1 on Amazon/))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/of 1 opened/)).not.toBeInTheDocument()
  })
})

// Claiming from inside the cart: the drawer receives each
// item's live wishlist state (liveById) plus the slug, and
// offers the same claim controls as the wishlist tiles.
describe('GiftCart inline claiming', () => {
  const onChanged = vi.fn()
  const renderCart = (liveItems, cartEntries = entries) =>
    render(
      <GiftCart
        entries={cartEntries}
        slug="fam-x"
        liveById={new Map(liveItems.map((i) => [i.id, i]))}
        onChanged={onChanged}
        onRemove={() => {}}
        onClose={() => {}}
      />
    )
  const live = (over) => ({ platform: 'books', claimed: false, claimed_by: '', ...over })

  beforeEach(() => {
    localStorage.clear()
    onChanged.mockClear()
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ data: { ok: true, token: 'tok-1', expires_at: null }, error: null })
  })

  it('claims an unclaimed item inline and stores the token', async () => {
    renderCart([live({ id: 'a', title: 'Bluey' }), live({ id: 'b', title: 'The Gruffalo' })])
    const claimButtons = screen.getAllByText(/I'll get this — claim it/)
    fireEvent.click(claimButtons[0])
    fireEvent.click(screen.getByText('Confirm claim'))
    await waitFor(() => expect(localStorage.getItem('claim:a')).toBe('tok-1'))
    expect(supabase.rpc).toHaveBeenCalledWith('claim_wishlist_item', {
      p_slug: 'fam-x',
      p_item_id: 'a',
      p_claimer_name: '',
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows who claimed an item taken by someone else, with no claim button', () => {
    renderCart([
      live({ id: 'a', title: 'Bluey', claimed: true, claimed_by: 'Aunt Sarah' }),
      live({ id: 'b', title: 'The Gruffalo' }),
    ])
    expect(screen.getByText(/Claimed by Aunt Sarah/)).toBeInTheDocument()
    expect(screen.getAllByText(/I'll get this — claim it/)).toHaveLength(1)
  })

  it('recognises my own claim from the localStorage token and offers undo', () => {
    localStorage.setItem('claim:a', 'some-token')
    renderCart([
      live({ id: 'a', title: 'Bluey', claimed: true, claimed_by: '' }),
      live({ id: 'b', title: 'The Gruffalo' }),
    ])
    expect(screen.getByText(/You claimed this/)).toBeInTheDocument()
    expect(screen.getByText('Undo claim')).toBeInTheDocument()
  })

  it('flags an entry whose item has left the wishlist', () => {
    renderCart([live({ id: 'a', title: 'Bluey' })])
    expect(screen.getByText(/No longer on the wishlist/)).toBeInTheDocument()
  })
})
