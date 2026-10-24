// Bundle helpers (migration 0013). A bundle is a catalog row
// with is_bundle set; bundle_contents maps it to the catalog
// rows inside it. The math here mirrors the share-page RPC:
// for a bundle sitting in a child's bucket, a content counts as
// owned when a have-item with the same platform+title sits in
// that bucket or the shared Family bucket; a Family bundle
// counts contents owned by anyone in the family.

export const PLATFORM_NOUN = {
  tonies: 'figures',
  yoto: 'cards',
  books: 'books',
  storypod: 'stories',
  projector: 'story reels',
  leapfrog: 'books',
  osmo: 'games',
  lunii: 'stories',
  vtech: 'books',
  other: 'items',
}

export function platformNoun(platform) {
  return PLATFORM_NOUN[platform] ?? 'items'
}

// "{child} already has {n} of the {total} {noun} in this
// collection" — the line the gift page and lists show on a
// bundle. Family bundles speak for the household.
export function bundleHeadline({ name, owned, total, platform }) {
  const who = name && name !== 'Family' ? name : 'The family'
  return `${who} already has ${owned} of the ${total} ${platformNoun(platform)} in this collection`
}

export const itemKey = (platform, title) =>
  `${platform}|${String(title ?? '').trim().toLowerCase()}`

export function indexContents(rows) {
  const map = new Map()
  for (const r of rows ?? []) {
    if (!map.has(r.bundle_id)) map.set(r.bundle_id, [])
    map.get(r.bundle_id).push(r.content_id)
  }
  return map
}

export function indexCatalog(rows) {
  const byId = new Map()
  const byKey = new Map()
  for (const r of rows ?? []) {
    byId.set(r.id, r)
    byKey.set(itemKey(r.platform, r.title), r)
  }
  return { byId, byKey }
}

// The owned-title set for one bucket (child id, or null for
// Family), from the family's have rows.
export function ownedKeysForBucket(items, childId) {
  const set = new Set()
  for (const i of items ?? []) {
    if (i.list_type !== 'have') continue
    if (childId == null || i.child_id === childId || i.child_id == null) {
      set.add(itemKey(i.platform, i.title))
    }
  }
  return set
}

// Coverage for one bundle catalog row: how many of its mapped
// contents are in ownedKeys, and the missing ones (capped, in
// the shape the share RPC returns so one component renders both).
export function bundleInfoFor({ twin, contentsByBundle, catalogById, ownedKeys }) {
  if (!twin?.is_bundle) return null
  const ids = contentsByBundle?.get(twin.id) ?? []
  const contents = ids.map((id) => catalogById?.get(id)).filter(Boolean)
  if (!contents.length) return null
  const missing = contents.filter((c) => !ownedKeys.has(itemKey(c.platform, c.title)))
  return {
    total: contents.length,
    owned: contents.length - missing.length,
    missing: missing.slice(0, 12).map((c) => ({
      id: c.id,
      title: c.title,
      platform: c.platform,
      details: c.details ?? '',
      asin: c.asin ?? null,
      product_url: c.product_url ?? null,
      image_url: c.image_url ?? '',
    })),
  }
}

// Which list items a bundle on the same list speaks for: when
// a bundle sits in a bucket (a child's list, or Family), its
// content items in the SAME bucket and list don't need their
// own tiles — the bundle's entry (and its coverage note)
// represents them. Returns the item ids to fold away in list
// views. The rows themselves are untouched: bundle math, the
// share page and every other consumer still see each piece.
// A bundle that is itself the content of a bigger bundle on
// the list folds too (a 3-pack of collections shows as the
// one pack).
export function foldedContentItemIds({ items, catalogByKey, contentsByBundle }) {
  const bucketContents = new Map() // "list|child" -> Set<catalogId>
  const bucketOf = (i) => `${i.list_type}|${i.child_id ?? ''}`
  for (const i of items ?? []) {
    const twin = catalogByKey?.get(itemKey(i.platform, i.title))
    if (!twin?.is_bundle) continue
    const key = bucketOf(i)
    if (!bucketContents.has(key)) bucketContents.set(key, new Set())
    for (const cid of contentsByBundle?.get(twin.id) ?? []) bucketContents.get(key).add(cid)
  }
  const folded = new Set()
  for (const i of items ?? []) {
    const twin = catalogByKey?.get(itemKey(i.platform, i.title))
    if (!twin) continue
    if (bucketContents.get(bucketOf(i))?.has(twin.id)) folded.add(i.id)
  }
  return folded
}

// When a bundle joins a have-list, its contents join too — the
// child owns the stories, not just the box. Builds the item
// rows to insert: every mapped content not already in the
// bucket's owned set.
export function cascadeContentRows({ entry, contentsByBundle, catalogById, ownedKeys, ownerId, childId }) {
  const ids = contentsByBundle?.get(entry.id) ?? []
  return ids
    .map((id) => catalogById?.get(id))
    .filter(Boolean)
    .filter((c) => !ownedKeys.has(itemKey(c.platform, c.title)))
    .map((c) => ({
      owner_id: ownerId,
      list_type: 'have',
      platform: c.platform,
      title: c.title,
      details: c.details ?? '',
      notes: '',
      image_url: c.image_url ?? '',
      asin: c.asin ?? null,
      child_id: childId,
    }))
}
