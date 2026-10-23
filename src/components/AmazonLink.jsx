import { amazonUrlFor } from '../lib/amazon'
import { usedBookLinksFor } from '../lib/bookSellers'

// The "Buy on Amazon" affiliate link shown under item tiles.
// sponsored/nofollow is the disclosure search engines (and the
// affiliate programme) expect on paid links; noopener + _blank
// keeps the app open in its own tab.
//
// Book tiles also get a "Used copies" line (lib/bookSellers.js):
// reputable used-book sellers, so a parent can pick a second-life
// copy over a new spine. Those links are plain — no affiliate
// relationship — so they keep rel="noopener" only.
export default function AmazonLink({ item }) {
  const used = usedBookLinksFor(item)
  return (
    <>
      <a
        className="linklike amazon-link"
        href={amazonUrlFor(item)}
        target="_blank"
        rel="sponsored nofollow noopener"
      >
        🛒 Buy on Amazon ↗
      </a>
      {used.length > 0 && (
        <span className="used-links">
          ♻️ Used copies:{' '}
          {used.map((s, i) => (
            <span key={s.key}>
              {i > 0 && ' · '}
              <a href={s.href} target="_blank" rel="noopener">
                {s.label} ↗
              </a>
            </span>
          ))}
        </span>
      )}
    </>
  )
}
