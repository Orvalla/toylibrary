import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Turnstile from '../components/Turnstile'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const captchaRef = useRef(null)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    let captchaToken = ''
    try {
      captchaToken = await captchaRef.current.consume()
    } catch {
      setBusy(false)
      setError('Please complete the human check, then try again.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      ...(captchaToken ? { captchaToken } : {}),
    })
    setBusy(false)
    if (error) setError(error.message)
    // Same message whether or not the email has an account — don't leak
    // which emails are registered.
    else setMessage('If that email has an account, a reset link is on its way.')
  }

  return (
    <main className="page narrow">
      <h1>Forgot your password?</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        {message && <p className="notice">{message}</p>}
        <Turnstile ref={captchaRef} />
        <button className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </main>
  )
}

// Landing page for the email reset link. Supabase puts a recovery
// session in the URL; AuthProvider picks it up, and we just set the
// new password on that session.
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const captchaRef = useRef(null)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    let captchaToken = ''
    try {
      captchaToken = await captchaRef.current.consume()
    } catch {
      setBusy(false)
      setError('Please complete the human check, then try again.')
      return
    }
    const { error } = await supabase.auth.updateUser(
      { password },
      captchaToken ? { captchaToken } : undefined
    )
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/dashboard')
  }

  if (!ready)
    return (
      <main className="page narrow">
        <h1>Reset your password</h1>
        <p>
          This page needs a fresh reset link. <Link to="/forgot-password">Request one</Link> and
          open it from your email.
        </p>
      </main>
    )

  return (
    <main className="page narrow">
      <h1>Choose a new password</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          New password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <Turnstile ref={captchaRef} />
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </main>
  )
}

export function NotFoundPage() {
  return (
    <main className="page narrow">
      <h1>That page wandered off 🧸</h1>
      <p>The link you followed doesn't exist here.</p>
      <p>
        <Link to="/">Go home</Link>
      </p>
    </main>
  )
}
