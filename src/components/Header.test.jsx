import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from './Header'
import { useAuth } from '../lib/auth'

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { auth: { signOut: vi.fn() } } }))

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>
  )

describe('Header catalog dropdown', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: null })
  })

  it('keeps the header clean: one Catalog entry, shelves inside the dropdown', () => {
    renderAt('/')
    expect(screen.queryByRole('link', { name: 'Books' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Devices' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    expect(screen.getByRole('menuitem', { name: /All/ })).toHaveAttribute('href', '/catalog')
    expect(screen.getByRole('menuitem', { name: /Books/ })).toHaveAttribute('href', '/books')
    expect(screen.getByRole('menuitem', { name: /Board games/ })).toHaveAttribute(
      'href',
      '/catalog?kind=games'
    )
    expect(screen.getByRole('menuitem', { name: /Devices/ })).toHaveAttribute('href', '/devices')
  })

  it('closes on Escape and on an outside tap', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('marks the current shelf inside the dropdown', () => {
    renderAt('/catalog?kind=games')
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    expect(screen.getByRole('menuitem', { name: /Board games/ })).toHaveClass('active')
    expect(screen.getByRole('menuitem', { name: /All/ })).not.toHaveClass('active')
  })

  it('signed-in nav gets the same dropdown', () => {
    useAuth.mockReturnValue({ user: { id: 'u1' } })
    renderAt('/dashboard')
    expect(screen.getByRole('link', { name: 'My lists' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    expect(screen.getByRole('menuitem', { name: /Board games/ })).toBeInTheDocument()
  })
})
