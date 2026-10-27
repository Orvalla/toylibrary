import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SteamPage from './SteamPage'
import { AuthProvider, useAuth } from '../lib/auth'

// Mirrors DevicesPage.test.jsx: render behind the auth provider the
// way Protected mounts the page in the app.
function Harness() {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <SteamPage />
}

const CATALOG = [
  { id: 'c1', platform: 'tonies', title: 'Bluey', details: 'Tonie figure', image_url: '', item_type: 'content', sort_order: 1 },
  { id: 'c2', platform: 'elenco', title: 'Snap Circuits Classic', details: 'Electronics kit', image_url: '', item_type: 'content', sort_order: 2 },
  { id: 'c3', platform: 'ozobot', title: 'Ozobot Evo', details: 'Coding robot', image_url: '', item_type: 'device', sort_order: 3 },
  { id: 'c4', platform: 'thamesandkosmos', title: 'Chemistry Set', details: 'Science kit', image_url: '', item_type: 'content', sort_order: 4 },
  { id: 'c5', platform: 'crayola', title: 'Crayola Art Case', details: 'Art supplies', image_url: '', item_type: 'content', sort_order: 5 },
]
const MINE = []
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

describe('SteamPage', () => {
  it('shows the STEAM rows — electronics, robots and science kits — with the catalog add actions', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    )

    expect(await screen.findByText('Snap Circuits Classic')).toBeInTheDocument()
    expect(screen.getByText('Ozobot Evo')).toBeInTheDocument()
    expect(screen.getByText('Chemistry Set')).toBeInTheDocument()
    // Audio content stays on the catalog page, not here — and
    // traditional art has its own zone, so Crayola is out too.
    expect(screen.queryByText('Bluey')).not.toBeInTheDocument()
    expect(screen.queryByText('Crayola Art Case')).not.toBeInTheDocument()
    // The add flow is the catalog's: all three STEAM rows addable.
    expect(screen.getAllByText('＋ We have it')).toHaveLength(3)
    expect(screen.getAllByText('☆ Add to wishlist')).toHaveLength(3)
  })
})
