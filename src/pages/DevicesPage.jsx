import CatalogBrowser from '../components/CatalogBrowser'

// The devices page: just the players themselves (Toniebox, Yoto
// Player, LeapPad…), browsed with the same tiles, search and
// add-to-my-list flow as the catalog — see CatalogBrowser.
export default function DevicesPage() {
  return <CatalogBrowser devicesOnly />
}
