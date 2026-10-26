import { describe, expect, it } from 'vitest'
import {
  extractBundleContents,
  extractEeboo,
  extractGeneric,
  extractIncludesList,
  extractKiwiCo,
  extractThamesKosmos,
  matchContents,
  normTitle,
} from './bundle-contents.mjs'

// Fixtures modelled on the live pages sampled for the
// completeness recon (RECON Part B, partials B1–B2), trimmed to
// the structures the extractor reads.

const row = (id, title, source_url = '') => ({ id, title, source_url })

describe('thamesandkosmos: title list + stated count + SKU blocks must agree', () => {
  const pool = [
    row('a', 'EXIT: The Game - The Cursed Labyrinth'),
    row('b', 'EXIT: The Game - Kidnapped in Fortune City'),
    row('c', 'EXIT: The Game - The Abandoned Cabin'),
  ]
  const body = `
    <h5>Product Description</h5>
    <p>This bundle includes two EXIT: The Game titles.</p>
    <p><strong>EXIT: The Cursed Labyrinth</strong> Can you solve the riddles?</p>
    <p>Product Information<br>SKU: 692860</p>
    <p><strong>EXIT: Kidnapped in Fortune City</strong> A detective story.</p>
    <p>Product Information<br>SKU: 692861</p>`

  it('passes and resolves the short names to the full single titles', () => {
    const out = extractBundleContents(
      {
        platform: 'thamesandkosmos',
        title: 'EXIT: The Game Season 5a, 2-Pack Bundle: The Cursed Labyrinth | Kidnapped in Fortune City',
        bodyHtml: body,
      },
      pool,
    )
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['a', 'b'])
    expect(out.unresolved).toEqual([])
  })

  it('fails when the SKU count disagrees with the title list', () => {
    const out = extractThamesKosmos({
      title: 'EXIT: The Game Season 2, 2-Pack Bundle: The Forgotten Island | The Forbidden Castle',
      bodyHtml: body.replace('SKU: 692861', 'SKU: 692861</p><p>Product Information<br>SKU: 692862'),
    })
    expect(out.verdict).toBe('fail')
    expect(out.reason).toMatch(/count disagreement/)
  })

  it('fails a gift/display set with no enumeration anywhere', () => {
    const out = extractThamesKosmos({
      title: 'Essential STEM Tools: Gyroscope - 12-Pack Gift Set',
      bodyHtml: '<p>A classic gyroscope.</p><p>Product Information<br>SKU: 665001</p>',
    })
    expect(out.verdict).toBe('fail')
  })

  it('treats a lone SKU block as the bundle\u2019s own, not a corroborator', () => {
    const out = extractBundleContents(
      {
        platform: 'thamesandkosmos',
        title: 'EXIT: The Game Season 5a, 2-Pack Bundle: The Cursed Labyrinth | Kidnapped in Fortune City',
        bodyHtml: `
          <p>This bundle includes two EXIT: The Game titles.</p>
          <p>Product Information<br>SKU: 814743018483</p>`,
      },
      pool,
    )
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['a', 'b'])
  })

  it('takes section names from the headings paired with per-title SKU blocks', () => {
    const body = `
      <p>Two build-them-yourself robots in one box.</p>
      <p><strong>ReBotz: Scoot the Cranky Robot</strong> A buildable robot.</p>
      <p>Product Information<br>SKU: 555001</p>
      <p><strong>ReBotz: Hex the Recycling Robot</strong> Another buildable robot.</p>
      <p>Product Information<br>SKU: 555002</p>`
    const botPool = [row('r1', 'ReBotz: Scoot - The Cranky Robot'), row('r2', 'ReBotz: Hex - The Recycling Robot')]
    const out = extractBundleContents(
      { platform: 'thamesandkosmos', title: 'ReBotz 2-Pack Bundle', bodyHtml: body },
      botPool,
    )
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['r1', 'r2'])
  })
})

describe('kiwico: the activities array decides', () => {
  const pool = [
    row('a', 'Animal Bath Bombs'),
    row('b', 'Planet Bath Bombs'),
    row('c', 'Santa Wobbler'),
    row('d', 'Snowman Wobbler'),
  ]

  it('passes a 2-Pack of two distinct kits', () => {
    const out = extractBundleContents(
      {
        platform: 'kiwico',
        title: 'Bath Bombs (2-Pack)',
        pageText: '{"activities":["Animal Bath Bombs","Planet Bath Bombs"],"age":{"min":9}}',
      },
      pool,
    )
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['a', 'b'])
  })

  it('strips the "(1) " quantity prefixes', () => {
    const out = extractKiwiCo({
      title: 'Santa and Snowman Wobbler (2-Pack)',
      pageText: '{"activities":["(1) Santa Wobbler","(1) Snowman Wobbler"]}',
    })
    expect(out.verdict).toBe('pass')
    expect(out.names.map((n) => n.name)).toEqual(['Santa Wobbler', 'Snowman Wobbler'])
  })

  it('classifies a party pack (single self-referencing activity) as excluded, not a bundle', () => {
    const out = extractKiwiCo({
      title: 'Wrap Rockets Party Supply Pack (6-Pack)',
      pageText: '{"activities":["wrap-rockets-party-supply-packs"]}',
    })
    expect(out.verdict).toBe('excluded')
    expect(out.reason).toMatch(/quantity pack/)
  })

  it('carries the pack label as a post-resolution gate, not a pre-gate', () => {
    // The activities field also lists a kit's internal steps, so a
    // label disagreement only means something once every name has
    // resolved to a real catalog row (the orchestrator's job).
    const ex = extractKiwiCo({
      title: 'Mystery Bundle (3-Pack)',
      pageText: '{"activities":["Animal Bath Bombs","Planet Bath Bombs"]}',
    })
    expect(ex.verdict).toBe('pass')
    expect(ex.labelCount).toBe(3)
    const out = extractBundleContents(
      {
        platform: 'kiwico',
        title: 'Mystery Bundle (3-Pack)',
        pageText: '{"activities":["Animal Bath Bombs","Planet Bath Bombs"]}',
      },
      pool,
    )
    expect(out.verdict).toBe('fail')
    expect(out.reason).toMatch(/count disagreement/)
  })

  it('prefers the numbered, individually-priced list over the activities steps', () => {
    const pageText =
      '"description":"This bundle includes: 1. Planet Bath Bombs (Ages 9+) Make bath time a blast. Individual price: $19.95 ' +
      '2. Animal Bath Bombs (Ages 5+) Fizzy fun. Individual price: $17.95 Both projects are delivered together.",' +
      '"activities":["Mix the powders","Add the color"]'
    const out = extractBundleContents({ platform: 'kiwico', title: 'Bath Bombs (2-Pack)', pageText }, pool)
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['b', 'a'])
  })
})

describe('eeboo: the Includes: list, its traps excluded', () => {
  const pool = [
    row('a', 'Love of Dragons 100 Piece Puzzle', 'https://www.eeboo.com/products/love-of-dragons-100-piece-puzzle'),
    row('b', 'Slips & Ladders Dragon Shaped Game', 'https://www.eeboo.com/products/slips-ladders-dragon-shaped-game'),
    row('c', 'Dragons Shiny Matching Game', 'https://www.eeboo.com/products/dragons-shiny-matching-game'),
    row('d', 'Dragon Stickers', 'https://www.eeboo.com/products/dragon-stickers'),
    row('e', 'Giant Shiny Dinosaur Dominoes'),
    row('f', 'Shiny Dinosaur Memory and Matching Game'),
    row('g', 'Dinosaur Rummy Playing Cards'),
    row('h', 'Dinosaur Bingo Game'),
  ]
  const dragonBody = `
    <p>Save 10% when you bundle!</p>
    <p>Includes: </p>
    <p><a href="https://eeboo.com/products/love-of-dragons-100-piece-puzzle">Love of Dragons 100 Piece Puzzle</a></p>
    <p><a href="https://eeboo.com/products/slips-ladders-dragon-shaped-game">Slips &amp; Ladders Dragon Shaped Game</a></p>
    <p><a href="https://eeboo.com/products/dragons-shiny-matching-game">Dragons Shiny Matching Game</a></p>
    <p><a href="https://eeboo.com/products/dragon-stickers">Dragon Stickers</a><br></p>
    <p>A profusion of fanciful dragons gather and cavort in a playful tableau. Spark your imagination with this collection.</p>`

  it('passes a hyperlinked list and resolves by handle', () => {
    const out = extractBundleContents({ platform: 'eeboo', title: 'Dragon Bundle', bodyHtml: dragonBody }, pool)
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('passes links <br>-separated inside a single <p> (the card-game shape)', () => {
    const body = `
      <p>Save 10% when you bundle our animal card games together!</p>
      <p><span>Bundle Includes: <br></span><a href="https://eeboo.com/products/go-shark-go-playing-cards">Go Shark Go</a><br><a href="https://eeboo.com/products/baseball-playing-cards">Baseball</a><br><a href="https://eeboo.com/products/dinosaur-rummy-playing-cards">Dinosaur Rummy</a></p>`
    const cardPool = [
      row('g1', 'Go Shark Go Playing Cards', 'https://www.eeboo.com/products/go-shark-go-playing-cards'),
      row('g2', 'Baseball Playing Cards', 'https://www.eeboo.com/products/baseball-playing-cards'),
      row('g3', 'Dinosaur Rummy Playing Cards', 'https://www.eeboo.com/products/dinosaur-rummy-playing-cards'),
    ]
    const out = extractBundleContents({ platform: 'eeboo', title: 'Card Game Bundle', bodyHtml: body }, cardPool)
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['g1', 'g2', 'g3'])
  })

  it('passes an unlinked list that matches its stated total', () => {
    const body = `
      <p>This bundle brings together four favorite games: Dominoes, Memory &amp; Matching, Rummy Cards, and Bingo.</p>
      <p>Includes:</p>
      <p>Giant Shiny Dinosaur Dominoes</p>
      <p>Shiny Dinosaur Memory and Matching Game</p>
      <p>Dinosaur Rummy Playing Cards</p>
      <p>Dinosaur Bingo Game</p>`
    const out = extractBundleContents({ platform: 'eeboo', title: 'Dinosaur Game Bundle', bodyHtml: body }, pool)
    expect(out.verdict).toBe('pass')
    expect(out.contents.map((c) => c.catalog_id)).toEqual(['e', 'f', 'g', 'h'])
  })

  it('excludes the "(6)" assortment rows outright', () => {
    const out = extractEeboo({
      title: 'Dinosaurs Biggie Mini Mural Bundle (6)',
      bodyHtml: '<p>Assortment includes 6 sets of the mini mural.</p><p>Includes 8 double-sided biggie color pencils, pencil sharpener, and fold-out mini mural to color</p>',
    })
    expect(out.verdict).toBe('excluded')
  })

  it('fails an Includes that names one product\u2019s components', () => {
    const out = extractEeboo({
      title: 'Sketchbook & Pencil Bundle',
      bodyHtml: '<p>Includes:</p><p>One sketchbook, twelve pencils, and a sharpener in a keepsake tin for drawing anywhere.</p>',
    })
    expect(out.verdict).toBe('fail')
  })
})

describe('generic pattern (weekly ingest path)', () => {
  it('passes a closed Includes list of plain items (Yoto shape)', () => {
    const body = `
      <p>This pack includes:</p>
      <p>Wings of Fire #4: The Dark Secret</p>
      <p>Wings of Fire #5: The Brightest Night</p>
      <p>Wings of Fire #6: Moon Rising</p>`
    const pool = [
      row('a', 'Wings of Fire #4: The Dark Secret'),
      row('b', 'Wings of Fire #5: The Brightest Night'),
      row('c', 'Wings of Fire #6: Moon Rising'),
    ]
    const out = extractBundleContents({ platform: 'yoto', title: 'Wings of Fire Pack 2', bodyHtml: body }, pool)
    expect(out.verdict).toBe('pass')
    expect(out.contents).toHaveLength(3)
  })

  it('refuses headed sections with no stated count to corroborate them', () => {
    const out = extractGeneric({
      title: '5-Minute Magical Stories Pack',
      bodyHtml: '<p><strong>5-Minute Unicorn Stories:</strong> Tales.</p><p><strong>5-Minute Mermaid Stories:</strong> More.</p><p><strong>5-Minute Fairy Stories:</strong> Last.</p>',
    })
    expect(out.verdict).toBe('fail')
  })
})

describe('matchContents: ambiguity stays unresolved', () => {
  it('does not guess between two pool rows ending with the same name', () => {
    const pool = [row('a', 'Series One: The Cave'), row('b', 'Series Two: The Cave')]
    const { contents, unresolved } = matchContents([{ name: 'The Cave', handle: null }], pool)
    expect(contents).toEqual([])
    expect(unresolved).toEqual(['The Cave'])
  })

  it('resolves a name that sits inside a longer pool title as a bounded segment', () => {
    const pool = [row('a', 'EXIT: The Game - The Sacred Temple with Puzzles')]
    const { contents, unresolved } = matchContents([{ name: 'The Sacred Temple', handle: null }], pool)
    expect(unresolved).toEqual([])
    expect(contents.map((c) => c.catalog_id)).toEqual(['a'])
  })

  it('stays unresolved when the bounded segment matches two pool rows', () => {
    const pool = [
      row('a', 'Gecko Run: Marble Run Starter Set'),
      row('b', 'Gecko Run: Marble Run Deluxe Starter Set'),
    ]
    const { contents, unresolved } = matchContents([{ name: 'Starter Set', handle: null }], pool)
    expect(contents).toEqual([])
    expect(unresolved).toEqual(['Starter Set'])
  })

  it('extractIncludesList stops at the resuming prose', () => {
    const items = extractIncludesList(
      '<p>Includes:</p><p>Alpha Kit</p><p>Beta Kit</p><p>This bundle is a wonderful gift for curious kids who love to build things together.</p><p>Gamma Kit</p>',
    )
    expect(items.map((i) => i.name)).toEqual(['Alpha Kit', 'Beta Kit'])
  })

  it('normTitle mirrors the bundles.mjs normaliser', () => {
    expect(normTitle('Slips & Ladders: Dragon!')).toBe('slips and ladders dragon')
  })
})
