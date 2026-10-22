import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProposalInbox from './ProposalInbox'
import { supabase } from '../supabaseClient'

// The parents' inbox reads and updates gift_proposals under
// RLS. Stub the query builder chain; pin that a pending
// proposal renders with its context and that Approve writes
// the decision back.
vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn() },
}))

const proposal = {
  id: 'p1',
  child_id: 'k1',
  title: 'Tricycle',
  url: 'https://shop.example.com/trike',
  image_url: '',
  price: 59.99,
  currency: 'USD',
  suggester_name: 'Grandma',
  note: 'She would love this',
  status: 'pending',
  created_at: '2026-10-22T00:00:00Z',
  decided_at: null,
}

function stubFrom(rows, updateSpy) {
  supabase.from.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: rows, error: null }),
    }),
    update: (patch) => {
      updateSpy?.(patch)
      return { eq: () => Promise.resolve({ error: null }) }
    },
  }))
}

describe('ProposalInbox', () => {
  beforeEach(() => {
    supabase.from.mockReset()
  })

  it('shows a waiting proposal with giver, child, price and note', async () => {
    stubFrom([proposal])
    render(<ProposalInbox kids={[{ id: 'k1', name: 'Sam' }]} />)
    await waitFor(() => expect(screen.getByText('Tricycle')).toBeInTheDocument())
    expect(screen.getByText(/from Grandma · for Sam · \$59\.99/)).toBeInTheDocument()
    expect(screen.getByText(/She would love this/)).toBeInTheDocument()
    expect(screen.getByText(/1 waiting/)).toBeInTheDocument()
  })

  it('approving writes the decision and moves the row to Decided', async () => {
    const patches = []
    stubFrom([proposal], (p) => patches.push(p))
    render(<ProposalInbox kids={[{ id: 'k1', name: 'Sam' }]} />)
    await waitFor(() => expect(screen.getByText('Tricycle')).toBeInTheDocument())
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(screen.getByText('Reconsider')).toBeInTheDocument())
    expect(patches).toEqual([expect.objectContaining({ status: 'approved' })])
  })

  it('hides withdrawn proposals entirely', async () => {
    stubFrom([{ ...proposal, status: 'withdrawn' }])
    render(<ProposalInbox kids={[]} />)
    await waitFor(() => expect(screen.getByText(/No suggestions yet/)).toBeInTheDocument())
    expect(screen.queryByText('Tricycle')).not.toBeInTheDocument()
  })
})
