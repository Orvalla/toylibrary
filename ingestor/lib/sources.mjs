// Tracked product lines. Adding a line = adding an entry here.
//
// kind 'shopify'  — reads the store's public /products.json feed.
// kind 'leapfrog' — the LeapFrog store (Magento) exposes no feed, so
//                   the adapter discovers product pages and reads
//                   their og:title / og:image.
// kind 'lunii'    — lunii.com (Next.js) exposes no feed either; the
//                   adapter discovers product pages from the store's
//                   product sitemap and reads their og tags.

export const SOURCES = [
  {
    id: 'tonies',
    platform: 'tonies',
    kind: 'shopify',
    base: 'https://us.tonies.com',
    // Only the collectible content figures belong in the catalog —
    // not players (Toniebox), bundles/sets (they duplicate singles),
    // accessories, or Tonieplay games (a different device).
    includeTypes: ['Tonie', 'Creative Tonie', 'Clever Tonie', 'My First Tonie', 'Audiobook'],
    excludeTitle: /\b\d+\s*pack\b|\bbundle\b/i,
    detailsByType: {
      Tonie: 'Tonie figure',
      'Creative Tonie': 'Creative Tonie',
      'Clever Tonie': 'Clever Tonie',
      'My First Tonie': 'My First Tonie',
      Audiobook: 'Audiobook Tonie',
    },
    stripTitleSuffix: ' Tonie',
  },
  {
    id: 'moonlite',
    platform: 'projector',
    kind: 'shopify',
    base: 'https://www.mymoonlite.com',
    // Single stories only: starter packs and boxed sets duplicate them
    // (and bundle in the projector hardware).
    includeTypes: ['Single Story'],
    excludeTitle: /\bpack\b|\bset\b/i,
    detailsByType: { 'Single Story': 'Story reel' },
    stripTitleSuffix: '',
  },
  {
    id: 'littletikes',
    platform: 'projector',
    kind: 'shopify',
    base: 'https://www.littletikes.com',
    // The whole Little Tikes store runs through this one feed and its
    // product_type is generic ('preschool toys' / 'toys'), so the Story
    // Dream Machine line is recognised by title instead. Kept: story
    // collections and single-story cartridges. Dropped: the Dream Pals
    // plush and other plush, carry/storage cases, the build-your-own
    // bundle listings, and the Starter / Special Edition packs — those
    // are the listings that bundle the projector hardware (the feed
    // has no standalone projector listing). The line name is stripped
    // from titles; it survives in `details`.
    includeTitle: /^Story Dream Machine/i,
    excludeTitle:
      /^Story Dream Pals\b|\bPlush\b|Starter Pack|Special Edition Pack|\bCase\b|^Build Your Own\b/i,
    stripTitlePrefix: 'Story Dream Machine ',
    detailsByTitle: [
      { match: /collection|colección|\bpack\b/i, details: 'Dream Machine story collection' },
    ],
    details: 'Dream Machine story cartridge',
  },
  {
    id: 'yoto',
    platform: 'yoto',
    kind: 'shopify',
    base: 'https://us.yotoplay.com',
    // product_type does the work here: cards are 'single-card', packs
    // of cards are 'bundle' / 'soft-bundle'. Not kept: 'content-bundle'
    // (every one of them bundles a Player or Mini), 'player-unit',
    // 'accessories' (cases, headphones, cables), 'Gift Card', 'Club'.
    // Digital-only cards are dropped too — the catalog tracks physical
    // cards; the store flags them 'flag:Digital Card' and usually
    // suffixes the title '(Digital)'.
    includeTypes: ['single-card', 'bundle', 'soft-bundle'],
    excludeTitle: /\(Digital\)\s*$/i,
    excludeTags: ['flag:Digital Card'],
    detailsByType: {
      'single-card': 'Yoto Card',
      bundle: 'Yoto Card pack',
      'soft-bundle': 'Yoto Card pack',
    },
    stripTitleSuffix: '',
  },
  {
    id: 'storypod',
    platform: 'storypod',
    kind: 'shopify',
    base: 'https://storypod.com',
    // The content line: figures, tokens, books, card/trivia decks,
    // learning sets, activity books, puzzles, and content bundles.
    // Feed evidence (299 products): no bundle in 'Content Bundle'
    // includes the player — they run $11.99–$59.99 and are all tagged
    // 'audio-experience'; the player itself isn't sold as a feed
    // product. Dropped by type: 'Sleeves' ($0 player covers) and
    // 'Plush' (the standalone Snuggly Sounds toys, not player
    // content). Dropped by title, from the untyped listings: the
    // Eddi device, a charging cable, and the subscription buy-out.
    // The untyped single Recordable Token IS content, rescued by the
    // detailsByTitle rule.
    excludeTypes: ['Sleeves', 'Plush'],
    excludeTitle: /charging cable|subscription buy out|\beddi\b/i,
    detailsByType: {
      Crafties: 'Craftie figure',
      Tokens: 'Token',
      'Picture Books': 'Picture book',
      'Board Books': 'Board book',
      'Learning Sets': 'Learning set',
      'Content Bundle': 'Content bundle',
      'Activity Books': 'Activity book',
      'Card Sets': 'Card set',
      Puzzles: 'Puzzle',
      'Trivia Decks': 'Trivia deck',
    },
    detailsByTitle: [{ match: /^recordable token$/i, details: 'Token' }],
    stripTitleSuffix: '',
  },
  {
    id: 'osmo',
    platform: 'osmo',
    kind: 'shopify',
    base: 'https://www.playosmo.com',
    // Only standalone games belong here. product_type is no help
    // (40 of 48 products are untyped, and some 'game'-typed listings
    // are starter kits), so the allow-list is by title. The Fire and
    // iPad listings of a game stay separate rows — they are not
    // interchangeable (different bases/reflectors). Excluded: every
    // starter kit (Coding Awbie is only sold that way), bases,
    // reflectors, cases, the Math Wizard Series bundle and the
    // Pretend Play Bundle (both duplicate the singles), and the
    // mystery-gift promos. Coding/Newton/Masterpiece have no
    // standalone listings in the current feed.
    includeTitle:
      /^(Detective Agency|Genius Numbers|Genius Words|Genius Tangram|Little Genius Costume Pieces|Little Genius Sticks & Rings|Math Wizard and the|Monster|Pizza Co)/i,
    excludeTitle: /starter kit|\bbase\b|reflector|\bcase\b|bundle|series|mystery gift/i,
    details: 'Osmo game',
    stripTitleSuffix: '',
  },
  {
    id: 'lunii',
    platform: 'lunii',
    kind: 'lunii',
    // The US store is the /en-us/ tree of lunii.com (see lib/lunii.mjs
    // for why this locale, and only this locale, is ingested).
    sitemap: 'https://lunii.com/api/products-sitemap.xml',
    localePath: '/en-us/products/',
    maxProducts: 800,
  },
  {
    id: 'leapfrog',
    platform: 'leapfrog',
    kind: 'leapfrog',
    seeds: [
      'https://store.leapfrog.com/en-us/store/c',
      'https://store.leapfrog.com/en-us/',
    ],
    maxProducts: 400,
  },
]
