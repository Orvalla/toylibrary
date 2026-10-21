import CatalogBrowser from '../components/CatalogBrowser'

// Browsable catalog of the well-known titles per platform. Parents tap
// to add instead of typing; anything already owned carries the green
// checkmark — the whole point of the app, applied at add time. The
// browser itself lives in components/CatalogBrowser so the Devices
// page can share it.
export default function CatalogPage() {
  return <CatalogBrowser />
}
