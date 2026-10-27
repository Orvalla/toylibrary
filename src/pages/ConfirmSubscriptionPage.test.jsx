import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
import { supabase } from '../supabaseClient'
import ConfirmSubscriptionPage from './ConfirmSubscriptionPage'

const open = (search) =>
  render(
    <MemoryRouter initialEntries={[`/confirm${search}`]}>
      <ConfirmSubscriptionPage />
    </MemoryRouter>,
  )

describe('ConfirmSubscriptionPage', () => {
  beforeEach(() => supabase.rpc.mockReset())

  it('confirms with the token from the link', async () => {
    supabase.rpc.mockResolvedValue({ data: true, error: null })
    open('?t=abc')
    expect(await screen.findByText(/You're confirmed/)).toBeTruthy()
    expect(supabase.rpc).toHaveBeenCalledWith('confirm_gift_subscriber', { p_token: 'abc' })
  })

  it('says so when the token is unknown', async () => {
    supabase.rpc.mockResolvedValue({ data: false, error: null })
    open('?t=nope')
    expect(await screen.findByText(/didn't work/)).toBeTruthy()
  })

  it('says so when there is no token or the call fails', async () => {
    open('')
    expect(await screen.findByText(/didn't work/)).toBeTruthy()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
