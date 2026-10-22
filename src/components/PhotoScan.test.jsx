import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PhotoScan from './PhotoScan'
import { AuthProvider, useAuth } from '../lib/auth'

function Harness(props) {
  const { user, loading } = useAuth()
  if (loading || !user) return null
  return <PhotoScan {...props} />
}

const invoke = vi.fn()
const inserted = []
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: 'p@example.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    functions: { invoke: (...args) => invoke(...args) },
    from: () => ({
      insert: (payload) => {
        inserted.push(payload)
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { ...payload, id: `id-${payload.title}` }, error: null }),
          }),
        }
      },
    }),
  },
}))
vi.mock('../lib/photoImage', () => ({
  fileToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}))

const CATALOG = [
  { id: 'c2', platform: 'tonies', title: 'Bluey', details: 'Character Tonie', image_url: 'https://img/bluey.png', asin: null },
]
const baseProps = {
  kids: [{ id: 'k1', name: 'Sam' }],
  catalogRows: CATALOG,
  items: [],
  initialChildId: 'k1',
  uploadPhoto: async () => 'https://img/shelf.jpg',
  onAdded: vi.fn(),
}

async function pickPhotoAndScan(container) {
  // The harness mounts PhotoScan only once the mocked session
  // resolves — wait for the section before reaching for inputs.
  await screen.findByText(/Add from a photo/)
  const input = container.querySelector('input[type="file"]')
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'shelf.jpg', { type: 'image/jpeg' })] },
  })
  fireEvent.click(screen.getByRole('button', { name: /Spot the toys/ }))
}

describe('PhotoScan', () => {
  it('matches detections to the catalog and adds the confirmed ones', async () => {
    inserted.length = 0
    invoke.mockResolvedValue({
      data: {
        configured: true,
        items: [
          { title: 'Bluey', platform: 'tonies', confidence: 0.95 },
          { title: 'Mystery Gadget', platform: 'other', confidence: 0.4 },
        ],
        scansLeft: 9,
      },
      error: null,
    })
    const onAdded = vi.fn()
    const { container } = render(
      <AuthProvider>
        <Harness {...baseProps} onAdded={onAdded} />
      </AuthProvider>
    )
    await pickPhotoAndScan(container)

    expect(await screen.findByText('found in the catalog', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('not in the catalog', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add 2 to/ }))
    expect(await screen.findByText(/Added 2 items to Sam/)).toBeInTheDocument()
    expect(onAdded).toHaveBeenCalledOnce()
    expect(onAdded.mock.calls[0][0]).toHaveLength(2)
    // The matched add carries catalog data; the unmatched one
    // keeps the parent's photo as its picture.
    const matched = inserted.find((p) => p.title === 'Bluey')
    expect(matched.image_url).toBe('https://img/bluey.png')
    expect(matched.child_id).toBe('k1')
    const manual = inserted.find((p) => p.title === 'Mystery Gadget')
    expect(manual.image_url).toBe('https://img/shelf.jpg')
    expect(screen.getByText(/9 of today’s 10 photo scans left/)).toBeInTheDocument()
  })

  it('explains the daily limit when the scans are used up', async () => {
    invoke.mockResolvedValue({
      data: { configured: true, limited: true, limit: 10, items: [] },
      error: null,
    })
    const { container } = render(
      <AuthProvider>
        <Harness {...baseProps} />
      </AuthProvider>
    )
    await pickPhotoAndScan(container)
    expect(await screen.findByText(/all 10 of today’s photo scans used/)).toBeInTheDocument()
    expect(screen.getByText(/0 of today’s 10 photo scans left/)).toBeInTheDocument()
  })

  it('says so plainly when photo scanning is not switched on', async () => {
    invoke.mockResolvedValue({ data: { configured: false, items: [] }, error: null })
    const { container } = render(
      <AuthProvider>
        <Harness {...baseProps} />
      </AuthProvider>
    )
    await pickPhotoAndScan(container)
    expect(await screen.findByText(/switched on yet/)).toBeInTheDocument()
  })

  it('flags detections that are already on the have list', async () => {
    invoke.mockResolvedValue({
      data: { configured: true, items: [{ title: 'Bluey', platform: 'tonies', confidence: 0.9 }] },
      error: null,
    })
    const items = [
      { platform: 'tonies', title: 'Bluey', list_type: 'have', child_id: 'k1' },
    ]
    const { container } = render(
      <AuthProvider>
        <Harness {...baseProps} items={items} />
      </AuthProvider>
    )
    await pickPhotoAndScan(container)
    expect(await screen.findByText(/Already on the have list/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add 0 to/ })).toBeDisabled()
  })
})
