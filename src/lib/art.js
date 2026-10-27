// The Arts & Crafts section (owner-directed 2026-10-27): the
// truly pure art, sequestered to its own shelf — art supplies
// and craft kits, as opposed to STEAM's art-tech (paper
// circuits, conductive dough), which stays on the STEAM shelf.
//
// Membership is derived from data the catalog already has:
//   * The pure-art platforms are in whole — every row on them is
//     an art supply or craft kit (each was fenced to pure art at
//     ingestion): Crayola, and the shelves-round makers OOLY,
//     Faber-Castell (Creativity for Kids), Bright Stripes,
//     Kwik Stix, Petit Collage, Ann Williams, Pipsticks and
//     Rainbow Loom.
//   * In the mixed toy brands, only the maker's own art lines
//     qualify, matched on the exact category text the maker's
//     store wrote into the row's details (the same details the
//     ingestor already carries). Melissa & Doug's "Colors &
//     Shapes" learning toys, Djeco's toddler puzzles and
//     rattles, and Mudpuppy's jigsaws are NOT art-making and
//     stay out — they live on their own shelves.
const ART_PLATFORMS = new Set([
  'crayola',
  'ooly',
  'fabercastell',
  'brightstripes',
  'thepencilgrip',
  'petitcollage',
  'annwilliams',
  'pipsticks',
  'rainbowloom',
])

const ART_DETAILS = {
  melissaanddoug: new Set([
    'Stickers & Sticker Books',
    'Craft & Stamp Kits',
    'Easels & Art Supplies',
    'Arts & Crafts',
  ]),
  djeco: new Set([
    'Water colouring set',
    'Water colouring folder',
    'Finger paint tubes',
    'First collage kit',
    '6 creative activities box',
    // Shelves-round top-up (2026-10-27): the older age bands'
    // workshop/DIY art lines, labelled by the maker's own
    // category text exactly as ingested.
    '3D painting kit',
    '5 crafting activities set',
    'Atelier kit',
    'Bead bracelet kit',
    'Bead jewellery kit',
    'Bead loom kit',
    'Bead necklace kit',
    'Beaded tiara kit',
    'Brush pens set',
    'Collage kit',
    'Colour and build kit',
    'Colour-in plane kit',
    'Colouring scene kit',
    'Colouring set',
    'Constellation viewer kit',
    'Crinkle cutting kit',
    'Cyanotype kit',
    'Dream catcher kit',
    'Engraving kit',
    'Fashion design kit',
    'Flower press kit',
    'Foil and transfer art kit',
    'Foil art kit',
    'Foil art mask kit',
    'Glitter art kit',
    'Headband craft kit',
    'Kaleidoscope kit',
    'Kumihimo bracelet kit',
    'Learn to draw kit',
    'Magic colouring kit',
    'Model house painting kit',
    'Mosaic collage kit',
    'Mosaic kit',
    'Mosaic sticker kit',
    'Oil pastel kit',
    'Origami kit',
    'Painting kit',
    'Palette painting kit',
    'Paper jewellery kit',
    'Rub-on transfer kit',
    'Sand art kit',
    'Scratch boards',
    'Sewing necklace kit',
    'Stencil set',
    'Sticker art kit',
    'Sticker decorating kit',
    'Sticker fashion kit',
    'Sticker scene set',
    'Sticker tiara kit',
    'Transfer art purse kit',
    'Water bead kit',
    'Watercolour kit',
    'Watercolour paint set',
    'Wooden bead kit',
  ]),
  eeboo: new Set(['Art set', 'Color pencils']),
  mudpuppy: new Set([
    'Scratch & Sparkle Art Activity Kit',
    'Color By Sticker Activity Kit',
    'Coloring & Activity',
    'Coloring Book',
    'Sticker Tin',
  ]),
}

// Does this catalog row belong on the Arts & Crafts shelf?
export function isArtRow(item) {
  if (!item) return false
  if (ART_PLATFORMS.has(item.platform)) return true
  // Robotime straddles both shelves: its Rolife craft kits are
  // art, its ROKR mechanical kits are STEAM. The ingestor
  // carries the line in the row's details.
  if (item.platform === 'robotime') {
    return String(item.details ?? '').trim().startsWith('Rolife')
  }
  const lines = ART_DETAILS[item.platform]
  return !!lines && lines.has(String(item.details ?? '').trim())
}
