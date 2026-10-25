// specall — the spec runtime caller (docs/CRAWLERS.md §3–§4).
//
// Executes learned endpoint specs (ingestor/specs/*.json) under the
// estate's transport discipline, which used to live, diverged, inside
// backfill-ratings-stores.mjs's crawlHost:
//
//   - one canonical identifying user-agent (invariant 1);
//   - per-host queues: requests to a host are serialized, with
//     >= minIntervalMs between request *starts* (invariant 2);
//   - a per-host strike counter: 403/429 strikes, a success resets
//     it, and at maxStrikes the host is dropped for the run — queued
//     requests behind the drop come back as skipped_stopped
//     (invariant 3, and the estate's existing stats vocabulary).
//
// This module never writes anything. callSpec returns a typed result
// ({ ok, values, stats }); consumers keep their own write paths.

import { readFileSync } from 'node:fs'

export const CANONICAL_UA = 'ToyLibraryIngestor/1.0 (contact via toylibrary.store)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- caller

export function createSpecCaller({ ua = CANONICAL_UA, minIntervalMs = 350, maxStrikes = 3, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init))
  const hosts = new Map()
  const totals = { calls: 0, http_blocked: 0, fetch_failed: 0, skipped_stopped: 0 }

  function stateFor(host) {
    if (!hosts.has(host))
      hosts.set(host, { tail: Promise.resolve(), lastStart: null, strikes: 0, stopped: false })
    return hosts.get(host)
  }

  // Queue one request on its host's chain. Resolves (never rejects) to
  // { ok, status, blocked, failed, skipped, text }:
  //   blocked — 403/429 (a strike was recorded);
  //   failed  — any other non-2xx, or the fetch threw;
  //   skipped — the host was already dropped; nothing was sent.
  function request(url, { method = 'GET', headers = {}, body } = {}) {
    let host
    try {
      host = new URL(url).host
    } catch {
      totals.fetch_failed++
      return Promise.resolve({ ok: false, status: null, blocked: false, failed: true, skipped: false, text: '' })
    }
    const st = stateFor(host)
    const run = async () => {
      if (st.stopped) {
        totals.skipped_stopped++
        return { ok: false, status: null, blocked: false, failed: false, skipped: true, text: '' }
      }
      if (st.lastStart !== null) {
        const wait = minIntervalMs - (Date.now() - st.lastStart)
        if (wait > 0) await sleep(wait)
      }
      st.lastStart = Date.now()
      totals.calls++
      // Header policy (§3): our canonical UA always; accept defaults
      // to JSON. A spec may declare content-type / accept / public-
      // constant headers, never a user-agent of its own.
      const finalHeaders = { 'user-agent': ua, accept: 'application/json' }
      for (const [k, v] of Object.entries(headers)) {
        const key = k.toLowerCase()
        if (key !== 'user-agent') finalHeaders[key] = v
      }
      finalHeaders['user-agent'] = ua
      let res
      try {
        res = await doFetch(url, { method, headers: finalHeaders, body })
      } catch {
        totals.fetch_failed++
        return { ok: false, status: null, blocked: false, failed: true, skipped: false, text: '' }
      }
      const status = typeof res?.status === 'number' ? res.status : res?.ok ? 200 : 0
      let text = ''
      try {
        text = typeof res?.text === 'function' ? await res.text() : (res?.text ?? '')
      } catch {
        text = ''
      }
      if (status === 403 || status === 429) {
        st.strikes++
        if (st.strikes >= maxStrikes) st.stopped = true
        totals.http_blocked++
        return { ok: false, status, blocked: true, failed: false, skipped: false, text }
      }
      if (status >= 200 && status < 300) {
        st.strikes = 0
        return { ok: true, status, blocked: false, failed: false, skipped: false, text }
      }
      totals.fetch_failed++
      return { ok: false, status, blocked: false, failed: true, skipped: false, text }
    }
    // Chain synchronously so concurrent callers queue in call order.
    const p = st.tail.then(run, run)
    st.tail = p.then(
      () => undefined,
      () => undefined,
    )
    return p
  }

  return {
    ua,
    minIntervalMs,
    maxStrikes,
    request,
    // Snapshot of one host's discipline state (strikes / dropped).
    hostState(host) {
      const st = hosts.get(host)
      return st ? { strikes: st.strikes, stopped: st.stopped } : { strikes: 0, stopped: false }
    },
    // Run totals across every request this caller has made.
    totals() {
      return { ...totals }
    },
  }
}

// ---------------------------------------------------------------- loader

const TOP_LEVEL_FIELDS = new Set([
  'spec_version',
  'id',
  'platform',
  'purpose',
  'status',
  'description',
  'steps',
  'fields',
  'write_rule',
  'provenance',
])
const PURPOSES = new Set(['ratings', 'listings', 'detail', 'ages', 'images'])
const STATUSES = new Set(['active', 'suspect', 'retired'])
const TAKES = new Set(['last_path_segment', 'host'])
const WRITE_RULES = new Set(['rating_only_with_count_gt_0'])
const SHAPE_TYPES = new Set(['number', 'string', 'boolean', 'object', 'array', 'null'])

function fail(msg) {
  throw new Error(`specall: loadSpec: ${msg}`)
}

function parseBindFrom(from, specId) {
  if (from === 'const') return { kind: 'const' }
  let m = /^row\.([A-Za-z0-9_]+)$/.exec(from)
  if (m) return { kind: 'row', field: m[1] }
  m = /^step\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/.exec(from)
  if (m) return { kind: 'step', step: m[1], field: m[2] }
  fail(`spec '${specId}': bind.from '${from}' is not row.<field>, const, or step.<name>.<field>`)
}

// Validate a spec (§3 is a contract: unknown top-level fields are
// rejected) and return it. Accepts a parsed object or a JSON file path.
export function loadSpec(pathOrObject) {
  let spec = pathOrObject
  if (typeof pathOrObject === 'string') {
    let raw
    try {
      raw = readFileSync(pathOrObject, 'utf8')
    } catch (err) {
      fail(`cannot read '${pathOrObject}': ${err.message}`)
    }
    try {
      spec = JSON.parse(raw)
    } catch (err) {
      fail(`'${pathOrObject}' is not valid JSON: ${err.message}`)
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('spec must be an object')
  for (const key of Object.keys(spec)) {
    if (!TOP_LEVEL_FIELDS.has(key)) fail(`unknown top-level field '${key}'`)
  }
  if (spec.spec_version !== 1) fail(`spec_version must be 1, got ${JSON.stringify(spec.spec_version)}`)
  for (const field of ['id', 'platform', 'purpose', 'status']) {
    if (typeof spec[field] !== 'string' || !spec[field]) fail(`missing required field '${field}'`)
  }
  if (!PURPOSES.has(spec.purpose)) fail(`spec '${spec.id}': purpose '${spec.purpose}' is not one of ${[...PURPOSES].join(', ')}`)
  if (!STATUSES.has(spec.status)) fail(`spec '${spec.id}': status '${spec.status}' is not one of ${[...STATUSES].join(', ')}`)
  if (spec.description !== undefined && typeof spec.description !== 'string')
    fail(`spec '${spec.id}': description must be a string`)
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) fail(`spec '${spec.id}': steps must be a non-empty array`)

  const stepNames = new Set()
  spec.steps.forEach((step, i) => {
    const where = `spec '${spec.id}' step ${i}`
    if (!step || typeof step !== 'object') fail(`${where}: step must be an object`)
    if (typeof step.name !== 'string' || !step.name) fail(`${where}: missing step name`)
    if (stepNames.has(step.name)) fail(`${where}: duplicate step name '${step.name}'`)
    if (!step.request || typeof step.request !== 'object') fail(`${where} ('${step.name}'): missing request`)
    if (typeof step.request.method !== 'string' || !step.request.method)
      fail(`${where} ('${step.name}'): request.method is required`)
    if (typeof step.request.url !== 'string' || !step.request.url)
      fail(`${where} ('${step.name}'): request.url is required`)
    if (step.request.headers !== undefined) {
      if (!step.request.headers || typeof step.request.headers !== 'object' || Array.isArray(step.request.headers))
        fail(`${where} ('${step.name}'): request.headers must be an object`)
      for (const [k, v] of Object.entries(step.request.headers))
        if (typeof v !== 'string') fail(`${where} ('${step.name}'): request header '${k}' must be a string`)
    }
    if (step.request.body !== undefined && typeof step.request.body !== 'string')
      fail(`${where} ('${step.name}'): request.body must be a string`)
    if (!step.extract || typeof step.extract !== 'object') fail(`${where} ('${step.name}'): missing extract`)
    if (step.extract.format !== 'json')
      fail(`${where} ('${step.name}'): extract.format '${step.extract.format}' is not supported (only 'json')`)
    if (step.extract.path !== undefined && typeof step.extract.path !== 'string')
      fail(`${where} ('${step.name}'): extract.path must be a string`)
    if (!step.extract.pick || typeof step.extract.pick !== 'object' || Array.isArray(step.extract.pick))
      fail(`${where} ('${step.name}'): extract.pick must be an object mapping output names to paths`)
    for (const [k, v] of Object.entries(step.extract.pick))
      if (typeof v !== 'string' || !v) fail(`${where} ('${step.name}'): extract.pick '${k}' must be a non-empty path string`)
    if (step.extract.shape !== undefined) {
      if (!step.extract.shape || typeof step.extract.shape !== 'object' || Array.isArray(step.extract.shape))
        fail(`${where} ('${step.name}'): extract.shape must be an object mapping paths to types`)
      for (const [k, v] of Object.entries(step.extract.shape))
        if (!SHAPE_TYPES.has(v)) fail(`${where} ('${step.name}'): extract.shape '${k}' has unknown type '${v}'`)
    }
    const params = step.params ?? []
    if (!Array.isArray(params)) fail(`${where} ('${step.name}'): params must be an array`)
    for (const param of params) {
      if (!param || typeof param.name !== 'string' || !param.name)
        fail(`${where} ('${step.name}'): every param needs a name`)
      if (!param.bind || typeof param.bind.from !== 'string')
        fail(`${where} ('${step.name}'): param '${param.name}' needs bind.from`)
      const parsed = parseBindFrom(param.bind.from, spec.id)
      if (parsed.kind === 'step' && !stepNames.has(parsed.step))
        fail(
          `${where} ('${step.name}'): param '${param.name}' binds step.${parsed.step}.*, which is not an earlier step`,
        )
      if (param.bind.take !== undefined && !TAKES.has(param.bind.take))
        fail(`${where} ('${step.name}'): param '${param.name}' has unknown take '${param.bind.take}'`)
      if (param.bind.join !== undefined && typeof param.bind.join !== 'string')
        fail(`${where} ('${step.name}'): param '${param.name}' join must be a string`)
    }
    stepNames.add(step.name)
  })

  if (spec.fields !== undefined) {
    if (!spec.fields || typeof spec.fields !== 'object' || Array.isArray(spec.fields))
      fail(`spec '${spec.id}': fields must be an object mapping extracted names to catalog fields`)
    for (const [k, v] of Object.entries(spec.fields))
      if (typeof v !== 'string' || !v) fail(`spec '${spec.id}': fields '${k}' must map to a catalog field name`)
  }
  if (spec.write_rule !== undefined && !WRITE_RULES.has(spec.write_rule))
    fail(`spec '${spec.id}': unknown write_rule '${spec.write_rule}'`)
  if (spec.provenance !== undefined) {
    if (!spec.provenance || typeof spec.provenance !== 'object' || Array.isArray(spec.provenance))
      fail(`spec '${spec.id}': provenance must be an object`)
    if (spec.provenance.verified_samples !== undefined && !Array.isArray(spec.provenance.verified_samples))
      fail(`spec '${spec.id}': provenance.verified_samples must be an array`)
  }
  return spec
}

// ------------------------------------------------------------- extraction

function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

// The §3 pick mini-path language, resolved against a base value:
// plain keys ('starsAverage'), dotted nesting ('numberOfReviews.total'),
// and array projection ('[].sku', 'variants[].sku', '[].a.b'). A '[]'
// segment maps the remaining path over the array, dropping misses.
function pickPath(base, path) {
  const segs = path.split('.')
  function walk(value, i) {
    if (i >= segs.length) return value
    if (value === null || value === undefined) return undefined
    const seg = segs[i]
    if (seg === '[]') {
      if (!Array.isArray(value)) return undefined
      const out = []
      for (const el of value) {
        const v = walk(el, i + 1)
        if (v !== undefined) out.push(v)
      }
      return out
    }
    if (seg.endsWith('[]')) {
      const arr = value[seg.slice(0, -2)]
      if (!Array.isArray(arr)) return undefined
      const out = []
      for (const el of arr) {
        const v = walk(el, i + 1)
        if (v !== undefined) out.push(v)
      }
      return out
    }
    return walk(value[seg], i + 1)
  }
  return walk(base, 0)
}

// extract.path navigation: dotted keys only (§3's examples).
function navigatePath(doc, path) {
  if (!path) return doc
  let cur = doc
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[seg]
  }
  return cur
}

// The §6 drift rule: >= 50% of shape key-paths present with a matching
// type is shape-ok; below that the response counts as shape_drift.
function checkShape(base, shape) {
  const entries = Object.entries(shape)
  if (!entries.length) return { total: 0, matched: 0, ok: true }
  let matched = 0
  for (const [path, expected] of entries) {
    const v = pickPath(base, path)
    if (v !== undefined && typeOf(v) === expected) matched++
  }
  return { total: entries.length, matched, ok: matched / entries.length >= 0.5 }
}

// -------------------------------------------------------------- execution

function emptyStats() {
  return {
    calls: 0,
    filled: 0,
    empty_extract: 0,
    http_blocked: 0,
    fetch_failed: 0,
    shape_drift: 0,
    skipped_stopped: 0,
    honest_zero: 0,
  }
}

function applyTake(value, take) {
  if (value === null || value === undefined) return value
  const s = String(value)
  if (take === 'last_path_segment') {
    const trimmed = s.replace(/\/+$/, '')
    const idx = trimmed.lastIndexOf('/')
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
  }
  if (take === 'host') {
    try {
      return new URL(s).host
    } catch {
      return undefined
    }
  }
  return value
}

// Resolve one param's value. `direct` (verifySpec samples) maps param
// names straight to values and wins over the spec's bindings.
function resolveParam(param, { row, stepOutputs, direct }) {
  if (direct && Object.prototype.hasOwnProperty.call(direct, param.name)) return direct[param.name]
  const bind = param.bind
  const parsed = parseBindFrom(bind.from, '')
  let value
  if (parsed.kind === 'const') {
    value = bind.value
  } else if (parsed.kind === 'row') {
    value = row ? row[parsed.field] : undefined
    value = applyTake(value, bind.take)
  } else {
    value = stepOutputs[parsed.step] ? stepOutputs[parsed.step][parsed.field] : undefined
  }
  if (value === null || value === undefined) return undefined
  if (bind.join !== undefined && Array.isArray(value)) return value.join(bind.join)
  return value
}

function substitute(template, values) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m,
  )
}

// Run a list of steps (the whole chain, or a tail for verifySpec's
// direct-params samples). Returns { outputs, failure } where outputs
// merges each step's pick results in order and failure is null or
// { reason } with the relevant stat already counted in `stats`.
async function runSteps(caller, spec, steps, { row = null, direct = null, stats }) {
  const stepOutputs = {}
  const merged = {}
  for (const step of steps) {
    const values = {}
    let bindingFailed = false
    for (const param of step.params ?? []) {
      const v = resolveParam(param, { row, stepOutputs, direct })
      if (v === undefined) bindingFailed = true
      else values[param.name] = v
    }
    const url = substitute(step.request.url, values)
    const body = step.request.body !== undefined ? substitute(step.request.body, values) : undefined
    const headers = {}
    for (const [k, v] of Object.entries(step.request.headers ?? {})) headers[k] = substitute(v, values)
    // Leftover-placeholder check: a real placeholder is exactly
    // '{name}' — JSON bodies are full of braces that are not.
    const leftover = /\{[A-Za-z0-9_]+\}/
    if (bindingFailed || leftover.test(url) || (body !== undefined && leftover.test(body))) {
      // A binding produced nothing (missing row field, unparseable
      // take) or a placeholder has no param: there is no request to
      // make. Counted as an empty extraction, like the estate's
      // no-url rows.
      stats.empty_extract++
      return { outputs: merged, failure: { reason: 'binding', step: step.name } }
    }
    const res = await caller.request(url, { method: step.request.method, headers, body })
    if (res.skipped) {
      stats.skipped_stopped++
      return { outputs: merged, failure: { reason: 'skipped_stopped', step: step.name } }
    }
    stats.calls++
    if (res.blocked) {
      stats.http_blocked++
      return { outputs: merged, failure: { reason: 'http_blocked', step: step.name } }
    }
    if (!res.ok) {
      stats.fetch_failed++
      return { outputs: merged, failure: { reason: 'fetch_failed', step: step.name } }
    }
    let doc
    try {
      doc = JSON.parse(res.text)
    } catch {
      // A 2xx whose body is not JSON cannot match the taught shape.
      stats.shape_drift++
      return { outputs: merged, failure: { reason: 'shape_drift', step: step.name } }
    }
    const base = navigatePath(doc, step.extract.path)
    if (step.extract.shape) {
      const shape = checkShape(base, step.extract.shape)
      // Drift is a stat, not a stop: the extraction below still
      // returns whatever it found (§4/§6).
      if (!shape.ok) stats.shape_drift++
    }
    const outputs = {}
    for (const [outName, path] of Object.entries(step.extract.pick)) {
      const v = pickPath(base, path)
      if (v !== undefined) outputs[outName] = v
    }
    stepOutputs[step.name] = outputs
    Object.assign(merged, outputs)
  }
  return { outputs: merged, failure: null }
}

// Apply fields mapping + the write rule to merged step outputs.
function finalize(spec, outputs, stats) {
  let values = {}
  if (spec.fields) {
    for (const [extracted, catalogField] of Object.entries(spec.fields)) {
      if (outputs[extracted] !== undefined) values[catalogField] = outputs[extracted]
    }
  } else {
    values = { ...outputs }
  }
  if (spec.write_rule === 'rating_only_with_count_gt_0' && ('rating' in values || 'rating_count' in values)) {
    // Invariant 4: a rating is written only with a review count
    // behind it. A product with no reviews is an honest zero — the
    // row stays unrated, so the result carries no values at all.
    const count = values.rating_count
    if (count === undefined || count === null || !(Number(count) > 0)) {
      stats.honest_zero++
      return { ok: false, values: {} }
    }
  }
  if (Object.keys(values).length === 0) {
    stats.empty_extract++
    return { ok: false, values: {} }
  }
  stats.filled++
  return { ok: true, values }
}

// Run one catalog row through a spec's step chain.
// Returns { ok, values, stats } — values are catalog fields (after
// the spec's fields mapping and write rule). Never writes anything.
export async function callSpec(caller, specInput, row) {
  const spec = loadSpec(specInput)
  const stats = emptyStats()
  const { outputs, failure } = await runSteps(caller, spec, spec.steps, { row, stats })
  if (failure) return { ok: false, values: {}, stats }
  const { ok, values } = finalize(spec, outputs, stats)
  return { ok, values, stats }
}

// Replay provenance.verified_samples against the live endpoints.
// Sample shapes (see ingestor/specs/yoto-trustpilot-rating.json):
//   { name, params: { <final-step param>: value, ... }, expect }
//     — runs the final step alone with direct param values;
//   { name, row: { source_url, ... }, expect }
//     — runs the full step chain via callSpec.
// expect is { rating, rating_count }: rating must match exactly,
// rating_count must be >= expect (counts only grow). An expect of
// { rating: 0, rating_count: 0 } means the sample must come back as
// an honest zero under the spec's write rule.
// Returns { ok, samples: [{ name, pass, observed, expect, note? }], stats }.
export async function verifySpec(caller, specInput) {
  const spec = loadSpec(specInput)
  const samples = spec.provenance?.verified_samples ?? []
  const totals = emptyStats()
  const results = []
  for (const sample of samples) {
    const name = sample.name ?? sample.input ?? '(unnamed sample)'
    const expect = sample.expect ?? {}
    let result
    if (sample.row) {
      result = await callSpec(caller, spec, sample.row)
    } else if (sample.params) {
      const stats = emptyStats()
      const lastStep = spec.steps[spec.steps.length - 1]
      const { outputs, failure } = await runSteps(caller, spec, [lastStep], { direct: sample.params, stats })
      if (failure) {
        result = { ok: false, values: {}, stats }
      } else {
        const fin = finalize(spec, outputs, stats)
        result = { ok: fin.ok, values: fin.values, stats }
      }
    } else {
      results.push({ name, pass: false, observed: null, expect, note: 'sample has neither params nor row' })
      continue
    }
    for (const k of Object.keys(totals)) totals[k] += result.stats[k] ?? 0
    const honestZero = (result.stats.honest_zero ?? 0) > 0
    const observed = honestZero
      ? { rating: 0, rating_count: 0, honest_zero: true }
      : result.values.rating !== undefined || result.values.rating_count !== undefined
        ? { rating: result.values.rating, rating_count: result.values.rating_count }
        : null
    let pass = false
    let note
    if (expect.rating === 0 && expect.rating_count === 0) {
      pass = honestZero
      if (!pass) note = 'expected an honest zero (row stays unrated)'
    } else if (!result.ok || !observed) {
      note = 'spec returned no values'
    } else if (result.stats.shape_drift > 0) {
      note = 'response shape drifted from extract.shape'
    } else if (Number(observed.rating) !== Number(expect.rating)) {
      note = `rating ${observed.rating} !== expected ${expect.rating}`
    } else if (!(Number(observed.rating_count) >= Number(expect.rating_count))) {
      note = `rating_count ${observed.rating_count} < expected ${expect.rating_count} (counts only grow)`
    } else {
      pass = true
    }
    results.push({ name, pass, observed, expect, ...(note ? { note } : {}) })
  }
  return { ok: results.every((r) => r.pass), samples: results, stats: totals }
}
