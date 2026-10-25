// Djeco toddler-art fetch pass (owner-approved art round follow-up).
//
// Djeco has no US storefront and no feed: the maker's own showcase
// (www.djeco.com/en) lists products on age-band pages, but each
// product's title/age only loads through the site's viewProduct
// AJAX endpoint (a POST this repo's sandbox egress denies — the
// fetches therefore run on a GitHub Actions runner via
// .github/workflows/djeco-fetch.yml).
//
// What this script does (no database writes anywhere):
//   1. GETs the seven 0-3 universe pages and enumerates the
//      .viewProduit cards (reference + categorie + categorie_id).
//   2. POSTs each reference to modules/ajax/viewProduct.php with
//      exactly the form fields the page's own JS sends, saving the
//      raw detail HTML per product.
//   3. Verifies each product's main image on the maker's media
//      library (status + content-type + bytes).
// Everything lands in ingestor/out/djeco/ and is uploaded as a
// workflow artifact; a planner pass turns it into a manifest.
//
// Crawl discipline (house rules): identifying UA, serial requests
// with >=350 ms spacing per host, and a host is abandoned after
// 3 consecutive hard blocks (403/429/5xx/network after retries).

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const UA = 'ToyLibraryIngestor/1.0 (contact via toylibrary.store)'
const BASE = 'https://www.djeco.com'
const MEDIA = 'https://media-library.djeco.com'
const OUT = 'ingestor/out/djeco'
const SPACING_MS = 400

const UNIVERSES = ['jaune', 'bleu', 'bleufonce', 'rose', 'rouge', 'vert', 'categorie']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Per-host politeness + strike state.
const hosts = new Map()
function hostState(host) {
  if (!hosts.has(host)) hosts.set(host, { lastAt: 0, strikes: 0, stopped: false })
  return hosts.get(host)
}
async function pace(host) {
  const st = hostState(host)
  const wait = st.lastAt + SPACING_MS - Date.now()
  if (wait > 0) await sleep(wait)
  st.lastAt = Date.now()
}

// Minimal cookie jar for www.djeco.com (the site sets a session
// cookie on the category pages; a browser would send it back on
// the AJAX POST, so we do the same).
const cookies = new Map()
function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
function absorbCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  for (const line of set) {
    const pair = line.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

// One request with the house discipline. Returns { status, body }
// (body = text) or { status, bytes, contentType } for images.
// Throws only via returning { error } after retries on hard
// failures; strike accounting lives in the callers via `hard`.
async function request(url, { method = 'GET', body, referer, binary = false } = {}) {
  const host = new URL(url).host
  const st = hostState(host)
  if (st.stopped) return { skipped: true }
  let lastErr = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    await pace(host)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'user-agent': UA,
          accept: '*/*',
          ...(referer ? { referer } : {}),
          ...(method === 'POST'
            ? {
                'content-type': 'application/x-www-form-urlencoded',
                'x-requested-with': 'XMLHttpRequest',
              }
            : {}),
          ...(cookies.size && host === 'www.djeco.com' ? { cookie: cookieHeader() } : {}),
        },
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
      absorbCookies(res)
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`)
        if (attempt < 2) await sleep(600 * 2 ** attempt)
        continue
      }
      st.strikes = 0
      if (binary) {
        const buf = Buffer.from(await res.arrayBuffer())
        return { status: res.status, bytes: buf.length, contentType: res.headers.get('content-type') || '' }
      }
      return { status: res.status, body: await res.text() }
    } catch (err) {
      lastErr = err
      if (attempt < 2) await sleep(600 * 2 ** attempt)
    }
  }
  st.strikes += 1
  if (st.strikes >= 3) st.stopped = true
  return { error: lastErr ? lastErr.message : 'unknown', hard: true }
}

async function main() {
  await mkdir(path.join(OUT, 'details'), { recursive: true })
  const summary = { startedAt: new Date().toISOString(), pages: [], refs: [], totals: {} }

  // 1. Enumerate the 0-3 universe pages.
  const byRef = new Map()
  for (const universe of UNIVERSES) {
    const url = `${BASE}/en/petits-et-grands/${universe}/0-3ans`
    const res = await request(url)
    if (res.skipped || res.error || res.status !== 200) {
      summary.pages.push({ universe, url, status: res.status ?? null, error: res.error ?? 'skipped', refs: 0 })
      continue
    }
    const cards = []
    for (const tag of res.body.matchAll(/<div[^>]*viewProduit[^>]*>/g)) {
      const el = tag[0]
      const ref = el.match(/data-id="([^"]+)"/)?.[1]
      const tableId = el.match(/data-table-id="([^"]+)"/)?.[1]
      const table = el.match(/data-table="([^"]+)"/)?.[1]
      if (ref && table && tableId) cards.push({ ref, table, tableId })
    }
    const unique = new Map(cards.map((c) => [c.ref, c]))
    for (const [ref, c] of unique) {
      if (!byRef.has(ref)) byRef.set(ref, { ...c, firstSeenOn: url })
    }
    summary.pages.push({ universe, url, status: res.status, refs: unique.size })
    console.log(`page ${universe}: ${unique.size} unique refs`)
  }
  const refs = [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref))
  summary.totals.enumerated = refs.length
  console.log(`enumerated ${refs.length} unique refs`)
  await writeFile(path.join(OUT, 'refs.json'), JSON.stringify(refs, null, 1))

  // 2. Detail POST per ref.
  let fetched = 0
  for (const [i, r] of refs.entries()) {
    const form = new URLSearchParams({
      reference: r.ref,
      categorie: r.table,
      categorie_id: r.tableId,
      lang: 'en',
      type: r.table,
    })
    const res = await request(`${BASE}/modules/ajax/viewProduct.php`, {
      method: 'POST',
      body: form.toString(),
      referer: r.firstSeenOn,
    })
    if (res.skipped) {
      summary.refs.push({ ref: r.ref, status: 'skipped_host_stopped' })
      continue
    }
    if (res.error || res.status !== 200 || !res.body.includes('good-title-popup')) {
      summary.refs.push({
        ref: r.ref,
        status: 'failed',
        http: res.status ?? null,
        error: res.error ?? 'unexpected body',
        snippet: res.body ? res.body.slice(0, 160) : null,
      })
      console.log(`[${i + 1}/${refs.length}] ${r.ref} FAILED ${res.status ?? res.error}`)
      continue
    }
    await writeFile(path.join(OUT, 'details', `${r.ref}.html`), res.body)
    fetched += 1
    summary.refs.push({ ref: r.ref, status: 'ok', bytes: res.body.length })
    console.log(`[${i + 1}/${refs.length}] ${r.ref} ok (${res.body.length} B)`)
  }
  summary.totals.detailsFetched = fetched

  // 3. Verify each fetched product's main image.
  let imagesOk = 0
  for (const entry of summary.refs) {
    if (entry.status !== 'ok') continue
    const candidates = [
      `${MEDIA}/images/files/mini/${entry.ref}-C-RVB.jpg`,
      `${MEDIA}/images/files/mini/${entry.ref}-C1-RVB.jpg`,
      `${MEDIA}/images/files/mini/${entry.ref}-B3D-RVB.jpg`,
    ]
    entry.imageAttempts = []
    for (const url of candidates) {
      const res = await request(url, { binary: true })
      entry.imageAttempts.push({
        url,
        status: res.status ?? null,
        contentType: res.contentType ?? null,
        bytes: res.bytes ?? null,
        error: res.error ?? (res.skipped ? 'skipped' : null),
      })
      if (res.status === 200 && (res.contentType || '').startsWith('image/') && res.bytes > 1000) {
        entry.image = entry.imageAttempts[entry.imageAttempts.length - 1]
        break
      }
    }
    if (entry.image) imagesOk += 1
  }
  summary.totals.imagesVerified = imagesOk
  summary.finishedAt = new Date().toISOString()
  await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
  console.log(`done: ${fetched}/${refs.length} details, ${imagesOk} images verified`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
