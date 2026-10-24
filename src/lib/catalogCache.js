// The catalog, cached in the browser between visits.
//
// A full catalog download is ~1.5 MB gzipped (18k+ rows), and
// most visits used to pay it in full. The catalog only changes
// in batches — the weekly ingest, an admin action, a parent
// adding a product — and migration 0044 keeps a version counter
// on the server that every catalog write bumps. So:
//
// 1. Ask for the current version (one tiny request).
// 2. If the IndexedDB copy carries that version, serve it —
//    no catalog download at all, and the page renders at once.
// 3. Otherwise stream the catalog in exactly as before
//    (lib/catalogFetch, progressive chunks and all) and save
//    the result stamped with the version read in step 1.
//
// The version is read BEFORE the download on purpose: if the
// catalog changes mid-download the saved stamp is older than
// the server's, so the next visit simply re-downloads — the
// cache can be stale for one visit, never wrong-versioned.
// Every failure (no IndexedDB, private mode, the meta table
// unreachable) degrades to the plain network fetch: the cache
// is an optimization, never a dependency.

import { fetchCatalog } from './catalogFetch'

const DB_NAME = 'toy-library'
const STORE_NAME = 'catalog-cache'
const RECORD_KEY = 'current'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const indexedDbStorage = {
  async read() {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(RECORD_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  },
  async write(record) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put(record, RECORD_KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  },
}

const noStorage = {
  async read() {
    return null
  },
  async write() {},
}

export function defaultStorage() {
  return typeof indexedDB !== 'undefined' ? indexedDbStorage : noStorage
}

async function fetchCatalogVersion(client) {
  try {
    const { data, error } = await client
      .from('catalog_meta')
      .select('version')
      .eq('id', 1)
      .single()
    if (error || data?.version == null) return null
    const version = Number(data.version)
    return Number.isFinite(version) ? version : null
  } catch {
    return null
  }
}

export async function loadCatalog(client, { onChunk, storage } = {}) {
  const store = storage ?? defaultStorage()
  const version = await fetchCatalogVersion(client)

  if (version != null) {
    try {
      const cached = await store.read()
      if (
        cached &&
        cached.version === version &&
        Array.isArray(cached.rows) &&
        cached.rows.length > 0
      ) {
        onChunk?.(cached.rows)
        return cached.rows
      }
    } catch {
      // Unreadable cache → fall through to the network fetch.
    }
  }

  const rows = await fetchCatalog(client, { onChunk })
  if (version != null && rows.length > 0) {
    try {
      await store.write({ version, rows })
    } catch {
      // Best effort: a failed write only costs the next visit
      // its download, nothing more.
    }
  }
  return rows
}
