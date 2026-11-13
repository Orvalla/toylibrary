// The Science & Physics category (owner-directed 2026-11-13):
// science and physics kits get a first-class shelf of their own
// instead of filing under the general Toys category — experiment
// kits, electronics kits, STEM crates and marble runs.
//
// Membership is derived from data the catalog already has: the
// kit-first science makers join by platform, so a new maker added
// under one of these platforms lands here automatically. One
// row-level carve-out: GraviTrax, Ravensburger's physics marble
// run, which lives inside a mixed publisher's platform and joins
// by its details prefix (the Robotime/ROKR pattern from
// lib/steam.js) rather than dragging every Ravensburger puzzle
// and game in with it.
//
// Deliberately NOT here: the logic-game lines (SmartGames,
// ThinkFun — they file under Games/Toys, and the STEAM section
// still gathers them), general-education platforms (Lakeshore),
// and the robotics/electronics end of STEAM, which is technology
// rather than science kits. Categories also run the details
// keywords (figure/book/card/game) BEFORE this check, so a
// science maker's games — Thames & Kosmos publishes the EXIT
// line — stay in Games where they belong.
export const SCIENCE_PLATFORMS = [
  'thamesandkosmos',
  'kiwico',
  'elenco',
  'learningresources',
  'geomag',
  'magtrax',
]

// Does this catalog row belong in Science & Physics?
export function isScienceRow(item) {
  if (!item) return false
  if (SCIENCE_PLATFORMS.includes(item.platform)) return true
  return (
    item.platform === 'ravensburger' &&
    String(item.details ?? '').trim().startsWith('GraviTrax')
  )
}
