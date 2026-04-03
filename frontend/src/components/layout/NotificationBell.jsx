import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNotifications, markNotificationRead, markAllNotificationsRead, generateNotifications } from '../../utils/api'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: res } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(),
    refetchInterval: 60000
  })
  const notifications = res?.data?.data || []
  const unreadCount = res?.data?.unreadCount || 0

  const markRead = useMutation({
    mutationFn: (id) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  })

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  })

  const handleClick = useCallback((n) => {
    if (!n.is_read) markRead.mutate(n.id)
    const url = n.action_url || n.link
    if (url) {
      navigate(url)
      setOpen(false)
    }
  }, [markRead, navigate])

  const typeIcons = {
    LEAVE_PENDING: '📋', SALARY_CHANGE: '💰', LOAN_PENDING: '🏦',
    LIFECYCLE_EVENT: '👤', COMPLIANCE: '✅',
    IMPORT_PENDING: '📥', MISS_PUNCH_PENDING: '🔍', DAY_CALC_PENDING: '📅',
    SALARY_PENDING: '💰', FINALIZE_URGENT: '🚨'
  }

  const typeColors = {
    LEAVE_PENDING: 'bg-blue-100 text-blue-700', SALARY_CHANGE: 'bg-amber-100 text-amber-700',
    LOAN_PENDING: 'bg-purple-100 text-purple-700', LIFECYCLE_EVENT: 'bg-green-100 text-green-700',
    COMPLIANCE: 'bg-red-100 text-red-700',
    IMPORT_PENDING: 'bg-amber-100 text-amber-700', MISS_PUNCH_PENDING: 'bg-blue-100 text-blue-700',
    DAY_CALC_PENDING: 'bg-purple-100 text-purple-700', SALARY_PENDING: 'bg-amber-100 text-amber-700',
    FINALIZE_URGENT: 'bg-red-100 text-red-700'
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-30 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAll.mutate()}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  No notifications
                </div>
              ) : (
                notifications.slice(0, 15).map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 ${
                      !n.is_read ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${typeColors[n.type] || 'bg-slate-100 text-slate-600'}`}>
                      {typeIcons[n.type] || '📌'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${!n.is_read ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
                        {n.title || n.message}
                      </p>
                      {n.title && n.message && <p className="text-xs text-slate-500 truncate mt-0.5">{n.message}</p>}
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />}
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-100">
                <button
                  onClick={() => { navigate('/alerts'); setOpen(false) }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  View all notifications →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
