import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SuggestGift, { ApprovedGifts } from './SuggestGift'
import { supabase } from '../supabaseClient'
import { loadProposalTokens } from '../lib/proposals'

// The proposal form talks to the suggest-gift Edge Function;
// stub the client. These tests pin the two outcomes a
// suggester can hit: a fresh proposal (token saved, listed as
// waiting) and an already-suggested link (told, not duped).
vi.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

const kids = [{ id: 'k1', name: 'Sam' }]

describe('SuggestGift', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.functions.invoke.mockReset()
  })

  it("submits a suggestion, saves the token and lists it as waiting", async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: {
        ok: true,
        proposal: { id: 'p1', title: 'Tricycle', image_url: '', status: 'pending' },
        token: 'tok-1',
      },
      error: null,
    })
    render(<SuggestGift slug="fam-x" kids={kids} />)
    fireEvent.change(screen.getByLabelText(/Link to the gift/), {
      target: { value: 'https://shop.example.com/trike' },
    })
    fireEvent.change(screen.getByLabelText(/What is it/), {
      target: { value: 'Tricycle' },
    })
    fireEvent.click(screen.getByText('Send for approval'))
    await waitFor(() => expect(screen.getByText(/Sent! The parents will take a look/)).toBeInTheDocument())
    expect(loadProposalTokens('fam-x')).toEqual([{ id: 'p1', token: 'tok-1' }])
    expect(screen.getByText(/Waiting for the parents to decide/)).toBeInTheDocument()
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'suggest-gift',
      expect.objectContaining({
        body: expect.objectContaining({ mode: 'suggest', slug: 'fam-x', title: 'Tricycle' }),
      })
    )
  })

  it('reports an already-approved duplicate instead of sending another', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { ok: false, reason: 'already_proposed', status: 'approved', title: 'Tricycle' },
      error: null,
    })
    render(<SuggestGift slug="fam-x" kids={kids} />)
    fireEvent.change(screen.getByLabelText(/Link to the gift/), {
      target: { value: 'https://shop.example.com/trike' },
    })
    fireEvent.click(screen.getByText('Send for approval'))
    await waitFor(() =>
      expect(screen.getByText(/already suggested and approved/)).toBeInTheDocument()
    )
    expect(loadProposalTokens('fam-x')).toEqual([])
  })

  it('loads this browser’s earlier suggestions on mount', async () => {
    localStorage.setItem('gift-proposals:fam-x', JSON.stringify([{ id: 'p9', token: 'tok-9' }]))
    supabase.functions.invoke.mockResolvedValue({
      data: {
        proposals: [
          { id: 'p9', title: 'Old Idea', url: 'https://x.example', image_url: '', status: 'approved', child_name: 'Sam' },
        ],
      },
      error: null,
    })
    render(<SuggestGift slug="fam-x" kids={kids} />)
    await waitFor(() => expect(screen.getByText('Old Idea')).toBeInTheDocument())
    expect(screen.getByText(/Approved — shown to all gift-givers/)).toBeInTheDocument()
  })
})

describe('ApprovedGifts', () => {
  it('renders approved proposals with the giver named', () => {
    render(
      <ApprovedGifts
        proposals={[
          {
            id: 'p1',
            title: 'Tricycle',
            url: 'https://shop.example.com/trike',
            image_url: '',
            suggester_name: 'Grandma',
            child_name: 'Sam',
            price: 59.99,
            currency: 'USD',
          },
        ]}
      />
    )
    expect(screen.getByText('Tricycle')).toBeInTheDocument()
    expect(screen.getByText(/Grandma is getting this · for Sam · \$59.99/)).toBeInTheDocument()
  })

  it('renders nothing when there are none', () => {
    const { container } = render(<ApprovedGifts proposals={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
