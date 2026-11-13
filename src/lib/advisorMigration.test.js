// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// WS7 migration 0064 (advisor usage / counters / alerts). The
// function runs with the service role; these guards read the SQL
// SOURCE to keep the tables locked down and transcript-free. (Not
// applied anywhere at build time; the behavioural proof is
// post-deploy.)

const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const MIGRATIONS = dir('../../supabase/migrations/')
const squash = (s) =>
  s
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
const sql = squash(readFileSync(MIGRATIONS + '0064_advisor_usage.sql', 'utf8'))

describe('0064 advisor tables', () => {
  it('is the next migration after 0063', () => {
    const nums = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4)))
      .sort((a, b) => a - b)
    expect(nums.at(-1)).toBe(64)
    expect(nums.filter((n) => n === 64)).toHaveLength(1)
  })

  it.each(['advisor_usage', 'advisor_ip_counters', 'advisor_alerts'])('%s: RLS on, anon/authenticated revoked', (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security`)
    expect(sql).toContain(`revoke all on public.${t} from public, anon, authenticated`)
    expect(sql).not.toMatch(new RegExp(`create policy[^;]*on public\\.${t}`))
  })

  it('advisor_usage stores counts, cost, mode, candidate ids: no transcript columns', () => {
    const body = sql.match(/create table if not exists public\.advisor_usage \((.*?)\);/)[1]
    for (const col of ['day', 'provider', 'tokens_in', 'tokens_out', 'est_cost', 'mode', 'candidate_ids', 'created_at']) {
      expect(body).toContain(col)
    }
    expect(body).not.toMatch(/\b(content|message|messages|text|prompt|reply|transcript|history|ip)\b/)
  })

  it('counters key on a hashed IP, never the raw address', () => {
    const body = sql.match(/create table if not exists public\.advisor_ip_counters \((.*?)\);/)[1]
    expect(body).toContain('ip_hash')
    expect(body).not.toMatch(/\bip\b|inet/)
  })

  it('RPCs are service-role only', () => {
    expect(sql).toContain('revoke all on function public.advisor_take_turn(text, int, int) from public, anon, authenticated')
    expect(sql).toContain('revoke all on function public.advisor_spend_today() from public, anon, authenticated')
    expect(sql).toContain('grant execute on function public.advisor_take_turn(text, int, int) to service_role')
  })
})
