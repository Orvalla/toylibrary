// convert.mjs — map an api-anything learned site JSON into a Toy Library
// endpoint spec (docs/CRAWLERS.md §3), and classify spec diffs for the
// reteach contract freeze (§5/§6).
//
// The conversion is deliberately strict — a spec is a contract, and
// specall's loader (ingestor/lib/specall.mjs) rejects anything outside
// it. Where the learned data cannot be represented honestly, this
// module fails with a message that says what the teacher must supply
// instead of guessing:
//
//   - captured browser headers are DROPPED. Only `content-type` and
//     headers named in the learned op's `public[]` (or the driver's
//     extra public list) survive — §3 header policy. (specall sends
//     the canonical ingestor UA itself at call time.)
//   - every slot/param needs a binding. Bindings are OUR knowledge
//     (where a value comes from in a crawl), supplied by the teach
//     driver as hints. An unbound param defaults to { from: 'const' }
//     ONLY when it is a declared public constant whose literal value
//     can be recovered from the learned request; otherwise conversion
//     fails and names the param.
//   - a slot backed by a cookie/session reference can never become a
//     spec (§3/§9: no secrets in specs, no source that needs one).
//   - only JSON recipes convert. specall executes extract.format
//     'json' only, so an html/embedded learned op fails here loudly
//     rather than landing a spec no consumer can run.
//
// Pure core (`convertLearnedSite`, `diffSpecs`, `buildVerifiedSample`)
// plus a thin CLI wrapper for the teach driver:
//
//   node ingestor/teach/convert.mjs --learned <site.json> \
//        [--hints <hints.json>] [--out <spec.json>] [--site s] [--op o]
//
// hints (all optional unless noted): {
//   site, op, specId, platform, purpose, description, status,
//   fields:            { <extracted name>: <catalog field>, ... },
//   writeRule,         // only 'rating_only_with_count_gt_0' exists (§3)
//   bindings:          { <param>: "<from>" | { from, take?, join?, value? } },
//   public:            [ <extra public-constant names> ],
//   extractPath,       // override the learned response.extract
//   pick,              // override the learned pick: { out: path } object,
//                      // or the tool's array form ([ "a.b", "x=a.b" ])
//   taughtAt,          // 'YYYY-MM-DD' (defaults to the op's learnedAt date)
//   taughtFrom,        // trigger URL the op was taught from
//   toolVersion, toolCommit,
//   teachRun,          // URL of the teach workflow run
//   captures,          // api-anything capture ids used while teaching
//   verifiedSamples,   // provenance samples (see buildVerifiedSample)
// }

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TOOL_NAME = 'api-anything'
export const TOOL_VERSION = '0.1.0'
export const TOOL_COMMIT = '441e50905acea35f407127c2b8a4032e969288f7'

const PURPOSES = new Set(['ratings', 'listings', 'detail', 'ages', 'images'])
const WRITE_RULES = new Set(['rating_only_with_count_gt_0'])
const SHAPE_TYPES = new Set(['number', 'string', 'boolean', 'object', 'array', 'null'])
// Mirror of specall's bind grammar (ingestor/lib/specall.mjs parseBindFrom
// + TAKES): keep the two in step — a spec convert emits must load.
const BIND_FROM_RE = /^(const|row\.[A-Za-z0-9_]+|step\.[A-Za-z0-9_-]+\.[A-Za-z0-9_]+)$/
const TAKES = new Set(['last_path_segment', 'host'])

function fail(msg) {
  throw new Error(`convert: ${msg}`)
}

/** 'productRating' / 'product_rating' / 'product-rating' → 'product-rating'. */
export function slugify(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Comparison key so 'product-rating' and 'productRating' name the same op. */
const opKey = (name) => slugify(name)

function findOperation(learned, hints) {
  const ops = learned?.operations
  if (!Array.isArray(ops) || ops.length === 0) fail('learned site JSON has no operations')
  if (!hints.op) {
    if (ops.length === 1) return ops[0]
    fail(`learned site has ${ops.length} operations; pass op to choose one of: ${ops.map((o) => o.name).join(', ')}`)
  }
  const want = opKey(hints.op)
  const op = ops.find((o) => opKey(o.name) === want)
  if (!op) fail(`learned site has no operation '${hints.op}' (has: ${ops.map((o) => o.name).join(', ')})`)
  return op
}

// ------------------------------------------------------------ headers

// §3 header policy: specs do not carry captured browser headers.
// content-type survives; a header whose (lower-cased) name is declared
// public — the learned op's public[] or the driver's extra list —
// survives with its captured literal value, because by definition it
// is the same for every visitor (a published widget key, the site's
// own shared bearer). Everything else (user-agent, sec-*, cookie,
// authorization, referer, …) is dropped.
function filterHeaders(op, extraPublic = []) {
  const raw = op.request?.headers ?? {}
  const publicNames = new Set(
    [...(op.public ?? []), ...extraPublic].map((n) => String(n).toLowerCase()),
  )
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase()
    if (key === 'content-type' || publicNames.has(key)) {
      if (typeof v === 'string' && v.includes('<redacted>'))
        fail(
          `header '${key}' survived the header policy but its learned value is <redacted>; ` +
            'declare the real public value at teach time (--public) or drop the header',
        )
      out[key] = v
    }
  }
  return out
}

// ------------------------------------------------------- const values

// Recover a param's literal value from the learned request template:
// a query parameter, a header, or a key in a JSON / form body. Returns
// undefined when the value is a {placeholder} (i.e. it varies — not a
// constant at all) or is not present.
function literalFromRequest(op, paramName) {
  const req = op.request ?? {}
  const name = paramName.toLowerCase()
  const usable = (v) => (typeof v === 'string' && v !== '' && !v.includes('{') && !v.includes('<redacted>') ? v : undefined)
  try {
    const q = new URL(req.url).searchParams.get(paramName)
    const hit = usable(q)
    if (hit !== undefined) return hit
  } catch {
    /* url not parseable — fall through to the other locations */
  }
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (k.toLowerCase() === name) {
      const hit = usable(v)
      if (hit !== undefined) return hit
    }
  }
  if (typeof req.body === 'string') {
    try {
      const stack = [JSON.parse(req.body)]
      while (stack.length) {
        const cur = stack.pop()
        if (cur && typeof cur === 'object') {
          for (const [k, v] of Object.entries(cur)) {
            if (k.toLowerCase() === name) {
              if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                const hit = usable(String(v))
                if (hit !== undefined) return hit
              }
            } else if (v && typeof v === 'object') stack.push(v)
          }
        }
      }
    } catch {
      const form = new URLSearchParams(req.body)
      const hit = usable(form.get(paramName))
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

// ------------------------------------------------------------- params

function normalizeBinding(paramName, hint) {
  const bind = typeof hint === 'string' ? { from: hint } : { ...(hint ?? {}) }
  if (typeof bind.from !== 'string' || !BIND_FROM_RE.test(bind.from))
    fail(
      `binding for param '${paramName}' has from '${bind.from}', which is not 'const', ` +
        `'row.<field>', or 'step.<name>.<field>' (the §3 binding grammar)`,
    )
  if (bind.take !== undefined && !TAKES.has(bind.take))
    fail(`binding for param '${paramName}' has unknown take '${bind.take}' (allowed: ${[...TAKES].join(', ')})`)
  if (bind.join !== undefined && typeof bind.join !== 'string')
    fail(`binding for param '${paramName}': join must be a string`)
  return bind
}

function resolveParams(op, hints) {
  const bindings = hints.bindings ?? {}
  const publicNames = new Set([...(op.public ?? []), ...(hints.public ?? [])].map((n) => String(n).toLowerCase()))
  const descriptors = new Map((op.params ?? []).map((p) => [p.name, p]))
  const names = []
  for (const slot of op.slots ?? []) {
    if (slot.ref)
      fail(
        `slot at ${(slot.at ?? []).join(' / ')} is backed by '${slot.ref}' — a cookie/session ` +
          'reference can never become a spec (§3: secrets never appear in a spec)',
      )
    if (slot.param && !names.includes(slot.param)) names.push(slot.param)
  }
  // Params the tool lists but no slot carries: e.g. a public constant
  // that stayed literal in the request (a Trustpilot businessUnitId).
  for (const p of op.params ?? []) if (!names.includes(p.name)) names.push(p.name)

  return names.map((name) => {
    const hint = bindings[name] ?? bindings[name.toLowerCase()]
    if (hint !== undefined) {
      const bind = normalizeBinding(name, hint)
      if (bind.from === 'const' && bind.value === undefined) {
        const literal = literalFromRequest(op, name) ?? descriptors.get(name)?.example
        if (literal === undefined || String(literal).includes('<redacted>'))
          fail(
            `binding for param '${name}' is { from: 'const' } but no literal value is known: ` +
              'supply value in the binding hint',
          )
        bind.value = literal
      }
      return { name, bind }
    }
    if (publicNames.has(name.toLowerCase())) {
      const literal = literalFromRequest(op, name) ?? descriptors.get(name)?.example
      if (literal === undefined || String(literal).includes('<redacted>'))
        fail(
          `param '${name}' is declared public but its constant value could not be recovered ` +
            'from the learned request; supply it via bindings: { "' + name + '": { "from": "const", "value": … } }',
        )
      return { name, bind: { from: 'const', value: literal } }
    }
    fail(
      `unbound param '${name}': no binding hint, and it is not a declared public constant. ` +
        `Bindings are our knowledge, not the tool's — pass bindings: { "${name}": { "from": "row.<field>" } } ` +
        '(or step.<name>.<field>, or const with a value) via the teach workflow',
    )
  })
}

// ------------------------------------------------------------ extract

// One tool pick entry: 'a.b.c', 'name=a.b.c', 'name=a.b~regex',
// '[].sku', 'variants[].sku'. Returns [outputName, path].
function parsePickEntry(entry) {
  const eq = entry.indexOf('=')
  const alias = eq > 0 ? entry.slice(0, eq) : null
  const path = eq > 0 ? entry.slice(eq + 1) : entry
  if (alias) return [alias, path]
  const leaf = path.replace(/\[\]/g, '').split('.').filter(Boolean).pop()
  return [leaf || path, path]
}

function pickObjectFromArray(entries) {
  const out = {}
  const used = new Map()
  for (const entry of entries ?? []) {
    const [name, path] = parsePickEntry(String(entry))
    let key = name
    if (used.has(key) && used.get(key) !== path) {
      // Two paths share a leaf name: disambiguate with the full path.
      key = path.replace(/\[\]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    }
    used.set(key, path)
    out[key] = path
  }
  return out
}

// Learned shape keys are rooted at the response document; §3 shape
// keys are relative to extract.path ('productReviewsSummary' →
// 'starsAverage', 'numberOfReviews.total'). '[]' segments are kept:
// pickPath in specall resolves them the same way.
function relativizeShapeKey(key, extractPath) {
  if (!extractPath) return key
  if (key === extractPath) return '$root'
  if (key.startsWith(`${extractPath}.`)) return key.slice(extractPath.length + 1)
  if (key.startsWith(`${extractPath}[]`)) return `[]${key.slice(extractPath.length + 2)}`
  return key
}

function buildExtract(op, hints, warnings) {
  const response = op.response ?? {}
  const format = response.format ?? 'json'
  if (format !== 'json')
    fail(
      `learned op '${op.name}' has response format '${format}', which specall cannot execute ` +
        "(it runs extract.format 'json' only). Teach a JSON request for this data, or extend " +
        'specall before this recipe can become a spec — no spec was written',
    )
  const extractPath = hints.extractPath ?? response.extract
  const pick =
    hints.pick && !Array.isArray(hints.pick) ? { ...hints.pick } : pickObjectFromArray(hints.pick ?? response.pick)
  if (Object.keys(pick).length === 0)
    fail(
      `learned op '${op.name}' has no pick recipe: a spec step needs extract.pick naming the ` +
        'fields to keep (pass --pick at teach time)',
    )
  const extract = { format: 'json' }
  if (extractPath) extract.path = extractPath
  extract.pick = pick
  if (response.shape) {
    // §3: shape is the drift fingerprint for the picked fields.
    const pickPaths = new Set(Object.values(pick).map((p) => String(p).split('~')[0]))
    const shape = {}
    for (const [k, t] of Object.entries(response.shape)) {
      const rel = relativizeShapeKey(k, extractPath)
      if (!pickPaths.has(rel)) continue
      if (!SHAPE_TYPES.has(t)) {
        warnings.push(`shape entry '${rel}' has unknown type '${t}' and was dropped`)
        continue
      }
      shape[rel] = t
    }
    if (Object.keys(shape).length) extract.shape = shape
  }
  return extract
}

// -------------------------------------------------------------- core

export function convertLearnedSite(learned, hints = {}) {
  const warnings = []
  if (!learned || typeof learned !== 'object') fail('learned site JSON must be an object')
  const op = findOperation(learned, hints)
  const site = hints.site ?? learned.name
  if (!site) fail('no site name: pass hints.site (the learned site JSON has no name)')
  const opName = hints.op ?? op.name
  const id = hints.specId ?? `${slugify(site)}-${slugify(opName)}`
  const purpose = hints.purpose ?? 'ratings'
  if (!PURPOSES.has(purpose)) fail(`purpose '${purpose}' is not one of ${[...PURPOSES].join(', ')}`)

  const req = op.request ?? {}
  if (!req.method || !req.url) fail(`learned op '${op.name}' has no request method/url`)
  if (String(req.url).includes('<redacted>'))
    fail(
      "learned request URL contains a <redacted> value; a spec built from it could never run. " +
        'If the value is a public constant, declare it with --public at teach time so it is kept literal',
    )
  const headers = filterHeaders(op, hints.public ?? [])
  const request = { method: String(req.method).toUpperCase(), url: req.url, headers }
  if (req.body !== undefined) request.body = req.body

  const extract = buildExtract(op, hints, warnings)
  const params = resolveParams(op, hints)
  const step = { name: slugify(op.name) || 'call', request, params, extract }

  if (Array.isArray(op.volatile) && op.volatile.length)
    warnings.push(
      `learned request carries ${op.volatile.length} volatile (nonce-shaped) field(s); specall cannot ` +
        'regenerate them — review the spec before merging',
    )
  if (op.learnedLoggedIn) warnings.push('op was learned while logged in; confirm the request needs no session')

  const pickNames = Object.keys(extract.pick)
  let fields = hints.fields
  if (fields === undefined) fields = Object.fromEntries(pickNames.map((n) => [n, n]))
  if (!fields || typeof fields !== 'object' || Array.isArray(fields))
    fail('fields hint must be an object mapping extracted names to catalog fields')

  let writeRule = hints.writeRule
  if (writeRule === undefined) {
    // Invariant 4 (§0): when the recipe maps a rating and its review
    // count, the estate's one write rule applies by default.
    const names = new Set([...pickNames, ...Object.values(fields)])
    const hasRating = [...names].some((n) => /rating|stars/i.test(n))
    const hasCount = [...names].some((n) => /rating_count|review.*count|count/i.test(n))
    if (hasRating && hasCount) writeRule = 'rating_only_with_count_gt_0'
  }
  if (writeRule !== undefined && !WRITE_RULES.has(writeRule))
    fail(`write_rule '${writeRule}' is not a known write rule (${[...WRITE_RULES].join(', ')})`)

  const provenance = {
    taught_at: hints.taughtAt ?? (op.learnedAt ? String(op.learnedAt).slice(0, 10) : undefined) ?? new Date().toISOString().slice(0, 10),
    taught_from: hints.taughtFrom ?? op.trigger?.url ?? hints.triggerUrl,
    tool: { name: TOOL_NAME, version: hints.toolVersion ?? TOOL_VERSION, commit: hints.toolCommit ?? TOOL_COMMIT },
  }
  if (hints.teachRun) provenance.teach_run = hints.teachRun
  if (Array.isArray(hints.captures) && hints.captures.length) provenance.captures = hints.captures
  provenance.verified_samples = hints.verifiedSamples ?? []

  const spec = {
    spec_version: 1,
    id,
    platform: hints.platform ?? site,
    purpose,
    status: hints.status ?? 'active',
    description: hints.description ?? op.description ?? learned.description ?? `${site} ${opName} (taught by ${TOOL_NAME})`,
    steps: [step],
    fields,
  }
  if (writeRule !== undefined) spec.write_rule = writeRule
  spec.provenance = provenance
  return { spec, warnings }
}

// -------------------------------------------------- verified samples

function walkValues(node, visit, depth = 0) {
  if (node === null || node === undefined || depth > 6) return
  if (Array.isArray(node)) {
    for (const el of node.slice(0, 5)) walkValues(el, visit, depth + 1)
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      visit(k, v)
      walkValues(v, visit, depth + 1)
    }
  }
}

const RATING_KEYS = new Set(['starsaverage', 'rating', 'averagerating', 'average_rating', 'stars'])
const COUNT_KEYS = new Set(['total', 'rating_count', 'ratingcount', 'numberofreviews', 'reviewcount', 'reviews', 'count'])

/**
 * Build one provenance.verified_samples entry from a fresh-input call
 * (the tool's own verification contract: the input was NOT an example).
 *
 * When the call's data carries a rating + review count, expect is the
 * specall sample shape { rating, rating_count } with the observed
 * values (docs §3 / specall verifySpec). Otherwise expect carries an
 * `observed_summary` string — a truthful summary of the raw response,
 * not a replayable rating expectation.
 *
 * `params` is the parsed verify input ({ k: v }); `input` keeps the
 * raw 'k=v …' string the driver was given.
 */
export function buildVerifiedSample({ input = '', params = {}, data, at } = {}) {
  let rating
  let count
  walkValues(data, (k, v) => {
    const key = k.toLowerCase()
    if (rating === undefined && RATING_KEYS.has(key) && (typeof v === 'number' || typeof v === 'string')) rating = v
    if (count === undefined && COUNT_KEYS.has(key) && (typeof v === 'number' || typeof v === 'string')) count = v
  })
  const sample = { name: `fresh-input verification (${input || 'verify input'})`, params, at: at ?? new Date().toISOString().slice(0, 10) }
  if (input) sample.input = input
  if (rating !== undefined) {
    sample.expect = { rating: typeof rating === 'string' && rating.trim() !== '' && !Number.isNaN(Number(rating)) ? Number(rating) : rating }
    if (count !== undefined) sample.expect.rating_count = Number(count)
  } else {
    let summary
    try {
      summary = JSON.stringify(data) ?? String(data)
    } catch {
      summary = String(data)
    }
    sample.expect = { observed_summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary }
  }
  return sample
}

// ------------------------------------------------------ diff (§5/§6)

// The reteach contract freeze: everything that defines WHAT a spec
// means — params, bindings, extract, fields, write_rule, and the
// spec's identity (id/platform/purpose/spec_version) — is contract.
// A step's request (method/url/headers/body) is the wire template:
// the only thing a reteach may change. Provenance, description and
// status are metadata: they change on every reteach and classify as
// neither. Unknown fields fail safe (contract).
export function diffSpecs(oldSpec, newSpec) {
  const contractChanges = []
  const wireChanges = []
  const metadataChanges = []
  const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
  const cmp = (list, path, a, b) => {
    if (!eq(a, b)) list.push({ path, from: a, to: b })
  }

  for (const key of ['spec_version', 'id', 'platform', 'purpose', 'fields', 'write_rule'])
    cmp(contractChanges, key, oldSpec?.[key], newSpec?.[key])
  for (const key of ['description', 'status']) cmp(metadataChanges, key, oldSpec?.[key], newSpec?.[key])
  cmp(metadataChanges, 'provenance', oldSpec?.provenance, newSpec?.provenance)

  const oldSteps = oldSpec?.steps ?? []
  const newSteps = newSpec?.steps ?? []
  if (oldSteps.length !== newSteps.length)
    contractChanges.push({ path: 'steps.length', from: oldSteps.length, to: newSteps.length })
  for (let i = 0; i < Math.max(oldSteps.length, newSteps.length); i++) {
    const o = oldSteps[i]
    const n = newSteps[i]
    if (!o || !n) continue
    cmp(contractChanges, `steps[${i}].name`, o.name, n.name)
    cmp(contractChanges, `steps[${i}].params`, o.params, n.params)
    cmp(contractChanges, `steps[${i}].extract`, o.extract, n.extract)
    const reqKeys = new Set([...Object.keys(o.request ?? {}), ...Object.keys(n.request ?? {})])
    for (const key of reqKeys) cmp(wireChanges, `steps[${i}].request.${key}`, o.request?.[key], n.request?.[key])
    const stepKeys = new Set([...Object.keys(o), ...Object.keys(n)])
    for (const key of stepKeys) {
      if (['name', 'params', 'extract', 'request'].includes(key)) continue
      cmp(contractChanges, `steps[${i}].${key}`, o[key], n[key])
    }
  }
  const allKeys = new Set([...Object.keys(oldSpec ?? {}), ...Object.keys(newSpec ?? {})])
  for (const key of allKeys) {
    if (
      ['spec_version', 'id', 'platform', 'purpose', 'fields', 'write_rule', 'description', 'status', 'provenance', 'steps'].includes(key)
    )
      continue
    cmp(contractChanges, key, oldSpec?.[key], newSpec?.[key])
  }
  return { wireOnly: contractChanges.length === 0, contractChanges, wireChanges, metadataChanges }
}

/** Alias matching the §6 vocabulary. */
export const classifySpecDiff = diffSpecs

export function isWireOnlyDiff(oldSpec, newSpec) {
  return diffSpecs(oldSpec, newSpec).wireOnly
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  return v
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--stdout') out.stdout = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else fail(`unexpected argument '${a}'`)
  }
  return out
}

function main(argv) {
  const args = parseArgs(argv)
  if (!args.learned) fail('usage: convert.mjs --learned <site.json> [--hints <hints.json>] [--out <spec.json>]')
  const learned = JSON.parse(readFileSync(args.learned, 'utf8'))
  const hints = args.hints ? JSON.parse(readFileSync(args.hints, 'utf8')) : {}
  if (args.site) hints.site = args.site
  if (args.op) hints.op = args.op
  const { spec, warnings } = convertLearnedSite(learned, hints)
  const text = `${JSON.stringify(spec, null, 2)}\n`
  if (args.out) writeFileSync(args.out, text)
  if (args.stdout || !args.out) process.stdout.write(text)
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }
}
