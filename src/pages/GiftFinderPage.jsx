import ToyLibrarian, { useAdvisorEnabled } from '../components/ToyLibrarian'
import { probeAdvisor } from '../lib/advisorClient'
import { NotFoundPage } from './PasswordPages'

// toylibrary.store/gift-finder: the apex door to the Toy Librarian
// (WS7 spec §1, finder mode). The shopper describes the child in
// conversation; no account, no stored profile. While
// advisor_enabled is off the route is a plain 404 page (spec §8).

export default function GiftFinderPage({ probe = probeAdvisor, send }) {
  const enabled = useAdvisorEnabled(probe)
  if (enabled === null) return null
  if (!enabled) return <NotFoundPage />
  return (
    <main className="page narrow">
      <h1>Find a gift</h1>
      <p className="muted">
        Tell the Toy Librarian about the child you're shopping for. She only suggests what's on
        the Toy Library shelves, fit for the child's age.
      </p>
      <ToyLibrarian mode="finder" {...(send ? { send } : {})} />
    </main>
  )
}
