// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Migration 0067 (feature flags): the advisor_public rollout
// flag. Like the 0064 guards, these read the SQL SOURCE: the
// table is world-readable BY DESIGN, so the whole security
// story is "no client write path exists" — writes only via
// the admin-guarded RPC. (Not applied anywhere at build time;
// the behavioural proof is post-deploy.)

const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const MIGRATIONS = dir('../../supabase/migrations/')
const squash = (s) =>
  s
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
const sql = squash(readFileSync(MIGRATIONS + '0067_feature_flags.sql', 'utf8'))

describe('0067 feature flags', () => {
  it('0067 directly follows 0066 and no migration number is reused', () => {
    const nums = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4)))
      .sort((a, b) => a - b)
    expect(nums.filter((n) => n === 67)).toHaveLength(1)
    expect(nums.indexOf(67)).toBe(nums.indexOf(66) + 1)
    expect(new Set(nums).size).toBe(nums.length)
  })

  it('feature_flags holds key / enabled / updated_at and nothing else', () => {
    const body = sql.match(/create table if not exists public\.feature_flags \((.*?)\);/)[1]
    expect(body).toContain('key text primary key')
    expect(body).toContain('enabled boolean not null default false')
    expect(body).toContain('updated_at timestamptz not null default now()')
    const columns = [...body.matchAll(/(?:^\s*|, )([a-z_]+) (?:text|boolean|timestamptz)/g)].map((m) => m[1])
    expect(columns.sort()).toEqual(['enabled', 'key', 'updated_at'].sort())
  })

  it('RLS on, SELECT public, and no client write policies', () => {
    expect(sql).toContain('alter table public.feature_flags enable row level security')
    expect(sql).toContain('grant select on public.feature_flags to anon, authenticated')
    expect(sql).toMatch(/create policy "[^"]*" on public\.feature_flags for select/)
    expect(sql).not.toMatch(/create policy[^;]*on public\.feature_flags for (insert|update|delete)/)
    expect(sql).toContain('revoke insert, update, delete on public.feature_flags from anon, authenticated')
  })

  it('the only write door is admin_set_feature_flag, behind the 0031 admin guard', () => {
    expect(sql).toContain('create or replace function public.admin_set_feature_flag( p_key text, p_enabled boolean )')
    expect(sql).toContain('security definer')
    expect(sql).toContain("if not public.caller_is_admin() then raise exception 'not an admin'; end if;")
    expect(sql).toContain('on conflict (key) do update')
  })

  it("seeds advisor_public off (admins-only preview), never overwriting a later flip", () => {
    expect(sql).toContain("insert into public.feature_flags (key, enabled) values ('advisor_public', false) on conflict do nothing")
  })
})
