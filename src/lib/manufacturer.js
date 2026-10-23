// Direct manufacturer links (owner request 2026-10-22): tiles
// offer the maker's own product page next to the Amazon link —
// but ONLY a direct product page. The owner explicitly ruled
// out falling back to the maker's storefront/catalog home:
// a link that lands on a generic catalog isn't the item, so
// items whose exact page is unknown (mostly discontinued
// stock the maker's store no longer lists) simply show no
// manufacturer link. catalog_items.product_url (migration
// 0025) is copied onto items when they're added, so one field
// serves every tile.

export function manufacturerUrlFor(item) {
  return item?.product_url || null
}

// The link's label names the SITE it goes to (owner request
// 2026-10-23), not the item's platform: a book's product page
// lives at Open Library, BRIO and ThinkFun items link into
// Ravensburger's store, Little People into Mattel's. Hosts we
// know get their proper site name; anything else falls back to
// a tidied-up domain so a user-added store still names itself.
const SITE_NAMES = {
  'openlibrary.org': 'Open Library',
  'us.tonies.com': 'Tonies',
  'us.yotoplay.com': 'Yoto',
  'storypod.com': 'Storypod',
  'store.leapfrog.com': 'LeapFrog',
  'lunii.com': 'Lunii',
  'www.playosmo.com': 'Osmo',
  'www.vtechkids.com': 'VTech',
  'www.mymoonlite.com': 'Moonlite',
  'www.habausa.com': 'HABA',
  'magnatiles.com': 'Magna-Tiles',
  'gamesbysmart.com': 'SmartGames',
  'lovevery.com': 'Lovevery',
  'www.melissaanddoug.com': 'Melissa & Doug',
  'shop.mattel.com': 'Mattel',
  'www.fisher-price.com': 'Fisher-Price',
  'www.ravensburger.us': 'Ravensburger',
  'www.fatbraintoys.com': 'Fat Brain Toys',
  'www.lakeshorelearning.com': 'Lakeshore',
  'www.learningresources.com': 'Learning Resources',
  'www.littletikes.com': 'Little Tikes',
  'www.thamesandkosmos.com': 'Thames & Kosmos',
  'www.kiwico.com': 'KiwiCo',
  'www.eeboo.com': 'eeBoo',
  'www.mudpuppy.com': 'Mudpuppy',
  'www.sphero.com': 'Sphero',
  'store.asmodee.com': 'Asmodee',
  'pandasaurusgames.com': 'Pandasaurus Games',
  'renegadegamestudios.com': 'Renegade Game Studios',
  'floodgate.games': 'Floodgate Games',
  'www.catan.com': 'CATAN',
  'blueorangegames.com': 'Blue Orange',
  'iello.fr': 'IELLO',
  'capstone-games.com': 'Capstone Games',
  'www.explodingkittens.com': 'Exploding Kittens',
  'www.hachetteboardgames.com': 'Hachette Board Games',
  'www.goliathgames.us': 'Goliath',
  'www.relatable.com': 'Relatable',
  'www.buffalogames.com': 'Buffalo Games',
  'shop.spinmaster.com': 'Spin Master',
  'deviramericas.com': 'Devir',
  'plantoys.com': 'PlanToys',
  'uk.hape.com': 'Hape',
  'www.janod.us': 'Janod',
  'letoyvan.com': 'Le Toy Van',
  'tenderleaftoys.com': 'Tender Leaf Toys',
  'greentoys.com': 'Green Toys',
  'www.manhattantoy.com': 'Manhattan Toy',
  'tegu.com': 'Tegu',
  'guidecraft.com': 'Guidecraft',
  'unclegoose.com': 'Uncle Goose',
}

export function siteNameForUrl(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (SITE_NAMES[host]) return SITE_NAMES[host]
  // Unknown host: name the site by its registrable label —
  // drop shop-style subdomains (www, shop, store, country
  // codes) from the front, then capitalize what remains
  // ('shop.example-store.co.uk' -> 'Example-store').
  const NOISE = new Set(['www', 'shop', 'store', 'us', 'uk', 'en', 'www2'])
  let parts = host.split('.')
  while (parts.length > 2 && NOISE.has(parts[0])) parts = parts.slice(1)
  const label = parts[0]
  if (!label) return null
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// The "At …" label for an item's manufacturer link: the site's
// name, or null when the item has no direct product page.
export function manufacturerNameFor(item) {
  const url = manufacturerUrlFor(item)
  return url ? siteNameForUrl(url) : null
}
