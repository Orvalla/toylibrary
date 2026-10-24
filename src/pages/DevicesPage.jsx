import { useAuth } from '../lib/auth'
import CatalogBrowser from '../components/CatalogBrowser'
import PublicCatalog from '../components/PublicCatalog'

// The devices page: the players themselves (Toniebox, Yoto
// Player, LeapPad…) plus every storybook-projector bundle —
// the Dream Machine's story collections and starter packs —
// browsed with the same tiles, search and add-to-my-list flow
// as the catalog (which rows qualify: lib/projector's
// isDevicesPageRow). Guests see the same page read-only, with
// the buy links.
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
