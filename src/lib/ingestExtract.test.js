import { describe, expect, it } from 'vitest'
import {
  candidateKey,
  extractFromJsonLd,
  extractFromOpenGraph,
  isSafeFetchUrl,
  normalizeShopifyProduct,
  normalizeSuggestResult,
  platformForUrl,
} from '../../supabase/functions/ingest-catalog/extract.js'

// The ingest-catalog Edge Function's pure helpers. The function itself
// runs on Deno in production; these tests pin the parsing and safety
// rules it depends on, with store-shaped fixtures.

describe('platformForUrl', () => {
  it('maps the known store hosts to their platforms', () => {
    expect(platformForUrl('https://us.tonies.com/products/bluey')).toBe('tonies')
    expect(platformForUrl('https://us.yotoplay.com/products/the-gruffalo')).toBe('yoto')
    expect(platformForUrl('https://storypod.com/products/some-craftie')).toBe('storypod')
    expect(platformForUrl('https://www.playosmo.com/products/detective-agency')).toBe('osmo')
    expect(platformForUrl('https://www.littletikes.com/products/story-dream-machine')).toBe(
      'projector'
    )
    expect(platformForUrl('https://www.mymoonlite.com/products/biscuit')).toBe('projector')
  })

  it('maps the crawl-only stores too (link paste still works for them)', () => {
    expect(platformForUrl('https://store.leapfrog.com/en-us/products/leapstart')).toBe('leapfrog')
    expect(platformForUrl('https://lunii.com/en-us/products/some-album')).toBe('lunii')
  })

  it('falls back to other for unknown hosts and junk', () => {
    expect(platformForUrl('https://www.amazon.com/dp/B000000000')).toBe('other')
    expect(platformForUrl('not a url')).toBe('other')
    expect(platformForUrl('')).toBe('other')
  })
})

describe('isSafeFetchUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(isSafeFetchUrl('https://us.tonies.com/products/bluey')).toBe(true)
    expect(isSafeFetchUrl('http://example.com/page')).toBe(true)
    expect(isSafeFetchUrl('https://8.8.8.8/')).toBe(true)
    // Just outside 172.16.0.0/12 — a public address.
    expect(isSafeFetchUrl('https://172.32.0.1/')).toBe(true)
  })

  it('rejects non-web schemes and unparseable input', () => {
    expect(isSafeFetchUrl('ftp://example.com/file')).toBe(false)
    expect(isSafeFetchUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeFetchUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeFetchUrl('not a url')).toBe(false)
    expect(isSafeFetchUrl('')).toBe(false)
  })

  it('rejects localhost and .local names', () => {
    expect(isSafeFetchUrl('http://localhost:54321/rest/v1/')).toBe(false)
    expect(isSafeFetchUrl('http://printer.local/')).toBe(false)
    expect(isSafeFetchUrl('https://db.internal.localhost/')).toBe(false)
  })

  it('rejects private, loopback and link-local IP literals', () => {
    expect(isSafeFetchUrl('http://127.0.0.1/admin')).toBe(false)
    expect(isSafeFetchUrl('http://10.0.0.5/')).toBe(false)
    expect(isSafeFetchUrl('http://172.16.0.5/')).toBe(false)
    expect(isSafeFetchUrl('http://172.31.255.255/')).toBe(false)
    expect(isSafeFetchUrl('http://192.168.1.1/')).toBe(false)
    // The cloud metadata address — the classic SSRF target.
    expect(isSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeFetchUrl('http://[::1]/')).toBe(false)
    expect(isSafeFetchUrl('http://[fe80::1]/')).toBe(false)
    expect(isSafeFetchUrl('http://[fd00::1]/')).toBe(false)
  })

  it('rejects URLs carrying credentials', () => {
    expect(isSafeFetchUrl('https://user:pass@example.com/')).toBe(false)
  })
})

describe('extractFromJsonLd', () => {
  it('reads a single Product block, brand as details', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Bluey",
       "image":"https://cdn.example.com/bluey.png",
       "brand":{"@type":"Brand","name":"Tonies"}}
      </script>
      </head></html>`
    expect(extractFromJsonLd(html)).toEqual({
      title: 'Bluey',
      image_url: 'https://cdn.example.com/bluey.png',
      details: 'Tonies',
    })
  })

  it('takes the first image when image is an array, category as details', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"The Gruffalo",
       "image":["https://cdn.example.com/g1.jpg","https://cdn.example.com/g2.jpg"],
       "category":"Yoto Cards"}
      </script>`
    expect(extractFromJsonLd(html)).toEqual({
      title: 'The Gruffalo',
      image_url: 'https://cdn.example.com/g1.jpg',
      details: 'Yoto Cards',
    })
  })

  it('finds the Product inside an @graph document', () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"Shop"},
        {"@type":"Product","name":"Detective Agency",
         "image":"https://cdn.example.com/osmo.jpg","brand":"Osmo"}
      ]}
      </script>`
    expect(extractFromJsonLd(html)).toEqual({
      title: 'Detective Agency',
      image_url: 'https://cdn.example.com/osmo.jpg',
      details: 'Osmo',
    })
  })

  it('skips malformed blocks and non-products', () => {
    const html = `
      <script type="application/ld+json">{not json</script>
      <script type="application/ld+json">{"@type":"WebPage","name":"Just a page"}</script>`
    expect(extractFromJsonLd(html)).toBeNull()
    expect(extractFromJsonLd('<html><body>No data here</body></html>')).toBeNull()
    expect(extractFromJsonLd('')).toBeNull()
  })

  it('allows a product with no image', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product","name":"Mystery Toy"}</script>`
    expect(extractFromJsonLd(html)).toEqual({
      title: 'Mystery Toy',
      image_url: null,
      details: '',
    })
  })
})

describe('extractFromOpenGraph', () => {
  it('reads og:title / og:image in either attribute order', () => {
    const a = '<meta property="og:title" content="Caps for Sale"><meta property="og:image" content="https://cdn.example.com/caps.jpg">'
    const b = '<meta content="Caps for Sale" property="og:title"><meta content="https://cdn.example.com/caps.jpg" property="og:image">'
    for (const html of [a, b]) {
      expect(extractFromOpenGraph(html)).toEqual({
        title: 'Caps for Sale',
        image_url: 'https://cdn.example.com/caps.jpg',
        details: '',
      })
    }
  })

  it('decodes entities and fixes protocol-relative images', () => {
    const html =
      '<meta property="og:title" content="Tom &amp; Jerry&#8217;s Chase"><meta property="og:image" content="//cdn.example.com/tom.jpg">'
    expect(extractFromOpenGraph(html)).toEqual({
      title: 'Tom & Jerry’s Chase',
      image_url: 'https://cdn.example.com/tom.jpg',
      details: '',
    })
  })

  it('returns null without an og:title', () => {
    expect(extractFromOpenGraph('<meta property="og:image" content="https://x/y.jpg">')).toBeNull()
    expect(extractFromOpenGraph('')).toBeNull()
  })
})

describe('normalizeShopifyProduct', () => {
  const wrapped = {
    product: {
      title: 'Bluey',
      product_type: 'Tonie',
      image: { src: 'https://cdn.shopify.com/bluey.png' },
      images: [{ src: 'https://cdn.shopify.com/bluey.png' }],
    },
  }

  it('normalises the wrapped { product } shape and humanises details', () => {
    expect(normalizeShopifyProduct(wrapped, 'tonies')).toEqual({
      platform: 'tonies',
      title: 'Bluey',
      details: 'Tonie figure',
      image_url: 'https://cdn.shopify.com/bluey.png',
    })
  })

  it('accepts the bare product object, images array and unknown types', () => {
    const bare = {
      title: 'LeapStart: 3D',
      product_type: 'Activity Book',
      images: [{ src: 'https://cdn.example.com/leap.jpg' }],
    }
    expect(normalizeShopifyProduct(bare, 'leapfrog')).toEqual({
      platform: 'leapfrog',
      title: 'LeapStart: 3D',
      details: 'Activity Book',
      image_url: 'https://cdn.example.com/leap.jpg',
    })
  })

  it('handles a product with no image and no type', () => {
    expect(normalizeShopifyProduct({ title: 'Plain Thing' }, 'other')).toEqual({
      platform: 'other',
      title: 'Plain Thing',
      details: '',
      image_url: null,
    })
  })

  it('rejects junk', () => {
    expect(normalizeShopifyProduct(null, 'tonies')).toBeNull()
    expect(normalizeShopifyProduct({}, 'tonies')).toBeNull()
    expect(normalizeShopifyProduct({ product: { title: '  ' } }, 'tonies')).toBeNull()
  })
})

describe('normalizeSuggestResult', () => {
  const store = { id: 'tonies', origin: 'https://us.tonies.com', platform: 'tonies' }
  // Shaped like the real /search/suggest.json payload (verified live):
  // path-only url with tracking params, featured_image object.
  const product = {
    title: 'Bluey Tonies 3 Pack',
    type: 'Tonie',
    url: '/products/bluey-tonies-3pack?_pos=1&_psq=bluey&_ss=e',
    featured_image: { url: 'https://cdn.shopify.com/bluey-3pack.png' },
  }

  it('keeps only the product path and drops tracking params', () => {
    expect(normalizeSuggestResult(store, product)).toEqual({
      platform: 'tonies',
      title: 'Bluey Tonies 3 Pack',
      details: '',
      image_url: 'https://cdn.shopify.com/bluey-3pack.png',
      source_url: 'https://us.tonies.com/products/bluey-tonies-3pack',
    })
  })

  it('falls back to the plain image string and fixes // URLs', () => {
    const p = { ...product, featured_image: null, image: '//cdn.shopify.com/x.png' }
    expect(normalizeSuggestResult(store, p)?.image_url).toBe('https://cdn.shopify.com/x.png')
  })

  it('ignores non-product results', () => {
    expect(normalizeSuggestResult(store, { ...product, url: '/pages/about' })).toBeNull()
    expect(normalizeSuggestResult(store, null)).toBeNull()
    expect(normalizeSuggestResult(store, { url: '/products/x' })).toBeNull()
  })
})

describe('candidateKey', () => {
  it('dedupes on platform + case-insensitive title', () => {
    expect(candidateKey({ platform: 'tonies', title: 'Bluey' })).toBe(
      candidateKey({ platform: 'tonies', title: '  bluey ' })
    )
    expect(candidateKey({ platform: 'tonies', title: 'Bluey' })).not.toBe(
      candidateKey({ platform: 'yoto', title: 'Bluey' })
    )
  })
})
