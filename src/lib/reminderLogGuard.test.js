import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Audit 2026-11-10, findings C-1 / C-2 / C-3 (send-occasion-reminders).
//
// occasion_reminder_log has three dedupe streams, each a partial unique
// index: owner digests, relatives (0020) and subscribers (0034). 0020's
// owner index was written as "WHERE relative_id IS NULL" before subscriber
// rows existed; subscriber rows also have relative_id NULL, so a
// subscriber's row collided with the owner's for the same occasion/date
// and the (unchecked) insert failure meant daily re-sends. These guards
// keep the fix from being undone. They read the migration and function
// SOURCE (the function runs under Deno and is not importable here); the
// behavioral proof is the scratch-Postgres run recorded in the manifest.

const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const MIGRATIONS = dir('../../supabase/migrations/')
const FN = dir('../../supabase/functions/send-occasion-reminders/index.ts')

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase()

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((name) => ({ name, sql: squash(stripSqlComments(readFileSync(MIGRATIONS + name, 'utf8'))) }))

// The index definitions, in migration order, that mention one index name.
const definitionsOf = (indexName) =>
  migrations.flatMap(({ name, sql }) =>
    sql
      .split(';')
      .map((st) => st.trim())
      .filter((st) => st.includes(indexName))
      .map((st) => ({ name, st })),
  )

describe('0063: owner dedupe index excludes subscriber rows', () => {
  const owner = definitionsOf('occasion_reminder_log_owner_key')
  const last = owner[owner.length - 1]

  it('the last migration to define the owner index is 0063', () => {
    expect(last.name.startsWith('0063_')).toBe(true)
  })

  it('drops and recreates the SAME index name, unique on (occasion_id, occurrence_date)', () => {
    const stmts = owner.filter((d) => d.name.startsWith('0063_')).map((d) => d.st)
    expect(stmts.some((s) => /^drop index if exists (public\.)?occasion_reminder_log_owner_key$/.test(s))).toBe(true)
    const create = stmts.find((s) => s.startsWith('create unique index'))
    expect(create).toBeDefined()
    expect(create).toMatch(/create unique index occasion_reminder_log_owner_key on public\.occasion_reminder_log \(occasion_id, occurrence_date\)/)
  })

  it('is partial on BOTH relative_id IS NULL and subscriber_id IS NULL', () => {
    const create = owner.filter((d) => d.name.startsWith('0063_')).find((d) => d.st.startsWith('create unique index')).st
    const where = create.slice(create.indexOf(' where ') + 7)
    expect(where).toMatch(/\brelative_id is null\b/)
    expect(where).toMatch(/\bsubscriber_id is null\b/)
    expect(where.includes(' or ')).toBe(false)
  })

  it('leaves the relative (0020) and subscriber (0034) indexes alone after their own migrations', () => {
    for (const [index, home] of [
      ['occasion_reminder_log_relative_key', '0020_'],
      ['occasion_reminder_log_subscriber_key', '0034_'],
    ]) {
      const defs = definitionsOf(index)
      expect(defs.length).toBe(1)
      expect(defs[0].name.startsWith(home)).toBe(true)
    }
  })
})

describe('send-occasion-reminders/index.ts: log handling (C-2, C-3)', () => {
  const src = readFileSync(FN, 'utf8')
  const code = src.replace(/\/\/[^\n]*/g, '')

  it('subscriber rows do not count as owner-sent', () => {
    expect(code).toMatch(/\.filter\(\(r: any\) => !r\.relative_id && !r\.subscriber_id\)\s*\.map\(\(r: any\) => `\$\{r\.occasion_id\}\|\$\{r\.occurrence_date\}`\)/)
  })

  it('writes the log only through writeLog, once per stream, and no raw insert remains', () => {
    expect(code.match(/\.from\('occasion_reminder_log'\)\.insert\(/g)?.length).toBe(1) // inside writeLog
    for (const stream of ['owner', 'relative', 'subscriber']) {
      expect(code).toMatch(new RegExp(`await writeLog\\(\\s*admin,\\s*'${stream}'`))
    }
    expect(code.match(/await writeLog\(/g)?.length).toBe(3)
  })

  it('writeLog checks the returned error and throws a LogWriteError naming the stream', () => {
    const body = code.slice(code.indexOf('async function writeLog('), code.indexOf('const dateKey'))
    expect(body).toMatch(/const \{ error \} = await admin\.from\('occasion_reminder_log'\)\.insert\(rows\)/)
    expect(body).toMatch(/if \(!error\) return/)
    expect(body).toMatch(/throw new LogWriteError\(stream, detail\)/)
  })

  it('a LogWriteError stops the run with 424 and names the stream (not a retried 5xx)', () => {
    const handler = code.slice(code.indexOf('if (e instanceof LogWriteError)'))
    expect(handler).toMatch(/stream: e\.stream/)
    expect(handler).toMatch(/\b424\b/)
    expect(handler.indexOf('424')).toBeLessThan(handler.indexOf("console.error('send-occasion-reminders failed'"))
  })

  it('keeps the success-path response fields', () => {
    for (const field of ['configured', 'dry', 'spread', 'dueProfiles', 'sent', 'digests']) {
      expect(code).toMatch(new RegExp(`\\b${field}\\b[:,]`))
    }
  })
})
