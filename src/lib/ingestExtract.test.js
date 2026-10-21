import { describe, expect, it } from 'vitest'
import {
  candidateKey,
  collectionPageUrl,
  extractAllFromJsonLd,
  extractFromJsonLd,
  extractFromOpenGraph,
  isSafeFetchUrl,
  normalizeShopifyProduct,
  normalizeSuggestResult,
  parseShopifyPath,
  passesStoreFilter,
  planCollectionImport,
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
      { title: 'First Toy', image_url: 'https://cdn.example.com/1.jpg', details: 'Acme' },
      { title: 'Second Toy', image_url: 'https://cdn.example.com/2.jpg', details: '' },
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
describe('passesStoreFilter', () => {
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: [] }

  it('tonies: content types in, hardware / packs / bundles out', () => {
    expect(
      passesStoreFilter('tonies', {
        ...base,
        product_type: 'Tonie',
        title: 'Disney Sofia the First: Royal Magic Tonie',
      })
    ).toBe(true)
    expect(passesStoreFilter('tonies', { ...base, product_type: 'Audiobook', title: 'Goosebumps' })).toBe(true)
    expect(passesStoreFilter('tonies', { ...base, product_type: 'Toniebox', title: 'Toniebox 2' })).toBe(false)
    expect(passesStoreFilter('tonies', { ...base, product_type: 'Bundle', title: 'Starter Set' })).toBe(false)
    expect(
      passesStoreFilter('tonies', {
        ...base,
        product_type: 'Audiobook',
        title: 'Goosebumps Book Tonies - 4 Pack',
      })
    ).toBe(false)
    expect(passesStoreFilter('tonies', { ...base, product_type: 'Tonie', title: 'Tonies Bundle' })).toBe(false)
  })

  it('yoto: cards and packs in, players / digital out', () => {
    expect(passesStoreFilter('yoto', { ...base, product_type: 'single-card', title: 'The Gruffalo' })).toBe(true)
    expect(passesStoreFilter('yoto', { ...base, product_type: 'bundle', title: 'Daniel & Friends Pack' })).toBe(true)
    expect(passesStoreFilter('yoto', { ...base, product_type: 'soft-bundle', title: 'Pixar Collection' })).toBe(true)
    expect(passesStoreFilter('yoto', { ...base, product_type: 'content-bundle', title: 'Yoto Mini + Bundle' })).toBe(false)
    expect(passesStoreFilter('yoto', { ...base, product_type: 'player-unit', title: 'Yoto Player' })).toBe(false)
    expect(
      passesStoreFilter('yoto', {
        ...base,
        product_type: 'single-card',
        title: 'The Legend of Sleepy Hollow (Digital)',
        tags: ['flag:Digital Card'],
      })
    ).toBe(false)
    expect(
      passesStoreFilter('yoto', { ...base, product_type: 'single-card', title: 'Voyager en musique (Digital)' })
    ).toBe(false)
    // Tags also arrive as one comma-joined string on some payloads.
    expect(
      passesStoreFilter('yoto', {
        ...base,
        product_type: 'single-card',
        title: 'A Card',
        tags: 'media:physical, flag:Digital Card',
      })
    ).toBe(false)
  })

  it('storypod: content line in, sleeves / plush / device listings out', () => {
    expect(passesStoreFilter('storypod', { ...base, product_type: 'Crafties', title: 'Riley Raccoon' })).toBe(true)
    expect(passesStoreFilter('storypod', { ...base, product_type: '', title: 'Recordable Token' })).toBe(true)
    expect(passesStoreFilter('storypod', { ...base, product_type: 'Sleeves', title: 'Teal Sleeve' })).toBe(false)
    expect(passesStoreFilter('storypod', { ...base, product_type: 'Plush', title: 'Snuggly Sounds Fox' })).toBe(false)
    expect(passesStoreFilter('storypod', { ...base, product_type: '', title: 'The Eddi System' })).toBe(false)
    expect(passesStoreFilter('storypod', { ...base, product_type: '', title: 'Storypod Charging Cable' })).toBe(false)
  })

  it('osmo: standalone games in, kits / hardware / bundles out', () => {
    expect(passesStoreFilter('osmo', { ...base, product_type: '', title: 'Detective Agency' })).toBe(true)
    expect(passesStoreFilter('osmo', { ...base, product_type: 'game', title: 'Little Genius Costume Pieces' })).toBe(true)
    expect(passesStoreFilter('osmo', { ...base, product_type: '', title: 'Math Wizard and the Magical Workshop' })).toBe(true)
    expect(passesStoreFilter('osmo', { ...base, product_type: '', title: 'Genius Starter Kit - iPad' })).toBe(false)
    expect(passesStoreFilter('osmo', { ...base, product_type: 'game', title: 'Pretend Play Bundle' })).toBe(false)
    expect(passesStoreFilter('osmo', { ...base, product_type: '', title: 'Math Wizard Series' })).toBe(false)
    expect(passesStoreFilter('osmo', { ...base, product_type: '', title: 'Osmo Large Carrying Case' })).toBe(false)
  })

  it('projector: Moonlite reels and the Dream Machine line, told apart', () => {
    expect(
      passesStoreFilter('projector', { ...base, product_type: 'Single Story', title: 'The Very Hungry Caterpillar' })
    ).toBe(true)
    expect(passesStoreFilter('projector', { ...base, product_type: 'Single Story', title: 'Story Reel 3 Pack' })).toBe(false)
    expect(passesStoreFilter('projector', { ...base, product_type: 'Starter Pack', title: 'Starter Pack' })).toBe(false)
    expect(
      passesStoreFilter('projector', {
        ...base,
        product_type: 'preschool toys',
        title: 'Story Dream Machine™ Random House The Berenstain Bears™ - 3 Pack Collection',
      })
    ).toBe(true)
    expect(
      passesStoreFilter('projector', {
        ...base,
        product_type: 'preschool toys',
        title: 'Story Dream Machine™ Dr. Seuss Starter Pack',
      })
    ).toBe(false)
    expect(
      passesStoreFilter('projector', { ...base, product_type: 'preschool toys', title: 'Story Dream Pals™ Grinch' })
    ).toBe(false)
    expect(passesStoreFilter('projector', { ...base, product_type: 'Kids Beds', title: 'Read & Dream Nap Nook' })).toBe(false)
  })

  it('platforms without store rules keep anything titled; junk never passes', () => {
    expect(passesStoreFilter('other', { title: 'Literally Anything' })).toBe(true)
    expect(passesStoreFilter('leapfrog', { title: 'LeapStart Book' })).toBe(true)
    expect(passesStoreFilter('tonies', null)).toBe(false)
    expect(passesStoreFilter('tonies', { product_type: 'Tonie' })).toBe(false)
  })
})

describe('planCollectionImport', () => {
  const img = [{ src: 'https://cdn.shopify.com/x.jpg' }]

  it('splits a Tonies page into add / present / filtered, tallies reconciling', () => {
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
    expect(plan.skippedFiltered).toBe(1)
    expect(plan.alreadyPresent).toBe(2) // Bluey + the in-feed repeat of Elsa
    expect(plan.toAdd).toEqual([
      {
        platform: 'tonies',
        title: 'Disney Frozen: Elsa',
        details: 'Tonie figure',
        image_url: 'https://cdn.shopify.com/x.jpg',
        source_url: 'https://us.tonies.com/products/elsa',
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
        image_url: 'https://cdn.shopify.com/x.jpg',
        source_url: 'https://www.littletikes.com/products/cat-hat',
      },
      {
        platform: 'projector',
        title: 'Harper Collins Digger the Dinosaur',
        details: 'Dream Machine story cartridge',
        image_url: 'https://cdn.shopify.com/x.jpg',
        source_url: 'https://www.littletikes.com/products/digger',
      },
    ])
    expect(plan.alreadyPresent).toBe(0)
    expect(plan.skippedFiltered).toBe(0)
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
        image_url: null,
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
    })
    expect(planCollectionImport(null, null, 'tonies').toAdd).toEqual([])
  })
})
