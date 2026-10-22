// Pure helpers for the suggest-gift Edge Function: the SSRF
// guard and page-fact extraction, ported from ingest-catalog's
// extract.js (each function carries the subset it needs). Plain
// ESM, no Deno APIs, so vitest can exercise it from
// src/lib/suggestExtract.test.js.

// ------------------------------------------------------------- SSRF guard

// The function fetches URLs a visitor pasted, server-side. Only
// public http(s) pages are fair game: no localhost, no *.local
// names, and no literal IPs in private / reserved ranges (a URL
// could otherwise be pointed at cloud metadata endpoints or
// the LAN).
function ipv4IsPrivate(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null // not an IPv4 literal
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((o) => Number(o) > 255)) return true // malformed — refuse
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local / metadata
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a >= 240) return true // reserved / broadcast
  if (a >= 224) return true // multicast
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true // 192.0.0.0/24 + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  return false
}

function ipv6IsPrivate(host) {
  const h = host.toLowerCase()
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb'))
    return true // link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local fc00::/7
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped — judge the embedded IPv4 address.
    return ipv4IsPrivate(h.slice('::ffff:'.length)) ?? true
  }
  return false
}

export function isSafeFetchUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  // URL keeps IPv6 literals bracketed in .hostname in some runtimes.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local')) return false
  const v4 = ipv4IsPrivate(host)
  if (v4 !== null) return v4 === false
  if (host.includes(':')) return !ipv6IsPrivate(host)
  return true
}

// -------------------------------------------------------------- text tidy

const ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&reg;': '',
  '&trade;': '',
}

export function decodeEntities(s) {
  let out = String(s ?? '')
  for (const [from, to] of Object.entries(ENTITIES)) out = out.split(from).join(to)
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  out = out.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  return out
}

export function cleanText(raw) {
  return decodeEntities(raw)
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fixImageUrl(raw) {
  const s = cleanText(raw)
  if (!s) return null
  if (s.startsWith('//')) return `https:${s}`
  return s
}

// -------------------------------------------------------------- extraction

function* jsonLdBlocks(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      yield JSON.parse(m[1].trim())
    } catch {
      // A malformed block shouldn't sink the others.
    }
  }
}

function productNodes(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) productNodes(item, out)
  } else if (node && typeof node === 'object') {
    const type = node['@type']
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) out.push(node)
    if (node['@graph']) productNodes(node['@graph'], out)
    if (node.itemListElement) productNodes(node.itemListElement, out)
  }
  return out
}

function metaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1])
  }
  return ''
}

// The facts a proposal needs from a product page: title,
// picture, and the price when the page's structured data
// publishes one (JSON-LD offers — a single Offer or an
// AggregateOffer's lowPrice). Open Graph covers title/picture
// when there's no JSON-LD Product at all. Null when the page
// yields nothing — the caller degrades gracefully to the
// suggester's own words.
export function extractProductFacts(html) {
  if (!html) return null
  for (const doc of jsonLdBlocks(html)) {
    for (const product of productNodes(doc)) {
      const title = cleanText(product.name)
      if (!title) continue
      const image = Array.isArray(product.image) ? product.image[0] : product.image
      let price = null
      let currency = null
      const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers
      if (offers && typeof offers === 'object') {
        const p = Number(offers.price ?? offers.lowPrice)
        if (Number.isFinite(p) && p > 0) {
          price = Math.round(p * 100) / 100
          currency = cleanText(offers.priceCurrency) || null
        }
      }
      return {
        title,
        image_url: typeof image === 'string' ? fixImageUrl(image) : null,
        price,
        currency,
      }
    }
  }
  const ogTitle = cleanText(metaContent(html, 'og:title'))
  if (ogTitle) {
    return {
      title: ogTitle,
      image_url: fixImageUrl(metaContent(html, 'og:image')),
      price: null,
      currency: null,
    }
  }
  return null
}

// Canonical form for duplicate detection: tracking parameters
// and the fragment don't make a different gift.
export function normalizeGiftUrl(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return ''
  }
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|tag$)/i.test(k)) u.searchParams.delete(k)
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1)
  }
  return u.toString()
}
