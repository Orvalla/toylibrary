import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GiftCart from './GiftCart'

// The cart's "Open all" used to loop window.open over every
// entry; browsers block all but the first popup per tap, so
// only one item ever opened. The fix is a launch list: the
// first item opens from the tap, the rest become per-item
// buttons. These tests pin that behavior.
const entries = [
  { id: 'a', title: 'Bluey', platform: 'books', image_url: '', child_name: 'Sam' },
  { id: 'b', title: 'The Gruffalo', platform: 'books', image_url: '', child_name: 'Sam' },
]

describe('GiftCart open-all launch list', () => {
  beforeEach(() => {
    window.open = vi.fn(() => ({}))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens only the first item from the tap and switches to the launch list', () => {
    render(<GiftCart entries={entries} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 2 on Amazon/))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open.mock.calls[0][0]).toContain('amazon')
    expect(screen.getByText(/1 of 2 opened/)).toBeInTheDocument()
    // The still-unopened item offers its own open button.
    expect(screen.getByText('Open on Amazon ↗')).toBeInTheDocument()
  })

  it('checks items off as their buttons are tapped and finishes with a Done state', () => {
    render(<GiftCart entries={entries} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 2 on Amazon/))
    fireEvent.click(screen.getByText('Open on Amazon ↗'))
    expect(screen.getByText(/All opened/)).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('a one-item cart just opens it, with no launch list', () => {
    render(<GiftCart entries={[entries[0]]} onRemove={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/Open all 1 on Amazon/))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/of 1 opened/)).not.toBeInTheDocument()
  })
})
