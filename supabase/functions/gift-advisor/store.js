// gift-advisor data access: the Supabase (service-role) side of
// retrieval and the §6 counters. Plain JS taking the client as an
// argument, so the query shapes can be exercised with a fake.

import { INTERESTS, PLAYER_PLATFORMS, ageOn, itemKey } from './retrieval.js'

export const CATALOG_COLUMNS =
  'id, platform, title, details, item_type, age_min_years, rating, rating_count, base_price_usd, base_price_checked_at, product_url'

const KNOWN_INTERESTS = new Set(INTERESTS.map((i) => i.key))
const PLAYERS = new Set(Object.keys(PLAYER_PLATFORMS))

// keywords / titleWords come only from the fixed INTERESTS list or
// [a-z0-9]+ tokens (retrieval.titleSearchWords); scrubbed and quoted
// anyway so nothing can break out of the PostgREST or-filter.
const safe = (w) => String(w).replace(/[^a-z0-9 ]/gi, '')
export const orIlike = (fields, words) =>
  fields.flatMap((f) => words.map((w) => `${f}.ilike."%${safe(w)}%"`)).join(',')

function catalogQuery(admin, q) {
  let query = admin
    .from('catalog_items')
    .select(CATALOG_COLUMNS)
    .eq('hidden', false)
    .eq('pending_review', false)
    .not('age_min_years', 'is', null)
  if (q.platforms?.length) query = query.in('platform', q.platforms)
  if (q.keywords?.length) query = query.or(orIlike(['title', 'details'], q.keywords))
  if (q.titleWords?.length) query = query.or(orIlike(['title'], q.titleWords))
  return query
}

async function rowsOf(query) {
  const { data, error } = await query
  if (error) throw new Error('catalog query failed')
  return data ?? []
}

export function supabaseCatalog(admin) {
  const ordered = (query, limit) =>
    query
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .limit(limit)
  return {
    eligible: (q) => rowsOf(ordered(catalogQuery(admin, q).lte('age_min_years', q.age), q.limit)),
    olderThan: (q) => rowsOf(ordered(catalogQuery(admin, q).gt('age_min_years', q.age), q.limit)),
  }
}

// The gift page's own data for one child: age (from birth date),
// interests, owned players, and the exclusion keys (owned items and
// actively claimed wishlist items). Scope = that child + "Family"
// items; with no single child chosen, the whole family's items.
export async function loadPage(admin, slug, childId, today = new Date()) {
  const { data: prof, error } = await admin
    .from('profiles')
    .select('id')
    .eq('share_slug', slug)
    .eq('share_enabled', true)
    .maybeSingle()
  if (error) throw new Error('profile lookup failed')
  if (!prof) return null

  const { data: kids, error: kidErr } = await admin
    .from('children')
    .select('id, birth_date, interests')
    .eq('owner_id', prof.id)
  if (kidErr) throw new Error('children lookup failed')
  const list = kids ?? []
  const child = list.find((k) => k.id === childId) ?? (list.length === 1 ? list[0] : null)

  const { data: items, error: itemErr } = await admin
    .from('items')
    .select('platform, title, list_type, child_id, claimed_at, claim_expires_at')
    .eq('owner_id', prof.id)
  if (itemErr) throw new Error('items lookup failed')
  return pageContext(child, items ?? [], today)
}

// Pure half of loadPage, unit-tested directly.
export function pageContext(child, items, today) {
  const inScope = (i) => !child || i.child_id == null || i.child_id === child.id
  const nowMs = today.getTime()
  const excludeKeys = new Set()
  const players = new Set()
  for (const i of items.filter(inScope)) {
    if (i.list_type === 'have') {
      excludeKeys.add(itemKey(i.platform, i.title))
      if (PLAYERS.has(i.platform)) players.add(i.platform)
    } else if (i.list_type === 'wishlist') {
      const claimed =
        i.claimed_at != null && (i.claim_expires_at == null || new Date(i.claim_expires_at).getTime() > nowMs)
      if (claimed) excludeKeys.add(itemKey(i.platform, i.title))
    }
  }
  return {
    childId: child?.id ?? null,
    age: child ? ageOn(child.birth_date, today) : null,
    interests: (child?.interests ?? []).filter((k) => KNOWN_INTERESTS.has(k)),
    players: [...players],
    excludeKeys,
  }
}

export function supabaseStore(admin, { hourCap, dayCap }) {
  return {
    catalog: supabaseCatalog(admin),
    loadPage: (slug, childId) => loadPage(admin, slug, childId),
    async takeTurn(ipHash) {
      const { data, error } = await admin.rpc('advisor_take_turn', {
        p_ip_hash: ipHash,
        p_hour_cap: hourCap,
        p_day_cap: dayCap,
      })
      if (error) throw new Error('counter rpc failed')
      return data === true
    },
    async spendToday() {
      const { data, error } = await admin.rpc('advisor_spend_today')
      if (error) throw new Error('spend rpc failed')
      return Number(data ?? 0)
    },
    async logUsage(row) {
      const { error } = await admin.from('advisor_usage').insert(row)
      if (error) throw new Error('usage insert failed')
    },
    async markAlert(level, spend) {
      const day = new Date().toISOString().slice(0, 10)
      const { error } = await admin
        .from('advisor_alerts')
        .upsert({ day, level, spend: Number(Number(spend).toFixed(6)) }, { onConflict: 'day,level', ignoreDuplicates: true })
      if (error) throw new Error('alert upsert failed')
    },
  }
}
