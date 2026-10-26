import { describe, expect, it } from 'vitest'
import { extractJudgemeRating, extractStoreRating } from './store-rating-extractors.mjs'

// Fixtures modelled on the live mudpuppy.com pages sampled in
// hidden_files/completeness/ratings-build/JUDGEME-PROBE.md
// (Bookish Cats 4.98/45, Artsy Cats 5.00/51, Andy Warhol
// Coloring Book 3.00/1, shop aggregate 4.93/2567).

const SHOP_CONTAINER =
  `<div id="judgeme_product_reviews" class="jdgm-widget jdgm-review-widget" ` +
  `data-product-id="4647271399512" data-shop-average-rating="4.93" ` +
  `data-shop-review-count="2567">`

describe('extractJudgemeRating (Mudpuppy / Judge.me)', () => {
  it('reads the jdgm-prev-badge pair (single-quoted attributes)', () => {
    const html =
      SHOP_CONTAINER +
      `<div style='display:none' class='jdgm-prev-badge' data-average-rating='4.98' ` +
      `data-number-of-reviews='45' data-number-of-questions='0'>` +
      `<span class='jdgm-prev-badge__stars'></span>` +
      `<span class='jdgm-prev-badge__text'>45 reviews</span></div></div>`
    // ratingPair rounds to one decimal — the module convention.
    expect(extractJudgemeRating(html)).toEqual({ rating: 5, rating_count: 45, extractor: 'judgeme-badge' })
  })

  it('falls back to the jdgm-rev-widg pair when no badge renders', () => {
    const html =
      SHOP_CONTAINER +
      `<div class='jdgm-rev-widg' data-average-rating='5.00' data-number-of-reviews='51'>` +
      `<div class='jdgm-rev-widg__header'></div></div></div>`
    expect(extractJudgemeRating(html)).toEqual({ rating: 5, rating_count: 51, extractor: 'judgeme-widget' })
  })

  it('prefers the badge when both carriers render', () => {
    const html =
      `<div class='jdgm-rev-widg' data-average-rating='3.00' data-number-of-reviews='1'></div>` +
      `<div class='jdgm-prev-badge' data-average-rating='4.98' data-number-of-reviews='45'></div>`
    expect(extractJudgemeRating(html)).toEqual({ rating: 5, rating_count: 45, extractor: 'judgeme-badge' })
  })

  it('never reads the shop-wide aggregate on the widget container', () => {
    // Container + an empty reviews body: the only numbers on
    // the page are the shop's, and they must not surface.
    const html = SHOP_CONTAINER + `<div class='jdgm-rev-widg__body'></div></div>`
    expect(extractJudgemeRating(html)).toBeNull()
  })

  it('returns null for a zero-review product (no aggregate divs at all)', () => {
    const html = SHOP_CONTAINER + `</div>`
    expect(extractJudgemeRating(html)).toBeNull()
  })

  it('surfaces an explicit 0/0 badge as an honest zero pair', () => {
    const html = `<div class='jdgm-prev-badge' data-average-rating='0.00' data-number-of-reviews='0'></div>`
    expect(extractJudgemeRating(html)).toEqual({ rating: 0, rating_count: 0, extractor: 'judgeme-badge' })
  })

  it('keeps a low-count pair (a rating only ever travels with its count)', () => {
    const html = `<div class='jdgm-prev-badge' data-average-rating='3.00' data-number-of-reviews='1'></div>`
    expect(extractJudgemeRating(html)).toEqual({ rating: 3, rating_count: 1, extractor: 'judgeme-badge' })
  })

  it('matches the class as a whole token, not a prefix', () => {
    const html = `<div class='jdgm-prev-badge__stars' data-average-rating='1.00' data-number-of-reviews='99'></div>`
    expect(extractJudgemeRating(html)).toBeNull()
  })

  it('still matches when the badge carries extra classes', () => {
    const html = `<div class="jdgm-prev-badge jdgm--hidden" data-average-rating="4.50" data-number-of-reviews="7"></div>`
    expect(extractJudgemeRating(html)).toEqual({ rating: 4.5, rating_count: 7, extractor: 'judgeme-badge' })
  })

  it('returns null on empty input', () => {
    expect(extractJudgemeRating('')).toBeNull()
    expect(extractJudgemeRating(null)).toBeNull()
  })
})

describe('extractStoreRating dispatch', () => {
  const badgeHtml = `<div class='jdgm-prev-badge' data-average-rating='4.98' data-number-of-reviews='45'></div>`

  it('routes platform mudpuppy to the Judge.me extractor', () => {
    expect(
      extractStoreRating('mudpuppy', 'https://www.mudpuppy.com/products/bookish-cats-500-piece-family-puzzle', badgeHtml),
    ).toEqual({ rating: 5, rating_count: 45, extractor: 'judgeme-badge' })
  })

  it('does not leak the Judge.me route to other platforms', () => {
    expect(extractStoreRating('osmo', 'https://www.playosmo.com/products/x', badgeHtml)).toBeNull()
  })

  it('returns null on missing html', () => {
    expect(extractStoreRating('mudpuppy', 'https://www.mudpuppy.com/products/x', null)).toBeNull()
  })
})
