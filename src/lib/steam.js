// The STEAM section (owner-directed 2026-10-27): one shelf for
// science, technology, engineering, art-tech and maths toys —
// the electronics/robotics makers (rounds 1–2) plus the STEM
// lines the catalog already carried. Traditional art keeps its
// own zone elsewhere; what's here is art wired into making —
// paper circuits, conductive dough, drawing robots.
//
// Membership is derived from data the catalog already has —
// a new maker added under one of these platforms joins the
// section automatically, nothing to maintain. One row-level
// exception: Robotime, whose ROKR mechanical kits belong here
// while its Rolife craft kits sit on the Arts & Crafts shelf.
export const STEAM_PLATFORMS = [
  // Electronics & robotics (assembly-kit rounds 1 and 2)
  'sphero',
  'arduino',
  'makeblock',
  'ozobot',
  'elenco',
  'sparkfun',
  'piper',
  'wonderworkshop',
  'elegoo',
  'eblox',
  'chibitronics',
  'circuitscribe',
  'circuitcubes',
  'squishycircuits',
  'engino',
  'birdbrain',
  'robolink',
  'sunfounder',
  'browndoggadgets',
  'powerup',
  'pimoroni',
  'picobricks',
  'inventr',
  'circuitmess',
  'robotis',
  'fischertechnik',
  'adafruit',
  'dfrobot',
  'kitronik',
  'seeed',
  'elecrow',
  'cubelets',
  'twinscience',
  'robotical',
  'tinkeringlabs',
  // Building & engineering (shelves round, 2026-10-27)
  'ugears',
  'plusplus',
  'geomag',
  'zometool',
  'knex',
  'keva',
  'arckit',
  'metalearth',
  // Science, logic & learning lines already in the catalog
  'thamesandkosmos',
  'kiwico',
  'osmo',
  'smartgames',
  'thinkfun',
  'learningresources',
  'lakeshore',
]

// Does this catalog row belong on the STEAM shelf?
export function isSteamRow(item) {
  if (!item) return false
  if (STEAM_PLATFORMS.includes(item.platform)) return true
  // Robotime straddles both shelves: its ROKR mechanical kits are
  // STEAM, its Rolife craft kits are Arts & Crafts. The ingestor
  // carries the line in the row's details.
  return (
    item.platform === 'robotime' &&
    String(item.details ?? '').trim().startsWith('ROKR')
  )
}
