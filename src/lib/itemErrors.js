// Errors from inserting into public.items that the UI words specially.
//
// Migration 0057 rejects a WISHLIST insert when the same title is
// already on that child's HAVE list (otherwise a grandparent could
// claim a gift the child owns — the one thing this app exists to
// prevent). It raises SQLSTATE 23505 with the message 'already_owned',
// so older code paths that only look at the code still show a sensible
// "already on that list" line; these helpers give the precise one.

export function isAlreadyOwned(error) {
  return Boolean(error?.message && String(error.message).includes('already_owned'))
}

export function alreadyOwnedMessage(title) {
  return `“${title}” is already on the have list for that child — no need to put it on the wishlist.`
}
