// The STEAM section (owner-directed 2026-10-27): one shelf for
// science, technology, engineering, art-tech and maths toys —
// the electronics/robotics makers (rounds 1–2) plus the STEM
// lines the catalog already carried. Traditional art keeps its
// own zone elsewhere; what's here is art wired into making —
// paper circuits, conductive dough, drawing robots.
//
// Membership is by platform only, derived from data the catalog
// already has — a new maker added under one of these platforms
// joins the section automatically, nothing to maintain.
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
  return !!item && STEAM_PLATFORMS.includes(item.platform)
}
