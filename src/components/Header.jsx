import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'

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
            <Link to="/catalog">Catalog</Link>
            <Link to="/books">Books</Link>
            <Link to="/devices">Devices</Link>
            <Link to="/settings">Settings</Link>
            <button className="linklike" onClick={() => supabase.auth.signOut()}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/catalog">Catalog</Link>
            <Link to="/books">Books</Link>
            <Link to="/devices">Devices</Link>
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
