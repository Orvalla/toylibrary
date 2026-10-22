import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TourGuide from './TourGuide'

describe('TourGuide', () => {
  it('walks the anchored steps, skips missing ones, and finishes', () => {
    document.body.innerHTML = `
      <section data-tour="share">share</section>
      <div data-tour="lists">lists</div>
      <form data-tour="add">add</form>
    `
    const onClose = vi.fn()
    render(<TourGuide onClose={onClose} />)
    // Only 3 of the 7 steps have anchors on this page.
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByText(/gift-giver link/)).toBeInTheDocument()
    expect(document.querySelector('[data-tour="share"]').classList.contains('tour-highlight')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    expect(screen.getByText(/Two lists/)).toBeInTheDocument()
    expect(document.querySelector('[data-tour="share"]').classList.contains('tour-highlight')).toBe(false)
    expect(document.querySelector('[data-tour="lists"]').classList.contains('tour-highlight')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Add things by hand/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes immediately when no anchors exist', () => {
    document.body.innerHTML = '<div>nothing here</div>'
    const onClose = vi.fn()
    const { container } = render(<TourGuide onClose={onClose} />)
    expect(onClose).toHaveBeenCalled()
    expect(container.firstChild).toBeNull()
  })
})
