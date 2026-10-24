import { describe, expect, it } from 'vitest'
import { CATALOG_COLUMNS, fetchCatalog } from './catalogFetch'

// A fake Supabase client that serves a synthetic catalog in
// pages, recording how it was asked and how many requests
// were ever in flight at once (the parallelism witness).
function fakeClient(totalRows, { withCount = true, delayMs = 15 } = {}) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: `id-${i}`, n: i }))
  const state = { inFlight: 0, maxInFlight: 0, selects: [] }
  const client = {
    from: () => ({
      select: (cols, opts) => {
        state.selects.push(cols)
        return {
          order: () => ({
            order: () => ({
              order: () => ({
                range: async (from, to) => {
                  state.inFlight++
                  state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
                  await new Promise((r) => setTimeout(r, delayMs))
                  state.inFlight--
                  return {
                    data: all.slice(from, to + 1),
                    count: withCount ? (opts?.count ? totalRows : undefined) : undefined,
                  }
                },
              }),
            }),
          }),
        }
      },
    }),
  }
  return { client, state }
}

describe('fetchCatalog', () => {
  it('assembles every page in catalog order', async () => {
    const { client } = fakeClient(2500)
    const rows = await fetchCatalog(client)
    expect(rows).toHaveLength(2500)
    expect(rows[0].n).toBe(0)
    expect(rows[2499].n).toBe(2499)
  })

  it('asks for the slim column set, never *', async () => {
    const { client, state } = fakeClient(10)
    await fetchCatalog(client)
    expect(state.selects.every((s) => s === CATALOG_COLUMNS)).toBe(true)
    expect(CATALOG_COLUMNS).not.toContain('source_url')
  })

  it('emits progressive prefixes starting with the first page', async () => {
    const { client } = fakeClient(2500)
    const chunks = []
    await fetchCatalog(client, { onChunk: (rows) => chunks.push(rows.length) })
    expect(chunks[0]).toBe(1000)
    expect(chunks[chunks.length - 1]).toBe(2500)
    expect(chunks).toEqual([...chunks].sort((a, b) => a - b))
  })

  it('fetches pages in parallel, not one at a time', async () => {
    const { client, state } = fakeClient(9500, { delayMs: 20 })
    await fetchCatalog(client)
    expect(state.maxInFlight).toBeGreaterThan(1)
  })

  it('a one-page catalog costs one request', async () => {
    const { client, state } = fakeClient(42)
    const rows = await fetchCatalog(client)
    expect(rows).toHaveLength(42)
    expect(state.selects).toHaveLength(1)
  })

  it('still terminates when the client reports no count', async () => {
    const { client } = fakeClient(2300, { withCount: false })
    const rows = await fetchCatalog(client)
    expect(rows).toHaveLength(2300)
  })
})
