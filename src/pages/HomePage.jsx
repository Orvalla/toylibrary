import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function HomePage() {
  const { user } = useAuth()

  return (
    <main className="page narrow">
      <img src="/logo.svg" alt="Toy Library logo" className="hero-logo" />
      <h1>Never gift the same Tonie twice.</h1>
      <p className="lede">
        Toniebox figures, LeapPad books, storybook projector cartridges — kids'
        story toys are wonderful gifts, which is exactly why grandparents,
        aunts and uncles keep buying the same ones twice.
      </p>
      <p>
        Toy Library keeps one simple list of what your child <em>already has</em>,
        plus a wishlist of what's actually wanted. Share a single link before
        birthdays and holidays, and gift-givers can check it in ten seconds —
        no account needed on their end.
      </p>

      <div className="card-grid">
        <div className="card">
          <h3>📚 Track what you have</h3>
          <p>Log every figure, book and cartridge as it arrives, by platform.</p>
        </div>
        <div className="card">
          <h3>⭐ Keep a wishlist</h3>
          <p>Note what's wanted next, so "what should we get?" has an answer.</p>
        </div>
        <div className="card">
          <h3>🔗 Share one link</h3>
          <p>Family sees the lists read-only. The duplicate check is built in — the database itself refuses the same title twice.</p>
        </div>
      </div>

      {user ? (
        <Link to="/dashboard" className="btn">
          Go to my lists
        </Link>
      ) : (
        <Link to="/signup" className="btn">
          Create your library
        </Link>
      )}
    </main>
  )
}
