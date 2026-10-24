import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BundleNote from './BundleNote'

const missing = [
  { title: 'Cheery Lane House Play Set', platform: 'other', asin: null },
  { title: 'Cheery Lane Cheeries Play Figures', platform: 'other', asin: null },
]

describe('BundleNote', () => {
  it('renders nothing when the child owns none of the pieces', () => {
    const { container } = render(
      <BundleNote info={{ total: 2, owned: 0, missing }} name="Sam" platform="other" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows progress and the missing pieces once some are owned', () => {
    render(<BundleNote info={{ total: 2, owned: 1, missing: [missing[1]] }} name="Sam" platform="other" />)
    expect(screen.getByText(/Sam already has 1 of the 2/)).toBeInTheDocument()
    expect(screen.getByText(/Still missing:/)).toBeInTheDocument()
    expect(screen.getByText(/Cheery Lane Cheeries Play Figures/)).toBeInTheDocument()
  })

  it('celebrates a complete set instead of listing missing pieces', () => {
    render(<BundleNote info={{ total: 2, owned: 2, missing: [] }} name="Sam" platform="other" />)
    expect(screen.getByText(/That completes the set/)).toBeInTheDocument()
    expect(screen.queryByText(/Still missing:/)).not.toBeInTheDocument()
  })

  it('renders nothing without bundle info', () => {
    const { container } = render(<BundleNote info={null} name="Sam" platform="other" />)
    expect(container).toBeEmptyDOMElement()
  })
})
