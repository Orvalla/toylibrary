import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import KindBar from './KindBar'

describe('KindBar', () => {
  it('shows every main shelf with its count', () => {
    render(
      <KindBar
        counts={{ all: 100, books: 40, games: 25, story: 20, toys: 15 }}
        value="all"
        onChange={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /Everything/ })).toHaveTextContent('100')
    expect(screen.getByRole('button', { name: /Board games/ })).toHaveTextContent('25')
    expect(screen.getByRole('button', { name: /Story devices/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Toys & play/ })).toBeInTheDocument()
  })

  it('formats big counts with thousands separators', () => {
    render(
      <KindBar counts={{ all: 18346, books: 7242 }} value="all" onChange={() => {}} />
    )
    expect(screen.getByRole('button', { name: /Everything/ })).toHaveTextContent('18,346')
    expect(screen.getByRole('button', { name: /Books/ })).toHaveTextContent('7,242')
  })

  it('marks the active shelf and reports picks', () => {
    const onChange = vi.fn()
    render(<KindBar counts={{}} value="books" onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Books/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Board games/ }))
    expect(onChange).toHaveBeenCalledWith('games')
  })
})
