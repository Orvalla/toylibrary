import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GiftBasket from './GiftBasket'

// The basket pane offers inline claiming, which talks to
// Supabase RPCs; stub the client out.
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })) },
}))

const entries = [
  { id: 'a', title: 'Bluey Figure', platform: 'tonies', image_url: 'https://x/bluey.jpg', child_name: 'Sam' },
  { id: 'b', title: 'The Gruffalo', platform: 'books', image_url: '', child_name: 'Sam' },
]

describe('GiftBasket shell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.classList.remove('basket-rail')
  })

  it('shows a floating Basket pill with the total added', () => {
    render(<GiftBasket entries={entries} slug="fam-x" onRemove={() => {}} />)
    const pill = screen.getByRole('button', { name: /Open your basket, 2 added/ })
    expect(pill).toHaveTextContent('Basket')
    expect(pill).toHaveTextContent('2')
  })

  it('an empty basket shows the pill with no count and no rail', () => {
    render(<GiftBasket entries={[]} slug="fam-x" onRemove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Open your basket' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Your basket at a glance')).not.toBeInTheDocument()
    expect(document.body.classList.contains('basket-rail')).toBe(false)
  })

  it('the closed rail shows every item picture and flags the page to make room', () => {
    const { container } = render(<GiftBasket entries={entries} slug="fam-x" onRemove={() => {}} />)
    const rail = screen.getByLabelText('Your basket at a glance')
    expect(rail.querySelector('img')).toHaveAttribute('src', 'https://x/bluey.jpg')
    // The imageless entry falls back to platform art, not a hole.
    expect(container.querySelectorAll('.basket-rail-thumb')).toHaveLength(2)
    expect(document.body.classList.contains('basket-rail')).toBe(true)
  })

  it('one tap on the pill opens the pane over the page, with buy links', () => {
    render(<GiftBasket entries={entries} slug="fam-x" onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Open your basket, 2 added/ }))
    expect(screen.getByRole('heading', { name: /Your basket/ })).toBeInTheDocument()
    expect(screen.getByText('Bluey Figure')).toBeInTheDocument()
    expect(screen.getByText(/Open all 2 on Amazon/)).toBeInTheDocument()
    // The rail steps aside while the pane is open.
    expect(document.body.classList.contains('basket-rail')).toBe(false)
  })

  it('a tap on a rail thumbnail opens the pane too', () => {
    render(<GiftBasket entries={entries} slug="fam-x" onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Open basket — The Gruffalo/ }))
    expect(screen.getByRole('heading', { name: /Your basket/ })).toBeInTheDocument()
  })

  it('closing the pane brings the pill and rail back', () => {
    render(<GiftBasket entries={entries} slug="fam-x" onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Open your basket, 2 added/ }))
    fireEvent.click(screen.getByText(/Close ✕/))
    expect(screen.queryByRole('heading', { name: /Your basket/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your basket at a glance')).toBeInTheDocument()
  })
})
