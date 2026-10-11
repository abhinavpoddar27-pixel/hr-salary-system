// P2-08 — return path after a forced sign-out, and the "let a forced navigation through" flag.
//
// saveReturnTo(reason) is called by the idle timeout and by the api.js 401 handler BEFORE they
// clear the stored user. Login reads it back and returns the SAME user to the same page + query.
// Everything is wrapped in try/catch: blocked storage must never stop a sign-out.

const RETURN_KEY = 'hr_return_to'
const MAX_AGE_MS = 12 * 60 * 60 * 1000 // a return path older than 12 h is ignored

let forcedUnload = false

/** Called right before a forced `location.href = '/login'` so useDraft's beforeunload prompt
 *  does not block the sign-out (the browser dialog would keep the expired page open). */
export function allowForcedUnload() { forcedUnload = true }
export function isUnloadAllowed() { return forcedUnload }

function storedUsername() {
  try { return JSON.parse(localStorage.getItem('hr_user') || 'null')?.username || '' } catch { return '' }
}

export function saveReturnTo(reason = 'expired') {
  try {
    const { pathname, search, hash } = window.location
    if (pathname.startsWith('/login')) return
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({
      path: pathname + search + hash, user: storedUsername(), reason, at: Date.now(),
    }))
  } catch { /* storage blocked — sign-out still goes ahead */ }
}

export function readReturnTo() {
  try {
    const v = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null')
    if (!v || typeof v !== 'object') return null
    if (typeof v.at === 'number' && Date.now() - v.at > MAX_AGE_MS) return null
    return v
  } catch { return null }
}

export function clearReturnTo() {
  try { sessionStorage.removeItem(RETURN_KEY) } catch { /* ignore */ }
}

/** An in-app path only: "/x?y", never "//host", "/login", a scheme or a backslash trick. */
export function isSafePath(path) {
  if (typeof path !== 'string' || path.length > 2000) return false
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false
  if (/^\/login(?:[/?#]|$)/i.test(path)) return false
  if (/[\u0000-\u001f]/.test(path) || /^[^?#]*:\/\//.test(path)) return false
  return true
}

/** The saved path when it is safe AND was saved for this same user; otherwise null. */
export function returnPathFor(saved, username) {
  if (!saved || !isSafePath(saved.path)) return null
  if (!saved.user || !username) return null
  if (String(saved.user).trim().toLowerCase() !== String(username).trim().toLowerCase()) return null
  return saved.path
}
