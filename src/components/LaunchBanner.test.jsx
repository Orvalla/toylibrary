import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import LaunchBanner from './LaunchBanner'
import { BANNER_DISMISS_KEY } from '../lib/launchBanner'

const inWindow = new Date('2026-12-01T20:00:00Z')
const before = new Date('2026-11-27T07:59:00Z')

const renderBanner = (props) =>
  render(
    <MemoryRouter>
      <LaunchBanner hostname="toylibrary.store" now={inWindow} {...props} />
    </MemoryRouter>
  )

describe('LaunchBanner (WS2)', () => {
  beforeEach(() => localStorage.clear())

  it('shows the exact announcement and a CTA to /welcome on the apex in the window', () => {
    renderBanner()
    expect(
      screen.getByText(
        "🎁 Toy Library is open for Christmas — make your family's gift page, share one link, and let family claim the gifts."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up my library' })).toHaveAttribute('href', '/welcome')
  })

  it('is hidden outside the window', () => {
    renderBanner({ now: before })
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull()
  })

  it('is never rendered on a family subdomain (gift page)', () => {
    renderBanner({ hostname: 'millers.toylibrary.store' })
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull()
  })

  it('also shows on www', () => {
    renderBanner({ hostname: 'www.toylibrary.store' })
    expect(screen.getByRole('region', { name: 'Announcement' })).toBeInTheDocument()
  })

  it('dismissal hides it and sticks in this browser', () => {
    const { unmount } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }))
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull()
    expect(localStorage.getItem(BANNER_DISMISS_KEY)).toBe('1')
    unmount()
    renderBanner()
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull()
  })
})
