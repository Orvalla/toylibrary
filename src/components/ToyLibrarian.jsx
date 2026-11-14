import { useEffect, useRef, useState } from 'react'
import {
  LIBRARIAN_NAME,
  MASCOT_SRC,
  MAX_SHOPPER_CHARS,
  advisorVisible,
  fetchAdvisorPublic,
  introText,
  probeAdvisor,
  replyBlocks,
  sendTurn,
  starterChips,
} from '../lib/advisorClient'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import './ToyLibrarian.css'

// The gift advisor chat (WS7, spec §5). One component, two doors:
// mode "page" on a child's gift page, mode "finder" on
// /gift-finder. No account wall; the conversation lives only in
// this component's state (nothing is stored server-side).

// Renders null until the flag says on (build flag + status probe).
export function useAdvisorEnabled(probe = probeAdvisor) {
  const [enabled, setEnabled] = useState(null) // null = checking
  useEffect(() => {
    let live = true
    probe().then((on) => live && setEnabled(Boolean(on)))
    return () => {
      live = false
    }
  }, [probe])
  return enabled
}

// Full visibility (owner ruling 2026-11-13): the probe must say
// on, and either the advisor_public feature flag is on or the
// signed-in viewer is an admin — she ships to admins first, the
// admin panel opens her to everyone. The signed-in profile is
// read the way the rest of the app reads it: useAuth() for the
// user, then the profiles row for is_admin. Anonymous viewers
// are never admins. Returns null until every input is known,
// so nobody sees a flash of the wrong door.
export function useAdvisorVisible(probe = probeAdvisor) {
  const probeOn = useAdvisorEnabled(probe)
  const auth = useAuth()
  const user = auth?.user ?? null
  const [publicOn, setPublicOn] = useState(null) // null = checking
  const [isAdmin, setIsAdmin] = useState(null) // null = checking

  useEffect(() => {
    let live = true
    fetchAdvisorPublic().then((on) => live && setPublicOn(Boolean(on)))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      return
    }
    let live = true
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data }) => live && setIsAdmin(Boolean(data?.is_admin)))
    return () => {
      live = false
    }
  }, [user])

  if (probeOn === null || publicOn === null || isAdmin === null) return null
  return advisorVisible({ probeOn, publicOn, isAdmin })
}

function Tokens({ tokens }) {
  return tokens.map((t, i) => {
    if (t.type === 'link') {
      const a = (
        <a href={t.href} target="_blank" rel="noopener noreferrer">
          {t.text}
        </a>
      )
      return t.style === 'bold' ? <strong key={i}>{a}</strong> : <span key={i}>{a}</span>
    }
    if (t.type === 'bold') return <strong key={i}>{t.text}</strong>
    if (t.type === 'italic') return <em key={i}>{t.text}</em>
    return <span key={i}>{t.text}</span>
  })
}

export function LibrarianReply({ text, candidates }) {
  return replyBlocks(text, candidates).map((b, i) =>
    b.type === 'list' ? (
      <ul key={i}>
        {b.items.map((tokens, j) => (
          <li key={j}>
            <Tokens tokens={tokens} />
          </li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        <Tokens tokens={b.tokens} />
      </p>
    ),
  )
}

export default function ToyLibrarian({ mode, slug, childId, childName, send = sendTurn }) {
  // messages: [{ role: 'user' | 'assistant', content, candidates? }]
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null) // { text, restart }
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [messages])

  // A different child means a different conversation.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [childId])

  async function ask(text) {
    const content = text.trim()
    if (!content || busy) return
    if (content.length > MAX_SHOPPER_CHARS) {
      setError({ text: `That's a long message! Could you say it in ${MAX_SHOPPER_CHARS} characters or fewer?` })
      return
    }
    const history = messages
      .filter((m) => m.content && !m.failed)
      .map((m) => ({ role: m.role, content: m.content }))
    setBusy(true)
    setError(null)
    setDraft('')
    setMessages((prev) => [...prev, { role: 'user', content }, { role: 'assistant', content: '', candidates: [] }])
    const patchLast = (fn) =>
      setMessages((prev) => {
        const next = prev.slice()
        next[next.length - 1] = fn(next[next.length - 1])
        return next
      })
    const result = await send({
      mode,
      slug,
      childId,
      history,
      text: content,
      onMeta: (candidates) => patchLast((m) => ({ ...m, candidates })),
      onDelta: (chunk) => patchLast((m) => ({ ...m, content: m.content + chunk })),
    })
    if (!result.ok) {
      // Drop the unanswered pair so the resent history stays valid.
      setMessages((prev) => prev.slice(0, -2))
      setDraft(content)
      setError({ text: result.error, restart: result.code === 'history_limit' })
    }
    setBusy(false)
  }

  function startOver() {
    setMessages([])
    setError(null)
    setDraft('')
  }

  const started = messages.length > 0

  return (
    <section className="librarian" aria-label={LIBRARIAN_NAME}>
      <header className="librarian-head">
        <img className="librarian-avatar" src={MASCOT_SRC} alt="" width="56" height="56" loading="lazy" />
        <div>
          <h3 className="librarian-name">{LIBRARIAN_NAME}</h3>
          <p className="muted small librarian-sub">Gift ideas from the Toy Library shelves</p>
        </div>
        {started && (
          <button type="button" className="btn btn-ghost librarian-reset" onClick={startOver} disabled={busy}>
            Start over
          </button>
        )}
      </header>

      <div className="librarian-log" aria-live="polite">
        <div className="librarian-bubble from-librarian">
          <p>{introText(mode, childName)}</p>
        </div>
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="librarian-bubble from-shopper">
              <p>{m.content}</p>
            </div>
          ) : (
            <div key={i} className="librarian-bubble from-librarian">
              {m.content ? (
                <LibrarianReply text={m.content} candidates={m.candidates} />
              ) : (
                <p className="muted librarian-typing">Searching my shelves…</p>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {!started && (
        <div className="librarian-chips">
          {starterChips(mode).map((chip) => (
            <button key={chip} type="button" className="librarian-chip" onClick={() => ask(chip)} disabled={busy}>
              {chip}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="librarian-error" role="alert">
          {error.text}{' '}
          {error.restart && (
            <button type="button" className="link-button" onClick={startOver}>
              Start a fresh conversation
            </button>
          )}
        </p>
      )}

      <form
        className="librarian-form"
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
      >
        <label className="sr-only" htmlFor={`librarian-input-${mode}`}>
          Message the Toy Librarian
        </label>
        <input
          id={`librarian-input-${mode}`}
          type="text"
          value={draft}
          maxLength={MAX_SHOPPER_CHARS}
          placeholder="Ask about a gift…"
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={busy || !draft.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </section>
  )
}
