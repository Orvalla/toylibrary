import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CatalogPage from './CatalogPage'
import { AuthProvider, useAuth } from '../lib/auth'

// Mirrors how the app actually mounts the page: behind Protected,
// which only renders children once a user session exists.
function Harness() {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <CatalogPage />
}

// The catalog reads two tables; stub the client with a tiny thenable
// query builder so the page renders headlessly.
const CATALOG = [
  { id: 'c1', platform: 'tonies', title: 'Bluey', details: 'Character Tonie', image_url: '', sort_order: 1 },
  { id: 'c2', platform: 'tonies', title: 'Peppa Pig', details: 'Character Tonie', image_url: '', sort_order: 2 },
]
const MINE = [{ platform: 'tonies', title: 'Bluey', list_type: 'have', child_id: null }]
// No children in this stub: ownership matching runs against Family.
const KIDS = []

function fakeQuery(table) {
  const q = {
    select: () => q,
    order: () => q,
    range: () => q,
    eq: () => q,
    then(res, rej) {
      const data = table === 'catalog_items' ? CATALOG : table === 'children' ? KIDS : MINE
      return Promise.resolve({ data, error: null }).then(res, rej)
    },
  }
  return q
}

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: 'p@example.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table) => fakeQuery(table),
  },
}))

describe('CatalogPage', () => {
  it('marks owned catalog titles with the checkmark state, others get add actions', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    )

    // Owned title: checkmark text, no "We have it" action — but a
    // clearly labeled way to take it back off the list.
    expect(await screen.findByText('✓ On your have list')).toBeInTheDocument()
    expect(screen.getByText('✕ Remove from have list')).toBeInTheDocument()
    // Unowned title: both add actions offered.
    expect(screen.getByText('＋ We have it')).toBeInTheDocument()
    expect(screen.getByText('☆ Add to wishlist')).toBeInTheDocument()
    expect(screen.getByText('Peppa Pig')).toBeInTheDocument()
  })
})
