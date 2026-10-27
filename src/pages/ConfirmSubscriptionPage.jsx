import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Where the confirm link in the double opt-in email lands
// (migration 0058). The token in the link is the credential;
// confirm_gift_subscriber is idempotent, so opening the link twice
// is harmless.
export default function ConfirmSubscriptionPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState('working') // working | done | invalid

  useEffect(() => {
    const token = params.get('t')
    if (!token) {
      setState('invalid')
      return
    }
    let live = true
    supabase.rpc('confirm_gift_subscriber', { p_token: token }).then(({ data, error }) => {
      if (live) setState(!error && data ? 'done' : 'invalid')
    })
    return () => {
      live = false
    }
  }, [params])

  return (
    <main className="page narrow">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Wishlist reminders</h2>
        {state === 'working' && <p>One moment…</p>}
        {state === 'done' && (
          <p>
            You're confirmed. We'll email you a heads-up before the big days — with the
            wishlist link — and every email has a one-click unsubscribe.
          </p>
        )}
        {state === 'invalid' && (
          <>
            <p>That confirmation link didn't work — it may have been copied incompletely.</p>
            <p className="notes">
              Open the wishlist page again and tap “Remind me” to get a fresh confirmation email.
            </p>
          </>
        )}
        <p>
          <Link to="/">Back to Toy Library</Link>
        </p>
      </div>
    </main>
  )
}
