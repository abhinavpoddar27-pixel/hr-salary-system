import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../utils/api'

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function typeBorderClass(type) {
  const red = ['IMPORT_PENDING', 'MISS_PUNCH_PENDING', 'SALARY_PENDING', 'FINALIZE_URGENT', 'SALARY_HELD']
  const green = ['DAY_CALC_COMPLETE', 'SALARY_COMPUTED', 'FINANCE_SIGNOFF', 'ED_GRANT_APPROVED', 'LATE_DED_APPROVED']
  if (red.includes(type)) return 'border-l-4 border-red-400'
  if (green.includes(type)) return 'border-l-4 border-green-400'
  return 'border-l-4 border-slate-200'
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)
  const navigate = useNavigate()

  // Fetch immediately on mount, then poll every 60s. No loading spinner on polls.
  useEffect(() => {
    let first = true
    async function fetchData() {
      try {
        const res = await api.get('/notifications')
        setNotifications(res.data.data || [])
        setUnreadCount(res.data.unreadCount || 0)
      } catch {}
      if (first) {
        setLoading(false)
        first = false
      }
    }
    fetchData()
    const id = setInterval(fetchData, 60000)
    return () => clearInterval(id)
  }, [])

  // Click-outside closes the dropdown
  useEffect(() => {
    if (!isOpen) return
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const handleNotificationClick = useCallback(async (n) => {
    if (!n.is_read) {
      try {
        await api.patch(`/notifications/${n.id}/read`)
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: 1 } : x))
        setUnreadCount(prev => Math.max(0, prev - 1))
      } catch {}
    }
    const url = n.action_url || n.link
    if (url) {
      navigate(url)
      setIsOpen(false)
    }
  }, [navigate])

  const handleMarkAllRead = useCallback(async () => {
    try {
      await api.patch('/notifications/mark-all-read')
      setNotifications(prev => prev.map(x => ({ ...x, is_read: 1 })))
      setUnreadCount(0)
    } catch {}
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold px-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
          style={{ zIndex: 50, maxHeight: '400px', overflowY: 'auto' }}
        >
          {/* Header — sticky so it stays visible while scrolling */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0">
            <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
          ) : (
            notifications.slice(0, 50).map(n => (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 items-start ${typeBorderClass(n.type)} ${!n.is_read ? 'bg-blue-50/40' : ''}`}
              >
                {/* Unread dot */}
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${!n.is_read ? 'bg-blue-500' : 'bg-transparent'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${!n.is_read ? 'font-semibold text-slate-800' : 'font-normal text-slate-700'}`}>
                    {n.title || n.message}
                  </p>
                  {n.title && n.message && n.title !== n.message && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">{relativeTime(n.created_at)}</p>
                </div>
              </button>
            ))
          )}

          {/* Footer */}
          {!loading && notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-white sticky bottom-0">
              <button
                onClick={() => { navigate('/alerts'); setIsOpen(false) }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                View all notifications →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
