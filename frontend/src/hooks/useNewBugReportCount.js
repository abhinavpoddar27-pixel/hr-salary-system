import { useEffect, useState, useRef } from 'react'
import { getBugReportCount } from '../api/bugReports'
import { useAppStore } from '../store/appStore'
import { normalizeRole } from '../utils/role'

// Polls /api/bug-reports/count every 60s for the sidebar "new" badge.
// Admin-only — skips entirely for non-admins (the endpoint 403s anyway).
// Uses visibilitychange to pause polling when the tab is backgrounded so
// we don't drain battery on unused tabs.
export default function useNewBugReportCount() {
  const user = useAppStore((s) => s.user)
  const role = normalizeRole(user?.role)
  const isAdmin = role === 'admin'
  const [count, setCount] = useState(0)
  const timerRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setCount(0)
      return undefined
    }
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const res = await getBugReportCount('new')
        if (!cancelled && mountedRef.current) {
          setCount(res?.data?.count ?? 0)
        }
      } catch (_e) { /* silent — 401/403/500 all just leave the badge stale */ }
    }

    const start = () => {
      if (timerRef.current) return
      fetchOnce()
      timerRef.current = setInterval(fetchOnce, 60_000)
    }
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isAdmin])

  return count
}
