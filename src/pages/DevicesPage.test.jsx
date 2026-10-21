import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DevicesPage from './DevicesPage'
import { AuthProvider, useAuth } from '../lib/auth'

// Mirrors CatalogPage.test.jsx: render behind the auth provider the
// way Protected mounts the page in the app.
function Harness() {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <DevicesPage />
}

const CATALOG = [
  { id: 'c1', platform: 'tonies', title: 'Bluey', details: 'Tonie figure', image_url: '', item_type: 'content', sort_order: 1 },
  { id: 'c2', platform: 'tonies', title: 'Toniebox 2 Starter Set', details: 'Toniebox audio player', image_url: '', item_type: 'device', sort_order: 2 },
  { id: 'c3', platform: 'yoto', title: 'Yoto Player', details: 'Yoto Player (4th generation)', image_url: '', item_type: 'device', sort_order: 3 },
]
const MINE = []
const KIDS = []

function fakeQuery(table) {
  const q = {
    select: () => q,
    order: () => q,
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

describe('DevicesPage', () => {
  it('shows only the device rows, with the same add actions as the catalog', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    )

    expect(await screen.findByText('Toniebox 2 Starter Set')).toBeInTheDocument()
    expect(screen.getByText('Yoto Player')).toBeInTheDocument()
    // Content rows stay on the catalog page, not here.
    expect(screen.queryByText('Bluey')).not.toBeInTheDocument()
    // The add flow is the catalog's: two devices, both addable.
    expect(screen.getAllByText('＋ We have it')).toHaveLength(2)
    expect(screen.getAllByText('☆ Add to wishlist')).toHaveLength(2)
  })
})
