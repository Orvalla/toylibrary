#!/usr/bin/env node
// Weekly database backup — run by .github/workflows/backup.yml
// (and locally: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
// node ingestor/backup.mjs [--dry]).
//
// The free Supabase plan has no automated backups. This exports
// every public table (discovered from the REST OpenAPI doc, so
// new tables join automatically) plus the auth user list into
// one gzipped JSON bundle and stores it in the private
// 'backups' bucket (migration 0047), keeping the newest 8.
//
// Format: { format: 'toy-library-backup/1', exported_at,
//           tables: { <name>: [rows…] }, auth_users: […] }
//
// A restore is a data-level replay: create the project, apply
// the migrations, then re-insert each table's rows in FK order
// with the service role. Auth password hashes are NOT part of
// any export the API offers, so restored accounts would need a
// password reset — the emails and profile data survive, which
// is the part that can't be recreated.
//
// Rows are de-duplicated per table and checked against the
// server's exact count; a mismatch is reported loudly (paging
// an actively-written table can shuffle rows between pages).

import { gzipSync } from 'node:zlib'
import { appendFile } from 'node:fs/promises'

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY = process.argv.includes('--dry') || process.env.BACKUP_DRY === '1'
const KEEP = 8
const PAGE = 1000

if (!URL_BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { headers, ...opts })
  if (!res.ok) throw new Error(`${res.status} ${url}: ${await res.text()}`)
  return res
}

async function discoverTables() {
  const res = await fetchJson(`${URL_BASE}/rest/v1/`)
  const spec = await res.json()
  return Object.keys(spec.paths ?? {})
    .filter((p) => /^\/[a-z][a-z0-9_]*$/.test(p) && !p.startsWith('/rpc'))
    .map((p) => p.slice(1))
    .sort()
}

async function exportTable(name) {
  const seen = new Set()
  const rows = []
  let expected = null
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetchJson(
      `${URL_BASE}/rest/v1/${name}?select=*&limit=${PAGE}&offset=${offset}`,
      { headers: { ...headers, Prefer: 'count=exact' } },
    )
    const range = res.headers.get('content-range') ?? ''
    const total = Number(range.split('/')[1])
    if (Number.isFinite(total)) expected = total
    const page = await res.json()
    for (const row of page) {
      const key = JSON.stringify(row)
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(row)
      }
    }
    if (page.length < PAGE) break
  }
  if (expected != null && rows.length !== expected) {
    console.warn(`⚠️ ${name}: exported ${rows.length} unique rows, server count is ${expected}`)
  }
  return rows
}

async function exportAuthUsers() {
  const users = []
  for (let page = 1; ; page++) {
    const res = await fetchJson(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=${PAGE}`)
    const body = await res.json()
    const batch = body.users ?? []
    users.push(...batch)
    if (batch.length < PAGE) break
  }
  return users
}

const stamp = new Date().toISOString().slice(0, 10)
const objectName = `backup-${stamp}.json.gz`

const tables = {}
let totalRows = 0
for (const name of await discoverTables()) {
  tables[name] = await exportTable(name)
  totalRows += tables[name].length
  console.log(`${name}: ${tables[name].length} rows`)
}
const authUsers = await exportAuthUsers()
console.log(`auth_users: ${authUsers.length}`)

const bundle = JSON.stringify({
  format: 'toy-library-backup/1',
  exported_at: new Date().toISOString(),
  tables,
  auth_users: authUsers,
})
const gz = gzipSync(Buffer.from(bundle))
console.log(`bundle: ${(bundle.length / 1e6).toFixed(1)} MB json, ${(gz.length / 1e6).toFixed(2)} MB gz, ${totalRows} table rows`)

if (DRY) {
  console.log('dry run — nothing uploaded')
} else {
  await fetchJson(`${URL_BASE}/storage/v1/object/backups/${objectName}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
    body: gz,
  })
  console.log(`uploaded backups/${objectName}`)

  // Prune to the newest KEEP bundles (date-prefixed names sort).
  const listRes = await fetchJson(`${URL_BASE}/storage/v1/object/list/backups`, {
    method: 'POST',
    body: JSON.stringify({ prefix: '', limit: 200, offset: 0 }),
  })
  const names = (await listRes.json()).map((o) => o.name).sort()
  const stale = names.slice(0, Math.max(0, names.length - KEEP))
  if (stale.length) {
    await fetchJson(`${URL_BASE}/storage/v1/object/backups`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: stale }),
    })
    console.log(`pruned ${stale.length} old backup(s): ${stale.join(', ')}`)
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `### Backup ${DRY ? '(dry run)' : ''}\n\n- Object: \`backups/${objectName}\`\n- Tables: ${Object.keys(tables).length}, rows: ${totalRows}, auth users: ${authUsers.length}\n- Size: ${(gz.length / 1e6).toFixed(2)} MB gzipped\n`,
  )
}
