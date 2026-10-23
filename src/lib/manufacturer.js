// Direct manufacturer links (owner request 2026-10-22): every
// tile offers the maker's own site next to the Amazon link.
// The exact product page wins when the catalog knows it
// (catalog_items.product_url, migration 0025, copied onto
// items when they're added); otherwise the platform's official
// store stands in, so the link exists wherever a maker has a
// site at all. Books have no single maker site, and 'other'
// has none by definition — those get no link.

import { projectorBrandOf } from './projector'

export const PLATFORM_SITES = {
  tonies: 'https://us.tonies.com',
  yoto: 'https://us.yotoplay.com',
  storypod: 'https://storypod.com',
  leapfrog: 'https://www.leapfrog.com',
  lunii: 'https://www.lunii.com',
  osmo: 'https://www.playosmo.com',
  vtech: 'https://www.vtechkids.com',
  haba: 'https://www.habausa.com',
  magnatiles: 'https://www.magnatiles.com',
  smartgames: 'https://www.smartgamesusa.com',
  lovevery: 'https://lovevery.com',
  melissaanddoug: 'https://www.melissaanddoug.com',
  littlepeople: 'https://shop.mattel.com',
  brio: 'https://www.brio.us',
  fatbrain: 'https://www.fatbraintoys.com',
  lakeshore: 'https://www.lakeshorelearning.com',
  learningresources: 'https://www.learningresources.com',
  littletikes: 'https://www.littletikes.com',
}

// The projector platform mixes two makers: Moonlite reels and
// Little Tikes' Story Dream Machine. The brand follows the
// title (lib/projector), and a title that names neither falls
// back to Moonlite, the platform's original maker.
const PROJECTOR_SITES = {
  moonlite: 'https://www.mymoonlite.com',
  'dream-machine': 'https://www.littletikes.com',
}

export function manufacturerSiteFor(item) {
  if (!item) return null
  if (item.platform === 'projector') {
    return PROJECTOR_SITES[projectorBrandOf(item) ?? 'moonlite']
  }
  return PLATFORM_SITES[item.platform] ?? null
}

// The URL a tile's manufacturer link should point at: the
// item's own product page when known, else its maker's site,
// else null (no link).
export function manufacturerUrlFor(item) {
  if (item?.product_url) return item.product_url
  return manufacturerSiteFor(item)
}
