// Gift proposals, suggester side (share page) — the token
// bookkeeping that lets one browser recognise its own
// suggestions. The proposal itself, its facts and its status
// live server-side (gift_proposals + the suggest-gift
// function); all that's kept here is { id, token } pairs, the
// same pattern as claim tokens (lib/useClaim). Tokens are
// one-time secrets: the server stores only their SHA-256 hash.

export const proposalStoreKey = (slug) => `gift-proposals:${slug}`
export const suggesterNameKey = 'gift-proposals:name'

export function loadProposalTokens(slug, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(proposalStoreKey(slug))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t) => t && typeof t.id === 'string' && typeof t.token === 'string'
    )
  } catch {
    return []
  }
}

export function saveProposalTokens(slug, tokens, storage = globalThis.localStorage) {
  try {
    storage?.setItem(proposalStoreKey(slug), JSON.stringify((tokens ?? []).slice(0, 50)))
  } catch {
    // Storage full/blocked — the proposal still exists server-side.
  }
}

export function addProposalToken(slug, entry, storage = globalThis.localStorage) {
  const all = loadProposalTokens(slug, storage).filter((t) => t.id !== entry.id)
  const next = [entry, ...all]
  saveProposalTokens(slug, next, storage)
  return next
}

export function proposalStatusLabel(status) {
  switch (status) {
    case 'approved':
      return '✓ Approved — shown to all gift-givers'
    case 'denied':
      return 'Not approved this time'
    case 'withdrawn':
      return 'Withdrawn'
    default:
      return '⏳ Waiting for the parents to decide'
  }
}

// "$24.99" from a stored price + ISO currency; '' when unknown.
export function priceLabel(price, currency) {
  if (price == null || !Number.isFinite(Number(price))) return ''
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(Number(price))
  } catch {
    return `$${Number(price).toFixed(2)}`
  }
}
