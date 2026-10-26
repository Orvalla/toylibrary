import { describe, expect, it } from 'vitest'
import {
  candidateKey,
  collectionPageUrl,
  extractAggregateRating,
  extractAllFromJsonLd,
  extractFromJsonLd,
  extractFromOpenGraph,
  extractOgType,
  extractProductLinks,
  isSafeFetchUrl,
  normalizeShopifyProduct,
  normalizeSuggestResult,
  parseShopifyPath,
  extractAgeRange,
  planCollectionImport,
  platformForProduct,
  planRowImport,
  faviconUrlFor,
  platformForUrl,
  isBlockedHost,
  isBlockedTitle,
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
    expect(platformForUrl('https://www.littletikes.com/products/cozy-coupe')).toBe(
      'littletikes'
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
      rating: null,
      rating_count: null,
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
      rating: null,
      rating_count: null,
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
      rating: null,
      rating_count: null,
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
      rating: null,
      rating_count: null,
    })
  })
})

describe('extractAggregateRating', () => {
  it('reads a Product aggregateRating with string values (the Osmo shape)', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Numbers Game",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.7","reviewCount":"2,648"}}
      </script>`
    expect(extractAggregateRating(html)).toEqual({ rating: 4.7, rating_count: 2648 })
  })

  it('accepts numeric values and prefers ratingCount over reviewCount', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Word Game",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":4.25,"ratingCount":312,"reviewCount":98}}
      </script>`
    expect(extractAggregateRating(html)).toEqual({ rating: 4.3, rating_count: 312 })
  })

  it('finds the rated Product inside an @graph document', () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"Shop"},
        {"@type":"Product","name":"Detective Agency",
         "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","ratingCount":"1,024"}}
      ]}
      </script>`
    expect(extractAggregateRating(html)).toEqual({ rating: 4.9, rating_count: 1024 })
  })

  it('rescales when the block declares a non-5 bestRating', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Percent Rated",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":"92","bestRating":"100","ratingCount":40}}
      </script>`
    expect(extractAggregateRating(html)).toEqual({ rating: 4.6, rating_count: 40 })
  })

  it('returns a rating with a null count when the count is unusable', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Countless",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":5,"reviewCount":"lots"}}
      </script>`
    expect(extractAggregateRating(html)).toEqual({ rating: 5, rating_count: null })
  })

  it('returns null when no Product publishes a rating', () => {
    expect(
      extractAggregateRating(
        '<script type="application/ld+json">{"@type":"Product","name":"Unrated"}</script>'
      )
    ).toBeNull()
    expect(extractAggregateRating('<html><body>No data here</body></html>')).toBeNull()
    expect(extractAggregateRating('')).toBeNull()
  })

  it('rejects nonsense ratings rather than storing them', () => {
    const zero = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Zero",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":"0","ratingCount":12}}
      </script>`
    expect(extractAggregateRating(zero)).toBeNull()
    const over = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Over",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":"7.5","ratingCount":12}}
      </script>`
    expect(extractAggregateRating(over)).toBeNull()
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
      is_bundle: false,
      image_url: 'https://cdn.shopify.com/bluey.png',
      age_min_years: null,
      age_max_years: null,
      rating: null,
      rating_count: null,
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
      is_bundle: false,
      image_url: 'https://cdn.example.com/leap.jpg',
      age_min_years: null,
      age_max_years: null,
      rating: null,
      rating_count: null,
    })
  })

  it('handles a product with no image and no type', () => {
    expect(normalizeShopifyProduct({ title: 'Plain Thing' }, 'other')).toEqual({
      platform: 'other',
      title: 'Plain Thing',
      details: '',
      is_bundle: false,
      image_url: null,
      age_min_years: null,
      age_max_years: null,
      rating: null,
      rating_count: null,
    })
  })

  it('rejects junk', () => {
    expect(normalizeShopifyProduct(null, 'tonies')).toBeNull()
    expect(normalizeShopifyProduct({}, 'tonies')).toBeNull()
    expect(normalizeShopifyProduct({ product: { title: '  ' } }, 'tonies')).toBeNull()
  })

  it('flags the pack product types as bundles from the type signal', () => {
    for (const [type, details] of [
      ['bundle', 'Yoto Card pack'],
      ['soft-bundle', 'Yoto Card pack'],
      ['Content Bundle', 'Content bundle'],
    ]) {
      const row = normalizeShopifyProduct({ title: 'Some Pack', product_type: type, images: [] }, 'yoto')
      expect(row?.details).toBe(details)
      expect(row?.is_bundle).toBe(true)
    }
    expect(
      normalizeShopifyProduct({ title: 'Single Card', product_type: 'single-card', images: [] }, 'yoto')
        ?.is_bundle,
    ).toBe(false)
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

describe('extractAllFromJsonLd', () => {
  it('returns every Product in an ItemList, in order', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"ItemList","itemListElement":[
        {"@type":"Product","name":"First Toy","image":"https://cdn.example.com/1.jpg","brand":"Acme"},
        {"@type":"Product","name":"Second Toy","image":"https://cdn.example.com/2.jpg"}
      ]}
      </script>`
    expect(extractAllFromJsonLd(html)).toEqual([
      { title: 'First Toy', image_url: 'https://cdn.example.com/1.jpg', details: 'Acme', rating: null, rating_count: null },
      { title: 'Second Toy', image_url: 'https://cdn.example.com/2.jpg', details: '', rating: null, rating_count: null },
    ])
  })

  it('returns a single product page as a one-item list, and [] for none', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Solo"}</script>`
    expect(extractAllFromJsonLd(html)).toHaveLength(1)
    expect(extractAllFromJsonLd('<html><body>nothing</body></html>')).toEqual([])
    expect(extractAllFromJsonLd('')).toEqual([])
  })
})

describe('parseShopifyPath', () => {
  it('recognises product pages, including collection-scoped and locale ones', () => {
    expect(parseShopifyPath('https://us.tonies.com/products/bluey')).toEqual({
      kind: 'product',
      handle: 'bluey',
    })
    expect(parseShopifyPath('https://us.tonies.com/collections/all-tonies/products/bluey')).toEqual(
      { kind: 'product', handle: 'bluey' }
    )
    expect(parseShopifyPath('https://us.tonies.com/en-us/products/bluey?variant=1')).toEqual({
      kind: 'product',
      handle: 'bluey',
    })
  })

  it('recognises collection pages, tolerating trailing slash and query', () => {
    expect(parseShopifyPath('https://us.tonies.com/collections/all-tonies')).toEqual({
      kind: 'collection',
      handle: 'all-tonies',
    })
    expect(parseShopifyPath('https://us.tonies.com/collections/all-tonies/')).toEqual({
      kind: 'collection',
      handle: 'all-tonies',
    })
    expect(parseShopifyPath('https://us.tonies.com/collections/all-tonies?sort_by=title')).toEqual(
      { kind: 'collection', handle: 'all-tonies' }
    )
  })

  it('returns other for everything else', () => {
    expect(parseShopifyPath('https://us.tonies.com/collections/')).toEqual({ kind: 'other' })
    expect(parseShopifyPath('https://us.tonies.com/products/')).toEqual({ kind: 'other' })
    expect(parseShopifyPath('https://example.com/pages/about')).toEqual({ kind: 'other' })
    expect(parseShopifyPath('not a url')).toEqual({ kind: 'other' })
  })
})

describe('collectionPageUrl', () => {
  it('builds the paged products.json URL the ingestor walks', () => {
    expect(collectionPageUrl('https://us.tonies.com', 'all-tonies', 2)).toBe(
      'https://us.tonies.com/collections/all-tonies/products.json?limit=250&page=2'
    )
  })
})

// Fixtures below mirror ingestor/lib/ingestor.test.mjs — the same
// products, judged by the ported rules, must get the same verdicts
// the ingestor gives them.
describe('planCollectionImport', () => {
  const img = [{ src: 'https://cdn.shopify.com/x.jpg' }]

  it('adds everything on a Tonies page — players included — splitting add / present, tallies reconciling', () => {
    const products = [
      { title: 'Disney Frozen: Elsa Tonie', product_type: 'Tonie', handle: 'elsa', images: img, tags: [] },
      { title: 'Bluey Tonie', product_type: 'Tonie', handle: 'bluey', images: img, tags: [] },
      { title: 'Toniebox 2', product_type: 'Toniebox', handle: 'tb2', images: img, tags: [] },
      { title: 'Disney Frozen: Elsa Tonie', product_type: 'Tonie', handle: 'elsa', images: img, tags: [] },
    ]
    // 'bluey' is already catalogued (case-insensitively), and the
    // ingestor-stocked title for #1 is the suffix-stripped 'Disney
    // Frozen: Elsa' — the plan must normalise to match it.
    const plan = planCollectionImport(products, ['bluey'], 'tonies', 'https://us.tonies.com')
    expect(plan.skippedFiltered).toBe(0)
    expect(plan.alreadyPresent).toBe(2) // Bluey + the in-feed repeat of Elsa
    expect(plan.toAdd).toEqual([
      {
        platform: 'tonies',
        title: 'Disney Frozen: Elsa',
        details: 'Tonie figure',
        is_bundle: false,
        image_url: 'https://cdn.shopify.com/x.jpg',
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
        source_url: 'https://us.tonies.com/products/elsa',
      },
      {
        platform: 'tonies',
        title: 'Toniebox 2',
        details: 'Toniebox',
        is_bundle: false,
        image_url: 'https://cdn.shopify.com/x.jpg',
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
        source_url: 'https://us.tonies.com/products/tb2',
      },
    ])
    expect(plan.toAdd.length + plan.alreadyPresent + plan.skippedFiltered).toBe(products.length)
  })

  it('strips the Dream Machine line name into details, collections vs cartridges', () => {
    const products = [
      {
        title: 'Story Dream Machine™ Dr. Seuss Cat in The Hat Collection',
        product_type: 'preschool toys',
        handle: 'cat-hat',
        images: img,
        tags: [],
      },
      {
        title: 'Story Dream Machine™ Harper Collins Digger the Dinosaur',
        product_type: 'preschool toys',
        handle: 'digger',
        images: img,
        tags: [],
      },
    ]
    const plan = planCollectionImport(products, [], 'projector', 'https://www.littletikes.com')
    expect(plan.toAdd).toEqual([
      {
        platform: 'projector',
        title: 'Dr. Seuss Cat in The Hat Collection',
        details: 'Dream Machine story collection',
        is_bundle: true,
        image_url: 'https://cdn.shopify.com/x.jpg',
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
        source_url: 'https://www.littletikes.com/products/cat-hat',
      },
      {
        platform: 'projector',
        title: 'Harper Collins Digger the Dinosaur',
        details: 'Dream Machine story cartridge',
        is_bundle: false,
        image_url: 'https://cdn.shopify.com/x.jpg',
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
        source_url: 'https://www.littletikes.com/products/digger',
      },
    ])
    expect(plan.alreadyPresent).toBe(0)
    expect(plan.skippedFiltered).toBe(0)
  })

  it('plans a Yoto pack as a bundle from its product type', () => {
    const products = [
      { title: "Daniel Tiger's Neighborhood: Daniel & Friends Pack", product_type: 'bundle', handle: 'dt-pack', images: img, tags: [] },
      { title: 'The Gruffalo', product_type: 'single-card', handle: 'gruffalo', images: img, tags: [] },
    ]
    const plan = planCollectionImport(products, [], 'yoto', 'https://us.yotoplay.com')
    expect(plan.toAdd.map((r) => [r.title, r.is_bundle])).toEqual([
      ["Daniel Tiger's Neighborhood: Daniel & Friends Pack", true],
      ['The Gruffalo', false],
    ])
  })

  it('rescues the Storypod Recordable Token details, and matches ingestor titles as present', () => {
    const products = [
      { title: 'Recordable Token', product_type: '', handle: 'rt', images: [], tags: [] },
      { title: 'The Gruffalo', product_type: 'Tokens', handle: 'gruffalo', images: img, tags: [] },
    ]
    const plan = planCollectionImport(products, ['The Gruffalo'], 'storypod', 'https://storypod.com')
    expect(plan.toAdd).toEqual([
      {
        platform: 'storypod',
        title: 'Recordable Token',
        details: 'Token',
        is_bundle: false,
        image_url: null,
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
        source_url: 'https://storypod.com/products/rt',
      },
    ])
    expect(plan.alreadyPresent).toBe(1)
  })

  it('handles empty inputs', () => {
    expect(planCollectionImport([], [], 'tonies')).toEqual({
      toAdd: [],
      alreadyPresent: 0,
      skippedFiltered: 0,
      blockedContent: 0,
    })
    expect(planCollectionImport(null, null, 'tonies').toAdd).toEqual([])
  })
})

describe('extractOgType', () => {
  it('reads og:type case-insensitively in either attribute order', () => {
    expect(extractOgType('<meta property="og:type" content="Product">')).toBe('product')
    expect(extractOgType('<meta content="website" property="og:type">')).toBe('website')
  })

  it('returns empty string when absent', () => {
    expect(extractOgType('<meta property="og:title" content="X">')).toBe('')
    expect(extractOgType('')).toBe('')
    expect(extractOgType(null)).toBe('')
  })
})

describe('extractProductLinks', () => {
  const page = 'https://lunii.com/en-us/stories'
  const html = `
    <a href="/en-us/products/the-gruffalo">Gruffalo</a>
    <a href="https://lunii.com/en-us/products/elmer?utm_source=nav">Elmer</a>
    <a href="/en-us/products/the-gruffalo">Gruffalo again</a>
    <a href="/en-us/stories">Stories</a>
    <a href="https://us.tonies.com/products/bluey">Other store</a>
    <a href="/en-us/products/">Index, no handle</a>`

  it('finds same-origin product links, de-duplicated, tracking params dropped', () => {
    expect(extractProductLinks(html, page)).toEqual([
      'https://lunii.com/en-us/products/the-gruffalo',
      'https://lunii.com/en-us/products/elmer',
    ])
  })

  it('recognises LeapFrog Magento product paths', () => {
    const lf = `<a href="/en-us/store/p/leappad-ultimate/_/A-prod123">LeapPad</a>`
    expect(extractProductLinks(lf, 'https://store.leapfrog.com/en-us/store/c/toys')).toEqual([
      'https://store.leapfrog.com/en-us/store/p/leappad-ultimate/_/A-prod123',
    ])
  })

  it('honours the limit and tolerates junk', () => {
    expect(extractProductLinks(html, page, 1)).toHaveLength(1)
    expect(extractProductLinks('', page)).toEqual([])
    expect(extractProductLinks(html, 'not a url')).toEqual([])
    expect(extractProductLinks(null, null)).toEqual([])
  })
})

describe('planRowImport', () => {
  it('splits new rows from ones already catalogued (case-insensitive)', () => {
    const rows = [
      { title: 'The Gruffalo', details: 'Story', image_url: 'https://x/g.jpg', source_url: 'https://s/g' },
      { title: 'elmer', details: '', image_url: '', source_url: 'https://s/e' },
    ]
    const plan = planRowImport(rows, ['Elmer'], 'lunii')
    expect(plan.toAdd).toEqual([
      {
        title: 'The Gruffalo',
        details: 'Story',
        is_bundle: false,
        image_url: 'https://x/g.jpg',
        source_url: 'https://s/g',
        age_min_years: null,
        age_max_years: null,
        rating: null,
        rating_count: null,
      },
    ])
    expect(plan.alreadyPresent).toBe(1)
    expect(plan.skippedFiltered).toBe(0)
  })

  it('applies the same title tidying as collection imports', () => {
    const plan = planRowImport([{ title: 'Bluey Tonie', source_url: 'https://s/b' }], [], 'tonies')
    expect(plan.toAdd[0].title).toBe('Bluey')
  })

  it('carries the bundle flag through — from the row, or from a bundle details string', () => {
    const flagged = planRowImport(
      [{ title: 'Some Pack', details: '', is_bundle: true, source_url: 'https://s/p' }],
      [],
      'yoto',
    )
    expect(flagged.toAdd[0].is_bundle).toBe(true)
    const byDetails = planRowImport(
      [{ title: 'Daniel Tiger Bundle', details: 'Content bundle', source_url: 'https://s/d' }],
      [],
      'storypod',
    )
    expect(byDetails.toAdd[0].is_bundle).toBe(true)
    const plain = planRowImport(
      [{ title: 'Single Card', details: 'Yoto Card', source_url: 'https://s/c' }],
      [],
      'yoto',
    )
    expect(plain.toAdd[0].is_bundle).toBe(false)
  })

  it('skips untitled rows and in-list repeats', () => {
    const rows = [
      { title: '  ', source_url: 'https://s/x' },
      { title: 'Alpha', source_url: 'https://s/a' },
      { title: 'ALPHA', source_url: 'https://s/a2' },
    ]
    const plan = planRowImport(rows, [], 'other')
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.alreadyPresent).toBe(1)
  })

  it('handles empty inputs', () => {
    expect(planRowImport([], [], 'tonies')).toEqual({
      toAdd: [],
      alreadyPresent: 0,
      skippedFiltered: 0,
      blockedContent: 0,
    })
    expect(planRowImport(null, null, 'tonies').toAdd).toEqual([])
  })
})

describe('extractAgeRange', () => {
  it('reads Little Tikes structured Age tags (the learn-play shapes)', () => {
    expect(extractAgeRange({ tags: ['Age:6 - 36 months', 'best-seller'] })).toEqual({
      age_min_years: 0.5,
      age_max_years: 3,
    })
    expect(extractAgeRange({ tags: ['Age:9 months - 3 years'] })).toEqual({
      age_min_years: 0.8,
      age_max_years: 3,
    })
    expect(extractAgeRange({ tags: ['Age:2 - 5 years'] })).toEqual({
      age_min_years: 2,
      age_max_years: 5,
    })
    expect(extractAgeRange({ tags: ['Age:3+ years'] })).toEqual({
      age_min_years: 3,
      age_max_years: null,
    })
  })

  it('falls back to the description text around "ages"', () => {
    expect(
      extractAgeRange({ tags: [], body_html: '<p>Perfect for ages 4 - 6 years. Batteries included.</p>' })
    ).toEqual({ age_min_years: 4, age_max_years: 6 })
    expect(
      extractAgeRange({ tags: [], body_html: '<p>Ages 18 months and up. Soft plush.</p>' })
    ).toEqual({ age_min_years: 1.5, age_max_years: null })
  })

  it('returns null when nothing sane is published', () => {
    expect(extractAgeRange({ tags: ['best-seller'], body_html: '<p>A fun toy.</p>' })).toBeNull()
    expect(extractAgeRange({})).toBeNull()
    expect(extractAgeRange(null)).toBeNull()
    // An inverted or absurd range is worse than no guidance.
    expect(extractAgeRange({ tags: ['Age:9 - 2 years'] })).toBeNull()
    expect(extractAgeRange({ tags: ['Age:2 - 40 years'] })).toBeNull()
  })
})

describe('platformForProduct', () => {
  it('splits Little Tikes: Dream Machine line to the projector shelf, the rest to Little Tikes', () => {
    expect(platformForProduct('littletikes', { title: 'Story Dream Machine™ Dr. Seuss Collection' })).toBe(
      'projector'
    )
    expect(platformForProduct('littletikes', 'Story Dream Machine - Winnie the Pooh')).toBe('projector')
    expect(platformForProduct('littletikes', { title: 'Activity Garden™' })).toBe('littletikes')
    expect(platformForProduct('littletikes', 'Cozy Coupe®')).toBe('littletikes')
  })

  it('leaves every other platform alone', () => {
    expect(platformForProduct('tonies', { title: 'Story Dream Machine' })).toBe('tonies')
    expect(platformForProduct('projector', { title: 'Anything' })).toBe('projector')
  })
})

describe('content guard', () => {
  const img = [{ src: 'https://cdn.shopify.com/x.jpg' }]

  it('blocks adult retailer hosts, subdomains and adult TLDs', () => {
    expect(isBlockedHost('https://www.adamandeve.com/products/x')).toBe(true)
    expect(isBlockedHost('https://shop.lovehoney.com/x')).toBe(true)
    expect(isBlockedHost('https://gifts.example.xxx/x')).toBe(true)
    expect(isBlockedHost('https://notadamandeve.com/x')).toBe(false)
    expect(isBlockedHost('https://us.tonies.com/products/x')).toBe(false)
  })

  it('screens explicit titles on word boundaries only', () => {
    expect(isBlockedTitle('Deluxe Vibrator X2000')).toBe(true)
    expect(isBlockedTitle("Couples' Sex Toy Kit")).toBe(true)
    expect(isBlockedTitle('Middlesex County Puzzle')).toBe(false)
    expect(isBlockedTitle('Essex Steam Train Set')).toBe(false)
    expect(isBlockedTitle('Electric Breast Pump')).toBe(false)
    expect(isBlockedTitle('Police Costume with Handcuffs')).toBe(false)
  })

  it('drops screened products from a collection plan and counts them', () => {
    const products = [
      { title: 'Wooden Tricycle', product_type: 'Toy', handle: 'trike', images: img, tags: [] },
      { title: 'Deluxe Vibrator X2000', product_type: 'Toy', handle: 'vib', images: img, tags: [] },
    ]
    const plan = planCollectionImport(products, [], 'other', 'https://shop.example.com')
    expect(plan.toAdd.map((r) => r.title)).toEqual(['Wooden Tricycle'])
    expect(plan.blockedContent).toBe(1)
  })

  it('drops screened rows from a page-row plan and counts them', () => {
    const plan = planRowImport(
      [
        { title: 'Building Blocks', image_url: '', source_url: '' },
        { title: 'Erotic Board Game', image_url: '', source_url: '' },
      ],
      [],
      'other'
    )
    expect(plan.toAdd.map((r) => r.title)).toEqual(['Building Blocks'])
    expect(plan.blockedContent).toBe(1)
  })
})

describe('faviconUrlFor (ingest)', () => {
  it('stamps the source store favicon onto user-added rows', () => {
    expect(faviconUrlFor('https://www.somenichetoys.com/products/x')).toBe(
      'https://www.google.com/s2/favicons?domain=www.somenichetoys.com&sz=128'
    )
    expect(faviconUrlFor('not a url')).toBeNull()
    expect(faviconUrlFor(null)).toBeNull()
  })
})
