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
  if (/^fe[89ab]/.test(h)) return true // link-local fe80::/10
  if (/^fe[c-f]/.test(h)) return true // site-local fec0::/10 (deprecated, still routable on some nets)
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local fc00::/7
  if (h.startsWith('ff')) return true // multicast ff00::/8
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped — judge the embedded IPv4 address.
    return ipv4IsPrivate(h.slice('::ffff:'.length)) ?? true
  }
  if (h.startsWith('64:ff9b:')) return true // NAT64 — embeds an IPv4 address
  if (h.startsWith('2002:')) return true // 6to4 — embeds an IPv4 address
  if (h.startsWith('::')) return true // IPv4-compatible forms such as ::7f00:1
  return false
}

// Suffixes that only ever name private / internal hosts.
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa']

export function isSafeFetchUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  // Public product pages live on the default ports; an odd port is how
  // internal services (admin panels, databases) get probed.
  if (url.port && url.port !== '80' && url.port !== '443') return false
  // URL keeps IPv6 literals bracketed in .hostname in some runtimes.
  // A trailing dot ("localhost.") is the same host to the resolver,
  // so it is stripped before any comparison.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host) return false
  const v4 = ipv4IsPrivate(host)
  if (v4 !== null) return v4 === false
  if (host.includes(':')) return !ipv6IsPrivate(host)
  // Public sites have a dotted name; single-label hosts ("metadata",
  // "localhost", "intranet") only resolve on private networks.
  if (!host.includes('.')) return false
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  return true
}

// ------------------------------------------- resolved-address guard
// isSafeFetchUrl judges the URL STRING, so a public-looking name that
// RESOLVES to a private address (an ordinary A/AAAA record pointing at
// 10.x, 127.x or a link-local address; no DNS race needed) passes it.
// assertPublicHost closes that: resolve the name and refuse the fetch
// when ANY answer is private. The resolver is injected so tests can
// fake DNS; createResolver builds the production one.
//
// Residual (documented, not closed here): fetch() resolves again at
// connect time and cannot be pinned to the address checked, so a
// resolver that answers differently between the check and the connect
// (DNS rebinding) is still possible. This guard removes the static
// case, which needs no timing at all.

export class HostGuardError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'HostGuardError'
    this.code = code // 'PRIVATE_ADDRESS' | 'UNRESOLVABLE'
  }
}

// An IPv6 text form (compressed, expanded, bracketed, with a dotted
// IPv4 tail or a zone id) as its eight 16-bit groups; null when it
// is not an IPv6 address.
function parseIPv6(raw) {
  let a = String(raw).toLowerCase().replace(/^\[|\]$/g, '')
  const zone = a.indexOf('%')
  if (zone >= 0) a = a.slice(0, zone)
  const tail4 = a.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (tail4) {
    const o = tail4[2].split('.').map(Number)
    if (o.some((n) => n > 255)) return null
    a = `${tail4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length
    if (fill < 1) return null
    groups = [...head, ...Array(fill).fill('0'), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return nums.some(Number.isNaN) ? null : nums
}

// Canonical compressed text (longest zero run -> "::"), the shape
// ipv6IsPrivate's prefix tests expect.
function compressIPv6(nums) {
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (nums[i] !== 0) {
      i += 1
      continue
    }
    let j = i
    while (j < 8 && nums[j] === 0) j += 1
    if (j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = nums.map((n) => n.toString(16))
  if (bestLen < 2) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

// Is this resolved address (as DNS returned it) a public one?
// Unparseable input is refused.
export function isPublicAddress(addr) {
  if (typeof addr !== 'string') return false
  const text = addr.trim()
  const v4 = ipv4IsPrivate(text)
  if (v4 !== null) return v4 === false
  const g = parseIPv6(text)
  if (!g) return false
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return ipv4IsPrivate(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`) === false
  }
  return !ipv6IsPrivate(compressIPv6(g))
}

// Throws HostGuardError unless every address `host` resolves to is
// public. `resolve(host)` returns the A and AAAA answers together as
// an array of address strings and must THROW on a lookup failure
// other than "no such record" (an unresolvable or half-resolved name
// is refused, never waved through). Literal-IP hosts need no lookup:
// isSafeFetchUrl already judged them, and they are re-judged here.
export async function assertPublicHost(host, resolve) {
  const h = String(host ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (!h) throw new HostGuardError('PRIVATE_ADDRESS', 'empty host')
  if (ipv4IsPrivate(h) !== null || h.includes(':')) {
    if (!isPublicAddress(h)) throw new HostGuardError('PRIVATE_ADDRESS', `${h} is not a public address`)
    return []
  }
  let answers
  try {
    answers = await resolve(h)
  } catch {
    throw new HostGuardError('UNRESOLVABLE', `could not resolve ${h}`)
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new HostGuardError('UNRESOLVABLE', `${h} has no A/AAAA records`)
  }
  for (const answer of answers) {
    if (!isPublicAddress(answer)) {
      throw new HostGuardError('PRIVATE_ADDRESS', `${h} resolves to a non-public address`)
    }
  }
  return answers
}

// Production resolver. PRIMARY: Deno.resolveDns (A and AAAA). If the
// runtime lacks it or refuses it for permission reasons, that
// resolver switches (and stays) on DNS-over-HTTPS to one fixed
// public resolver, so a missing capability can never turn the guard
// off. A lookup error that is not "no such record" propagates, and
// assertPublicHost then refuses the host. Both runtimes are
// injected (`deno`, `fetchImpl`) so tests can stand in for them.
export function createResolver({ deno, fetchImpl, dohUrl = 'https://cloudflare-dns.com/dns-query' } = {}) {
  let useDoh = typeof deno?.resolveDns !== 'function'
  const isCapabilityError = (e) =>
    e?.name === 'PermissionDenied' || e?.name === 'NotCapable' || e?.name === 'NotSupported'
  const viaDeno = async (host, type) => {
    try {
      return (await deno.resolveDns(host, type)).map(String)
    } catch (e) {
      if (e?.name === 'NotFound') return []
      throw e
    }
  }
  const viaDoh = async (host, type) => {
    const res = await fetchImpl(`${dohUrl}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`)
    const body = await res.json()
    if (body.Status === 3) return [] // NXDOMAIN
    if (body.Status !== 0) throw new Error(`DoH status ${body.Status}`)
    const want = type === 'A' ? 1 : 28
    return (body.Answer ?? []).filter((r) => r.type === want).map((r) => String(r.data))
  }
  const lookup = async (host, type) => {
    if (!useDoh) {
      try {
        return await viaDeno(host, type)
      } catch (e) {
        if (!isCapabilityError(e)) throw e
        useDoh = true
      }
    }
    return viaDoh(host, type)
  }
  return async (host) => {
    const [a, aaaa] = await Promise.all([lookup(host, 'A'), lookup(host, 'AAAA')])
    return [...a, ...aaaa]
  }
}

// ---------------------------------------------------------- content guard

// This is a kids' catalog (owner request 2026-10-22): pasted
// links are screened before anything is fetched or stored.
// Two signals, host first (highest precision): known adult
// retailers / adult TLDs are refused outright, and product
// titles are screened for explicit terms. Matching is
// word-boundary on tokenised text, so innocent substrings
// never trip it ("Middlesex", "Essex", a breast pump, a police
// costume's accessories all pass). The clinical vocabulary of
// ordinary puberty/anatomy books is deliberately NOT screened.
const ADULT_TLDS = new Set(['xxx', 'adult', 'porn', 'sex', 'tube', 'fans'])

const ADULT_HOSTS = [
  'adamandeve.com',
  'lovehoney.com',
  'lovehoney.co.uk',
  'lelo.com',
  'fleshlight.com',
  'tenga.co',
  'babeland.com',
  'goodvibes.com',
  'hustlerhollywood.com',
  'loverslane.com',
  'bellesa.co',
  'womanizer.com',
  'we-vibe.com',
  'satisfyer.com',
  'docjohnson.com',
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  'onlyfans.com',
]

const ADULT_TERMS = [
  'dildo',
  'dildos',
  'vibrator',
  'vibrators',
  'masturbator',
  'masturbation',
  'fleshlight',
  'butt plug',
  'butt plugs',
  'anal',
  'bdsm',
  'bondage',
  'fetish',
  'erotic',
  'erotica',
  'porn',
  'pornographic',
  'pornography',
  'hentai',
  'sex toy',
  'sex toys',
  'sextoy',
  'sextoys',
  'strap on',
  'strapon',
  'orgasm',
  'condom',
  'condoms',
  'aphrodisiac',
  'dominatrix',
  'edible underwear',
  'love doll',
  'blow up doll',
]

export function isBlockedHost(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  const tld = host.split('.').pop() ?? ''
  if (ADULT_TLDS.has(tld)) return true
  return ADULT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))
}

// True when the text carries an explicit adult term as a whole
// word or phrase. Tokenising first (non-alphanumerics become
// spaces) is what keeps the check honest: "sex" inside
// "Middlesex" is part of a longer token and never matches.
export function screenText(raw) {
  const norm = ` ${String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')} `
  return ADULT_TERMS.some((term) => norm.includes(` ${term} `) || norm.includes(` ${term}s `))
}

export function isBlockedTitle(title) {
  return screenText(title)
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
