// Gift-buyer email signups on the public list (migration 0034).
// The parent chooses the reach in Settings: per-child signups
// (the visitor picks a child; the default) or family scope (one
// signup covers every child's occasions). The RPC snapshots the
// scope at signup time; these helpers just shape the call and
// translate its answer codes into visitor-facing words.

export function subscribePayload({ slug, email, familyScope, childId }) {
  return {
    p_slug: slug,
    p_email: (email ?? '').trim(),
    // Family-scope signups bind to the family, not a child.
    p_child_id: familyScope ? null : childId ?? null,
  }
}

export function subscribeResultMessage(code, { familyScope, childName } = {}) {
  switch (code) {
    case 'ok':
      return familyScope
        ? "You're in! We'll email you before each child's birthday and holidays — wishlist link included."
        : `You're in! We'll email you before ${childName ? `${childName}'s` : "the child's"} birthday and holidays — wishlist link included.`
    case 'bad_email':
      return "That email doesn't look quite right — check it and try again."
    case 'child_required':
      return 'Pick a child to get reminders for, then try again.'
    default:
      return "That didn't work — the list may not be available right now."
  }
}

// Which child a per-child signup starts on: the first child on
// the page. (The visitor can change it in the picker.)
export function defaultChildId(kids) {
  return kids?.length ? kids[0].id : null
}
