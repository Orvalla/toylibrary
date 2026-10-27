import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'

// The whole catalog family under one header entry: everything,
// the Book Library, the board-games shelf, the devices page, the
// STEAM shelf and the Arts & Crafts shelf. (The separate
// top-level links crowded the header out as the shelves grew.)
const CATALOG_ITEMS = [
  { to: '/catalog', label: 'All', emoji: '🛍️', match: (p, s) => p === '/catalog' && !s.includes('kind=') },
  { to: '/books', label: 'Books', emoji: '📚', match: (p) => p === '/books' },
  { to: '/catalog?kind=games', label: 'Board games', emoji: '🎲', match: (p, s) => p === '/catalog' && s.includes('kind=games') },
  { to: '/devices', label: 'Devices', emoji: '🕹️', match: (p) => p === '/devices' },
  { to: '/steam', label: 'STEAM Toys', emoji: '🧪', match: (p) => p === '/steam' },
  { to: '/art', label: 'Arts & Crafts', emoji: '🎨', match: (p) => p === '/art' },
]

function CatalogMenu() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const wrapRef = useRef(null)
  const onCatalogPage = CATALOG_ITEMS.some((i) => i.match(location.pathname, location.search))

  // Navigating (including picking an item) closes the menu.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open ])

  return (
    <span className="nav-menu" ref={wrapRef}>
      <button
        className={onCatalogPage ? 'nav-menu-btn active' : 'nav-menu-btn'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Catalog <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <span className="nav-menu-panel" role="menu">
          {CATALOG_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              className={
                item.match(location.pathname, location.search)
                  ? 'nav-menu-item active'
                  : 'nav-menu-item'
              }
            >
              <span aria-hidden="true">{item.emoji}</span> {item.label}
            </Link>
          ))}
        </span>
      )}
    </span>
  )
}

export default function Header() {
  const { user } = useAuth()

  return (
    <header className="header">
      <Link to="/" className="logo">
        <img src="/logo.svg" alt="" className="logo-mark" />
        Toy Library
      </Link>
      <nav>
        {user ? (
          <>
            <Link to="/dashboard">My lists</Link>
            <CatalogMenu />
            <Link to="/settings">Settings</Link>
            <button className="linklike" onClick={() => supabase.auth.signOut()}>
              Log out
            </button>
          </>
        ) : (
          <>
            <CatalogMenu />
            <Link to="/login">Log in</Link>
            <Link to="/signup" className="btn btn-small">
              Sign up free
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}
