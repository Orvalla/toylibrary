import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SupportWidget from './SupportWidget'
import { supabase } from '../supabaseClient'

// Filing a report inserts the row, then pings the
// notify-support Edge Function so the ticket is also emailed
// to support@. The ping is best-effort: the report is filed
// either way (it still lands in the admin inbox).
const insertMock = vi.fn()

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({ insert: insertMock })),
    storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) },
    functions: { invoke: vi.fn() },
  },
}))

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: null }),
}))

// No canvas in jsdom — the widget treats a failed capture as
// "report without a screenshot", which is the path we want.
vi.mock('html2canvas', () => ({
  default: vi.fn(async () => {
    throw new Error('no canvas in tests')
  }),
}))

async function fileReport() {
  render(<SupportWidget />)
  fireEvent.click(screen.getByRole('button', { name: 'Support' }))
  const box = await screen.findByLabelText(/What went wrong/)
  fireEvent.change(box, { target: { value: 'The catalog page froze on my phone.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('SupportWidget', () => {
  beforeEach(() => {
    insertMock.mockReset()
    supabase.functions.invoke.mockReset()
    insertMock.mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'report-1' }, error: null }),
      }),
    })
    supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null })
  })

  it('files the report and pings notify-support with the new id', async () => {
    await fileReport()
    await waitFor(() =>
      expect(screen.getByText(/Thanks — it's on its way/)).toBeInTheDocument()
    )
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bug',
        message: 'The catalog page froze on my phone.',
      })
    )
    expect(supabase.functions.invoke).toHaveBeenCalledWith('notify-support', {
      body: { report_id: 'report-1' },
    })
  })

  it('still files the report when the email ping fails', async () => {
    supabase.functions.invoke.mockRejectedValue(new Error('function down'))
    await fileReport()
    await waitFor(() =>
      expect(screen.getByText(/Thanks — it's on its way/)).toBeInTheDocument()
    )
  })
})
