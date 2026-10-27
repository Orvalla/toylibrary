import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ArtPage from './ArtPage'
import { AuthProvider, useAuth } from '../lib/auth'

// Mirrors SteamPage.test.jsx: render behind the auth provider the
// way Protected mounts the page in the app.
function Harness() {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <ArtPage />
}

const CATALOG = [
  { id: 'c1', platform: 'tonies', title: 'Bluey', details: 'Tonie figure', image_url: '', item_type: 'content', sort_order: 1 },
  { id: 'c2', platform: 'crayola', title: 'Crayola Art Case', details: 'Art supplies', image_url: '', item_type: 'content', sort_order: 2 },
  { id: 'c3', platform: 'melissaanddoug', title: 'Created by Me Craft Kit', details: 'Craft & Stamp Kits', image_url: '', item_type: 'content', sort_order: 3 },
  { id: 'c4', platform: 'melissaanddoug', title: 'Colors & Shapes Sorter', details: 'Colors & Shapes', image_url: '', item_type: 'content', sort_order: 4 },
  { id: 'c5', platform: 'djeco', title: 'Djeco Wooden Puzzle', details: 'Wooden puzzle', image_url: '', item_type: 'content', sort_order: 5 },
  { id: 'c6', platform: 'djeco', title: 'Water Colouring Set', details: 'Water colouring set', image_url: '', item_type: 'content', sort_order: 6 },
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

describe('ArtPage', () => {
  it('shows only the pure art — Crayola and the makers’ art lines — with the catalog add actions', async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    )

    expect(await screen.findByText('Crayola Art Case')).toBeInTheDocument()
    expect(screen.getByText('Created by Me Craft Kit')).toBeInTheDocument()
    expect(screen.getByText('Water Colouring Set')).toBeInTheDocument()
    // The same brands' non-art lines stay on their own shelves:
    // a colour-learning sorter is not art-making, and Djeco's
    // toddler puzzles are toys.
    expect(screen.queryByText('Colors & Shapes Sorter')).not.toBeInTheDocument()
    expect(screen.queryByText('Djeco Wooden Puzzle')).not.toBeInTheDocument()
    expect(screen.queryByText('Bluey')).not.toBeInTheDocument()
    // The add flow is the catalog's: all three art rows addable.
    expect(screen.getAllByText('＋ We have it')).toHaveLength(3)
    expect(screen.getAllByText('☆ Add to wishlist')).toHaveLength(3)
  })
})
