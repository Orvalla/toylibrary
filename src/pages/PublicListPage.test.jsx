import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicListPage from './PublicListPage'
import { supabase } from '../supabaseClient'

// The shared gift page leads with the wishlist: the
// "Already have it" shelf starts collapsed (owner request
// 2026-10-24) so owned tiles stop pushing the want list
// down the page. One tap opens it.
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: { proposals: [] }, error: null })) },
  },
}))

const shared = {
  child_name: 'Sam',
  children: [{ id: 'k1', name: 'Sam' }],
  have: [
    { id: 'h1', title: 'Owned Tonie', platform: 'tonies', child_id: 'k1', child_name: 'Sam', image_url: '', details: '' },
  ],
  wishlist: [
    { id: 'w1', title: 'Wished Tonie', platform: 'tonies', child_id: 'k1', child_name: 'Sam', image_url: '', details: '' },
  ],
  occasions: [],
  next_occasion: null,
}

describe('PublicListPage have list', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.rpc.mockReset()
    supabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_shared_list') return { data: shared, error: null }
      if (fn === 'get_shared_proposals') return { data: [], error: null }
      return { data: false, error: null }
    })
  })

  it('starts collapsed with the wishlist prominent, expands on tap', async () => {
    render(
      <MemoryRouter>
        <PublicListPage slugOverride="fam-x" />
      </MemoryRouter>
    )
    // Wishlist is right there once the page loads…
    await waitFor(() => expect(screen.getByText('Wished Tonie')).toBeInTheDocument())
    // …and the owned tiles are not.
    expect(screen.queryByText('Owned Tonie')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /Already have it/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1 on the shelf')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Owned Tonie')).toBeInTheDocument()
  })
})
