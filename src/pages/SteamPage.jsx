import { useAuth } from '../lib/auth'
import CatalogBrowser from '../components/CatalogBrowser'
import PublicCatalog from '../components/PublicCatalog'

// The STEAM page (owner-directed 2026-10-27): science,
// technology, engineering, art-tech and maths — electronics
// kits, robotics, experiments and engineering toys — browsed
// with the same tiles, search and add-to-my-list flow as the
// catalog (which rows qualify: lib/steam's isSteamRow).
// Traditional art has its own zone elsewhere. Guests see the
// same page read-only, with the buy links.
export default function SteamPage() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }
  return user ? <CatalogBrowser steamOnly /> : <PublicCatalog steamOnly />
}
