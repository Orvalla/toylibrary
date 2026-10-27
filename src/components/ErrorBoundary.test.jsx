import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Boom() {
  throw new Error('render failure')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('shows a plain message and a reload button instead of a blank page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Reload the page/ })).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})
