import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatISODate } from '../lib/occasions'

// Anonymous wishlist claiming, shared by the wishlist tiles
// and the gift cart so a gift-giver can claim from either
// place without hunting between them.
//
// How claiming works without gift-giver accounts:
//   claim_wishlist_item() returns a one-time token. We keep it
//   in localStorage (`claim:<itemId>`); its presence is how this
//   browser knows "I claimed this" and it's required to undo
//   the claim. Other visitors just see that the item is taken.
//   Claims also expire (the RPC returns `expires_at`): once it
//   passes, the share page treats the item as unclaimed again.

export const claimTokenKey = (itemId) => `claim:${itemId}`

export function useClaim(slug, item, onChanged) {
  const [mine, setMine] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    setMine(Boolean(localStorage.getItem(claimTokenKey(item.id))))
  }, [item.id, item.claimed])

  async function claim() {
    setBusy(true)
    setNote('')
    const { data, error } = await supabase.rpc('claim_wishlist_item', {
      p_slug: slug,
      p_item_id: item.id,
      p_claimer_name: name.trim(),
    })
    setBusy(false)
    if (error) {
      setNote('Something went wrong — please try again.')
      return
    }
    if (data?.ok) {
      localStorage.setItem(claimTokenKey(item.id), data.token)
      setClaiming(false)
      // Claims expire (usually the day after the child's next
      // occasion): say how long the hold lasts so it never feels
      // arbitrary when the item opens up again.
      if (data.expires_at) {
        setNote(
          `Held for you until ${formatISODate(data.expires_at)} — after that it opens up again so the list stays current.`
        )
      }
      onChanged()
    } else if (data?.reason === 'already_claimed') {
      setNote('Someone just claimed this one — refreshing the list.')
      onChanged()
    } else {
      setNote('This item is no longer available to claim.')
    }
  }

  async function unclaim() {
    const token = localStorage.getItem(claimTokenKey(item.id))
    if (!token) return
    setBusy(true)
    const { data } = await supabase.rpc('unclaim_wishlist_item', {
      p_slug: slug,
      p_item_id: item.id,
      p_token: token,
    })
    setBusy(false)
    if (data?.ok) {
      localStorage.removeItem(claimTokenKey(item.id))
      setMine(false)
      onChanged()
    } else {
      setNote("That claim couldn't be released from this browser.")
    }
  }

  return { mine, claiming, setClaiming, name, setName, busy, note, claim, unclaim }
}
