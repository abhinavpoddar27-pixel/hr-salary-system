import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import api from '../utils/api'
import toast from 'react-hot-toast'

const INACTIVITY_LIMIT = 15 * 60 * 1000   // 15 minutes — auto-logout
const WARNING_BEFORE = 2 * 60 * 1000       // Show warning 2 min before logout
const HEARTBEAT_INTERVAL = 5 * 60 * 1000   // Send heartbeat every 5 min if active
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

export default function useInactivityTimeout() {
  const { isAuthenticated, clearAuth, token } = useAppStore()
  const lastActivityRef = useRef(Date.now())
  const warningShownRef = useRef(false)
  const logoutTimerRef = useRef(null)
  const heartbeatTimerRef = useRef(null)

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    warningShownRef.current = false
  }, [])

  const doLogout = useCallback(() => {
    clearAuth()
    toast('Session expired due to inactivity', { icon: '🔒', duration: 5000 })
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
      // If heartbeat fails with 401, token expired server-side
      if (e.response?.status === 401) {
        doLogout()
      }
    }
  }, [token, doLogout])

  useEffect(() => {
    if (!isAuthenticated) return

    // Track user activity
    const handleActivity = () => {
      resetActivity()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true })
    }

    // Check inactivity periodically
    logoutTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current

      // Auto-logout
      if (elapsed >= INACTIVITY_LIMIT) {
        doLogout()
        return
      }

      // Warning toast 2 min before logout
      if (elapsed >= (INACTIVITY_LIMIT - WARNING_BEFORE) && !warningShownRef.current) {
        warningShownRef.current = true
        const minsLeft = Math.ceil((INACTIVITY_LIMIT - elapsed) / 60000)
        toast(`You'll be logged out in ~${minsLeft} min due to inactivity. Move your mouse to stay active.`, {
          icon: '⏳',
          duration: 10000,
          id: 'inactivity-warning'
        })
      }
    }, 30000) // Check every 30 seconds

    // Heartbeat: keep server session alive while user is active
    heartbeatTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      // Only send heartbeat if user was recently active (within last 5 min)
      if (elapsed < HEARTBEAT_INTERVAL) {
        sendHeartbeat()
      }
    }, HEARTBEAT_INTERVAL)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity)
      }
      if (logoutTimerRef.current) clearInterval(logoutTimerRef.current)
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
    }
  }, [isAuthenticated, resetActivity, doLogout, sendHeartbeat])
}
