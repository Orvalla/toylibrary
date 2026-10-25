// run.mjs — the teach driver for .github/workflows/teach.yml
// (docs/CRAWLERS.md §5). Parameterized entirely by TEACH_* env vars,
// which the workflow fills from its dispatch inputs.
//
// Why a Node driver and not a run.sh like the pilot's: the pilot's bash
// driver needed an embedded python heredoc just to pick a request id
// out of capture JSON, and this driver additionally has to parse tool
// JSON, build conversion hints, classify a spec diff (§6 freeze), and
// compose a markdown teach report / PR body. The repo is ESM Node
// throughout the ingestor, convert.mjs is importable in-process, and
// node is guaranteed present in the workflow before this runs — bash
// would shell out to node/python for most steps anyway.
//
// Modes:
//   outline — capture --outline against the trigger URL; artifact the
//             ranked candidates + response summaries for a human/agent
//             to read before choosing a request + recipe (§7 intake).
//   teach   — capture once per example → add the operation from the
//             captures (the pilot's proven shape: --from/--from2 with
//             an explicit --pick-request chosen by the match pin) →
//             call with a FRESH input (TEACH_VERIFY, required, never
//             an example) → convert.mjs → spec PR on branch
//             spec/<site>-<op>. A failed verification fails the run:
//             no PR for an unverified spec.
//   reteach — teach seeded from the existing spec's provenance
//             (trigger, bindings, recipe, fields, write_rule), for
//             healing (§6). After conversion the new spec is diffed
//             against the old: any contract change (params, bindings,
//             extract, fields, write_rule) fails the run with no PR.
//             Wire-only + verification passed → PR with auto-merge
//             enabled (owner decision 2). Wire-only + verification
//             failed → PR without auto-merge, with a failure note.
//
// Artifacts: this driver writes exactly the three files the workflow
// uploads — teach-out/outline.json, teach-out/learned-site.json,
// teach-out/teach-report.md. Everything else (captures, call output,
// hints, the staged spec) lives in teach-work/ and is never uploaded:
// captures and the tool's home dir hold cookie values (§5).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildVerifiedSample, convertLearnedSite, diffSpecs, slugify, TOOL_COMMIT } from './convert.mjs'

const OUT_DIR = process.env.TEACH_OUT_DIR || 'teach-out'
const WORK_DIR = process.env.TEACH_WORK_DIR || 'teach-work'
const REPORT = join(OUT_DIR, 'teach-report.md')

const env = (name) => (process.env[name] ?? '').trim()
const today = () => new Date().toISOString().slice(0, 10)

function fail(msg) {
  throw new Error(msg)
}

// Run a command, tee'ing combined output to a work-dir log. Returns
// { status, stdout } — never throws on a nonzero exit; callers decide
// which failures are fatal (verification semantics differ per mode).
function run(cmd, args, { log } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  if (log) writeFileSync(join(WORK_DIR, log), `$ ${cmd} ${args.join(' ')}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`)
  if (stdout) process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`)
  if (stderr) process.stderr.write(stderr)
  return { status: res.status ?? 1, stdout, stderr }
}

function runOrFail(cmd, args, opts) {
  const r = run(cmd, args, opts)
  if (r.status !== 0) fail(`'${cmd} ${args.slice(0, 2).join(' ')} …' exited ${r.status} (see teach-work logs)`)
  return r
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    fail(`${what} did not print JSON (first 200 chars: ${JSON.stringify(text.slice(0, 200))})`)
  }
}

// 'sku=A,B k2=v2' → [['sku','A,B'], ['k2','v2']] (values may contain
// commas — e.g. a SKU set — but not spaces).
function parseKvList(text, label) {
  const pairs = []
  for (const token of (text ?? '').split(/\s+/).filter(Boolean)) {
    const eq = token.indexOf('=')
    if (eq < 1) fail(`${label}: expected k=v pairs separated by spaces, got '${token}'`)
    pairs.push([token.slice(0, eq), token.slice(eq + 1)])
  }
  return pairs
}
const kvFlags = (flag, pairs) => pairs.flatMap(([k, v]) => [flag, `${k}=${v}`])
const kvArgs = (pairs) => pairs.map(([k, v]) => `${k}=${v}`)

// Fill a trigger URL template's {param} placeholders with example
// values to get the concrete page a capture should load.
function fillTemplate(template, pairs) {
  const values = Object.fromEntries(pairs)
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => {
    if (!(name in values)) fail(`trigger_url placeholder {${name}} has no value in the example inputs`)
    return encodeURIComponent(values[name]).replace(/%2C/g, ',')
  })
}

// The match pin: JSON ('{"host": "…", "path": "/x/*"}') or k=v pairs
// separated by commas ('host=…,path=/x/*'). Returns null when unset.
function parseMatch(text) {
  if (!text) return null
  if (text.startsWith('{')) {
    const parsed = parseJson(text, 'match input')
    return parsed && typeof parsed === 'object' ? parsed : fail('match JSON must be an object')
  }
  const out = {}
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq < 1) fail(`match: expected k=v pairs or a JSON object, got '${part}'`)
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

function pathMatches(pattern, pathname) {
  const p = pattern.split('/').filter((s) => s !== '')
  const a = pathname.split('/').filter((s) => s !== '')
  if (p.length !== a.length) return false
  return p.every((seg, i) => seg === '*' || seg === a[i])
}

// Choose the capture candidate the match pin names; without a pin,
// the tool's top-ranked candidate (the pilot had to pick by hand —
// the pin exists so teach runs don't). Candidate URLs in capture
// output are truncated at 160 chars by the tool; path matching on a
// truncated URL can miss, which fails loudly here rather than picking
// the wrong request.
function chooseCandidate(capture, pin) {
  const candidates = capture?.candidates ?? []
  if (!candidates.length) fail('capture produced no request candidates — nothing to teach from')
  if (!pin) return { candidate: candidates[0], note: 'no match pin supplied; used the top-ranked candidate' }
  for (const c of candidates) {
    if (pin.method && String(c.method).toLowerCase() !== String(pin.method).toLowerCase()) continue
    if (pin.operationName && c.operationName !== pin.operationName) continue
    if (pin.host || pin.path) {
      let url
      try {
        url = new URL(c.url)
      } catch {
        continue
      }
      if (pin.host && url.host !== pin.host) continue
      if (pin.path && !pathMatches(pin.path, url.pathname)) continue
    }
    return { candidate: c, note: `match pin selected request ${c.id}` }
  }
  fail(
    `no capture candidate matches the match pin ${JSON.stringify(pin)}; candidates were:\n` +
      candidates.map((c) => `  ${c.id}: ${c.method} ${c.url}`).join('\n'),
  )
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function teachRunUrl() {
  if (!env('GITHUB_RUN_ID')) return undefined
  const server = env('GITHUB_SERVER_URL') || 'https://github.com'
  const repo = env('GITHUB_REPOSITORY')
  return repo ? `${server}/${repo}/actions/runs/${env('GITHUB_RUN_ID')}` : undefined
}

function writeReport(text) {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(REPORT, text)
}

// ------------------------------------------------------------- outline

function doOutline(cfg) {
  const url = fillTemplate(cfg.triggerUrl, parseKvList(cfg.example, 'example'))
  const args = ['capture', url, '--outline', ...kvFlags('--example', parseKvList(cfg.example, 'example'))]
  if (cfg.steps) args.push('--steps', cfg.steps)
  if (cfg.softFrom) args.push('--soft-from', cfg.softFrom)
  const r = run('api-anything', args, { log: 'capture-outline.log' })
  writeFileSync(join(OUT_DIR, 'outline.json'), r.stdout)
  const parsed = r.status === 0 ? parseJson(r.stdout, 'capture --outline') : null
  const rows = (parsed?.candidates ?? [])
    .map((c) => `| ${c.id} | ${c.method} | ${c.url} | ${c.size ?? ''} |`)
    .join('\n')
  writeReport(
    [
      `# Teach report — outline`,
      '',
      `- Site: \`${cfg.site}\`${cfg.op ? ` · op: \`${cfg.op}\`` : ''}`,
      `- Trigger URL: ${cfg.triggerUrl}`,
      `- Capture: ${parsed?.capture ?? '(capture failed — see outline.json)'}`,
      '',
      '## Ranked candidates',
      '',
      '| id | method | url | response bytes |',
      '| --- | --- | --- | --- |',
      rows || '| — | — | (none) | — |',
      '',
      'Full candidate outlines (response summaries, suggested recipes) are in `outline.json`.',
      'Choose the request and exactly one recipe, then dispatch `teach` mode.',
      '',
    ].join('\n'),
  )
  if (r.status !== 0) fail(`capture --outline exited ${r.status}`)
}

// -------------------------------------------------------- teach/reteach

function loadOldSpec(specId) {
  const path = join('ingestor', 'specs', `${specId}.json`)
  if (!existsSync(path)) fail(`reteach: no existing spec at ${path} (spec_id '${specId}')`)
  return { path, spec: JSON.parse(readFileSync(path, 'utf8')) }
}

function doTeach(cfg) {
  const isReteach = cfg.mode === 'reteach'
  const specId = cfg.specId || `${slugify(cfg.site)}-${slugify(cfg.op)}`

  // ---- seed from the existing spec (reteach) / validate (teach)
  let old = null
  let triggerUrl = cfg.triggerUrl
  let example = cfg.example
  let example2 = cfg.example2
  let bindings = cfg.bindings
  let fields = cfg.fields
  let writeRule = cfg.writeRule
  let purpose = cfg.purpose
  let platform = cfg.platform
  let description = cfg.description
  let extract = cfg.extract
  let pick = cfg.pick
  let html = cfg.html
  let embedded = cfg.embedded

  if (isReteach) {
    old = loadOldSpec(specId)
    const prov = old.spec.provenance ?? {}
    triggerUrl = triggerUrl || prov.taught_from || ''
    // Provenance samples carry the fresh inputs a previous teach
    // verified with — the closest stored record of example inputs.
    const sampleInputs = (prov.verified_samples ?? []).map((s) => s.input).filter(Boolean)
    example = example || sampleInputs[0] || ''
    example2 = example2 || sampleInputs.find((s) => s !== example) || ''
    // The contract is frozen, so seed everything contract-shaped
    // from the old spec unless the dispatcher explicitly overrode it.
    const oldBindings = {}
    for (const step of old.spec.steps ?? []) for (const p of step.params ?? []) oldBindings[p.name] = p.bind
    bindings = { ...oldBindings, ...bindings }
    fields = fields ?? old.spec.fields
    writeRule = writeRule || old.spec.write_rule
    purpose = old.spec.purpose || purpose
    platform = platform || old.spec.platform
    description = description || old.spec.description
    if (!extract && !pick && !html && !embedded) {
      const withExtract = [...(old.spec.steps ?? [])].reverse().find((s) => s.extract)
      if (withExtract) {
        extract = withExtract.extract.path ?? ''
        pick = Object.entries(withExtract.extract.pick ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      }
    }
  } else if (existsSync(join('ingestor', 'specs', `${specId}.json`))) {
    fail(`teach: ingestor/specs/${specId}.json already exists — use mode=reteach to heal an existing spec`)
  }

  cfg.triggerUrl = triggerUrl // effective trigger (reteach may have seeded it) — used by the report
  if (!triggerUrl) fail(`${cfg.mode}: trigger_url is required (reteach: or a taught_from in the existing spec's provenance)`)
  if (!cfg.verify)
    fail(
      `${cfg.mode}: the 'verify' input is required — a fresh input that was NOT an example, ` +
        "used for the verification call (the tool's own verification contract, §5)",
    )
  if (cfg.verify === example || (example2 && cfg.verify === example2))
    fail("the 'verify' input must be a fresh input, not one of the examples")
  if (!example) fail(`${cfg.mode}: example is required (reteach seeding from provenance found none either)`)

  // Exactly one response recipe (§5): extract+pick counts as one.
  const recipes = [
    ['extract/pick', Boolean(extract || pick)],
    ['html', Boolean(html)],
    ['embedded', Boolean(embedded)],
  ].filter(([, on]) => on)
  if (recipes.length !== 1)
    fail(
      `exactly one response recipe per teach run is required (extract+pick, or html, or embedded); got ${recipes.length}` +
        (isReteach ? ' (reteach seeding from the old spec found none either)' : ''),
    )

  const ex1 = parseKvList(example, 'example')
  const ex2 = example2 ? parseKvList(example2, 'example2') : []
  const warnings = []
  if (!example2) warnings.push('example2 not supplied: two genuinely different examples are what let the tool separate params from nonces (§5) — the op was taught from a single example')

  // ---- captures: once per example (the pilot's proven shape)
  const capArgs = (pairs, log) => {
    const args = ['capture', fillTemplate(triggerUrl, pairs), ...kvFlags('--example', pairs)]
    if (cfg.steps) args.push('--steps', cfg.steps)
    if (cfg.softFrom) args.push('--soft-from', cfg.softFrom)
    return runOrFail('api-anything', args, { log })
  }
  const capA = parseJson(capArgs(ex1, 'capture-a.log').stdout, 'capture (example)')
  const capB = ex2.length ? parseJson(capArgs(ex2, 'capture-b.log').stdout, 'capture (example2)') : null

  const pin = parseMatch(cfg.match)
  const { candidate, note } = chooseCandidate(capA, pin)
  warnings.push(note)

  // ---- add the operation from the captures
  const addArgs = [
    'add', cfg.site, cfg.op,
    '--from', String(capA.capture), '--pick-request', String(candidate.id),
    ...kvFlags('--example', ex1),
  ]
  if (capB) addArgs.push('--from2', String(capB.capture), ...kvFlags('--example2', ex2))
  if (pin) for (const [k, v] of Object.entries(pin)) addArgs.push('--match', `${k}=${v}`)
  if (extract) addArgs.push('--extract', extract)
  if (pick) addArgs.push('--pick', pick)
  if (html) addArgs.push('--html', html)
  if (embedded) addArgs.push('--embedded', embedded)
  if (cfg.publicList) addArgs.push('--public', cfg.publicList)
  if (description) addArgs.push('--description', description)
  const addOut = runOrFail('api-anything', addArgs, { log: 'add.log' })
  const addResult = parseJson(addOut.stdout, 'api-anything add')
  for (const w of addResult.warnings ?? []) warnings.push(`tool: ${w}`)

  // ---- the learned site JSON (artifact: this file only, never the
  // tool's home dir wholesale — it holds cookie values, §5)
  const aaHome = process.env.API_ANYTHING_HOME || join(homedir(), '.api-anything')
  const learnedPath = join(aaHome, 'sites', `${cfg.site}.json`)
  if (!existsSync(learnedPath)) fail(`learned site JSON not found at ${learnedPath} after add`)
  const learned = JSON.parse(readFileSync(learnedPath, 'utf8'))
  writeFileSync(join(OUT_DIR, 'learned-site.json'), `${JSON.stringify(learned, null, 2)}\n`)

  // ---- verification call with the fresh input
  const verifyPairs = parseKvList(cfg.verify, 'verify')
  const callOut = run('api-anything', ['call', cfg.site, cfg.op, ...kvArgs(verifyPairs)], { log: 'call-verify.log' })
  let callResult = null
  try {
    callResult = JSON.parse(callOut.stdout)
  } catch {
    /* handled below as a failed verification */
  }
  const verified = callOut.status === 0 && callResult?.ok === true
  const sample = verified
    ? buildVerifiedSample({ input: cfg.verify, params: Object.fromEntries(verifyPairs), data: callResult?.data, at: today() })
    : {
        name: `fresh-input verification (${cfg.verify})`,
        params: Object.fromEntries(verifyPairs),
        input: cfg.verify,
        expect: { verification_failed: callResult?.class ?? `call exited ${callOut.status}` },
        at: today(),
      }

  // ---- convert
  let toolVersion = '0.1.0'
  const versionOut = run('api-anything', ['--version'], {})
  if (versionOut.status === 0 && versionOut.stdout.trim()) toolVersion = versionOut.stdout.trim()
  const hints = {
    site: cfg.site,
    op: cfg.op,
    specId,
    platform: platform || undefined,
    purpose,
    description: description || undefined,
    fields,
    writeRule: writeRule || undefined,
    bindings,
    public: cfg.publicList ? cfg.publicList.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    taughtAt: today(),
    taughtFrom: triggerUrl,
    toolVersion,
    toolCommit: env('AA_COMMIT') || TOOL_COMMIT,
    teachRun: teachRunUrl(),
    captures: [capA.capture, capB?.capture].filter((c) => c !== undefined && c !== null),
    verifiedSamples: [sample],
  }
  const hintsPath = join(WORK_DIR, 'hints.json')
  writeFileSync(hintsPath, `${JSON.stringify(hints, null, 2)}\n`)
  let spec
  let convertWarnings
  try {
    ;({ spec, warnings: convertWarnings } = convertLearnedSite(learned, hints))
  } catch (err) {
    writeReport(reportFor(cfg, { specId, warnings, error: err.message }))
    throw err
  }
  warnings.push(...(convertWarnings ?? []))
  const stagedSpec = join(WORK_DIR, `${specId}.json`)
  writeFileSync(stagedSpec, `${JSON.stringify(spec, null, 2)}\n`)

  // ---- reteach contract freeze (§6)
  let diff = null
  if (isReteach) {
    diff = diffSpecs(old.spec, spec)
    if (!diff.wireOnly) {
      writeReport(reportFor(cfg, { specId, spec, warnings, verified, sample, diff, error: 'contract change — conversion rejected, no PR opened' }))
      fail(
        'reteach produced a CONTRACT change, which the §6 freeze forbids:\n' +
          diff.contractChanges.map((c) => `  - ${c.path}`).join('\n') +
          '\nA contract change is a human design task, not a heal. No PR was opened.',
      )
    }
    if (diff.wireChanges.length === 0) {
      writeReport(reportFor(cfg, { specId, spec, warnings, verified, sample, diff, note: 'reteach produced an identical wire template — no PR opened (nothing to merge)' }))
      console.log('reteach: wire template unchanged; no PR')
      return
    }
  }

  if (!verified && !isReteach) {
    writeReport(reportFor(cfg, { specId, spec, warnings, verified, sample, error: 'fresh-input verification failed — no PR opened' }))
    fail(`teach: verification call with fresh input '${cfg.verify}' failed (class: ${sample.expect.verification_failed}); no PR opened`)
  }
  const autoMerge = Boolean(isReteach && diff?.wireOnly && verified)

  // ---- report (also the PR body)
  const economy = {
    captures: capB ? 2 : 1,
    requestsObserved: [capA.requests, capB?.requests].filter((n) => n !== undefined),
    candidateSize: candidate.size,
    verifyTier: callResult?.tier,
    verifyMs: callResult?.ms,
    specSteps: spec.steps.length,
    learnedBytes: fileSize(join(OUT_DIR, 'learned-site.json')),
    specBytes: fileSize(stagedSpec),
  }
  writeReport(reportFor(cfg, { specId, spec, warnings, verified, sample, diff, economy, autoMerge }))

  // ---- spec branch + PR
  if (env('TEACH_SKIP_PR') === '1') {
    console.log('TEACH_SKIP_PR=1 — spec staged at', stagedSpec, '; no branch/PR')
    return
  }
  const branch = `spec/${cfg.site}-${cfg.op}`
  const git = (args, opts) => runOrFail('git', args, opts)
  git(['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'])
  git(['config', 'user.name', 'github-actions[bot]'])
  git(['checkout', '-B', branch])
  const specPath = join('ingestor', 'specs', `${specId}.json`)
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
  git(['add', specPath])
  git(['commit', '-m', `[spec] ${specId}: ${cfg.mode}`])
  // The spec branch is automation-owned; force-push so a re-run of
  // the same teach replaces its own earlier attempt.
  git(['push', '--force', 'origin', branch])
  const pr = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `[spec] ${specId}: ${cfg.mode}`, '--body-file', REPORT], { log: 'pr-create.log' })
  let prUrl = pr.stdout.trim().split('\n').pop()
  if (pr.status !== 0) {
    const existing = run('gh', ['pr', 'list', '--head', branch, '--json', 'url', '--jq', '.[0].url'], {})
    prUrl = existing.stdout.trim()
    if (!prUrl) fail(`gh pr create failed and no existing PR found for ${branch}`)
    console.log(`PR already exists for ${branch}: ${prUrl}`)
  }
  console.log(`spec PR: ${prUrl}`)
  if (autoMerge) {
    const merge = run('gh', ['pr', 'merge', '--auto', '--squash', prUrl], { log: 'pr-automerge.log' })
    if (merge.status !== 0) {
      run('gh', ['pr', 'comment', prUrl, '--body', 'Auto-merge was requested (wire-only reteach + verification passed) but `gh pr merge --auto` failed — see the teach run log. The PR is ready for manual merge.'], {})
      console.log('WARNING: auto-merge could not be enabled; PR left for manual merge')
    } else {
      console.log('auto-merge enabled (wire-only reteach + verification passed)')
    }
  }
}

// -------------------------------------------------------------- report

function reportFor(cfg, { specId, spec, warnings = [], verified, sample, diff, economy, autoMerge, error, note }) {
  const lines = [`# Teach report — ${specId} (${cfg.mode})`, '']
  if (error) lines.push(`> **Failed:** ${error}`, '')
  if (note) lines.push(`> ${note}`, '')
  lines.push(
    `- Site / op: \`${cfg.site}\` / \`${cfg.op}\``,
    `- Trigger: ${cfg.triggerUrl || '(seeded from existing spec provenance)'}`,
    `- Tool: api-anything ${'0.1.0'} @ ${env('AA_COMMIT') || TOOL_COMMIT} (pinned, teach-only)`,
    `- Teach run: ${teachRunUrl() ?? '(local / unknown)'}`,
    '',
  )
  if (spec) {
    const step = spec.steps[0]
    lines.push(
      '## Spec',
      '',
      `- id: \`${spec.id}\` · platform: \`${spec.platform}\` · purpose: \`${spec.purpose}\``,
      `- Request: \`${step.request.method} ${step.request.url}\``,
      `- Headers kept (§3 policy): ${Object.keys(step.request.headers).join(', ') || '(none)'}`,
      `- Extract: \`${step.extract.path ?? ''}\` → ${Object.entries(step.extract.pick).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      `- Fields: ${Object.entries(spec.fields ?? {}).map(([k, v]) => `${k}→${v}`).join(', ')}`,
      ...(spec.write_rule ? [`- Write rule: \`${spec.write_rule}\``] : []),
      '',
      '### Params & bindings',
      '',
      '| param | bind.from | take / join / value |',
      '| --- | --- | --- |',
      ...spec.steps.flatMap((s) =>
        (s.params ?? []).map(
          (p) =>
            `| ${p.name} | ${p.bind.from} | ${[p.bind.take, p.bind.join, p.bind.value !== undefined ? JSON.stringify(p.bind.value) : ''].filter(Boolean).join(' ') || '—'} |`,
        ),
      ),
      '',
    )
  }
  if (sample) {
    lines.push(
      '## Verification (fresh input, not an example)',
      '',
      `- Input: \`${sample.input ?? cfg.verify}\``,
      `- Result: ${verified ? 'passed' : '**FAILED**'}`,
      '',
      '| input | observed (expect) | at |',
      '| --- | --- | --- |',
      `| ${sample.input ?? cfg.verify} | ${JSON.stringify(sample.expect)} | ${sample.at} |`,
      '',
    )
  }
  if (economy) {
    lines.push(
      '## Request economy',
      '',
      '| measure | value |',
      '| --- | --- |',
      `| teach captures | ${economy.captures} page load(s) |`,
      `| requests observed per capture | ${economy.requestsObserved.join(', ') || '—'} |`,
      `| chosen response size | ${economy.candidateSize ?? '—'} bytes |`,
      `| spec requests per call (per datum chain) | ${economy.specSteps} |`,
      `| verify call | tier ${economy.verifyTier ?? '—'}, ${economy.verifyMs ?? '—'} ms |`,
      `| learned site JSON | ${economy.learnedBytes ?? '—'} bytes |`,
      `| spec JSON | ${economy.specBytes ?? '—'} bytes |`,
      '',
    )
  }
  if (diff) {
    lines.push(
      '## Reteach diff (contract freeze, §6)',
      '',
      `- Wire-only: ${diff.wireOnly ? 'yes' : '**no**'}`,
      `- Wire changes: ${diff.wireChanges.map((c) => c.path).join(', ') || '(none)'}`,
      `- Contract changes: ${diff.contractChanges.map((c) => c.path).join(', ') || '(none)'}`,
      ...(cfg.mode === 'reteach'
        ? [
            diff.wireOnly && verified
              ? '- Auto-merge: enabled on this PR (owner decision 2: wire-only + verification passed)'
              : diff.wireOnly
                ? '- Auto-merge: **not** enabled — verification failed; this PR needs human review'
                : '- Auto-merge: not applicable — contract change',
          ]
        : []),
      '',
    )
  }
  if (autoMerge) lines.push('Auto-merge will be enabled on the PR (wire-only reteach, verification passed).', '')
  if (warnings.length) lines.push('## Warnings & notes', '', ...warnings.map((w) => `- ${w}`), '')
  return lines.join('\n')
}

// ---------------------------------------------------------------- main

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(WORK_DIR, { recursive: true })
  const parseJsonInput = (name, label) => {
    const raw = env(name)
    if (!raw) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      fail(`${label} input is not valid JSON: ${raw.slice(0, 120)}`)
    }
  }
  const cfg = {
    mode: env('TEACH_MODE') || 'outline',
    site: env('TEACH_SITE'),
    op: env('TEACH_OP'),
    triggerUrl: env('TEACH_TRIGGER_URL'),
    example: env('TEACH_EXAMPLE'),
    example2: env('TEACH_EXAMPLE2'),
    match: env('TEACH_MATCH'),
    extract: env('TEACH_EXTRACT'),
    pick: env('TEACH_PICK'),
    html: env('TEACH_HTML'),
    embedded: env('TEACH_EMBEDDED'),
    steps: env('TEACH_STEPS'),
    softFrom: env('TEACH_SOFT_FROM'),
    verify: env('TEACH_VERIFY'),
    bindings: parseJsonInput('TEACH_BINDINGS', 'bindings') ?? {},
    fields: parseJsonInput('TEACH_FIELDS', 'fields'),
    platform: env('TEACH_PLATFORM'),
    purpose: env('TEACH_PURPOSE') || 'ratings',
    writeRule: env('TEACH_WRITE_RULE'),
    description: env('TEACH_DESCRIPTION'),
    publicList: env('TEACH_PUBLIC'),
    specId: env('TEACH_SPEC_ID'),
  }
  if (!['outline', 'teach', 'reteach'].includes(cfg.mode)) fail(`unknown mode '${cfg.mode}' (outline | teach | reteach)`)
  if (!cfg.site) fail('site is required')
  if (cfg.mode === 'outline') {
    if (!cfg.triggerUrl) fail('outline: trigger_url is required')
    doOutline(cfg)
    return
  }
  if (!cfg.op) fail(`${cfg.mode}: op is required`)
  for (const [label, value] of [['site', cfg.site], ['op', cfg.op], ['spec_id', cfg.specId]]) {
    if (value && !/^[a-z0-9][a-z0-9-]*$/.test(value)) fail(`${label} '${value}' must be a lower-case slug (it names files and branches)`)
  }
  doTeach(cfg)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    process.stderr.write(`teach driver failed: ${err.message}\n`)
    // Best effort: a report artifact should exist even on failure so
    // the workflow's upload step has the failure context.
    try {
      if (!existsSync(REPORT)) writeReport(`# Teach report\n\n> **Failed:** ${err.message}\n`)
    } catch {
      /* nothing more to do */
    }
    process.exit(1)
  }
}
