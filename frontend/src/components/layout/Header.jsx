import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { logout } from '../../utils/api'
import { MONTH_OPTIONS, YEAR_OPTIONS, monthYearLabel } from '../../utils/formatters'
import NotificationBell from './NotificationBell'
import toast from 'react-hot-toast'

export default function Header({ title }) {
  const {
    selectedMonth, selectedYear, setMonthYear,
    dateRangeMode, dateRangeStart, dateRangeEnd,
    setDateRangeMode, setDateRange,
    alertCount, user, clearAuth
  } = useAppStore()
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)

  async function handleLogout() {
    try { await logout() } catch {}
    clearAuth()
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10 no-print">
      <div className="flex-1">
        <h1 className="text-base font-semibold text-slate-800">{title || 'HR & Salary System'}</h1>
      </div>

      {/* Period selector with mode toggle */}
      <div className="flex items-center gap-2">
        {/* Mode toggle */}
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setDateRangeMode('month')}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${
              dateRangeMode === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Month
          </button>
          <button
            onClick={() => setDateRangeMode('custom')}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${
              dateRangeMode === 'custom' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Custom
          </button>
        </div>

        {dateRangeMode === 'month' ? (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500 font-medium">Period:</span>
            <select
              value={selectedMonth}
              onChange={e => setMonthYear(parseInt(e.target.value), selectedYear)}
              className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer"
            >
              {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={e => setMonthYear(selectedMonth, parseInt(e.target.value))}
              className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer"
            >
              {YEAR_OPTIONS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500 font-medium">From:</span>
            <input
              type="date"
              value={dateRangeStart}
              onChange={e => setDateRange(e.target.value, dateRangeEnd)}
              className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateRangeEnd}
              onChange={e => setDateRange(dateRangeStart, e.target.value)}
              className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Company Selector (RBAC) */}
      {(() => {
        const ac = user?.allowedCompanies || ['*']
        const showSelector = ac.includes('*') || ac.length > 1
        if (!showSelector) return null
        const { selectedCompany, setSelectedCompany } = useAppStore.getState()
        return (
          <select
            value={useAppStore(s => s.selectedCompany)}
            onChange={e => useAppStore.getState().setSelectedCompany(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
          >
            <option value="">All Companies</option>
            <option value="Indriyan Beverages Pvt Ltd">Indriyan Beverages</option>
            <option value="Asian Lakto Ind Ltd">Asian Lakto</option>
          </select>
        )
      })()}

      {/* Notifications */}
      <NotificationBell />

      <div className="text-xs text-slate-400 border-l border-slate-200 pl-4 hidden sm:block">
        {dateRangeMode === 'month'
          ? monthYearLabel(selectedMonth, selectedYear)
          : dateRangeStart && dateRangeEnd
            ? `${new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : 'Select dates'
        }
      </div>

      {/* User menu */}
      <div className="relative border-l border-slate-200 pl-4">
        <button
          onClick={() => setShowUserMenu(v => !v)}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg px-2 py-1.5 transition-colors"
        >
          <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold uppercase">
            {user?.username?.[0] || 'U'}
          </span>
          <span className="hidden md:block font-medium">{user?.username || 'User'}</span>
          <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {showUserMenu && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl border border-slate-200 shadow-lg z-20 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs text-slate-500">Signed in as</p>
                <p className="text-sm font-semibold text-slate-800">{user?.username}</p>
                <span className="inline-block mt-0.5 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize">{user?.role}</span>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { setShowUserMenu(false); navigate('/settings/policy') }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                >
                  Settings
                </button>
                <button
                  onClick={() => { setShowUserMenu(false); handleLogout() }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
