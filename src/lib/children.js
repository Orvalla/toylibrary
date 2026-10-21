// Per-child grouping helpers (see supabase/migrations/0005_children.sql).
//
// An item's child_id is either the id of a row in `children` or null.
// Null means "Family" — the item belongs to everyone and renders in its
// own section, always last. Items pointing at a child that isn't in the
// list (e.g. it was just deleted) are treated as Family too.

export const FAMILY_NAME = 'Family'

export function childNameFor(item, children) {
  if (!item?.child_id) return FAMILY_NAME
  return (children ?? []).find((c) => c.id === item.child_id)?.name ?? FAMILY_NAME
}

// Ordered sections for rendering: one per child, in the order the
// children were given, then the Family section last. Sections with no
// items are omitted — a heading over an empty grid helps nobody.
export function groupByChild(items, children) {
  const kids = children ?? []
  const known = new Set(kids.map((c) => c.id))
  const sections = []
  for (const child of kids) {
    const own = (items ?? []).filter((i) => i.child_id === child.id)
    if (own.length) sections.push({ childId: child.id, childName: child.name, items: own })
  }
  const family = (items ?? []).filter((i) => !i.child_id || !known.has(i.child_id))
  if (family.length) sections.push({ childId: null, childName: FAMILY_NAME, items: family })
  return sections
}
