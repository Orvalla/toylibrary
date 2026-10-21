import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/dashboard')
  }

  return (
    <main className="page narrow">
      <h1>Log in</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p>
        New here? <Link to="/signup">Create an account</Link> ·{' '}
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
    </main>
  )
}

export function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [childName, setChildName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    // display_name / child_name land in raw_user_meta_data, which the
    // handle_new_user trigger copies into the new profile row.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, child_name: childName } },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
    } else if (data.session) {
      navigate('/dashboard')
    } else {
      // Email confirmation is enabled on this Supabase project.
      setNotice('Check your email to confirm your account, then log in.')
    }
  }

  return (
    <main className="page narrow">
      <h1>Create your library</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          Your name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Morgan" />
        </label>
        <label>
          Child's first name
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Shown on your share page, e.g. “Alex's library”"
          />
        </label>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  )
}
