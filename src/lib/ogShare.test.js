import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GENERIC,
  buildPreview,
  escapeHtml,
  joinNames,
  possessive,
  previewUrl,
  renderPreviewHtml,
  shareDescription,
  shareTitle,
} from '../../supabase/functions/og-share/preview.js'

// WS2 (2026-11-11): what a link-preview crawler receives for a
// family subdomain. og-share/index.ts does the lookups and hands
// the results to preview.js; these tests pin the card itself.
// Test family: Emma Miller / millers only.

const millers = { display_name: 'The Millers' }

// Pull one meta tag's content out of the rendered page.
const meta = (html, attr, key) => {
  const re = new RegExp(`<meta ${attr}="${key.replace(/[:]/g, '\\$&')}" content="([^"]*)"`)
  return re.exec(html)?.[1] ?? null
}

describe('og-share preview wording', () => {
  it('possessive: names ending in s take a bare apostrophe', () => {
    expect(possessive('The Millers')).toBe("The Millers'")
    expect(possessive('Emma Miller')).toBe("Emma Miller's")
    expect(possessive('  ')).toBe('')
  })

  it('joinNames reads naturally for 1, 2 and 3 names', () => {
    expect(joinNames(['Emma'])).toBe('Emma')
    expect(joinNames(['Emma', 'Leo'])).toBe('Emma and Leo')
    expect(joinNames(['Emma', 'Leo', 'Ava'])).toBe('Emma, Leo and Ava')
    expect(joinNames(['', null])).toBe('')
  })

  it('title names the family display name', () => {
    expect(shareTitle({ displayName: 'The Millers', childNames: ['Emma'] })).toBe(
      "The Millers' Toy Library — gift page"
    )
  })

  it('title falls back to the children, then to a neutral title', () => {
    expect(shareTitle({ displayName: ' ', childNames: ['Emma'] })).toBe("Emma's Toy Library — gift page")
    expect(shareTitle({ displayName: '', childNames: [] })).toBe('Toy Library — gift page')
  })

  it('description invites claiming, with and without child names', () => {
    const one = shareDescription({ childNames: ['Emma'] })
    expect(one).toBe(
      "You're invited: see what Emma is wishing for, and claim a gift so nobody buys the same one twice."
    )
    expect(shareDescription({ childNames: ['Emma', 'Leo'] })).toMatch(/Emma and Leo are wishing for/)
    expect(shareDescription({ childNames: [] })).toMatch(/^You're invited: .*claim a gift/)
  })
})

describe('og-share rendered page', () => {
  const html = renderPreviewHtml(buildPreview({ slug: 'millers', profile: millers, childNames: ['Emma'] }))

  it('carries the family title, inviting description, url and a sized image', () => {
    const title = "The Millers&#39; Toy Library — gift page"
    expect(html).toContain(`<title>${title}</title>`)
    expect(meta(html, 'property', 'og:title')).toBe(title)
    expect(meta(html, 'name', 'twitter:title')).toBe(title)
    expect(meta(html, 'property', 'og:description')).toMatch(/^You&#39;re invited: see what Emma is wishing for/)
    expect(meta(html, 'property', 'og:url')).toBe('https://millers.toylibrary.store/')
    expect(meta(html, 'property', 'og:image')).toBe('https://toylibrary.store/og.png')
    expect(meta(html, 'property', 'og:image:width')).toBe('1200')
    expect(meta(html, 'property', 'og:image:height')).toBe('630')
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image')
  })

  it('the image it points at ships in public/ at the advertised size', () => {
    const png = readFileSync(resolve(__dirname, '../../public/og.png'))
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })

  it('an unknown or sharing-off family gets the generic card (no hint it exists)', () => {
    const p = buildPreview({ slug: 'millers', profile: null, childNames: [] })
    expect(p.title).toBe(GENERIC.title)
    expect(p.description).toBe(GENERIC.description)
  })

  it('a malformed slug never lands in the url; markup in names is escaped', () => {
    expect(previewUrl('bad slug"><x')).toBe('https://toylibrary.store/')
    expect(previewUrl('')).toBe('https://toylibrary.store/')
    const evil = renderPreviewHtml(
      buildPreview({ slug: 'millers', profile: { display_name: '<b>"Millers"</b>' }, childNames: ['<i>'] })
    )
    expect(evil).not.toMatch(/<b>|<i>/)
    expect(escapeHtml(`<&"'>`)).toBe('&lt;&amp;&quot;&#39;&gt;')
  })
})

// nginx.conf decides who gets og-share instead of the app. Parse the
// real map regex so the list in the shipped config is what's tested.
describe('nginx crawler routing', () => {
  const conf = readFileSync(resolve(__dirname, '../../nginx.conf'), 'utf8')
  const m = /map \$http_user_agent \$tl_crawler \{[^}]*~\*\(([^)]+)\) 1;/.exec(conf)
  const crawler = new RegExp(`(${m?.[1]})`, 'i')

  it.each([
    ['iMessage', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0'],
    ['Messenger/Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['Teams/Skype', 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5'],
  ])('%s preview fetches get the family card', (_label, ua) => {
    expect(m).not.toBeNull()
    expect(crawler.test(ua)).toBe(true)
  })

  it('a phone browser gets the app, not the preview page', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    const android =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(crawler.test(iphone)).toBe(false)
    expect(crawler.test(android)).toBe(false)
  })

  it('the slug header comes from the subdomain label only', () => {
    expect(conf).toMatch(/~\^\(\?<fam>\[a-z0-9-\]\+\)\\\.toylibrary\\\.store\$ \$fam;/)
    expect(conf).toMatch(/proxy_set_header X-Family-Slug \$tl_famslug;/)
  })
})
