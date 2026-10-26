import { describe, expect, it } from 'vitest'
import { cleanTitle, matchKey, stripPrefix, stripSuffix } from './normalize.mjs'
import { mapShopifyProduct } from './shopify.mjs'
import { extractOg, extractProductUrls, mapLeapfrogPage, parsePageData, parsePageDataBlock, mapPageDataProduct } from './leapfrog.mjs'
import { decodeNumericEntities, extractSitemapUrls, mapLuniiPage } from './lunii.mjs'
import { dedupeCatalog, catalogToSql } from './output.mjs'
import { SOURCES, isBundleRow } from './sources.mjs'

const tonies = SOURCES.find((s) => s.id === 'tonies')
const moonlite = SOURCES.find((s) => s.id === 'moonlite')
const littletikes = SOURCES.find((s) => s.id === 'littletikes')
const yoto = SOURCES.find((s) => s.id === 'yoto')
const storypod = SOURCES.find((s) => s.id === 'storypod')
const osmo = SOURCES.find((s) => s.id === 'osmo')

describe('normalize', () => {
  it('cleans entities, marks and whitespace', () => {
    expect(cleanTitle('LeapFrog  LeapStart® &amp; Friends™')).toBe('LeapFrog LeapStart & Friends')
  })
  it('matchKey treats punctuation and dash variants as equal', () => {
    expect(matchKey('Paw Patrol: Chase')).toBe(matchKey('Paw Patrol — Chase'))
    expect(matchKey("Giraffes Can't Dance")).toBe(matchKey('Giraffes Cant Dance'))
  })
  it('stripSuffix only removes a real trailing suffix', () => {
    expect(stripSuffix('Santa Creative Tonie', ' Tonie')).toBe('Santa Creative')
    expect(stripSuffix('Tonie', ' Tonie')).toBe('Tonie')
  })
  it('stripPrefix only removes a real leading prefix', () => {
    expect(stripPrefix('Story Dream Machine Dr. Seuss Grinch Collection', 'Story Dream Machine ')).toBe(
      'Dr. Seuss Grinch Collection'
    )
    expect(stripPrefix('Dream Machine', 'Story Dream Machine ')).toBe('Dream Machine')
  })
})

describe('shopify mapping (fixtures modelled on the live us.tonies.com feed)', () => {
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: [] }

  it('keeps a content Tonie, strips the format suffix, picks the image', () => {
    const row = mapShopifyProduct(tonies, {
      ...base,
      product_type: 'Tonie',
      title: 'Disney Sofia the First: Royal Magic Tonie',
    })
    expect(row).toMatchObject({
      platform: 'tonies',
      title: 'Disney Sofia the First: Royal Magic',
      details: 'Tonie figure',
      image_url: 'https://cdn.shopify.com/x.jpg',
    })
  })

  it('drops hardware, bundles and multi-packs', () => {
    expect(mapShopifyProduct(tonies, { ...base, product_type: 'Toniebox', title: 'Toniebox 2' })).toBeNull()
    expect(mapShopifyProduct(tonies, { ...base, product_type: 'Bundle', title: 'Starter Set' })).toBeNull()
    expect(
      mapShopifyProduct(tonies, { ...base, product_type: 'Audiobook', title: 'Goosebumps Book Tonies - 4 Pack' })
    ).toBeNull()
  })

  it('keeps Moonlite single stories for the projector platform', () => {
    const row = mapShopifyProduct(moonlite, {
      ...base,
      product_type: 'Single Story',
      title: 'The Very Hungry Caterpillar',
    })
    expect(row).toMatchObject({ platform: 'projector', details: 'Story reel' })
    expect(mapShopifyProduct(moonlite, { ...base, product_type: 'Starter Pack', title: 'Starter Pack' })).toBeNull()
  })
})

describe('shopify mapping (fixtures modelled on the live littletikes.com feed)', () => {
  // product_type is generic across the whole store, so fixtures keep
  // the real types and tags — the title rules do the filtering.
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: [] }
  const dmTags = ['Collection:Story Dream Machine', 'Collection:Story Dream Machine Books']

  it('keeps a story collection, strips the line name into details', () => {
    const row = mapShopifyProduct(littletikes, {
      ...base,
      product_type: 'preschool toys',
      title: 'Story Dream Machine™ Random House The Berenstain Bears™ - 3 Pack Collection',
      tags: dmTags,
    })
    expect(row).toMatchObject({
      platform: 'projector',
      title: 'Random House The Berenstain Bears - 3 Pack Collection',
      details: 'Dream Machine story collection',
      is_bundle: true,
      image_url: 'https://cdn.shopify.com/x.jpg',
    })
  })

  it('keeps a single story as a cartridge, and a Spanish collection as a collection', () => {
    expect(
      mapShopifyProduct(littletikes, {
        ...base,
        product_type: 'preschool toys',
        title: 'Story Dream Machine™ Harper Collins Digger the Dinosaur',
        tags: dmTags,
      })
    ).toMatchObject({ title: 'Harper Collins Digger the Dinosaur', details: 'Dream Machine story cartridge' })
    expect(
      mapShopifyProduct(littletikes, {
        ...base,
        product_type: 'preschool toys',
        title: 'Story Dream Machine™ Colección de héroes de Paw Patrol de Paramount',
        tags: [...dmTags, 'spanish'],
      })
    ).toMatchObject({ details: 'Dream Machine story collection' })
  })

  it('drops plush, cases, bundle builders and the hardware packs', () => {
    const drop = (title, extra = {}) =>
      expect(mapShopifyProduct(littletikes, { ...base, product_type: 'preschool toys', title, ...extra })).toBeNull()
    drop('Story Dream Pals™ Grinch', { tags: ['Collection:Story Dream Machine Pals'] })
    drop('Story Dreamers™ Cat in the Hat Plush™')
    drop('Story Dream Machine™  Storytime Travel Case', { tags: ['Collection:Story Dream Machine Accessories'] })
    drop('Story Dream Machine™ Dr. Seuss Starter Pack')
    drop('Story Dream Machine™ PAW Patrol Special Edition Pack with Headphones')
    drop('Build Your Own Story Dream Machine Book Bundle and Save 10%')
    drop('Read & Dream Nap Nook', { product_type: 'Kids Beds' })
    drop('Cozy Coupe®')
  })
})

describe('shopify mapping (fixtures modelled on the live us.yotoplay.com feed)', () => {
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: ['media:physical'] }

  it('keeps single cards, including non-English ones', () => {
    expect(
      mapShopifyProduct(yoto, { ...base, product_type: 'single-card', title: 'Disney: 5 Minute Mickey Mouse Christmas Stories' })
    ).toMatchObject({ platform: 'yoto', title: 'Disney: 5 Minute Mickey Mouse Christmas Stories', details: 'Yoto Card' })
    expect(
      mapShopifyProduct(yoto, {
        ...base,
        product_type: 'single-card',
        title: 'Mes petits contes du soir Pixar',
        tags: ['media:physical', 'language:French'],
      })
    ).toMatchObject({ platform: 'yoto', details: 'Yoto Card' })
  })

  it('keeps card packs as packs', () => {
    expect(
      mapShopifyProduct(yoto, { ...base, product_type: 'bundle', title: "Daniel Tiger's Neighborhood: Daniel & Friends Pack" })
    ).toMatchObject({ details: 'Yoto Card pack', is_bundle: true })
    expect(
      mapShopifyProduct(yoto, { ...base, product_type: 'soft-bundle', title: 'Pixar Audio Collection: Volume 2' })
    ).toMatchObject({ details: 'Yoto Card pack', is_bundle: true })
    expect(
      mapShopifyProduct(yoto, { ...base, product_type: 'single-card', title: 'The Gruffalo' })
    ).toMatchObject({ details: 'Yoto Card', is_bundle: false })
  })

  it('drops players, hardware bundles, accessories, gift cards and club', () => {
    const drop = (product_type, title) =>
      expect(mapShopifyProduct(yoto, { ...base, product_type, title })).toBeNull()
    drop('player-unit', 'Yoto Player 4th Gen')
    drop('content-bundle', 'Yoto Mini 4th Gen + Bedtime Bundle')
    drop('accessories', 'Wireless Headphones')
    drop('accessories', 'Yoto Mini Travel Case 4th Gen')
    drop('Gift Card', 'Gift Certificate')
    drop('Club', 'Yoto Club Monthly')
  })

  it('drops digital-only cards, by flag tag or by (Digital) title suffix', () => {
    expect(
      mapShopifyProduct(yoto, {
        ...base,
        product_type: 'single-card',
        title: 'The Legend of Sleepy Hollow (Digital)',
        tags: ['flag:Digital Card'],
      })
    ).toBeNull()
    expect(
      mapShopifyProduct(yoto, { ...base, product_type: 'single-card', title: 'Voyager en musique (Digital)', tags: [] })
    ).toBeNull()
  })
})

describe('shopify mapping (fixtures modelled on the live storypod.com feed)', () => {
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: ['audio-experience', 'YGroup_all'] }

  it('keeps the content line with humanised details per type', () => {
    const keep = (product_type, title, details) =>
      expect(mapShopifyProduct(storypod, { ...base, product_type, title })).toMatchObject({
        platform: 'storypod',
        details,
        image_url: 'https://cdn.shopify.com/x.jpg',
      })
    keep('Crafties', 'Riley Raccoon', 'Craftie figure')
    keep('Tokens', 'The Gruffalo', 'Token')
    keep('Picture Books', "Let's Stay Clean from PAW Patrol", 'Picture book')
    keep('Board Books', 'My First Bedtime Routine', 'Board book')
    keep('Learning Sets', 'Letters, Numbers & Animals Set', 'Learning set')
    keep('Card Sets', 'My First Numbers Card Set', 'Card set')
    keep('Trivia Decks', 'Skilled Readers Deck for 3rd Graders', 'Trivia deck')
    keep('Activity Books', 'Zoonicorns Activity Book', 'Activity book')
    keep('Puzzles', "Let's Count", 'Puzzle')
  })

  it('keeps content bundles — none of them includes the player', () => {
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: 'Content Bundle', title: 'Daniel Tiger Bundle' })
    ).toMatchObject({ details: 'Content bundle', is_bundle: true })
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: 'Content Bundle', title: 'Recordable Token 5 Pack' })
    ).toMatchObject({ details: 'Content bundle', is_bundle: true })
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: 'Tokens', title: 'The Gruffalo' })
    ).toMatchObject({ details: 'Token', is_bundle: false })
  })

  it('rescues the untyped single Recordable Token, drops the other untyped listings', () => {
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: '', title: 'Recordable Token' })
    ).toMatchObject({ title: 'Recordable Token', details: 'Token' })
    const drop = (title) =>
      expect(mapShopifyProduct(storypod, { ...base, product_type: '', title })).toBeNull()
    drop('The Eddi System') // the other device
    drop('Storypod Charging Cable')
    drop('Subscription Buy Out')
  })

  it('drops player sleeves and the standalone plush toys by type', () => {
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: 'Sleeves', title: 'Teal Sleeve for The Storypod' })
    ).toBeNull()
    expect(
      mapShopifyProduct(storypod, { ...base, product_type: 'Plush', title: 'Snuggly Sounds Fox' })
    ).toBeNull()
  })
})

describe('shopify mapping (fixtures modelled on the live playosmo.com feed)', () => {
  const base = { images: [{ src: 'https://cdn.shopify.com/x.jpg' }], handle: 'x', tags: [] }

  it('keeps standalone games, Fire and iPad listings alike', () => {
    const keep = (product_type, title) =>
      expect(mapShopifyProduct(osmo, { ...base, product_type, title })).toMatchObject({
        platform: 'osmo',
        details: 'Osmo game',
      })
    keep('', 'Detective Agency')
    keep('', 'Detective Agency - Fire')
    keep('', 'Genius Numbers')
    keep('', 'Genius Words - Fire')
    keep('game', 'Genius Tangram')
    keep('', 'Monster')
    keep('', 'Pizza Co.')
    keep('', 'Math Wizard and the Magical Workshop')
    keep('', 'Little Genius Sticks & Rings (ABCs & Squiggle Magic)')
    keep('game', 'Little Genius Costume Pieces')
  })

  it('drops starter kits even when typed as games, plus hardware and bundles', () => {
    const drop = (product_type, title) =>
      expect(mapShopifyProduct(osmo, { ...base, product_type, title })).toBeNull()
    drop('', 'Genius Starter Kit - iPad')
    drop('game', 'Little Genius Starter Kit - Fire')
    drop('game', 'Little Genius Starter Kit + Early Math Adventure - Fire')
    drop('', 'Coding Starter Kit - iPad') // Coding Awbie is only sold as a kit
    drop('', 'Osmo New Base & Reflector for iPad')
    drop('', 'Base and Reflector for Fire')
    drop('', 'Osmo Large Carrying Case')
    drop('', 'Math Wizard Series') // bundle of the individually listed games
    drop('game', 'Pretend Play Bundle') // ditto for the Little Genius games
    drop('', 'Free $20 Mystery Gift with Your Purchase!')
  })
})

describe('the bundle signal (lib/sources.mjs isBundleRow)', () => {
  it('reads the same type/title evidence as the details text', () => {
    expect(isBundleRow(yoto, { product_type: 'bundle', title: 'Any Pack', details: 'Yoto Card pack' })).toBe(true)
    expect(isBundleRow(yoto, { product_type: 'soft-bundle', title: 'Any Pack', details: 'Yoto Card pack' })).toBe(true)
    expect(isBundleRow(yoto, { product_type: 'single-card', title: 'The Gruffalo', details: 'Yoto Card' })).toBe(false)
    expect(isBundleRow(storypod, { product_type: 'Content Bundle', title: 'Daniel Tiger Bundle', details: 'Content bundle' })).toBe(true)
    expect(isBundleRow(storypod, { product_type: 'Tokens', title: 'The Gruffalo', details: 'Token' })).toBe(false)
    // Little Tikes has no bundle types — the details string the
    // title rule produces is the signal.
    expect(isBundleRow(littletikes, { product_type: 'preschool toys', title: 'X Collection', details: 'Dream Machine story collection' })).toBe(true)
    expect(isBundleRow(littletikes, { product_type: 'preschool toys', title: 'X', details: 'Dream Machine story cartridge' })).toBe(false)
  })

  it('never signals for sources that exclude bundles outright, or for no source', () => {
    expect(isBundleRow(tonies, { product_type: 'Audiobook', title: 'Goosebumps Book Tonies - 4 Pack', details: 'Audiobook Tonie' })).toBe(false)
    expect(isBundleRow(osmo, { product_type: 'game', title: 'Pretend Play Bundle', details: 'Osmo game' })).toBe(false)
    expect(isBundleRow(null, { product_type: 'bundle', title: 'X', details: 'Yoto Card pack' })).toBe(false)
    expect(isBundleRow(undefined, {})).toBe(false)
  })
})

describe('lunii mapping (fixtures modelled on the live lunii.com pages)', () => {
  const album = { title: "Andersen&#x27;s Fairy Tales | Audiobooks | Lunii", image: 'https://cdn.shopify.com/x.png' }

  it('keeps Audiobooks-line pages, decoding numeric entities in titles', () => {
    const row = mapLuniiPage('https://lunii.com/en-us/products/andersen-fairy-tales', album)
    expect(row).toMatchObject({
      platform: 'lunii',
      title: "Andersen's Fairy Tales",
      details: 'Story album',
      image_url: 'https://cdn.shopify.com/x.png',
    })
    expect(decodeNumericEntities('Les Couz&#x27; Pépouzes &#224; No&#xeb;l')).toBe("Les Couz' Pépouzes à Noël")
  })

  it('drops the device lines, rentals, subscriptions and accessories (no Audiobooks suffix)', () => {
    const drop = (title) =>
      expect(
        mapLuniiPage('https://lunii.com/en-us/products/x', { title, image: 'https://cdn.shopify.com/x.png' })
      ).toBeNull()
    drop('Headphones for 3-12 years | Lunii')
    drop('Pack Découverte : Conteuse + Abonnement')
    drop('Location de conteuse FLAM')
    drop('Pack baladeur audio FLAM, coque et casque Bluetooth | 7-14 ans | Lunii')
    drop('Abonnement illimité (yearly)')
    drop('Abonnement cadeau Lunii+ | Offrir 3, 6 ou 12 mois | Lunii')
  })

  it('extracts only the configured locale product urls from the sitemap', () => {
    const xml = `<urlset>
      <url><loc>https://lunii.com/en-us/products/andersen-fairy-tales</loc></url>
      <url><loc>https://lunii.com/fr-fr/products/contes-d-andersen</loc></url>
      <url><loc>https://lunii.com/en-us/products/andy-warhol</loc></url>
      <url><loc>https://lunii.com/en-us/products/andersen-fairy-tales</loc></url>
      <url><loc>https://lunii.com/en-us/collections/all</loc></url>
    </urlset>`
    expect(extractSitemapUrls(xml, '/en-us/products/')).toEqual([
      'https://lunii.com/en-us/products/andersen-fairy-tales',
      'https://lunii.com/en-us/products/andy-warhol',
    ])
  })
})

describe('leapfrog mapping', () => {
  it('extracts product urls and og data', () => {
    const html = `<a href="https://store.leapfrog.com/en-us/store/p/leapstart-preschool-success/_/A-prod80-602170">x</a>
      <meta property="og:title" content="LeapFrog LeapStart® Preschool Success System and Book Bundle">
      <meta property="og:image" content="https://t7.leapfrog.com/images/prod-lg/x.jpg">`
    expect(extractProductUrls(html)).toHaveLength(1)
    const row = mapLeapfrogPage('https://store.leapfrog.com/x', extractOg(html))
    expect(row).toMatchObject({
      platform: 'leapfrog',
      title: 'LeapStart Preschool Success System and Book Bundle',
      details: 'LeapStart',
      image_url: 'https://t7.leapfrog.com/images/prod-lg/x.jpg',
    })
  })
})

describe('leapfrog PAGE_DATA (fixture modelled on the live store embed)', () => {
  it('parses the embedded catalog and maps a product', () => {
    const html = `<script type="application/json" id="PAGE_DATA">
      {"products":[{"id":"3467","sku":"80-618700","name":"LeapMove™","image_url":"https://t7.leapfrog.com/images/prod-cat/leapmove_80-618700_1.png","url_key":"leapmove"}]}
    </script>`
    const products = parsePageData(html)
    expect(products).toHaveLength(1)
    const row = mapPageDataProduct(products[0])
    expect(row).toMatchObject({
      platform: 'leapfrog',
      title: 'LeapMove',
      details: 'LeapMove',
      image_url: 'https://t7.leapfrog.com/images/prod-cat/leapmove_80-618700_1.png',
    })
    expect(row.source_url).toContain('A-prod80-618700')
  })

  it('returns [] when the block is absent or malformed', () => {
    expect(parsePageData('<html></html>')).toEqual([])
    expect(parsePageData('<script type="application/json" id="PAGE_DATA">{oops</script>')).toEqual([])
  })

  it('exposes the paging meta alongside the products', () => {
    const html = `<script type="application/json" id="PAGE_DATA">
      {"products":[],"currentPage":1,"totalPages":18,"totalItems":415}
    </script>`
    const block = parsePageDataBlock(html)
    expect(block).toMatchObject({ currentPage: 1, totalPages: 18, totalItems: 415 })
    expect(parsePageDataBlock('<html></html>')).toBeNull()
    expect(parsePageDataBlock('<script type="application/json" id="PAGE_DATA">{oops</script>')).toBeNull()
  })

  it('maps pdp_url-bearing products so the crawl can follow them', () => {
    const row = mapPageDataProduct({
      name: 'LeapStart® Preschool Success',
      sku: '80-602170',
      image_url: 'https://t7.leapfrog.com/images/prod-cat/x.jpg',
      url_key: 'leapstart-preschool-success',
    })
    expect(row.source_url).toBe(
      'https://store.leapfrog.com/en-us/store/p/leapstart-preschool-success/_/A-prod80-602170'
    )
  })
})

describe('output', () => {
  it('dedupes punctuation variants, preferring the row with an image', () => {
    const rows = dedupeCatalog([
      { platform: 'tonies', title: 'Paw Patrol: Chase', details: '', image_url: '' },
      { platform: 'tonies', title: 'Paw Patrol — Chase', details: '', image_url: 'https://img/x.jpg' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].image_url).toBe('https://img/x.jpg')
  })

  it('emits upsert SQL with quotes escaped', () => {
    const sql = catalogToSql([
      { platform: 'books', title: "Giraffes Can't Dance", details: 'Picture book', image_url: '' },
    ])
    expect(sql).toContain("Giraffes Can''t Dance")
    expect(sql).toContain('on conflict (platform, title) do update')
  })
})
