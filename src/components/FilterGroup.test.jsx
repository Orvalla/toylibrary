import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FilterGroup } from './FilterSection'

describe('FilterGroup', () => {
  it('starts folded: header + summary + badge show, children do not', () => {
    render(
      <FilterGroup label="Filters" summary="Books · Ages 2–3" badge="2 active">
        <button>Inside control</button>
      </FilterGroup>
    )
    const head = screen.getByRole('button', { name: /Filters/ })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(head).toHaveTextContent('Books · Ages 2–3')
    expect(head).toHaveTextContent('2 active')
    expect(screen.queryByRole('button', { name: 'Inside control' })).not.toBeInTheDocument()
  })

  it('unfolds on tap and folds back', () => {
    render(
      <FilterGroup label="✍️ Add by hand" summary="Anything the catalog doesn't have">
        <input placeholder="Title you own" />
      </FilterGroup>
    )
    fireEvent.click(screen.getByRole('button', { name: /Add by hand/ }))
    expect(screen.getByPlaceholderText('Title you own')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add by hand/ }))
    expect(screen.queryByPlaceholderText('Title you own')).not.toBeInTheDocument()
  })

  it('carries the tour anchor when given one', () => {
    const { container } = render(
      <FilterGroup label="Add" summary="s" tourId="add">
        <span>x</span>
      </FilterGroup>
    )
    expect(container.querySelector('[data-tour="add"]')).not.toBeNull()
  })
})
