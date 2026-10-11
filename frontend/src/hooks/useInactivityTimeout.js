import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppStore } from '../store/appStore'
import api from '../utils/api'
import { saveReturnTo, allowForcedUnload } from '../utils/sessionReturn'

// P2-08: the warning is a modal countdown (SessionTimeoutDialog, rendered by InactivityGuard in
// App.jsx) instead of a toast. On a forced sign-out the page + query is saved (utils/sessionReturn)
// and Login brings the same user back to it.
const DEFAULT_LIMIT = 15 * 60 * 1000       // 15 minutes — auto-logout
const DEFAULT_WARN = 2 * 60 * 1000         // countdown shown for the last 2 minutes
const HEARTBEAT_INTERVAL = 5 * 60 * 1000   // Send heartbeat every 5 min if active
const TICK_MS = 1000
const SHARED_KEY = 'hr_last_activity'       // last activity in ANY tab (ruling Q2)
const SHARE_THROTTLE_MS = 5000
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

// TEST KNOB (documented in docs/ux-bulk/prs/P2-08/PLAN.md): localStorage `hr_idle_test_ms` and
// `hr_idle_test_warn_ms` can only SHORTEN the timeout (limit 5 s … 15 min; warning 2 s … limit − 1 s).
// Used by backend/scripts/session-timeout-check.py; harmless in production.
function readLimits() {
  let limit = DEFAULT_LIMIT
  let warn = DEFAULT_WARN
  try {
    const l = Number(localStorage.getItem('hr_idle_test_ms'))
    if (Number.isFinite(l) && l > 0) limit = Math.min(DEFAULT_LIMIT, Math.max(5000, l))
    const w = Number(localStorage.getItem('hr_idle_test_warn_ms'))
    if (Number.isFinite(w) && w > 0) warn = Math.max(2000, w)
  } catch { /* storage blocked → defaults */ }
  warn = Math.min(warn, limit - 1000)
  return { limit, warn }
}

function readShared() {
  try { const v = Number(localStorage.getItem(SHARED_KEY)); return Number.isFinite(v) ? v : 0 } catch { return 0 }
}
function writeShared(t) {
  try { localStorage.setItem(SHARED_KEY, String(t)) } catch { /* ignore */ }
}

export default function useInactivityTimeout() {
  const { isAuthenticated, clearAuth, token } = useAppStore()
  const lastActivityRef = useRef(Date.now())
  const lastSharedWriteRef = useRef(0)
  const warningOpenRef = useRef(false)
  const loggingOutRef = useRef(false)
  const heartbeatTimerRef = useRef(null)
  const [warningOpen, setWarningOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const markActive = useCallback((force = false) => {
    const now = Date.now()
    lastActivityRef.current = now
    if (force || now - lastSharedWriteRef.current >= SHARE_THROTTLE_MS) {
      lastSharedWriteRef.current = now
      writeShared(now)
    }
  }, [])

  const doLogout = useCallback((reason) => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    saveReturnTo(reason)      // before clearAuth: it reads the stored username
    allowForcedUnload()
    clearAuth()
    // Hard reload on purpose: it drops the old session's in-memory data (react-query cache).
    window.location.href = '/login'
  }, [clearAuth])

  const sendHeartbeat = useCallback(async () => {
    if (!token) return
    try {
      const res = await api.post('/auth/heartbeat')
      if (res.data?.token) {
        // Update stored token with refreshed one
        localStorage.setItem('hr_token', res.data.token)
        // Update cookie is handled by the backend httpOnly cookie
      }
    } catch (e) {
      // If heartbeat fails with 401, token expired server-side. The api.js 401 handler has already
      // saved the return path and started the redirect — a second location change would abort it.
      if (e.response?.status === 401) {
        loggingOutRef.current = true
      }
    }
  }, [token])

  const staySignedIn = useCallback(() => {
    markActive(true)
    warningOpenRef.current = false
    setWarningOpen(false)
    sendHeartbeat()
  }, [markActive, sendHeartbeat])

  const signOutNow = useCallback(() => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    api.post('/auth/logout').catch(() => {}).finally(() => {
      allowForcedUnload() // the user chose to leave
      clearAuth()
      window.location.href = '/login'
    })
  }, [clearAuth])

  useEffect(() => {
    if (!isAuthenticated) return
    const { limit, warn } = readLimits()
    loggingOutRef.current = false
    markActive(true)

    // While the countdown shows, passive movement does NOT keep the session (ruling Q1):
    // only "Stay signed in" does. Activity in another tab still does (shared timestamp, Q2).
    const handleActivity = () => {
      if (warningOpenRef.current) return
      markActive(false)
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true })
    }

    const tick = () => {
      if (loggingOutRef.current) return
      const last = Math.max(lastActivityRef.current, readShared())
      const elapsed = Date.now() - last
      if (elapsed >= limit) {
        doLogout('idle')
        return
      }
      if (elapsed >= limit - warn) {
        if (!warningOpenRef.current) { warningOpenRef.current = true; setWarningOpen(true) }
        setSecondsLeft(Math.ceil((limit - elapsed) / 1000))
      } else if (warningOpenRef.current) {
        // another tab was used — close the countdown here too
        lastActivityRef.current = Math.max(lastActivityRef.current, last)
        warningOpenRef.current = false
        setWarningOpen(false)
      }
    }
    const tickTimer = setInterval(tick, TICK_MS)
    const onStorage = (e) => { if (e.key === SHARED_KEY) tick() }
    window.addEventListener('storage', onStorage)

    // Heartbeat: keep the server session alive while THIS tab is active (N tabs ≠ N heartbeats)
    heartbeatTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed < HEARTBEAT_INTERVAL) {
        sendHeartbeat()
      }
    }, HEARTBEAT_INTERVAL)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity)
      }
      window.removeEventListener('storage', onStorage)
      clearInterval(tickTimer)
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      warningOpenRef.current = false
      setWarningOpen(false)
    }
  }, [isAuthenticated, markActive, doLogout, sendHeartbeat])

  return { warningOpen: isAuthenticated && warningOpen, secondsLeft, staySignedIn, signOutNow }
}
