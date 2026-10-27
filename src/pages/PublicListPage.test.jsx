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

  // Review 2026-10-26 (EDIT-LIST E15–E17).
  it('finds an owned title even when the visitor types it without punctuation', async () => {
    supabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_shared_list')
        return {
          data: {
            ...shared,
            have: [
              { id: 'h2', title: 'Paw Patrol — Chase', platform: 'tonies', child_id: 'k1', child_name: 'Sam', image_url: '', details: '' },
            ],
          },
          error: null,
        }
      if (fn === 'get_shared_proposals') return { data: [], error: null }
      return { data: false, error: null }
    })
    render(
      <MemoryRouter>
        <PublicListPage slugOverride="fam-x" />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('Wished Tonie')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Type a title/), { target: { value: 'paw patrol chase' } })
    expect(screen.getByText(/Already owned/)).toHaveTextContent('Sam')
    expect(screen.queryByText(/you're clear/)).not.toBeInTheDocument()
  })

  it('does not claim "you\'re clear" when nothing has been logged yet', async () => {
    supabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_shared_list') return { data: { ...shared, have: [] }, error: null }
      if (fn === 'get_shared_proposals') return { data: [], error: null }
      return { data: false, error: null }
    })
    render(
      <MemoryRouter>
        <PublicListPage slugOverride="fam-x" />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('Wished Tonie')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Type a title/), { target: { value: 'bluey' } })
    expect(screen.getByText(/Nothing has been logged on the shelf yet/)).toBeInTheDocument()
    expect(screen.queryByText(/you're clear/)).not.toBeInTheDocument()
  })

  it('shows a retry screen, not "link not available", when the request fails', async () => {
    let fail = true
    supabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_shared_list')
        return fail ? { data: null, error: { message: 'Failed to fetch' } } : { data: shared, error: null }
      if (fn === 'get_shared_proposals') return { data: [], error: null }
      return { data: false, error: null }
    })
    render(
      <MemoryRouter>
        <PublicListPage slugOverride="fam-x" />
      </MemoryRouter>
    )
    expect(await screen.findByText(/couldn't load this page/)).toBeInTheDocument()
    expect(screen.queryByText(/This link isn't available/)).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(screen.getByText('Wished Tonie')).toBeInTheDocument())
  })

  it('still says "not available" for a link that genuinely does not exist', async () => {
    supabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_shared_list') return { data: null, error: null }
      return { data: [], error: null }
    })
    render(
      <MemoryRouter>
        <PublicListPage slugOverride="nope" />
      </MemoryRouter>
    )
    expect(await screen.findByText(/This link isn't available/)).toBeInTheDocument()
  })
})
