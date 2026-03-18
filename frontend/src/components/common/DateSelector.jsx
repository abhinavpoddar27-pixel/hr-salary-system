import React, { useState, useCallback } from 'react'
import { MONTH_OPTIONS, YEAR_OPTIONS } from '../../utils/formatters'
import { useAppStore } from '../../store/appStore'
import clsx from 'clsx'
import toast from 'react-hot-toast'

/**
 * DateSelector — Per-page date selection with quick presets.
 *
 * Props:
 *   mode          — 'month' | 'range' | 'date'
 *   initialMonth  — Starting month (1-12). Defaults to store value.
 *   initialYear   — Starting year. Defaults to store value.
 *   onChange       — Called with { month, year, dateRangeMode, dateRangeStart, dateRangeEnd, date }
 *   syncToStore   — If true, writes changes to Zustand store for child components
 *   compact       — Smaller sizing
 *   className     — Additional classes
 */
export default function DateSelector({
  mode = 'month',
  initialMonth,
  initialYear,
  onChange,
  syncToStore = false,
  compact = false,
  className = '',
}) {
  const storeMonth = useAppStore(s => s.selectedMonth)
  const storeYear = useAppStore(s => s.selectedYear)

  const [month, setMonth] = useState(initialMonth || storeMonth)
  const [year, setYear] = useState(initialYear || storeYear)
  const [rangeMode, setRangeMode] = useState('month') // 'month' | 'custom'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [singleDate, setSingleDate] = useState(new Date().toISOString().slice(0, 10))
  const [activePreset, setActivePreset] = useState(null)

  const emit = useCallback((overrides = {}) => {
    const state = {
      month: overrides.month ?? month,
      year: overrides.year ?? year,
      dateRangeMode: overrides.dateRangeMode ?? rangeMode,
      dateRangeStart: overrides.dateRangeStart ?? startDate,
      dateRangeEnd: overrides.dateRangeEnd ?? endDate,
      date: overrides.date ?? singleDate,
    }
    onChange?.(state)
    if (syncToStore) {
      try {
        const store = useAppStore.getState()
        store.setMonthYear(state.month, state.year)
        if (mode === 'range') {
          store.setDateRangeMode(state.dateRangeMode)
          store.setDateRange(state.dateRangeStart, state.dateRangeEnd)
        }
      } catch { /* silent */ }
    }
  }, [month, year, rangeMode, startDate, endDate, singleDate, onChange, syncToStore, mode])

  function handleMonthChange(m) {
    setMonth(m); setActivePreset(null)
    emit({ month: m })
  }
  function handleYearChange(y) {
    setYear(y); setActivePreset(null)
    emit({ year: y })
  }
  function handleRangeModeToggle(m) {
    setRangeMode(m); setActivePreset(null)
    emit({ dateRangeMode: m })
  }
  function handleStartDate(d) {
    if (endDate && d > endDate) { toast.error('Start must be before end'); return }
    setStartDate(d); setActivePreset(null)
    emit({ dateRangeStart: d })
  }
  function handleEndDate(d) {
    if (startDate && d < startDate) { toast.error('End must be after start'); return }
    setEndDate(d); setActivePreset(null)
    emit({ dateRangeEnd: d })
  }
  function handleSingleDate(d) {
    setSingleDate(d); setActivePreset(null)
    emit({ date: d })
  }

  // ── Quick Presets ──────────────────────────────────────
  function applyPreset(preset) {
    setActivePreset(preset)
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10)

    // Monday of this week
    const dayOfWeek = now.getDay() || 7
    const thisMonday = new Date(now - (dayOfWeek - 1) * 86400000).toISOString().slice(0, 10)
    const lastMonday = new Date(new Date(thisMonday) - 7 * 86400000).toISOString().slice(0, 10)
    const lastSunday = new Date(new Date(thisMonday) - 86400000).toISOString().slice(0, 10)

    const thisMonth = now.getMonth() + 1
    const thisYear = now.getFullYear()
    let prevMonth = thisMonth - 1, prevYear = thisYear
    if (prevMonth === 0) { prevMonth = 12; prevYear-- }

    if (mode === 'month') {
      // In month mode, presets resolve to the correct month
      switch (preset) {
        case 'today':
        case 'yesterday':
        case 'thisWeek':
        case 'thisMonth':
          setMonth(thisMonth); setYear(thisYear)
          emit({ month: thisMonth, year: thisYear })
          break
        case 'lastWeek': {
          const lm = new Date(lastMonday)
          setMonth(lm.getMonth() + 1); setYear(lm.getFullYear())
          emit({ month: lm.getMonth() + 1, year: lm.getFullYear() })
          break
        }
        case 'lastMonth':
          setMonth(prevMonth); setYear(prevYear)
          emit({ month: prevMonth, year: prevYear })
          break
      }
    } else if (mode === 'range') {
      // In range mode, presets set custom date ranges
      setRangeMode('custom')
      let s, e
      switch (preset) {
        case 'today': s = today; e = today; break
        case 'yesterday': s = yesterday; e = yesterday; break
        case 'thisWeek': s = thisMonday; e = today; break
        case 'lastWeek': s = lastMonday; e = lastSunday; break
        case 'thisMonth':
          s = `${thisYear}-${String(thisMonth).padStart(2,'0')}-01`
          e = today; break
        case 'lastMonth':
          s = `${prevYear}-${String(prevMonth).padStart(2,'0')}-01`
          const lastDay = new Date(thisYear, thisMonth - 1, 0).getDate()
          e = `${prevYear}-${String(prevMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
          break
      }
      setStartDate(s); setEndDate(e)
      emit({ dateRangeMode: 'custom', dateRangeStart: s, dateRangeEnd: e })
    } else if (mode === 'date') {
      switch (preset) {
        case 'today': setSingleDate(today); emit({ date: today }); break
        case 'yesterday': setSingleDate(yesterday); emit({ date: yesterday }); break
        default: setSingleDate(today); emit({ date: today })
      }
    }
  }

  const presets = mode === 'date'
    ? [
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
      ]
    : [
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
        { key: 'thisWeek', label: 'This Week' },
        { key: 'lastWeek', label: 'Last Week' },
        { key: 'thisMonth', label: 'This Month' },
        { key: 'lastMonth', label: 'Last Month' },
      ]

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1">
        {presets.map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium rounded-full border transition-all',
              activePreset === p.key
                ? 'bg-blue-100 text-blue-700 border-blue-300'
                : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600'
            )}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-slate-200 hidden sm:block" />

      {/* Mode toggle for range mode */}
      {mode === 'range' && (
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => handleRangeModeToggle('month')}
            className={clsx('px-2 py-1 text-xs font-medium rounded-md transition-all',
              rangeMode === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Month
          </button>
          <button onClick={() => handleRangeModeToggle('custom')}
            className={clsx('px-2 py-1 text-xs font-medium rounded-md transition-all',
              rangeMode === 'custom' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Custom
          </button>
        </div>
      )}

      {/* Month selector */}
      {mode !== 'date' && (mode === 'month' || rangeMode === 'month') && (
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
          <select value={month} onChange={e => handleMonthChange(parseInt(e.target.value))}
            className={clsx('font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer', compact ? 'text-xs' : 'text-sm')}>
            {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={year} onChange={e => handleYearChange(parseInt(e.target.value))}
            className={clsx('font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer', compact ? 'text-xs' : 'text-sm')}>
            {YEAR_OPTIONS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
          </select>
        </div>
      )}

      {/* Custom date range */}
      {mode === 'range' && rangeMode === 'custom' && (
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
          <span className="text-xs text-slate-400">From</span>
          <input type="date" value={startDate} onChange={e => handleStartDate(e.target.value)}
            className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={endDate} onChange={e => handleEndDate(e.target.value)}
            className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer" />
        </div>
      )}

      {/* Single date */}
      {mode === 'date' && (
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
          <input type="date" value={singleDate} onChange={e => handleSingleDate(e.target.value)}
            className="text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer" />
        </div>
      )}
    </div>
  )
}
