import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}))

import GrowCatalog from './GrowCatalog'

const CANDIDATE = {
  platform: 'tonies',
  title: 'Bluey Tonie',
  details: '',
  image_url: '',
}

describe('GrowCatalog', () => {
  beforeEach(() => invoke.mockReset())

  it('standalone: shows its heading and both tabs', () => {
    render(<GrowCatalog />)
    expect(screen.getByText("Can't find a product? Grow the catalog")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search stores' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paste a link' })).toBeInTheDocument()
  })

  it('controlled mode: no chrome, just the search panel', () => {
    render(<GrowCatalog mode="search" />)
    expect(screen.queryByText("Can't find a product? Grow the catalog")).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Paste a link' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search the stores')).toBeInTheDocument()
  })

  it('controlled link mode: just the link panel', () => {
    render(<GrowCatalog mode="link" />)
    expect(screen.getByLabelText('Product or collection link')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search the stores')).not.toBeInTheDocument()
  })

  it('reports an already-catalog result through onExists, a new one through onAdded', async () => {
    const onAdded = vi.fn()
    const onExists = vi.fn()
    invoke
      .mockResolvedValueOnce({ data: { results: [CANDIDATE] }, error: null })
      .mockResolvedValueOnce({ data: { status: 'exists', item: CANDIDATE }, error: null })
    render(<GrowCatalog mode="search" onAdded={onAdded} onExists={onExists} />)
    fireEvent.change(screen.getByLabelText('Search the stores'), {
      target: { value: 'Bluey' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Add to catalog/ }))
    await waitFor(() => expect(onExists).toHaveBeenCalledWith(CANDIDATE))
    expect(onAdded).not.toHaveBeenCalled()
  })
  it('tells the adder a pasted link is saved but waiting for review, not "in the catalog"', async () => {
    invoke.mockResolvedValueOnce({
      data: { status: 'added', pending_review: true, item: { ...CANDIDATE, id: 'n1' } },
      error: null,
    })
    render(<GrowCatalog mode="link" />)
    fireEvent.change(screen.getByLabelText('Product or collection link'), {
      target: { value: 'https://example.com/p' },
    })
    fireEvent.submit(screen.getByLabelText('Product or collection link').closest('form'))
    expect(await screen.findByText(/once it has been checked/)).toBeInTheDocument()
    expect(screen.queryByText(/is now in the catalog/)).not.toBeInTheDocument()
  })

  it('says how many collection rows were left for tomorrow by the daily limit', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        status: 'collection', platform: 'tonies', added: 5, already_present: 1,
        skipped_filtered: 0, skipped_cap: 7, blocked_content: 0, pending_review: true,
      },
      error: null,
    })
    render(<GrowCatalog mode="link" />)
    fireEvent.change(screen.getByLabelText('Product or collection link'), {
      target: { value: 'https://us.tonies.com/collections/all' },
    })
    fireEvent.submit(screen.getByLabelText('Product or collection link').closest('form'))
    expect(await screen.findByText(/7 left for tomorrow/)).toBeInTheDocument()
    expect(screen.getByText(/waiting for review/)).toBeInTheDocument()
  })
})
