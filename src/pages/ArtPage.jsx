import { useAuth } from '../lib/auth'
import CatalogBrowser from '../components/CatalogBrowser'
import PublicCatalog from '../components/PublicCatalog'

// The Arts & Crafts page (owner-directed 2026-10-27): the truly
// pure art — paints, crayons, craft kits and sticker books —
// sequestered to its own shelf, browsed with the same tiles,
// search and add-to-my-list flow as the catalog (which rows
// qualify: lib/art's isArtRow). Art-tech stays on the STEAM
// shelf. Guests see the same page read-only, with the buy links.
export default function ArtPage() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }
  return user ? <CatalogBrowser artOnly /> : <PublicCatalog artOnly />
}
