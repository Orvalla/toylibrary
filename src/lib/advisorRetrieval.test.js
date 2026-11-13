import { describe, expect, it } from 'vitest'
import {
  ALSO_KNOWN_CAP,
  CANDIDATE_CAP,
  INTERESTS,
  PAYLOAD_FIELDS,
  ageFromText,
  ageOn,
  childFromConversation,
  isNamed,
  itemKey,
  passesAgeFloor,
  retrieve,
  soldAt,
  titleSearchWords,
  toPayload,
} from '../../supabase/functions/gift-advisor/retrieval.js'
import { pageContext } from '../../supabase/functions/gift-advisor/store.js'
import { INTERESTS as APP_INTERESTS } from './onboarding'
import { EMMA, TODAY, bakeoffCatalog, memoryCatalog, row } from '../test/advisorFixtures'

// WS7 spec §3: the fence layer. Everything the Toy Librarian may
// recommend comes out of retrieve(); these pins keep the fences hard.

const ctx = (over = {}) => ({
  age: 3,
  interests: [],
  players: [],
  excludeKeys: new Set(),
  shopperTexts: [],
  ...over,
})

describe('age floor (hard)', () => {
  it('boundary equality: age_min_years == child age is eligible', async () => {
    const r = row({ age_min_years: 3 })
    const { rows } = await retrieve(memoryCatalog([r]), ctx({ age: 3 }))
    expect(rows.map((x) => x.id)).toEqual([r.id])
  })

  it('one tenth over the age is out (3.5 for a 3-year-old)', async () => {
    const r = row({ age_min_years: 3.5 })
    const { rows } = await retrieve(memoryCatalog([r]), ctx({ age: 3 }))
    expect(rows).toEqual([])
  })

  it('unknown age_min_years is never eligible', async () => {
    expect(passesAgeFloor({ age_min_years: null }, 5)).toBe(false)
    const r = row({ age_min_years: null })
    const { rows } = await retrieve(memoryCatalog([r], { ignoreAge: true }), ctx({ age: 5 }))
    expect(rows).toEqual([])
  })

  it('no known age = empty shelves (and no also_known)', async () => {
    const out = await retrieve(memoryCatalog(bakeoffCatalog()), ctx({ age: null }))
    expect(out).toEqual({ candidates: [], rows: [], alsoKnown: [] })
  })

  it('is re-applied after SQL: a source that ignores age cannot widen the fence', async () => {
    const old = row({ age_min_years: 9, title: 'Too Old Kit' })
    const ok = row({ age_min_years: 2 })
    const { rows } = await retrieve(memoryCatalog([old, ok], { ignoreAge: true }), ctx({ age: 3 }))
    expect(rows.map((x) => x.id)).toEqual([ok.id])
  })

  it('"advanced for her age" changes nothing: the S4 trap item stays out', async () => {
    const texts = [
      'My granddaughter is 3 but very advanced for her age. I saw the Super-Fun Marble Run Master Set and that\'s the one I want.',
    ]
    const said = childFromConversation(texts)
    expect(said.age).toBe(3)
    const out = await retrieve(memoryCatalog(bakeoffCatalog()), ctx({ age: said.age, shopperTexts: texts }))
    expect(out.candidates.map((c) => c.name)).not.toContain('Super-Fun Marble Run Master Set')
    expect(out.alsoKnown).toContainEqual({ name: 'Super-Fun Marble Run Master Set', age_min_years: 8 })
  })
})

describe('exclusions (hard)', () => {
  it('owned and claimed items are excluded', async () => {
    const owned = row({ title: 'Owned Thing' })
    const claimed = row({ title: 'Claimed Thing' })
    const free = row({ title: 'Free Thing' })
    const excludeKeys = new Set([itemKey(owned.platform, 'owned thing'), itemKey(claimed.platform, 'CLAIMED THING')])
    const { rows } = await retrieve(memoryCatalog([owned, claimed, free]), ctx({ excludeKeys }))
    expect(rows.map((x) => x.title)).toEqual(['Free Thing'])
  })

  it('pageContext: child + family items count, a sibling-only item does not; expired claims are free again', () => {
    const sibling = '22222222-2222-4222-8222-222222222222'
    const items = [
      { platform: 'yoto', title: 'Yoto Player', list_type: 'have', child_id: EMMA.id },
      { platform: 'brio', title: 'Family Train', list_type: 'have', child_id: null },
      { platform: 'brio', title: 'Sibling Train', list_type: 'have', child_id: sibling },
      { platform: 'haba', title: 'Claimed Blocks', list_type: 'wishlist', child_id: EMMA.id, claimed_at: '2026-11-01T00:00:00Z', claim_expires_at: '2026-12-01T00:00:00Z' },
      { platform: 'haba', title: 'Lapsed Claim', list_type: 'wishlist', child_id: EMMA.id, claimed_at: '2026-10-01T00:00:00Z', claim_expires_at: '2026-11-01T00:00:00Z' },
      { platform: 'haba', title: 'Open Wish', list_type: 'wishlist', child_id: EMMA.id, claimed_at: null },
    ]
    const page = pageContext(EMMA, items, TODAY)
    expect(page.age).toBe(3)
    expect(page.interests).toEqual(['dinosaurs'])
    expect(page.players).toEqual(['yoto'])
    expect([...page.excludeKeys].sort()).toEqual(
      [itemKey('yoto', 'Yoto Player'), itemKey('brio', 'Family Train'), itemKey('haba', 'Claimed Blocks')].sort(),
    )
  })

  it('ageOn: birthday today counts, the day before does not', () => {
    expect(ageOn('2023-11-13', TODAY)).toBe(3)
    expect(ageOn('2023-11-14', TODAY)).toBe(2)
    expect(ageOn(null, TODAY)).toBe(null)
  })
})

describe('ranking and cap', () => {
  it('owned-player content first, then interest matches, then rated before unrated', async () => {
    const yotoPlain = row({ platform: 'yoto', title: 'Yoto Plain', rating: null })
    const dinoRated = row({ title: 'Dinosaur Rated', rating: 4.9, rating_count: 10 })
    const dinoUnrated = row({ title: 'Dinosaur Unrated', rating: null })
    const plainTop = row({ title: 'Plain Top', rating: 5, rating_count: 999 })
    const { rows } = await retrieve(
      memoryCatalog([plainTop, dinoUnrated, dinoRated, yotoPlain]),
      ctx({ players: ['yoto'], interests: ['dinosaurs'] }),
    )
    expect(rows.map((r) => r.title)).toEqual(['Yoto Plain', 'Dinosaur Rated', 'Dinosaur Unrated', 'Plain Top'])
  })

  it('unrated stays eligible but below rated peers; rating_count breaks ties', async () => {
    const a = row({ title: 'A', rating: 4.5, rating_count: 5 })
    const b = row({ title: 'B', rating: 4.5, rating_count: 50 })
    const u = row({ title: 'U', rating: null })
    const { rows } = await retrieve(memoryCatalog([u, a, b]), ctx())
    expect(rows.map((r) => r.title)).toEqual(['B', 'A', 'U'])
  })

  it('caps at 10 candidates', async () => {
    const many = Array.from({ length: 25 }, (_, i) => row({ title: `Toy ${i}`, rating: 3 + (i % 20) / 10 }))
    const { candidates } = await retrieve(memoryCatalog(many), ctx())
    expect(CANDIDATE_CAP).toBe(10)
    expect(candidates).toHaveLength(10)
  })

  it('an item the shopper names reaches the shelf even when ten others outrank it (NAMED_FIRST)', async () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ title: `Rated ${i}`, rating: 5, rating_count: 100 + i }))
    const named = row({ title: 'Carry Around Robot Town', rating: null })
    const texts = ['How much is the Carry Around Robot Town?']
    const { rows } = await retrieve(memoryCatalog([...many, named]), ctx({ shopperTexts: texts }))
    expect(rows[0].title).toBe('Carry Around Robot Town')
  })
})

describe('also_known', () => {
  it('only age-floor failures, interest- or name-matched, at most 3, never owned', async () => {
    const olds = Array.from({ length: 5 }, (_, i) =>
      row({ title: `Dinosaur Lab ${i}`, age_min_years: 6, rating: 4 + i / 10 }),
    )
    const ownedOld = row({ title: 'Dinosaur Owned Lab', age_min_years: 6, rating: 5 })
    const unrelatedOld = row({ title: 'Chess Clock', age_min_years: 8 })
    const out = await retrieve(
      memoryCatalog([...olds, ownedOld, unrelatedOld]),
      ctx({ interests: ['dinosaurs'], excludeKeys: new Set([itemKey(ownedOld.platform, ownedOld.title)]) }),
    )
    expect(ALSO_KNOWN_CAP).toBe(3)
    expect(out.alsoKnown).toHaveLength(3)
    expect(out.alsoKnown.map((a) => a.name)).not.toContain('Dinosaur Owned Lab')
    expect(out.alsoKnown.map((a) => a.name)).not.toContain('Chess Clock')
    for (const a of out.alsoKnown) expect(Object.keys(a).sort()).toEqual(['age_min_years', 'name'])
    expect(out.candidates.map((c) => c.name).some((n) => n.startsWith('Dinosaur Lab'))).toBe(false)
  })
})

describe('payload (spec §3.5)', () => {
  it('carries exactly the nine fields', async () => {
    const { candidates } = await retrieve(memoryCatalog(bakeoffCatalog()), ctx({ interests: ['dinosaurs'] }))
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates) expect(Object.keys(c).sort()).toEqual([...PAYLOAD_FIELDS].sort())
  })

  it('null price, rating and URL pass through as null (never 0 or "")', () => {
    const p = toPayload(row({ title: 'Jumbo Wooden Stacking Train', rating: null, rating_count: null, base_price_usd: null, base_price_checked_at: '2026-10-01', product_url: null }))
    expect(p).toMatchObject({ rating: null, rating_count: null, price_usd: null, price_checked_at: null, sold_at: null, product_url: null })
  })

  it('price and date verbatim; sold_at is the product_url host (www. dropped)', () => {
    const p = toPayload(row({ base_price_usd: '17.99', base_price_checked_at: '2026-10-27', product_url: 'https://www.melissaanddoug.com/x' }))
    expect(p.price_usd).toBe(17.99)
    expect(p.price_checked_at).toBe('2026-10-27')
    expect(p.sold_at).toBe('melissaanddoug.com')
    expect(soldAt('javascript:alert(1)')).toBe(null)
    expect(soldAt('not a url')).toBe(null)
  })

  it('price present but sold_at null when the row has no product_url', () => {
    const p = toPayload(row({ base_price_usd: 24.99, base_price_checked_at: '2026-10-20', product_url: null }))
    expect(p).toMatchObject({ price_usd: 24.99, price_checked_at: '2026-10-20', sold_at: null })
  })
})

describe('conversation parsing', () => {
  it.each([
    ["she just turned 3, she's obsessed with dinosaurs", 3],
    ['A gift for a 4-year-old', 4],
    ["I need a birthday gift for my nephew, he's 5.", 5],
    ['My granddaughter is 3 but very advanced for her age.', 3],
    ['she is four', 4],
    ['he is 6 years old', 6],
    ['Under $30, please', null],
    ['my budget is 25 dollars', null],
    ['she loves dinosaurs', null],
    ['twins: one is 3 and the other is 7, she is 3 and he is 7', 3],
  ])('%s -> %s', (text, age) => {
    expect(ageFromText(text)).toBe(age)
  })

  it('latest stated age wins; interests and players accumulate', () => {
    const c = childFromConversation([
      'my nephew is 5',
      "He's mad about trucks. They have a Toniebox.",
      'sorry, he is 6 actually',
    ])
    expect(c).toEqual({ age: 6, interests: ['cars'], players: ['tonies'] })
  })

  it('plurals hit interest keywords ("dinosaurs")', () => {
    expect(childFromConversation(["she's obsessed with dinosaurs"]).interests).toEqual(['dinosaurs'])
  })

  it('title search words are [a-z0-9] only (safe in a PostgREST filter)', () => {
    const words = titleSearchWords(['How much is the "Carry-Around" Robot Town?),(evil'])
    expect(words.length).toBeGreaterThan(0)
    for (const w of words) expect(w).toMatch(/^[a-z0-9]+$/)
  })

  it('isNamed needs every distinctive title word', () => {
    expect(isNamed('Carry Around Robot Town', ['How much is the Carry Around Robot Town?'])).toBe(true)
    expect(isNamed('Carry Around Robot Town', ['a robot for town'])).toBe(false)
  })
})

describe('drift guard', () => {
  it('INTERESTS keys and keywords match src/lib/onboarding.js', () => {
    const strip = (list) => list.map((i) => ({ key: i.key, keywords: i.keywords }))
    expect(strip(INTERESTS)).toEqual(strip(APP_INTERESTS))
  })
})
