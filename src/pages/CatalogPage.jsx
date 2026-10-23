import { useAuth } from '../lib/auth'
import CatalogBrowser from '../components/CatalogBrowser'
import PublicCatalog from '../components/PublicCatalog'

// Browsable catalog of the well-known titles per platform. Parents tap
// to add instead of typing; anything already owned carries the green
// checkmark — the whole point of the app, applied at add time. The
// browser itself lives in components/CatalogBrowser so the Devices
// page can share it.
//
// Guests get the same shelves read-only (components/PublicCatalog):
// browsing and shopping never needed an account — only lists do.
export default function CatalogPage() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }
  return user ? <CatalogBrowser /> : <PublicCatalog />
}
