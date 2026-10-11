import React, { useState, useEffect, useRef, useCallback } from 'react'
import { isUnloadAllowed } from '../utils/sessionReturn'

/**
 * P2-08 — keep a half-typed form across navigation, refresh and the session-timeout re-login.
 *
 *   const draft = useDraft('ed-bulk', { rows: [] })
 *   draft.value / draft.setValue(v | fn)
 *   <DraftRestoredBanner draft={draft} />      // "Draft restored · Discard"
 *   after a successful save: draft.markSaved() // or draft.clear() to also reset the value
 *
 * - JSON in sessionStorage under `hr_draft:<username>:<key>` (per tab; another user signing in
 *   on the same tab does not see it). Every storage access is try/catch: blocked storage → the
 *   hook still works, in memory only.
 * - The key must stay the same for the component's lifetime (remount with a React `key` to switch).
 * - `beforeunload` ("Leave site?") is registered only while dirty, and is skipped when a forced
 *   sign-out called allowForcedUnload() (utils/sessionReturn) — otherwise it would block it.
 * - A value equal to the starting value is not stored (and removes any stored draft).
 * Not used by any page yet (P3-01 bulk panels adopt it).
 */
const PREFIX = 'hr_draft:'

function currentUser() {
  try { return JSON.parse(localStorage.getItem('hr_user') || 'null')?.username || '' } catch { return '' }
}
export function draftStorageKey(key, userScoped = true) {
  return PREFIX + (userScoped ? `${currentUser() || 'anon'}:` : '') + key
}
function readDraft(k) {
  try {
    const raw = sessionStorage.getItem(k)
    if (raw == null) return null
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || !('v' in p)) return null
    return { value: p.v, savedAt: typeof p.t === 'number' ? p.t : null }
  } catch { return null }
}
function writeDraft(k, v) {
  try { sessionStorage.setItem(k, JSON.stringify({ v, t: Date.now() })) } catch { /* blocked / full */ }
}
function removeDraft(k) {
  try { sessionStorage.removeItem(k) } catch { /* ignore */ }
}
function toJson(v) {
  try { return JSON.stringify(v) } catch { return undefined }
}

export default function useDraft(key, initialValue, { userScoped = true, debounceMs = 300 } = {}) {
  const storageKeyRef = useRef(null)
  if (storageKeyRef.current === null) storageKeyRef.current = draftStorageKey(key, userScoped)
  const initialJsonRef = useRef(toJson(initialValue))
  const initialRef = useRef(initialValue)

  const [boot] = useState(() => {
    const d = readDraft(storageKeyRef.current)
    if (d && toJson(d.value) !== initialJsonRef.current) return { value: d.value, restored: true, savedAt: d.savedAt }
    return { value: initialValue, restored: false, savedAt: null }
  })
  const [value, setValueState] = useState(boot.value)
  const [restored, setRestored] = useState(boot.restored)
  const [baselineJson, setBaselineJson] = useState(initialJsonRef.current)

  const valueRef = useRef(value)
  valueRef.current = value
  const valueJson = toJson(value)
  const dirty = valueJson !== baselineJson

  // Debounced write; `pending` lets beforeunload / unmount flush the latest value at once.
  const pendingRef = useRef(null)
  const timerRef = useRef(null)
  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const p = pendingRef.current
    pendingRef.current = null
    if (!p) return
    if (p.remove) removeDraft(storageKeyRef.current)
    else writeDraft(storageKeyRef.current, p.value)
  }, [])

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return } // nothing changed yet
    pendingRef.current = (dirty && valueJson !== initialJsonRef.current) ? { value } : { remove: true }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, debounceMs)
  }, [valueJson]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => flush(), [flush]) // unmount: keep the last keystrokes

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (e) => {
      flush()
      if (isUnloadAllowed()) return undefined
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    const onPageHide = () => flush()
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [dirty, flush])

  const setValue = useCallback((next) => {
    setValueState(prev => (typeof next === 'function' ? next(prev) : next))
  }, [])

  const forget = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    pendingRef.current = null
    removeDraft(storageKeyRef.current)
  }, [])

  /** Throw the draft away: back to the starting value. */
  const discard = useCallback(() => {
    forget()
    setValueState(initialRef.current)
    setBaselineJson(initialJsonRef.current)
    setRestored(false)
  }, [forget])

  /** After a successful save: keep what is on screen, but it is no longer a draft. */
  const markSaved = useCallback(() => {
    forget()
    setBaselineJson(toJson(valueRef.current))
    setRestored(false)
  }, [forget])

  /** After a successful save that also resets the form. */
  const clear = discard

  /** Hide the "Draft restored" banner but keep the draft. */
  const acknowledge = useCallback(() => setRestored(false), [])

  return { value, setValue, dirty, restored, savedAt: boot.savedAt, discard, clear, markSaved, acknowledge }
}

/** "Draft restored · Discard" — renders nothing unless the draft was restored on mount. */
export function DraftRestoredBanner({ draft, className = '' }) {
  if (!draft?.restored) return null
  const h = React.createElement
  const when = draft.savedAt
    ? ` from ${new Date(draft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : ''
  return h('div', {
    role: 'status',
    'data-testid': 'draft-restored-banner',
    className: `flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 ${className}`,
  },
  h('span', null, `Draft restored${when}`),
  h('span', { 'aria-hidden': 'true' }, '·'),
  h('button', { type: 'button', onClick: draft.discard, className: 'font-medium underline hover:no-underline' }, 'Discard'),
  h('button', {
    type: 'button', onClick: draft.acknowledge, 'aria-label': 'Keep draft and hide this message',
    className: 'ml-auto text-blue-500 hover:text-blue-700',
  }, '✕'))
}
