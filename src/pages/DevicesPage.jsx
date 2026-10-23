import { useAuth } from '../lib/auth'
import CatalogBrowser from '../components/CatalogBrowser'
import PublicCatalog from '../components/PublicCatalog'

// The devices page: just the players themselves (Toniebox, Yoto
// Player, LeapPad…), browsed with the same tiles, search and
// add-to-my-list flow as the catalog — see CatalogBrowser.
// Guests see the same players read-only, with the buy links.
export default function DevicesPage() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }
  return user ? <CatalogBrowser devicesOnly /> : <PublicCatalog devicesOnly />
}
