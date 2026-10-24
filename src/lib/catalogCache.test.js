import { describe, expect, it } from 'vitest'
import { loadCatalog } from './catalogCache'

// A fake Supabase client with two tables: catalog_meta serves
// a version, catalog_items serves paged rows and counts how
// many page requests it took (the egress witness).
function fakeClient({ version = 7, totalRows = 30, metaError = false } = {}) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: `id-${i}`, n: i }))
  const state = { catalogRequests: 0 }
  const client = {
    from: (table) => {
      if (table === 'catalog_meta') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                metaError ? { data: null, error: new Error('nope') } : { data: { version }, error: null },
            }),
          }),
        }
      }
      return {
        select: () => ({
          order: () => ({
            order: () => ({
              order: () => ({
                range: async (from, to) => {
                  state.catalogRequests++
                  return { data: all.slice(from, to + 1), count: totalRows }
                },
              }),
            }),
          }),
        }),
      }
    },
  }
  return { client, state }
}

function memoryStorage(initial = null) {
  const box = { record: initial }
  return {
    box,
    read: async () => box.record,
    write: async (record) => {
      box.record = record
    },
  }
}

describe('loadCatalog', () => {
  it('serves a version-matched cache without touching the catalog table', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const { client, state } = fakeClient({ version: 7 })
    const storage = memoryStorage({ version: 7, rows })
    const chunks = []
    const got = await loadCatalog(client, { storage, onChunk: (r) => chunks.push(r) })
    expect(got).toEqual(rows)
    expect(chunks).toEqual([rows])
    expect(state.catalogRequests).toBe(0)
  })

  it('downloads and caches when the cached version is behind', async () => {
    const { client, state } = fakeClient({ version: 8, totalRows: 30 })
    const storage = memoryStorage({ version: 7, rows: [{ id: 'stale' }] })
    const got = await loadCatalog(client, { storage })
    expect(got).toHaveLength(30)
    expect(state.catalogRequests).toBe(1)
    expect(storage.box.record.version).toBe(8)
    expect(storage.box.record.rows).toHaveLength(30)
  })

  it('downloads when there is no cache yet, then stamps it', async () => {
    const { client } = fakeClient({ version: 3, totalRows: 12 })
    const storage = memoryStorage(null)
    const got = await loadCatalog(client, { storage })
    expect(got).toHaveLength(12)
    expect(storage.box.record).toMatchObject({ version: 3 })
  })

  it('falls back to a plain download when the version check fails', async () => {
    const { client, state } = fakeClient({ metaError: true, totalRows: 9 })
    const storage = memoryStorage({ version: 7, rows: [{ id: 'a' }] })
    const got = await loadCatalog(client, { storage })
    expect(got).toHaveLength(9)
    expect(state.catalogRequests).toBe(1)
    // No version → never overwrite the cache with an unstamped copy.
    expect(storage.box.record.rows).toEqual([{ id: 'a' }])
  })

  it('a broken cache read still downloads', async () => {
    const { client } = fakeClient({ version: 7, totalRows: 5 })
    const storage = {
      read: async () => {
        throw new Error('idb gone')
      },
      write: async () => {},
    }
    const got = await loadCatalog(client, { storage })
    expect(got).toHaveLength(5)
  })
})
