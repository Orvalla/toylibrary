import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }))
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ToyLibrarian from './ToyLibrarian'
import GiftAdvisor from './GiftAdvisor'
import GiftFinderPage from '../pages/GiftFinderPage'

// WS7 UI: the flag gates both doors; chips, streaming reply and
// candidate links; the history-limit restart. Emma Miller test data
// only (launch copy fence).

const EMMA = { id: '11111111-1111-4111-8111-111111111111', name: 'Emma' }
const on = async () => true
const off = async () => false

function fakeSend(script) {
  const calls = []
  const send = async (args) => {
    calls.push(args)
    const step = script.shift()
    if (step.error) return { ok: false, error: step.error, code: step.code }
    args.onMeta(step.candidates ?? [])
    for (const chunk of step.chunks) args.onDelta(chunk)
    return { ok: true }
  }
  send.calls = calls
  return send
}

describe('flag OFF: the UI does not render', () => {
  it('gift page: nothing at all', async () => {
    const { container } = render(<GiftAdvisor slug="millers" kids={[EMMA]} probe={off} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('/gift-finder: the not-found page', async () => {
    render(
      <MemoryRouter>
        <GiftFinderPage probe={off} />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/wandered off/)).toBeInTheDocument()
    expect(screen.queryByText('The Toy Librarian')).toBeNull()
  })
})

describe('flag ON', () => {
  it('gift page: opens on tap, introduces the Toy Librarian for the page child, mascot avatar', async () => {
    render(<GiftAdvisor slug="millers" kids={[EMMA]} probe={on} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ask the Toy Librarian/ }))
    expect(screen.getByRole('heading', { name: 'The Toy Librarian' })).toBeInTheDocument()
    expect(screen.getByText(/Shopping for Emma\?/)).toBeInTheDocument()
    const imgs = document.querySelectorAll('img[src="/toy-library-mascot-storytime.webp"]')
    expect(imgs.length).toBeGreaterThan(0)
    for (const chip of ['What does she still need?', 'Something for the car', 'Under $30']) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument()
    }
  })

  it('finder page renders the finder chips', async () => {
    render(
      <MemoryRouter>
        <GiftFinderPage probe={on} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: 'A gift for a 4-year-old' })).toBeInTheDocument()
    expect(screen.getByText(/Tell me who you're shopping for/)).toBeInTheDocument()
  })

  it('a chip sends a page-mode turn; the streamed reply renders with candidate links', async () => {
    const send = fakeSend([
      {
        candidates: [{ id: 'a', name: 'Dinosaur Stomp Card', product_url: 'https://us.yotoplay.com/products/dino-stomp' }],
        chunks: ['For her Yoto: **Dinosaur Stomp Card**, ', '$9.99 at yotoplay.com (checked 2026-10-27).'],
      },
      { chunks: ['Happy to help.'] },
    ])
    render(<ToyLibrarian mode="page" slug="millers" childId={EMMA.id} childName="Emma" send={send} />)
    fireEvent.click(screen.getByRole('button', { name: 'What does she still need?' }))
    const link = await screen.findByRole('link', { name: 'Dinosaur Stomp Card' })
    expect(link).toHaveAttribute('href', 'https://us.yotoplay.com/products/dino-stomp')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(send.calls[0]).toMatchObject({ mode: 'page', slug: 'millers', childId: EMMA.id, history: [] })
    // chips go away once the conversation starts
    expect(screen.queryByRole('button', { name: 'Something for the car' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Message the Toy Librarian'), { target: { value: 'Thanks!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText('Happy to help.')
    expect(send.calls[1].history).toEqual([
      { role: 'user', content: 'What does she still need?' },
      { role: 'assistant', content: 'For her Yoto: **Dinosaur Stomp Card**, $9.99 at yotoplay.com (checked 2026-10-27).' },
    ])
  })

  it('history limit: friendly message, draft kept, one-tap fresh start', async () => {
    const send = fakeSend([{ error: "We've covered a lot of ground!", code: 'history_limit' }])
    render(<ToyLibrarian mode="finder" send={send} />)
    fireEvent.change(screen.getByLabelText('Message the Toy Librarian'), { target: { value: 'one more' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We've covered a lot of ground!")
    expect(screen.getByLabelText('Message the Toy Librarian')).toHaveValue('one more')
    fireEvent.click(screen.getByRole('button', { name: 'Start a fresh conversation' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: 'A gift for a 4-year-old' })).toBeInTheDocument()
  })

  it('caps the input at 500 characters', () => {
    render(<ToyLibrarian mode="finder" send={fakeSend([])} />)
    expect(screen.getByLabelText('Message the Toy Librarian')).toHaveAttribute('maxLength', '500')
  })
})
