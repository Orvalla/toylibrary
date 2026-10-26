// Bundle-contents extraction — the generalized successor to the
// one-off ingestor/bundles.mjs (which was hardcoded to Tonies /
// Moonlite / Osmo inserts plus Yoto / Storypod / projector
// flagging, on a SQL transport from another era). This module is
// pure: callers fetch the bundle's store page, hand in
// { platform, title, bodyHtml | pageText } plus the platform's
// non-bundle catalog rows as the match pool, and get back a
// verdict. Nothing here writes anything.
//
// The house bar is exact-count (RECON Part B): a bundle maps only
// when its contents are enumerated in a closed form AND every
// corroborating count the page offers agrees — title pipe-list,
// stated-count sentence, per-title SKU blocks, pack-size label,
// structured activities array. A partial extraction is a FAILURE,
// reported with the names it could not resolve, never emitted as
// a mapping. Bundles whose "contents" are one item ×N (party /
// assortment / gift-display sets) are EXCLUDED — they are the
// bundle_contents_no_data candidates (migration 0054), not
// mappings waiting to happen.
//
// bundles.mjs's three signals survive, generalized:
//   1. bold-title lists (<b>/<strong> headed sections),
//   2. the strict description scan (a pool title, full and
//      >= 8 normalized chars, appearing in the bundle's text),
//   3. series-stem match (pool titles under the bundle's stem).
// They now feed name RESOLUTION (and the generic pattern below);
// the per-platform patterns from the completeness recon are the
// primary extractors where they exist:
//   thamesandkosmos — title pipe-list + stated count + SKU blocks
//   kiwico          — embedded product JSON `activities` array
//   eeboo           — "Includes:" list, hyperlinked where present

const COUNT_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
}

export function normTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

export function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// ---- bundles.mjs signal 1: bold-title lists ----------------------
// Numbered "<b>1. Some Title:</b>" entries, or bare bold segments
// that look like titles (short, capitalised, no sentence inside).
export function boldTitles(html) {
  const out = []
  for (const m of String(html ?? '').matchAll(/<(?:b|strong)[^>]*>(.*?)<\/(?:b|strong)>/gis)) {
    const seg = stripTags(m[1]).replace(/:$/, '').trim()
    const numbered = seg.match(/^\d+\.\s*(.+)$/)
    if (numbered && numbered[1].length <= 60) {
      out.push(numbered[1].trim())
    } else if (
      seg.length >= 4 && seg.length <= 50 &&
      /^[A-Z0-9"']/.test(seg) &&
      seg.split(' ').length <= 9 &&
      !/[.!?].+\w/.test(seg) &&
      !/tonies|audiobook|language|sensitive|inappropriate|children\.|product|description|information|download/i.test(seg)
    ) {
      out.push(seg)
    }
  }
  return out
}

// ---- bundles.mjs signal 3: series stem ---------------------------
export function seriesStem(title) {
  return String(title ?? '')
    .replace(/\s*\((?:books?|vol\.?)[^)]*\)/gi, '')
    .replace(/\s+Book Tonies.*$/i, '')
    .replace(/\s+Pocket Tonies.*$/i, '')
    .replace(/\s+Tonies\s+\d+\s*Pack.*$/i, '')
    .replace(/\s*-\s*\d+\s*Pack.*$/i, '')
    .replace(/\s+(Collection|Pack|Boxed Set|Set)$/i, '')
    .trim()
}

// ---- name resolution against the pool ------------------------------
// Strategies, strongest first, each guarded by uniqueness — an
// ambiguous name stays unresolved rather than guessed:
//   handle      the name carried a /products/<handle> link and a
//               pool row's source_url ends with that handle
//   exact       normalized titles equal
//   suffix      a pool title ends with the name (EXIT contents are
//               named short: "The Cursed Labyrinth" inside
//               "EXIT: The Game - The Cursed Labyrinth"), or the
//               name ends with a pool title's tail after dropping
//               up to 4 leading series words ("Return to the
//               Abandoned Cabin" vs "… The Abandoned Cabin")
//   prefix      the name is a pool title plus a trailing word
//               ("… Book" / "… Kit"), pool title >= 10 chars
//   stem        pool titles under the bundle's series stem whose
//               full title also appears in the bundle's text
//               (bundles.mjs signals 2+3, as resolution aids)
function titleVariants(norm) {
  const words = norm.split(' ')
  const out = [norm]
  for (let drop = 1; drop <= 4 && words.length - drop >= 2; drop++) {
    const v = words.slice(drop).join(' ')
    if (v.length >= 6) out.push(v)
  }
  return out
}

export function matchContents(names, pool, { bundleTitle = '', bodyText = '' } = {}) {
  const rows = (pool ?? []).filter((r) => r && r.id && r.title)
  const byNorm = new Map()
  const byHandle = new Map()
  for (const r of rows) {
    const n = normTitle(r.title)
    if (!byNorm.has(n)) byNorm.set(n, [])
    byNorm.get(n).push(r)
    const h = String(r.source_url ?? '').match(/\/products\/([a-z0-9-]+)/i)
    if (h) byHandle.set(h[1].toLowerCase(), r)
  }
  const stem = normTitle(seriesStem(bundleTitle))
  const text = ` ${normTitle(bodyText)} `
  const claimed = new Set()
  const contents = []
  const unresolved = []

  const claim = (row) => {
    if (!row || claimed.has(row.id)) return false
    claimed.add(row.id)
    return true
  }
  const unique = (candidates) => {
    const fresh = [...new Set(candidates.map((r) => r.id))]
      .map((id) => rows.find((r) => r.id === id))
      .filter((r) => !claimed.has(r.id))
    return fresh.length === 1 ? fresh[0] : null
  }

  for (const entry of names ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name
    const handle = typeof entry === 'string' ? null : entry.handle
    const nn = normTitle(name)
    let row = null
    if (handle && byHandle.has(handle.toLowerCase())) {
      const r = byHandle.get(handle.toLowerCase())
      if (!claimed.has(r.id)) row = r
    }
    if (!row && nn) row = unique(byNorm.get(nn) ?? [])
    if (!row && nn.length >= 5) {
      row = unique(rows.filter((r) => normTitle(r.title).endsWith(` ${nn}`)))
    }
    if (!row && nn.length >= 5) {
      // Containment: the name as a bounded segment inside a
      // longer pool title ("The Sacred Temple" inside "EXIT:
      // The Game - The Sacred Temple with Puzzles").
      row = unique(
        rows.filter((r) => {
          const t = ` ${normTitle(r.title)} `
          return t.includes(` ${nn} `)
        }),
      )
    }
    if (!row && nn.length >= 8) {
      row = unique(
        rows.filter((r) =>
          titleVariants(normTitle(r.title)).some((v) => v.length >= 8 && nn.endsWith(` ${v}`)),
        ),
      )
    }
    if (!row && nn.length >= 10) {
      row = unique(rows.filter((r) => nn.startsWith(`${normTitle(r.title)} `)))
    }
    if (!row && stem && nn.length >= 8 && text.includes(` ${nn} `)) {
      row = unique(rows.filter((r) => normTitle(r.title).startsWith(stem)))
    }
    if (row && claim(row)) contents.push({ name, catalog_id: row.id, catalog_title: row.title })
    else unresolved.push(name)
  }
  return { contents, unresolved }
}

// ---- shared: a closed "Includes:" list -----------------------------
// The region after an "Includes:" marker. Two shapes in the wild:
// linked lists — product links in document order, whether they
// sit in <p>s, in pasted product-card <div>s (eeBoo's Dragon), or
// <br>-separated inside a single <p> (eeBoo's card-game bundles)
// — and plain lists, one short line per item (eeBoo's Dinosaur,
// Yoto's pack pages). Either way the list is closed: the first
// long prose passage after the items is the description
// resuming, and ends it. Returns null when no marker exists.
export function extractIncludesList(bodyHtml) {
  const html = String(bodyHtml ?? '')
  const marker = html.search(/includes\s*:/i)
  if (marker === -1) return null
  const region = html.slice(marker)

  const items = []
  let lastEnd = 0
  for (const m of region.matchAll(/<a[^>]*href=["'][^"']*\/products\/([a-z0-9-]+)["'][^>]*>(.*?)<\/a>/gis)) {
    const gap = stripTags(region.slice(lastEnd, m.index))
    if (items.length && gap.length > 80) break
    const name = stripTags(m[2])
    if (name) items.push({ name, handle: m[1].toLowerCase() })
    lastEnd = m.index + m[0].length
    if (items.length >= 12) break
  }
  if (items.length) return items

  const lines = region
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/<\/(?:p|div|li)>|\n/i)
    .map((chunk) => stripTags(chunk))
  for (const line of lines) {
    const text = line.replace(/\s+/g, ' ').trim().replace(/^includes\s*:\s*/i, '')
    if (!text) continue
    if (text.length > 80 || (text.length > 40 && /\.\s+[A-Z]/.test(text))) break
    items.push({ name: text, handle: null })
    if (items.length >= 12) break
  }
  return items
}

function countFromText(text) {
  const m = String(text ?? '').match(
    /\b(?:includes|contains|brings together)\s+(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/i,
  )
  if (!m) return null
  return COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1])
}

function packLabelCount(title) {
  const m = String(title ?? '').match(/(\d+)\s*-\s*pack/i)
  return m ? Number(m[1]) : null
}

// ---- thamesandkosmos ------------------------------------------------
// Contents stated three agreeing ways (RECON B2): the title's
// pipe enumeration (after "Bundle:", else after the last colon),
// a stated-count sentence, and one Product Information / SKU
// block per title. The bar: an enumeration plus at least one
// corroborating count, and every count present must agree.
export function extractThamesKosmos({ title, bodyHtml }) {
  const text = stripTags(bodyHtml)
  let names = titleEnumeration(title)
  let nameSource = names.length ? 'title' : null
  if (!names.length) {
    names = skuPairedHeadings(bodyHtml)
    nameSource = names.length ? 'sections' : null
  }
  const sentence = countFromText(text)
  const label = packLabelCount(title)
  const skus = new Set([...String(bodyHtml ?? '').matchAll(/SKU:\s*([A-Za-z0-9-]+)/g)].map((m) => m[1]))
  // A lone SKU block is the bundle's own Product Information —
  // per-title blocks only corroborate at two or more.
  const skuCount = skus.size >= 2 ? skus.size : null
  if (!names.length) {
    return { verdict: 'fail', reason: 'no contents enumerated in the title or the page sections' }
  }
  const counts = { sentence, label, sku: skuCount }
  const present = Object.entries(counts).filter(([, v]) => v !== null)
  if (!present.length) {
    return { verdict: 'fail', reason: 'enumeration with no corroborating count (stated, label, or SKU) — exact-count bar', names }
  }
  const disagree = present.filter(([, v]) => v !== names.length)
  if (disagree.length) {
    return {
      verdict: 'fail',
      reason: `count disagreement: ${names.length} names (${nameSource}) vs ${disagree.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      names,
    }
  }
  return { verdict: 'pass', names: names.map((name) => ({ name, handle: null })), statedCount: names.length }
}

function titleEnumeration(title) {
  const t = String(title ?? '')
  let tail = null
  const bi = t.toLowerCase().lastIndexOf('bundle:')
  if (bi >= 0) tail = t.slice(bi + 'bundle:'.length)
  else if (t.includes('|')) {
    const ci = t.lastIndexOf(':')
    tail = ci >= 0 ? t.slice(ci + 1) : t
  }
  if (!tail || !tail.includes('|')) return []
  return tail.split('|').map((s) => s.trim()).filter(Boolean)
}

const HEADING_JUNK = /product (description|information)|download|warning|safety|instruction|details|contents/i
// Section names that pair with per-title Product Information
// blocks: for each SKU on the page, the nearest preceding
// <strong> heading since the previous SKU. A heading harvest
// without the pairing counts feature blurbs as contents (the
// ReBotz / Spy Labs pages name 8 sections for 3–4 products) —
// the pairing is what makes a section a content.
function skuPairedHeadings(bodyHtml) {
  const html = String(bodyHtml ?? '')
  const headings = [...html.matchAll(/<strong[^>]*>(.*?)<\/strong>/gis)].map((m) => ({
    index: m.index,
    text: stripTags(m[1]).replace(/:$/, '').trim(),
  }))
  const out = []
  let cursor = -1
  for (const m of html.matchAll(/SKU:\s*[A-Za-z0-9-]+/g)) {
    const before = headings.filter((h) => h.index > cursor && h.index < m.index)
    const candidate = before[before.length - 1]
    cursor = m.index
    if (!candidate) continue
    const seg = candidate.text
    if (seg.length < 4 || seg.length > 60 || HEADING_JUNK.test(seg) || /[.!?]/.test(seg)) continue
    if (!out.includes(seg)) out.push(seg)
  }
  return out
}

// ---- kiwico -----------------------------------------------------------
// Two candidate sources, in trust order:
//   1. The numbered contents list in the product description —
//      "1. Planet Bath Bombs (Ages 9+) … Individual price: $19.95
//      / 2. Animal Bath Bombs …" — each entry a separately priced
//      project. This is the bundle's own contents statement.
//   2. The embedded product JSON's `activities` array
//      (quantity-prefixed: "(1) Santa Wobbler") — BUT on kit
//      pages the same field lists the kit's internal steps
//      ("Build the walls", "Add the roof"), so activities alone
//      never prove a bundle: the names must resolve to catalog
//      rows, and the pack label must then agree (the orchestrator
//      applies that gate post-resolution via labelCount below).
// A single activities entry — especially a slug of the product
// itself — is the same kit ×N: a quantity pack, not a bundle
// (RECON B1).
export function extractKiwiCo({ title, pageText }) {
  const listed = kiwiCoNumberedList(pageText)
  if (listed) {
    return { verdict: 'pass', names: listed.map((name) => ({ name, handle: null })), statedCount: listed.length }
  }
  let activities = null
  const m = String(pageText ?? '').match(/"activities"\s*:\s*(\[[^\]]*\])/)
  if (m) {
    try {
      const parsed = JSON.parse(m[1])
      if (Array.isArray(parsed)) activities = parsed.map((a) => String(a))
    } catch {
      activities = null
    }
  }
  if (!activities) {
    return { verdict: 'fail', reason: 'no activities array in the page JSON' }
  }
  const names = activities
    .map((a) => a.replace(/^\(\d+\)\s*/, '').trim())
    .filter(Boolean)
  if (!names.length) return { verdict: 'fail', reason: 'activities array is empty' }
  if (names.length === 1) {
    const only = names[0]
    const slugLike = /^[a-z0-9-]+$/.test(only)
    if (slugLike || /party|supply/i.test(title ?? '') || packLabelCount(title) !== null) {
      return {
        verdict: 'excluded',
        reason: 'quantity pack — activities lists the single kit itself (same kit ×N); no distinct contents to map',
        names,
      }
    }
    return { verdict: 'fail', reason: 'activities lists a single item — cannot corroborate a bundle', names }
  }
  return {
    verdict: 'pass',
    names: names.map((name) => ({ name, handle: null })),
    statedCount: names.length,
    labelCount: packLabelCount(title),
  }
}

// The numbered, individually-priced contents list KiwiCo prints
// for true multi-kit bundles. Sequential numbering from 1 and at
// least one "Individual price" are both required — a numbered
// list of steps inside one kit's description must not qualify.
export function kiwiCoNumberedList(pageText) {
  const text = String(pageText ?? '')
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
  if (!/individual price/i.test(text)) return null
  const entries = []
  for (const m of text.matchAll(/(\d+)\.\s+([A-Z][A-Za-z0-9 &+'’-]+?)(?=\s*\(Ages|\s+Individual price|\s+\d+\.\s)/g)) {
    const n = Number(m[1])
    if (n !== entries.length + 1) {
      if (entries.length) break
      continue
    }
    entries.push(m[2].trim())
    if (entries.length >= 8) break
  }
  return entries.length >= 2 ? entries : null
}

// ---- eeboo --------------------------------------------------------------
// A structured "Includes:" list in the description — product
// links where present, plain lines otherwise (RECON B2). Traps:
// "(6)" assortment rows are one set ×N, and an "Includes" naming
// components (pencils, a sharpener, a mural) is one product's
// parts, not contents.
export function extractEeboo({ title, bodyHtml }) {
  const text = stripTags(bodyHtml)
  if (/\(\d+\)\s*$/.test(title ?? '') || /assortment includes \d+ sets/i.test(text)) {
    return { verdict: 'excluded', reason: 'quantity assortment — the same set ×N, not distinct products', names: [] }
  }
  const items = extractIncludesList(bodyHtml)
  if (!items || !items.length) {
    return { verdict: 'fail', reason: 'no closed Includes: list in the description' }
  }
  if (items.length === 1) {
    return {
      verdict: 'fail',
      reason: 'Includes: names a single item — components of one set, not bundle contents',
      names: items.map((i) => i.name),
    }
  }
  const stated = countFromText(text)
  if (stated !== null && stated !== items.length) {
    return {
      verdict: 'fail',
      reason: `count disagreement: stated ${stated} vs ${items.length} Includes: items`,
      names: items.map((i) => i.name),
    }
  }
  return { verdict: 'pass', names: items, statedCount: items.length }
}

// ---- generic (weekly ingest + platforms without a pattern) -------------
// bundles.mjs's signals under the exact-count bar: a closed
// Includes list, else bold/headed titles — and a stated count
// (title N-pack or an "includes N" sentence) must corroborate
// whenever one exists. With no count anywhere, only a closed
// Includes list passes: headings alone can't prove exhaustiveness.
export function extractGeneric({ title, bodyHtml }) {
  const text = stripTags(bodyHtml)
  const listed = extractIncludesList(bodyHtml)
  const stated = countFromText(text) ?? packLabelCount(title)
  if (listed && listed.length >= 2) {
    if (stated !== null && stated !== listed.length) {
      return { verdict: 'fail', reason: `count disagreement: stated ${stated} vs ${listed.length} Includes: items`, names: listed.map((i) => i.name) }
    }
    return { verdict: 'pass', names: listed, statedCount: listed.length }
  }
  const bold = boldTitles(bodyHtml)
  if (bold.length >= 2 && stated !== null && bold.length === stated) {
    return { verdict: 'pass', names: bold.map((name) => ({ name, handle: null })), statedCount: stated }
  }
  if (bold.length >= 2) {
    return { verdict: 'fail', reason: `bold-title sections name ${bold.length} contents but no stated count corroborates the set`, names: bold }
  }
  return { verdict: 'fail', reason: 'no closed contents list or corroborated title sections on the page' }
}

// ---- orchestrator -------------------------------------------------------
// bundle: { platform, title, bodyHtml (Shopify description/HTML),
//           pageText (full page text/HTML for JSON-embedded
//           platforms) }
// pool:   the platform's non-bundle catalog rows [{ id, title,
//           source_url }]
// Returns { verdict: 'pass' | 'fail' | 'excluded', reason,
//           statedCount, names, contents, unresolved } — contents
//           in the page's order, each { name, catalog_id,
//           catalog_title }. A pass requires the extraction bar
//           AND every name resolved to a pool row: a partial
//           resolution is a failure (failure_class
//           'unresolved-contents'), never a partial mapping.
export function extractBundleContents(bundle, pool) {
  const platform = bundle?.platform
  let ex
  if (platform === 'thamesandkosmos') ex = extractThamesKosmos(bundle)
  else if (platform === 'kiwico') ex = extractKiwiCo(bundle)
  else if (platform === 'eeboo') ex = extractEeboo(bundle)
  else ex = extractGeneric(bundle)

  if (ex.verdict !== 'pass') {
    return {
      verdict: ex.verdict,
      reason: ex.reason,
      statedCount: ex.statedCount ?? null,
      names: (ex.names ?? []).map((n) => (typeof n === 'string' ? n : n.name)),
      contents: [],
      unresolved: [],
    }
  }
  const bodyText = stripTags(bundle.bodyHtml ?? bundle.pageText ?? '')
  const { contents, unresolved } = matchContents(ex.names, pool, {
    bundleTitle: bundle.title,
    bodyText,
  })
  // KiwiCo's activities field doubles as a kit's step list, so
  // its pack label only becomes evidence once every name has
  // resolved to a real row — then a label that disagrees with
  // the resolved set fails the bundle after all.
  if (!unresolved.length && ex.labelCount != null && ex.labelCount !== ex.names.length) {
    return {
      verdict: 'fail',
      failure_class: 'count-disagreement',
      reason: `count disagreement: pack label ${ex.labelCount} vs ${ex.names.length} resolved contents`,
      statedCount: ex.statedCount ?? null,
      names: ex.names.map((n) => n.name),
      contents,
      unresolved: [],
    }
  }
  if (unresolved.length) {
    return {
      verdict: 'fail',
      failure_class: 'unresolved-contents',
      reason: `${unresolved.length} of ${ex.names.length} extracted contents have no catalog row: ${unresolved.join(' | ')}`,
      statedCount: ex.statedCount ?? null,
      names: ex.names.map((n) => n.name),
      contents,
      unresolved,
    }
  }
  return {
    verdict: 'pass',
    reason: null,
    statedCount: ex.statedCount ?? null,
    names: ex.names.map((n) => n.name),
    contents,
    unresolved: [],
  }
}
