import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ALSO_KNOWN_HEADER,
  RULE3_CLAUSE,
  SYSTEM_TEMPLATE,
  buildSystemPrompt,
  promptTemplate,
} from '../../supabase/functions/gift-advisor/prompt.js'

// WS7 spec §4: the production system prompt is the bake-off
// harness's SYSTEM_TEMPLATE verbatim + ONE rule-3 clause. The hash
// below is the harness template's SHA-256 (ws7-bakeoff-harness.py,
// computed 2026-11-13). If it changes, the bake-off verdict no
// longer covers the prompt.

const HARNESS_SHA256 = '16f40e7863e081f81ff0b9c1bd918a4b958cb1b958908f73360ccb730f8e7443'

describe('system prompt', () => {
  it('SYSTEM_TEMPLATE is byte-identical to the bake-off harness', () => {
    expect(createHash('sha256').update(SYSTEM_TEMPLATE).digest('hex')).toBe(HARNESS_SHA256)
  })

  it('adds exactly one clause, at the end of rule 3', () => {
    const t = promptTemplate()
    expect(t.length).toBe(SYSTEM_TEMPLATE.length + 1 + RULE3_CLAUSE.length)
    const rule3 = t.split('\n').find((l) => l.startsWith('3. Prices:'))
    expect(rule3.endsWith(`Never estimate or round a price into existence. ${RULE3_CLAUSE}`)).toBe(true)
    expect(t.split(RULE3_CLAUSE)).toHaveLength(2)
  })

  it('introduces the Toy Librarian (never any other name)', () => {
    expect(SYSTEM_TEMPLATE.startsWith('You are the Toy Librarian')).toBe(true)
    expect(promptTemplate()).not.toMatch(/Elise/)
  })

  it('appends the candidate JSON in place, then also_known under the DO-NOT-RECOMMEND marker', () => {
    const candidates = [{ name: 'Wooden Dinosaur Puzzle', price_usd: null }]
    const s = buildSystemPrompt({
      candidates,
      alsoKnown: [{ name: 'Super-Fun Marble Run Master Set', age_min_years: 8 }],
      child: { age_years: 3 },
    })
    expect(s).toContain(`CANDIDATES (JSON):\n${JSON.stringify(candidates, null, 1)}`)
    expect(s).not.toContain('{candidates}')
    const tail = s.slice(s.indexOf(ALSO_KNOWN_HEADER))
    expect(tail).toContain('DO NOT RECOMMEND')
    expect(tail).toContain('"DO_NOT_RECOMMEND": true')
    expect(tail).toContain('Super-Fun Marble Run Master Set')
    // also_known rows sit after the candidates, never inside them.
    expect(s.indexOf('Super-Fun Marble Run')).toBeGreaterThan(s.indexOf('CANDIDATES (JSON):'))
  })
})
