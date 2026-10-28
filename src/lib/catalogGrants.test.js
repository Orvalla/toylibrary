import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Guards for the column-level read grants on catalog_items
// (migration 0062; owner decision B8). base_price_usd and
// base_price_checked_at are an internal anchor: anon/authenticated
// hold SELECT on every OTHER column, not on the table. That has two
// consequences this file keeps from biting later:
//   1. a column added to catalog_items after 0062 is unreadable by the
//      browser until its migration grants it — and no migration may
//      re-grant table-level SELECT (that would expose the anchor again);
//   2. browser code must list catalog columns (select * would fail),
//      and must never mention the internal columns.

const INTERNAL = ['base_price_usd', 'base_price_checked_at']
const GRANT_MIGRATION = 62

const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url))

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

// migrations: [{ name: '0063_x.sql', sql }] in order. Returns problem strings.
export function checkCatalogGrants(migrations) {
  const problems = []
  const granted = new Set()
  for (const { name, sql } of migrations) {
    const n = Number(name.slice(0, 4))
    if (!(n > GRANT_MIGRATION)) continue
    const statements = stripComments(sql).split(';')
    const added = []
    for (const st of statements) {
      if (/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?catalog_items\b/i.test(st)) {
        for (const m of st.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) {
          added.push(m[1].toLowerCase())
        }
      }
      const colGrant = st.match(
        /grant\s+select\s*\(([^)]*)\)\s+on\s+(?:table\s+)?(?:public\.)?catalog_items\s+to\s+([\s\S]*)/i,
      )
      if (colGrant && /\banon\b/i.test(colGrant[2]) && /\bauthenticated\b/i.test(colGrant[2])) {
        for (const c of colGrant[1].split(',')) granted.add(c.trim().replace(/"/g, '').toLowerCase())
      }
      if (
        /grant\s+(?:select|all(?:\s+privileges)?)\s+on\s+(?:table\s+)?(?:public\.)?catalog_items\b[\s\S]*\bto\b[\s\S]*\b(anon|authenticated|public)\b/i.test(st)
      ) {
        problems.push(`${name}: table-level grant on catalog_items would expose ${INTERNAL.join(', ')}`)
      }
      if (
        /grant\s+(?:select|all(?:\s+privileges)?)\s+on\s+all\s+tables\s+in\s+schema\s+public\b[\s\S]*\b(anon|authenticated|public)\b/i.test(st)
      ) {
        problems.push(`${name}: schema-wide table grant would expose ${INTERNAL.join(', ')}`)
      }
    }
    for (const col of added) {
      if (INTERNAL.includes(col)) continue
      if (!granted.has(col)) {
        problems.push(
          `${name}: new catalog_items column "${col}" has no "grant select (${col}) on public.catalog_items to anon, authenticated"`,
        )
      }
    }
  }
  return problems
}

// Browser-code scan: returns problem strings for one file.
export function checkBrowserSource(path, text) {
  const problems = []
  for (const col of INTERNAL) {
    if (text.includes(col)) problems.push(`${path}: mentions ${col}`)
  }
  if (/from\(\s*['"]catalog_items['"]\s*\)\s*\.select\(\s*(?:['"]\*['"]\s*)?(?:,[^)]*)?\)/.test(text)) {
    problems.push(`${path}: select * on catalog_items (list columns; see migration 0062)`)
  }
  return problems
}

const migrations = () =>
  readdirSync(dir('../../supabase/migrations/'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(dir(`../../supabase/migrations/${name}`), 'utf8') }))

function sourceFiles(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = `${root}${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(`${full}/`))
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
  }
  return out
}

describe('catalog_items column grants (migration 0062)', () => {
  it('the grant migration swaps table-level SELECT for column-level SELECT', () => {
    const m = migrations().find((x) => x.name.startsWith('0062_'))
    expect(Boolean(m)).toBe(true)
    const sql = stripComments(m.sql)
    expect(/revoke\s+select\s+on\s+public\.catalog_items\s+from[^;]*\banon\b[^;]*\bauthenticated\b/i.test(sql)).toBe(true)
    expect(/grant select \(%s\) on public\.catalog_items to anon, authenticated/.test(sql)).toBe(true)
    for (const col of INTERNAL) expect(sql.includes(`'${col}'`)).toBe(true)
  })

  it('no later migration adds an ungranted column or re-grants the table', () => {
    expect(checkCatalogGrants(migrations())).toEqual([])
  })

  it('checker: flags a new column without a grant, accepts one with it', () => {
    const bad = [{ name: '0063_x.sql', sql: 'alter table public.catalog_items add column if not exists vibe text;' }]
    expect(checkCatalogGrants(bad).length).toBe(1)
    const good = [
      {
        name: '0063_x.sql',
        sql:
          'alter table public.catalog_items add column vibe text, add column mood text;\n' +
          'grant select (vibe, mood) on public.catalog_items to anon, authenticated;',
      },
    ]
    expect(checkCatalogGrants(good)).toEqual([])
    const lateGrant = [
      { name: '0063_x.sql', sql: 'alter table public.catalog_items add column vibe text;' },
      { name: '0064_y.sql', sql: 'grant select (vibe) on public.catalog_items to anon, authenticated;' },
    ]
    expect(checkCatalogGrants(lateGrant).length).toBe(1) // must be granted in the same or an earlier file
  })

  it('checker: flags table-level and schema-wide re-grants, ignores comments', () => {
    const t = [{ name: '0063_x.sql', sql: 'grant select on public.catalog_items to anon;' }]
    expect(checkCatalogGrants(t).length).toBe(1)
    const a = [{ name: '0063_x.sql', sql: 'grant all on public.catalog_items to authenticated, service_role;' }]
    expect(checkCatalogGrants(a).length).toBe(1)
    const s = [{ name: '0063_x.sql', sql: 'grant select on all tables in schema public to anon;' }]
    expect(checkCatalogGrants(s).length).toBe(1)
    const c = [{ name: '0063_x.sql', sql: '-- grant select on public.catalog_items to anon;\nselect 1;' }]
    expect(checkCatalogGrants(c)).toEqual([])
    const svc = [{ name: '0063_x.sql', sql: 'grant all on public.catalog_items to service_role;' }]
    expect(checkCatalogGrants(svc)).toEqual([])
  })

  it('checker: the internal columns themselves never need a grant', () => {
    const m = [{ name: '0063_x.sql', sql: 'alter table public.catalog_items add column base_price_usd numeric;' }]
    expect(checkCatalogGrants(m)).toEqual([])
  })
})

describe('browser code and the internal price columns', () => {
  it('no src file selects * from catalog_items or mentions the internal columns', () => {
    const root = dir('../')
    const problems = sourceFiles(root).flatMap((f) =>
      checkBrowserSource(f.replace(root, 'src/'), readFileSync(f, 'utf8')),
    )
    expect(problems).toEqual([])
  })

  it('scanner: catches select * and select() on catalog_items, passes explicit lists', () => {
    expect(checkBrowserSource('a.jsx', "supabase.from('catalog_items').select('*').eq('x', 1)").length).toBe(1)
    expect(checkBrowserSource('a.jsx', "supabase\n  .from('catalog_items')\n  .select()").length).toBe(1)
    expect(checkBrowserSource('a.jsx', "supabase.from('catalog_items').select('*', { count: 'exact' })").length).toBe(1)
    expect(checkBrowserSource('a.jsx', "supabase.from('catalog_items').select(CATALOG_COLUMNS)").length).toBe(0)
    expect(checkBrowserSource('a.jsx', "supabase.from('items').select('*')").length).toBe(0)
    expect(checkBrowserSource('a.jsx', "const x = d.base_price_usd").length).toBe(1)
  })
})
