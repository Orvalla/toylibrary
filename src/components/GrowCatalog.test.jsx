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
})
