import { describe, expect, it } from 'vitest'
import * as ingest from '../../supabase/functions/ingest-catalog/extract.js'
import * as suggest from '../../supabase/functions/suggest-gift/extract.js'

// Audit 2026-11-10, finding O8: isSafeFetchUrl judges the URL string,
// so a public-looking name that RESOLVES to a private address passed it.
// assertPublicHost (resolved-address check, run before the first request
// and before every redirect hop in ingest-catalog's fetchTextCapped) and a
// port restriction close that. Both extract.js copies carry the same code;
// every guard test below runs against both so they cannot drift apart.

const COPIES = [
  ['ingest-catalog', ingest],
  ['suggest-gift', suggest],
]

// A resolver double: name -> addresses (or an Error to throw).
const fakeDns = (table) => async (host) => {
  const hit = table[host]
  if (hit instanceof Error) throw hit
  return hit ?? []
}

// Resolve a promise to the thrown error (or null when it did not throw).
// try/catch rather than `.rejects`, so the tests read the same everywhere.
async function failure(promise) {
  try {
    await promise
    return null
  } catch (err) {
    return err
  }
}

for (const [label, mod] of COPIES) {
  describe(`${label}: port restriction in isSafeFetchUrl`, () => {
    it('allows default ports, explicit 80/443, and rejects every other port', () => {
      expect(mod.isSafeFetchUrl('https://example.com/p')).toBe(true)
      expect(mod.isSafeFetchUrl('http://example.com/p')).toBe(true)
      expect(mod.isSafeFetchUrl('http://example.com:80/p')).toBe(true)
      expect(mod.isSafeFetchUrl('https://example.com:443/p')).toBe(true)
      expect(mod.isSafeFetchUrl('https://example.com:8443/p')).toBe(false)
      expect(mod.isSafeFetchUrl('http://example.com:8080/p')).toBe(false)
      expect(mod.isSafeFetchUrl('http://example.com:22/')).toBe(false)
      expect(mod.isSafeFetchUrl('http://example.com:5432/')).toBe(false)
      expect(mod.isSafeFetchUrl('http://shop.rebind.test:8099/')).toBe(false)
    })
  })

  describe(`${label}: assertPublicHost`, () => {
    it('accepts a name whose every answer is public', async () => {
      const dns = fakeDns({ 'shop.example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] })
      expect(await mod.assertPublicHost('shop.example.com', dns)).toEqual([
        '93.184.216.34',
        '2606:2800:220:1:248:1893:25c8:1946',
      ])
    })

    it('rejects a public-looking name that resolves to a private IPv4 address', async () => {
      for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
        const err = await failure(mod.assertPublicHost('shop.example.com', fakeDns({ 'shop.example.com': [ip] })))
        expect(err instanceof mod.HostGuardError).toBe(true)
        expect(err.code).toBe('PRIVATE_ADDRESS')
      }
    })

    it('rejects a name that resolves to a private IPv6 address, in any text form', async () => {
      for (const ip of [
        '::1',
        '0:0:0:0:0:0:0:1',
        'fe80::1',
        'fd00::5',
        'fc00:1::1',
        'fec0::1',
        'ff02::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '0:0:0:0:0:ffff:a00:1',
        '64:ff9b::7f00:1',
        '2002:7f00:1::1',
      ]) {
        const err = await failure(mod.assertPublicHost('shop.example.com', fakeDns({ 'shop.example.com': [ip] })))
        expect(err instanceof mod.HostGuardError).toBe(true)
        expect(err.code).toBe('PRIVATE_ADDRESS')
      }
    })

    it('rejects a name with MIXED public and private answers', async () => {
      const dns = fakeDns({ 'mixed.example.com': ['93.184.216.34', '10.0.0.7'] })
      const err = await failure(mod.assertPublicHost('mixed.example.com', dns))
      expect(err.code).toBe('PRIVATE_ADDRESS')
      const v6 = fakeDns({ 'mixed6.example.com': ['93.184.216.34', '::1'] })
      expect((await failure(mod.assertPublicHost('mixed6.example.com', v6))).code).toBe('PRIVATE_ADDRESS')
    })

    it('treats an IPv4-mapped PUBLIC address as public (embedded address is judged)', async () => {
      const dns = fakeDns({ 'm.example.com': ['::ffff:5db8:d822'] })
      expect(await mod.assertPublicHost('m.example.com', dns)).toEqual(['::ffff:5db8:d822'])
    })

    it('refuses unresolvable names, empty answers and a failing resolver (never waves through)', async () => {
      expect((await failure(mod.assertPublicHost('nx.example.com', fakeDns({})))).code).toBe('UNRESOLVABLE')
      expect(
        (await failure(mod.assertPublicHost('x.example.com', fakeDns({ 'x.example.com': new Error('SERVFAIL') })))).code,
      ).toBe('UNRESOLVABLE')
      expect((await failure(mod.assertPublicHost('x.example.com', async () => null))).code).toBe('UNRESOLVABLE')
      expect((await failure(mod.assertPublicHost('x.example.com', fakeDns({ 'x.example.com': ['not-an-ip'] })))).code).toBe(
        'PRIVATE_ADDRESS',
      )
    })

    it('judges IP-literal hosts directly, without asking the resolver', async () => {
      let asked = false
      const dns = async () => {
        asked = true
        return ['93.184.216.34']
      }
      expect((await failure(mod.assertPublicHost('127.0.0.1', dns))).code).toBe('PRIVATE_ADDRESS')
      expect((await failure(mod.assertPublicHost('[::1]', dns))).code).toBe('PRIVATE_ADDRESS')
      expect(await mod.assertPublicHost('93.184.216.34', dns)).toEqual([])
      expect(asked).toBe(false)
    })

    it('ignores a trailing dot and case on the host', async () => {
      const dns = fakeDns({ 'shop.example.com': ['10.0.0.1'] })
      expect((await failure(mod.assertPublicHost('SHOP.Example.com.', dns))).code).toBe('PRIVATE_ADDRESS')
    })

    // The contract fetchTextCapped relies on (ingest-catalog/index.ts):
    // assertPublicHost runs for the first URL and again for every redirect
    // hop, so a public first hop that redirects to a name resolving
    // privately is refused at the second hop. (The real loop is Deno code
    // and is not importable here; see the manifest for the run that drove it.)
    it('refuses a redirect hop to a private-resolving name after a public first hop', async () => {
      const dns = fakeDns({
        'shop.example.com': ['93.184.216.34'],
        'internal.example.net': ['10.0.0.9'],
      })
      const hops = ['https://shop.example.com/a', 'https://internal.example.net/b']
      let refusedAt = -1
      for (let i = 0; i < hops.length; i++) {
        const err = await failure(mod.assertPublicHost(new URL(hops[i]).hostname, dns))
        if (err) {
          refusedAt = i
          break
        }
      }
      expect(refusedAt).toBe(1)
    })
  })

  describe(`${label}: isPublicAddress`, () => {
    it('classifies common public and private literals', () => {
      expect(mod.isPublicAddress('8.8.8.8')).toBe(true)
      expect(mod.isPublicAddress('2606:4700:4700::1111')).toBe(true)
      expect(mod.isPublicAddress('10.0.0.1')).toBe(false)
      expect(mod.isPublicAddress('::')).toBe(false)
      expect(mod.isPublicAddress('')).toBe(false)
      expect(mod.isPublicAddress(undefined)).toBe(false)
      expect(mod.isPublicAddress('1.2.3')).toBe(false)
    })
  })

  describe(`${label}: createResolver`, () => {
    const notFound = () => Object.assign(new Error('no record'), { name: 'NotFound' })
    const denied = () => Object.assign(new Error('requires net access'), { name: 'PermissionDenied' })

    it('uses Deno.resolveDns for A and AAAA, and treats NotFound as no records', async () => {
      const calls = []
      const deno = {
        resolveDns: async (host, type) => {
          calls.push(`${type}:${host}`)
          if (type === 'AAAA') throw notFound()
          return ['93.184.216.34']
        },
      }
      const resolve = mod.createResolver({ deno, fetchImpl: async () => { throw new Error('DoH must not be used') } })
      expect(await resolve('shop.example.com')).toEqual(['93.184.216.34'])
      expect(calls.sort()).toEqual(['A:shop.example.com', 'AAAA:shop.example.com'])
    })

    it('propagates any other Deno lookup error (so assertPublicHost refuses the host)', async () => {
      const deno = { resolveDns: async () => { throw new Error('connection refused') } }
      const resolve = mod.createResolver({ deno, fetchImpl: async () => ({ ok: true, json: async () => ({ Status: 0 }) }) })
      expect((await failure(mod.assertPublicHost('shop.example.com', resolve))).code).toBe('UNRESOLVABLE')
    })

    it('falls back to DNS-over-HTTPS when Deno.resolveDns is denied, keeps the answers checked', async () => {
      const urls = []
      const fetchImpl = async (url) => {
        urls.push(url)
        const type = new URL(url).searchParams.get('type')
        const answer =
          type === 'A'
            ? [
                { type: 5, data: 'cdn.example.net.' },
                { type: 1, data: '10.0.0.8' },
              ]
            : []
        return { ok: true, json: async () => ({ Status: 0, Answer: answer }) }
      }
      const resolve = mod.createResolver({ deno: { resolveDns: async () => { throw denied() } }, fetchImpl })
      expect(await resolve('shop.example.com')).toEqual(['10.0.0.8'])
      expect(urls.every((u) => u.startsWith('https://cloudflare-dns.com/dns-query?name=shop.example.com&type='))).toBe(true)
      expect((await failure(mod.assertPublicHost('shop.example.com', resolve))).code).toBe('PRIVATE_ADDRESS')
    })

    it('uses DoH when there is no Deno.resolveDns at all; NXDOMAIN is "no records", other statuses throw', async () => {
      const make = (status) =>
        mod.createResolver({ deno: undefined, fetchImpl: async () => ({ ok: true, json: async () => ({ Status: status }) }) })
      expect(await make(3)('gone.example.com')).toEqual([])
      expect((await failure(make(2)('broken.example.com'))) instanceof Error).toBe(true)
      const http500 = mod.createResolver({ deno: undefined, fetchImpl: async () => ({ ok: false, status: 500 }) })
      expect((await failure(http500('x.example.com'))) instanceof Error).toBe(true)
    })
  })
}

describe('guard parity between the two extract.js copies', () => {
  const URLS = [
    'http://localhost./',
    'http://foo.local./',
    'http://[::127.0.0.1]/',
    'http://[fec0::1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://metadata.google.internal/',
    'http://metadata/',
    'http://169.254.169.254/',
    'http://[::ffff:7f00:1]/',
    'http://[2002:7f00:1::]/',
    'http://100.64.0.1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://example.com:8080/',
    'https://example.com:8443/',
    'http://example.com:80/',
    'https://example.com:443/',
    'https://example.com/',
  ]
  it('agrees on every adversarial URL', () => {
    for (const u of URLS) expect(ingest.isSafeFetchUrl(u)).toBe(suggest.isSafeFetchUrl(u))
  })
  it('agrees on resolved-address classification', () => {
    for (const ip of ['8.8.8.8', '10.0.0.1', '::1', '::ffff:7f00:1', '2606:4700:4700::1111', 'nope']) {
      expect(ingest.isPublicAddress(ip)).toBe(suggest.isPublicAddress(ip))
    }
  })
})
