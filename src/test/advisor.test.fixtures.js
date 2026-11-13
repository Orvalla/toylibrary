// Shared fixtures for the gift-advisor (WS7) tests.
//
// Launch copy fence: the ONLY child in these fixtures is the Emma
// Miller test child (slug "millers"). No other child names.

export const EMMA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Emma',
  birth_date: '2023-03-10', // 3 years old on 2026-11-13
  interests: ['dinosaurs'],
}
export const TODAY = new Date('2026-11-13T12:00:00Z')

let n = 0
export function row(over = {}) {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    platform: 'melissaanddoug',
    title: `Plain Toy ${n}`,
    details: '',
    item_type: 'content',
    age_min_years: 3,
    rating: null,
    rating_count: null,
    base_price_usd: null,
    base_price_checked_at: null,
    product_url: null,
    hidden: false,
    pending_review: false,
    ...over,
  }
}

// In-memory stand-in for the SQL side of retrieval (store.js):
// same filters and order (hidden/pending out, age_min not null,
// platform IN, ilike OR on title/details, rating desc nulls last,
// rating_count desc nulls last, limit).
export function memoryCatalog(rows, { ignoreAge = false } = {}) {
  const calls = []
  const query = (q, ageOk) => {
    calls.push(q)
    const hit = (text, words) => words.some((w) => String(text ?? '').toLowerCase().includes(w.toLowerCase()))
    return rows
      .filter((r) => !r.hidden && !r.pending_review && r.age_min_years != null)
      .filter((r) => ignoreAge || ageOk(Number(r.age_min_years)))
      .filter((r) => !q.platforms?.length || q.platforms.includes(r.platform))
      .filter((r) => !q.keywords?.length || hit(r.title, q.keywords) || hit(r.details, q.keywords))
      .filter((r) => !q.titleWords?.length || hit(r.title, q.titleWords))
      .sort(
        (a, b) =>
          (a.rating == null) - (b.rating == null) ||
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.rating_count ?? 0) - (a.rating_count ?? 0),
      )
      .slice(0, q.limit)
  }
  return {
    calls,
    eligible: async (q) => query(q, (min) => min <= q.age),
    olderThan: async (q) => query(q, (min) => min > q.age),
  }
}

// A small catalog shaped like the bake-off's set_a / set_b rows.
export function bakeoffCatalog() {
  return [
    row({ platform: 'yoto', title: 'Dinosaur Stomp Card', age_min_years: 3, rating: 4.8, rating_count: 120, base_price_usd: 9.99, base_price_checked_at: '2026-10-27', product_url: 'https://us.yotoplay.com/products/dino-stomp' }),
    row({ platform: 'yoto', title: 'Bedtime Songs Card', age_min_years: 2, rating: null, rating_count: null }),
    row({ platform: 'melissaanddoug', title: 'Wooden Dinosaur Puzzle', details: 'chunky dinosaur puzzle', age_min_years: 3, rating: 4.6, rating_count: 300, base_price_usd: 17.99, base_price_checked_at: '2026-10-27', product_url: 'https://www.melissaanddoug.com/products/dino-puzzle' }),
    row({ platform: 'melissaanddoug', title: 'Carry Around Robot Town', age_min_years: 3, rating: 4.1, rating_count: 12, base_price_usd: 24.99, base_price_checked_at: '2026-10-20', product_url: null }),
    row({ platform: 'brio', title: 'Jumbo Wooden Stacking Train', details: 'train', age_min_years: 2, rating: null, rating_count: null, base_price_usd: null, product_url: 'https://www.brio.us/products/stacking-train' }),
    row({ platform: 'thinkfun', title: 'Super-Fun Marble Run Master Set', age_min_years: 8, rating: 4.9, rating_count: 900, base_price_usd: 59.99, base_price_checked_at: '2026-10-27', product_url: 'https://www.thinkfun.com/marble-run' }),
    row({ platform: 'thamesandkosmos', title: 'Dinosaur Fossil Dig Lab', details: 'dinosaur science kit', age_min_years: 8, rating: 4.4, rating_count: 50 }),
    row({ platform: 'tonies', title: 'Truck Tales Tonie', details: 'trucks', age_min_years: 3, rating: null, rating_count: null }),
  ]
}
