// Minimal polite HTTP for the ingestor: identifying user-agent,
// per-request timeout, and retry with backoff on 429/5xx/network errors.

const UA = 'ToyLibraryIngestor/1.0 (catalog sync for Toy Library)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function getText(url, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(500 * 2 ** attempt)
    }
  }
  throw new Error(`GET ${url} failed: ${lastErr.message}`)
}

export async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts))
}

// Runs async fn over items with bounded concurrency, preserving order.
export async function mapPool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}
