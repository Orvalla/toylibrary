// localStorage that never throws.
//
// Safari private mode, "block all cookies", some in-app browsers and
// full quotas all make localStorage access throw. On the gift page
// that used to blank the whole screen (an unguarded getItem inside an
// effect) or lose a claim's undo token right after the claim
// succeeded. These wrappers turn every failure into a plain
// "nothing stored" so the page keeps working.

export function safeGet(key, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

// Returns true when the value was actually stored.
export function safeSet(key, value, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemove(key, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
