import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicListPage from './PublicListPage'
import { supabase } from '../supabaseClient'

// WS2 audit (2026-11-11): first-visit clarity on the gift page.
// Test family: Emma Miller / millers only.
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}))

const tile = (id, childId, childName) => ({
  id, title: `Wished ${id}`, platform: 'tonies', child_id: childId, child_name: childName, image_url: '', details: '',
})

const millers = {
  display_name: 'The Millers',
  child_name: 'Emma',
  children: [
    { id: 'k1', name: 'Emma' },
    { id: 'k2', name: 'Leo' },
  ],
  have: [],
  wishlist: [tile('w1', 'k1', 'Emma'), tile('w2', 'k2', 'Leo')],
  occasions: [],
  next_occasion: null,
}

function renderPage(data) {
  supabase.rpc.mockImplementation(async (fn) => {
    if (fn === 'get_shared_list') return { data, error: null }
    if (fn === 'get_shared_proposals') return { data: [], error: null }
    return { data: false, error: null }
  })
  return render(
    <MemoryRouter>
      <PublicListPage slugOverride="millers" />
    </MemoryRouter>
  )
}

describe('PublicListPage first-visit clarity (WS2)', () => {
  beforeEach(() => {
    localStorage.clear()
    supabase.rpc.mockReset()
    document.title = 'Toy Library — no more duplicate gifts'
  })

  it('headline and intro name every child, not just the profile child_name', async () => {
    renderPage(millers)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("Emma and Leo's toy & story library")
    expect(screen.getByText(/Thinking of a gift for Emma and Leo\?/)).toBeInTheDocument()
  })

  it('a one-child family keeps the familiar headline', async () => {
    renderPage({ ...millers, children: [{ id: 'k1', name: 'Emma' }], wishlist: [tile('w1', 'k1', 'Emma')] })
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("Emma's toy & story library")
  })

  it('the tab title matches the share-preview card, and is restored on leave', async () => {
    const { unmount } = renderPage(millers)
    await waitFor(() => expect(document.title).toBe("The Millers' Toy Library — gift page"))
    unmount()
    expect(document.title).toBe('Toy Library — no more duplicate gifts')
  })

  it('each child section heading is marked as a child section', async () => {
    renderPage(millers)
    const emma = await screen.findByRole('heading', { name: 'For Emma' })
    expect(emma).toHaveClass('child-section-title')
    expect(screen.getByRole('heading', { name: 'For Leo' })).toHaveClass('child-section-title')
  })
})
