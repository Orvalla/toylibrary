import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Where the unsubscribe link in a wishlist email lands. Two
// kinds of recipients share this page: gift-circle relatives
// (migration 0020) and gift-list subscribers (migration 0034).
// Neither has an account — the token in the link is the
// credential; each kind has its own RPC, and the tokens are
// distinct, so we try both.
export default function UnsubscribePage() {
  const [params] = useSearchParams()
  const [state, setState] = useState('working') // working | done | invalid

  useEffect(() => {
    const token = params.get('t')
    if (!token) {
      setState('invalid')
      return
    }
    let live = true
    ;(async () => {
      const rel = await supabase.rpc('unsubscribe_relative', { p_token: token })
      if (!live) return
      if (!rel.error && rel.data) {
        setState('done')
        return
      }
      const sub = await supabase.rpc('unsubscribe_gift_subscriber', { p_token: token })
      if (live) setState(!sub.error && sub.data ? 'done' : 'invalid')
    })()
    return () => {
      live = false
    }
  }, [params])

  return (
    <main className="page narrow">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Wishlist emails</h2>
        {state === 'working' && <p>One moment…</p>}
        {state === 'done' && (
          <>
            <p>
              You're unsubscribed. You won't get any more wishlist emails
              from Toy Library.
            </p>
            <p className="notes">
              The family's wishlist page itself still works — you can open it
              any time from a link they send you.
            </p>
          </>
        )}
        {state === 'invalid' && (
          <>
            <p>That unsubscribe link didn't work — it may have been copied incompletely.</p>
            <p className="notes">
              The link in the most recent email will work, or just reply to
              that email and ask to be taken off the list.
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
