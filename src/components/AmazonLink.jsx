import { amazonUrlFor } from '../lib/amazon'

// The "Buy on Amazon" affiliate link shown under item tiles.
// sponsored/nofollow is the disclosure search engines (and the
// affiliate programme) expect on paid links; noopener + _blank
// keeps the app open in its own tab.
export default function AmazonLink({ item }) {
  return (
    <a
      className="linklike amazon-link"
      href={amazonUrlFor(item)}
      target="_blank"
      rel="sponsored nofollow noopener"
    >
      🛒 Buy on Amazon ↗
    </a>
  )
}
