import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TourGuide from './TourGuide'

describe('TourGuide', () => {
  it('opens with the anchorless welcome, walks the anchored steps, and finishes', () => {
    document.body.innerHTML = `
      <section data-tour="share">share</section>
      <div data-tour="lists">lists</div>
      <form data-tour="add">add</form>
    `
    const onClose = vi.fn()
    render(<TourGuide onClose={onClose} />)
    // Three anchored steps survive, bracketed by the two
    // anchorless bookends: welcome + finale = 5 steps.
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    expect(screen.getByText(/Welcome to your library/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    expect(screen.getByText(/This link is the whole trick/)).toBeInTheDocument()
    expect(document.querySelector('[data-tour="share"]').classList.contains('tour-highlight')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Two lists/)).toBeInTheDocument()
    expect(document.querySelector('[data-tour="share"]').classList.contains('tour-highlight')).toBe(false)
    expect(document.querySelector('[data-tour="lists"]').classList.contains('tour-highlight')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Add things by hand/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/whole map/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes the tour', () => {
    document.body.innerHTML = '<section data-tour="share">share</section>'
    const onClose = vi.fn()
    render(<TourGuide onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
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
