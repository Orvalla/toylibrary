// Sub-categories inside the 'projector' platform. Two incompatible
// story-projector systems share the platform — Moonlite (phone-clip
// story reels) and the Little Tikes Story Dream Machine (cartridges)
// — and a family owns one or the other, so every projector surface
// splits by brand. The brand isn't a column: it is fully determined
// by the catalog's own wording (Moonlite content is "Story reel…",
// Dream Machine content is "Dream Machine…"), verified against all
// 155 live rows on 2026-10-22 — zero unclassifiable.

export const PROJECTOR_BRANDS = [
  { key: 'moonlite', label: 'Moonlite', emoji: '🌙' },
  { key: 'dream-machine', label: 'Dream Machine', emoji: '✨' },
]

export function projectorBrandOf(item) {
  if (!item || item.platform !== 'projector') return null
  const text = `${item.title ?? ''} ${item.details ?? ''}`.toLowerCase()
  if (text.includes('dream machine')) return 'dream-machine'
  if (text.includes('moonlite') || text.includes('story reel')) return 'moonlite'
  return null
}

export function projectorBrand(key) {
  return PROJECTOR_BRANDS.find((b) => b.key === key) ?? null
}

// Ordered sub-groups for section rendering: Moonlite first, then
// Dream Machine, then anything unbranded (a hand-added item whose
// wording names neither system) with no heading of its own.
export function projectorGroups(items) {
  const groups = PROJECTOR_BRANDS.map((b) => ({ ...b, items: [] }))
  const other = { key: null, label: null, emoji: null, items: [] }
  for (const item of items) {
    const brand = projectorBrandOf(item)
    const group = groups.find((g) => g.key === brand) ?? other
    group.items.push(item)
  }
  return [...groups, other].filter((g) => g.items.length > 0)
}
