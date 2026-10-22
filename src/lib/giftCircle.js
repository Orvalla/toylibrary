// Gift circle helpers (migration 0020): normalizing the social
// handles parents paste — bare handles, @handles and full
// profile URLs all show up — the chat links those handles open,
// and the ready-to-paste wishlist message.
//
// Why links instead of Toy Library sending the message?
// Instagram and Facebook Messenger only let an account message
// someone who has messaged it first (or tapped one of its ads /
// buttons), and only inside a limited window. There is no
// supported way for an app to DM a relative cold, so the parent
// gets the honest one-tap version: the button opens the chat
// with that person and the wishlist message is copied, ready
// to paste. Email stays the one channel that can be sent on a
// schedule (the send-occasion-reminders Edge Function).

// Pull a bare handle out of whatever the parent pasted:
// "@aunt.jen", "instagram.com/aunt.jen/", "https://m.me/auntjen"
// and plain "auntjen" all become the handle. Returns '' when
// nothing handle-shaped is in there.
export function normalizeHandle(value) {
  if (!value) return ''
  let v = String(value).trim()
  if (!v) return ''
  // Full URL (or bare domain): keep only the path.
  const urlish = v.match(/(?:instagram\.com|facebook\.com|fb\.com|m\.me|ig\.me)\/(.+)$/i)
  if (urlish) v = urlish[1]
  v = v.replace(/^m\//i, '') // ig.me/m/<handle> form
  v = v.split(/[/?#]/)[0] // first path segment only
  v = v.replace(/^@+/, '').trim()
  // Handles are letters, numbers, dots and underscores.
  return /^[\w.]+$/.test(v) ? v : ''
}

// One-tap chat links, or null when no usable handle was given.
// m.me opens a Messenger thread with that person; the
// instagram.com link opens their profile, where the Message
// button starts the DM (Instagram has no public deep link
// that opens a DM composer for an arbitrary person).
export function messengerLink(facebook) {
  const h = normalizeHandle(facebook)
  return h ? `https://m.me/${h}` : null
}

export function instagramLink(instagram) {
  const h = normalizeHandle(instagram)
  return h ? `https://instagram.com/${h}` : null
}

// The message the parent pastes into the chat: who it's from,
// whose wishlist it is, and what claiming means — in two lines,
// so it survives being forwarded.
export function giftMessage({ relativeName, ownerName, kidsLabel, link }) {
  const hi = relativeName ? `Hi ${relativeName}!` : 'Hi!'
  const from = ownerName ? ` It's ${ownerName}.` : ''
  return (
    `${hi}${from} ${kidsLabel}'s wishlist is here so nobody buys the same gift twice: ${link} ` +
    `🎁 Anything you buy, tap “I'm getting this” on the list and it's marked as taken for everyone else.`
  )
}
