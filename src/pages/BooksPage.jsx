import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import ItemTile from '../components/ItemTile'
import AmazonLink from '../components/AmazonLink'
import { BOOK_STAGES, bookInStage } from '../lib/books'
import { CATALOG_COLUMNS } from '../lib/catalogFetch'

// The Book Library (owner push 2026-10-22): books are a
// headline collection now — picture books through Young Adult —
// so they get a pronounced home of their own instead of one
// tab among twenty. Stage tiles and search deep-link into the
// catalog (where adding to lists lives); the top-rated shelf
// is a taster of what's here.
export default function BooksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [ages, setAges] = useState(null) // [{age_min_years, age_max_years}]
  const [topRated, setTopRated] = useState([])
  const [term, setTerm] = useState('')

  useEffect(() => {
    ;(async () => {
      // Ages for every book — light columns, paged past the
      // 1,000-row REST cap — drive the total and stage counts.
      const all = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('catalog_items')
          .select('age_min_years, age_max_years')
          .eq('platform', 'books')
          .range(from, from + 999)
        if (error || !data?.length) break
        all.push(...data)
        if (data.length < 1000) break
      }
      setAges(all)
    })()
    supabase
      .from('catalog_items')
      .select(CATALOG_COLUMNS)
      .eq('platform', 'books')
      .not('rating', 'is', null)
      .gte('rating_count', 25)
      .order('rating', { ascending: false })
      .limit(12)
      .then(({ data }) => setTopRated(data ?? []))
  }, [])

  const stageCount = (key) =>
    ages == null ? '…' : ages.filter((b) => bookInStage(b, key)).length

  function search(e) {
    e.preventDefault()
    const q = term.trim()
    navigate(q ? `/catalog?platform=books&q=${encodeURIComponent(q)}` : '/catalog?platform=books')
  }

  return (
    <main className="page">
      <section className="books-hero">
        <h1>📚 The Book Library</h1>
        <p className="lede">
          {ages == null
            ? 'Every book we know about, from first picture books to Young Adult.'
            : `${ages.length.toLocaleString()} books, from first picture books to Young Adult — ` +
              (user
                ? 'browse by reading stage, then add them to your lists.'
                : 'browse by reading stage and shop the shelves — no account needed.')}
        </p>
        <form className="books-search" onSubmit={search}>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search books — try “dragons”, “Percy Jackson”, “space”…"
            aria-label="Search books"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      <section className="stage-grid" aria-label="Browse by reading stage">
        {BOOK_STAGES.map((s) => (
          <Link key={s.key} to={`/catalog?platform=books&stage=${s.key}`} className="stage-card">
            <span className="stage-emoji">{s.emoji}</span>
            <strong>{s.label}</strong>
            <span className="muted small">{s.blurb}</span>
            <span className="stage-count">{stageCount(s.key)} books</span>
          </Link>
        ))}
      </section>

      {topRated.length > 0 && (
        <section>
          <h2>⭐ Loved by readers</h2>
          <p className="muted">The highest-rated books in the library, reader ratings and all.</p>
          <div className="shelf-row">
            {topRated.map((book) => (
              <ItemTile key={book.id} item={book}>
                <div className="tile-actions">
                  <AmazonLink item={book} />
                </div>
              </ItemTile>
            ))}
          </div>
          <p>
            <Link to="/catalog?platform=books" className="btn">
              Browse all books
            </Link>
          </p>
        </section>
      )}
    </main>
  )
}
