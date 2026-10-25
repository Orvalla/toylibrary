// yoto-spec — the Yoto/Trustpilot spec runner, extracted from
// backfill-ratings-stores.mjs (docs/CRAWLERS.md Phase 3).
//
// Runs each row through ingestor/specs/yoto-trustpilot-rating.json
// via specall: per-variant SKUs from the Storefront GraphQL, then
// the Trustpilot aggregate. Resolution is always against the US
// store by handle (the last path segment of the row's URL, whatever
// host the URL names): SKUs are global product identifiers, so a
// UK-listed row resolves through the US storefront when the handle
// exists there. GraphQL product:null (retired / not published to
// the Storefront channel) falls back to the same store's
// /products/<handle>.js — identical per-variant SKU data. A double
// miss leaves the row unresolved and unrated, counted.
//
// This module never writes anything. It returns per-row outcomes
// plus summed totals; the consumer keeps its own accounting and
// write path — rated rows are reported through onRating as they
// complete so the consumer can buffer + flush exactly as before.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callSpec, createSpecCaller, loadSpec } from './specall.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC_PATH = join(HERE, '..', 'specs', 'yoto-trustpilot-rating.json')

function emptyTotals() {
  return {
    rows: 0,
    resolved: 0,
    rated: 0,
    honest_zero: 0,
    unresolved: 0,
    usedFallback: 0,
    calls: 0,
    http_blocked: 0,
    fetch_failed: 0,
    skipped_stopped: 0,
    shape_drift: 0,
  }
}

// items: [{ id, url }]. caller: a specall caller (one is created
// here when not passed). onRating({ id, rating, rating_count }) is
// invoked (and awaited) for each 'rated' row.
//
// Returns { rows, totals, error }:
//   rows: [{ id, outcome: 'rated' | 'honest_zero' | 'unresolved',
//            rating?, rating_count?, ok, calls, http_blocked,
//            fetch_failed, skipped_stopped, shape_drift,
//            usedFallback }]
//     — `ok` is the underlying spec result's ok flag for the row
//       (after any fallback), preserved because consumers key
//       their stopped-host accounting on it: an 'unresolved' row
//       can still carry ok=true (spec ran, no usable rating).
//   totals: the per-row numbers summed, plus outcome counts
//     (resolved = rated + honest_zero; rows = items.length).
//   error: the loadSpec error when the spec failed to load (rows
//     is empty in that case), otherwise null.
export async function rateYotoRows({ items, caller, onRating }) {
  const totals = emptyTotals()
  totals.rows = items.length
  let spec
  try {
    spec = loadSpec(SPEC_PATH)
  } catch (err) {
    return { rows: [], totals, error: err }
  }
  const effectiveCaller = caller ?? createSpecCaller({})
  const ratingStep = spec.steps.find((st) => st.name === 'rating')
  const jsResolveSpec = {
    spec_version: 1, id: 'yoto-shopify-js-resolve', platform: 'yoto',
    purpose: 'detail', status: 'active',
    steps: [{
      name: 'resolve-skus-js',
      request: {
        method: 'GET',
        url: 'https://yoto-usa.myshopify.com/products/{handle}.js',
        headers: {},
      },
      params: [{ name: 'handle', bind: { from: 'row.source_url', take: 'last_path_segment' } }],
      extract: { format: 'json', path: 'variants', pick: { skus: '[].sku' } },
    }],
    fields: { skus: 'skus' },
  }
  const ratingOnlySpec = (csv) => ({
    spec_version: 1, id: 'yoto-trustpilot-rating#step', platform: 'yoto',
    purpose: 'ratings', status: 'active',
    steps: [{
      ...ratingStep,
      params: [{ name: 'skus', bind: { from: 'const', value: csv } }],
    }],
    fields: spec.fields,
    write_rule: spec.write_rule,
  })

  const rows = await Promise.all(
    items.map(async (item) => {
      const row = { source_url: item.url }
      let res = await callSpec(effectiveCaller, spec, row)
      let st = res.stats
      let usedFallback = false
      if (!res.ok && st.empty_extract > 0 && !st.http_blocked && !st.fetch_failed && !st.skipped_stopped) {
        // GraphQL could not see the product — try the .js shape
        // of the same store before calling the row unresolved.
        const js = await callSpec(effectiveCaller, jsResolveSpec, row)
        const skus = (js.values?.skus ?? []).filter((x) => typeof x === 'string' && x.trim())
        if (!js.ok || !skus.length) {
          // The fallback also missed — keep its transport
          // failures visible in the row's accounting.
          st = {
            ...st,
            calls: st.calls + js.stats.calls,
            http_blocked: st.http_blocked + js.stats.http_blocked,
            fetch_failed: st.fetch_failed + js.stats.fetch_failed,
            skipped_stopped: st.skipped_stopped + js.stats.skipped_stopped,
          }
        }
        if (js.ok && skus.length) {
          usedFallback = true
          res = await callSpec(effectiveCaller, ratingOnlySpec(skus.join(',')), {})
          st = {
            ...res.stats,
            calls: st.calls + js.stats.calls + res.stats.calls,
            http_blocked: st.http_blocked + js.stats.http_blocked + res.stats.http_blocked,
            fetch_failed: st.fetch_failed + js.stats.fetch_failed + res.stats.fetch_failed,
            skipped_stopped: st.skipped_stopped + js.stats.skipped_stopped + res.stats.skipped_stopped,
            shape_drift: st.shape_drift + js.stats.shape_drift + res.stats.shape_drift,
            honest_zero: res.stats.honest_zero,
          }
        }
      }
      let outcome
      let rated = null
      if (res.ok && res.values?.rating != null && res.values?.rating_count > 0) {
        outcome = 'rated'
        rated = { id: item.id, rating: res.values.rating, rating_count: res.values.rating_count }
        if (onRating) await onRating(rated)
      } else if (st.honest_zero) {
        outcome = 'honest_zero'
      } else {
        outcome = 'unresolved'
      }
      return {
        id: item.id,
        outcome,
        ...(rated ? { rating: rated.rating, rating_count: rated.rating_count } : {}),
        ok: res.ok,
        calls: st.calls,
        http_blocked: st.http_blocked,
        fetch_failed: st.fetch_failed,
        skipped_stopped: st.skipped_stopped,
        shape_drift: st.shape_drift,
        usedFallback,
      }
    }),
  )

  for (const r of rows) {
    totals.calls += r.calls
    totals.http_blocked += r.http_blocked
    totals.fetch_failed += r.fetch_failed
    totals.skipped_stopped += r.skipped_stopped
    totals.shape_drift += r.shape_drift
    if (r.usedFallback) totals.usedFallback++
    if (r.outcome === 'rated') {
      totals.rated++
      totals.resolved++
    } else if (r.outcome === 'honest_zero') {
      totals.honest_zero++
      totals.resolved++
    } else {
      totals.unresolved++
    }
  }
  return { rows, totals, error: null }
}
