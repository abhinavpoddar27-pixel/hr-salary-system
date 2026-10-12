// P2-02 (X-17): one API failure → one error toast.
//
// The axios interceptor in api.js toasts every non-401 error, and most pages ALSO toast in their onError /
// catch. Without this module that is two toasts per failure (plus a third copy when react-query retries a
// failing query). Pages are not edited; instead:
//   * the interceptor calls apiErrorToast(msg): the toast gets the id `api-error:<msg>`, so a repeat of the
//     same failure (query retry, a burst) updates that toast instead of adding one;
//   * toast.error is wrapped once: a call WITHOUT its own id, made within CLAIM_WINDOW_MS of the last API
//     error toast that nobody claimed yet, reuses that toast's id → the page's text replaces the
//     interceptor's text in the SAME toast (page text wins — planner ruling Q1). The claim is one-shot.
//   * calls with their own id, and calls outside the window, behave exactly as before.
import toast from 'react-hot-toast'

export const CLAIM_WINDOW_MS = 1500

// State lives on the toast object, not in module variables, so a second copy of this module (Vite HMR in dev)
// shares it with the wrapper that is already installed.
const state = toast.__p202State || (toast.__p202State = {
  last: null,                                   // { id, at } — the newest unclaimed API error toast
  now: () => Date.now(),
  originalError: toast.error,                   // react-hot-toast's own toast.error
})

export function apiErrorToast(msg) {
  const id = `api-error:${msg}`
  state.originalError(msg, { id })
  state.last = { id, at: state.now() }
  return id
}

export function installToastDedup() {
  if (toast.error && toast.error.__p202Dedup) return
  const wrapped = (message, opts) => {
    const last = state.last
    if (!(opts && opts.id) && last && state.now() - last.at <= CLAIM_WINDOW_MS) {
      state.last = null
      return state.originalError(message, { ...(opts || {}), id: last.id })
    }
    return state.originalError(message, opts)
  }
  wrapped.__p202Dedup = true
  toast.error = wrapped
}

// Test hook only (backend/scripts/toast-dedup-unit-check.mjs).
export function __resetToastDedupForTest(clock) {
  state.last = null
  if (clock) state.now = clock
}

installToastDedup()
