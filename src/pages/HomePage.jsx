import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { PLATFORMS } from '../lib/platforms'
import PlatformMark from '../components/PlatformMark'
import Ethos from '../components/Ethos'

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

      <section className="ethos-band">
        <h2>Why we built it this way</h2>
        <Ethos />
      </section>

      <div className="brand-strip" aria-label="Platforms Toy Library tracks">
        <span className="brand-strip-label">One library for all of them:</span>
        {PLATFORMS.filter((p) => p.key !== 'other').map((p) => (
          <span key={p.key} className="brand-strip-item" title={p.label}>
            <PlatformMark platform={p.key} /> {p.label.split(' / ')[0]}
          </span>
        ))}
      </div>

      <section className="books-hero home-books">
        <h2>📚 Now with a proper book library</h2>
        <p>
          Thousands of books from first picture books through middle grade to
          Young Adult — browse by reading stage, see what's already on your
          shelves, and let family gift the next volume instead of a second
          copy of the first.
        </p>
        <Link to="/books" className="btn">
          Explore the Book Library
        </Link>
      </section>

      <section className="books-hero home-books">
        <h2>🧪 And a STEAM shelf of its own</h2>
        <p>
          Electronics kits, coding robots, experiments and engineering sets
          from dozens of makers — Snap Circuits to Arduino, Cubelets to
          Thames &amp; Kosmos — gathered on one shelf so the next project is
          easy to find and gift.
        </p>
        <Link to="/steam" className="btn">
          Explore STEAM Toys
        </Link>
      </section>

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
        <div className="card">
          <h3>📸 Add from a photo</h3>
          <p>Snap a bookshelf or a game closet — the scan reads what's there and checks it off against your lists.</p>
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
