import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getEarlyExitRangeReport, getEarlyExitMtdSummary, getEarlyExitDeptSummary,
  exportEarlyExitReport,
  getEarlyExitEmployeeAnalytics, submitEarlyExitDeduction,
  cancelEarlyExitDeduction, reviseEarlyExitDeduction,
  detectEarlyExits
} from '../utils/api'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// ─── Local helpers ────────────────────────────────────────
function flagColor(mins) {
  if (mins > 120) return 'bg-red-100 text-red-700'
  if (mins >= 30) return 'bg-amber-100 text-amber-700'
  return 'bg-yellow-100 text-yellow-700'
}

function TrendArrow({ trend }) {
  if (trend === 'up') return <span className="text-red-600 font-bold">↑</span>
  if (trend === 'down') return <span className="text-green-600 font-bold">↓</span>
  return <span className="text-slate-400">→</span>
}

function KPI({ label, value, sub, color = 'blue', icon }) {
  const colors = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    red: 'from-red-500 to-red-600',
    amber: 'from-amber-500 to-amber-600',
    purple: 'from-purple-500 to-purple-600',
    cyan: 'from-cyan-500 to-cyan-600',
  }
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={clsx('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-lg shrink-0', colors[color] || colors.blue)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function useSortable(defaultKey = '', defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState(defaultDir)
  const toggle = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const indicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const sortFn = (a, b) => {
    if (!sortKey) return 0
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? ''
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  }
  return { sortKey, sortDir, toggle, indicator, sortFn }
}

function SortTh({ sort, k, children, className = '' }) {
  return (
    <th onClick={() => sort.toggle(k)}
        className={clsx('cursor-pointer select-none hover:text-blue-600 transition-colors', className)}>
      {children}{sort.indicator(k)}
    </th>
  )
}

// ─── Date preset helpers ──────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function toIso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function daysDiff(a, b) {
  const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()
  return Math.floor(ms / 86400000) + 1
}

function computePreset(preset) {
  const today = new Date()
  const y = today.getFullYear(), m = today.getMonth()
  switch (preset) {
    case 'today':
      return { start: toIso(today), end: toIso(today) }
    case 'week': {
      const day = today.getDay() // Sun=0
      const offset = day === 0 ? 6 : day - 1 // Mon start
      const start = new Date(today); start.setDate(start.getDate() - offset)
      return { start: toIso(start), end: toIso(today) }
    }
    case 'month': {
      const start = new Date(y, m, 1)
      return { start: toIso(start), end: toIso(today) }
    }
    case 'lastMonth': {
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 0)
      return { start: toIso(start), end: toIso(end) }
    }
    case 'last3': {
      const start = new Date(y, m - 2, 1)
      return { start: toIso(start), end: toIso(today) }
    }
    default:
      return null
  }
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function EarlyExitDetection({ selectedMonth, selectedYear, selectedCompany }) {
  const queryClient = useQueryClient()

  // Date range state — default to current month
  const defaultRange = useMemo(() => computePreset('month'), [])
  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)
  const [activePreset, setActivePreset] = useState('month')
  const [rangeError, setRangeError] = useState('')

  // Filters
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [minMinutes, setMinMinutes] = useState('')

  // Sort
  const sort = useSortable('date', 'desc')

  // Detail panel & detect modal
  const [selectedRow, setSelectedRow] = useState(null)
  const [showDetectModal, setShowDetectModal] = useState(false)
  const [detectDate, setDetectDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return toIso(d)
  })
  const [exporting, setExporting] = useState(false)

  // Validate range client-side before firing query
  useEffect(() => {
    if (!startDate || !endDate) { setRangeError(''); return }
    if (startDate > endDate) { setRangeError('Start date must be before end date'); return }
    if (daysDiff(startDate, endDate) > 90) { setRangeError('Maximum range is 90 days'); return }
    setRangeError('')
  }, [startDate, endDate])

  const rangeValid = !rangeError && startDate && endDate

  // ─── Queries ──────────────────────────────────────────
  const { data: rangeRes, isLoading } = useQuery({
    queryKey: ['ee-range', startDate, endDate, selectedCompany],
    queryFn: () => getEarlyExitRangeReport({
      startDate, endDate,
      ...(selectedCompany ? { company: selectedCompany } : {})
    }),
    enabled: !!rangeValid,
    retry: 0
  })
  const rows = rangeRes?.data?.data || []
  const summary = rangeRes?.data?.summary || {}

  const { data: mtdRes } = useQuery({
    queryKey: ['ee-mtd', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getEarlyExitMtdSummary({
      month: selectedMonth, year: selectedYear,
      ...(selectedCompany ? { company: selectedCompany } : {})
    }),
    retry: 0
  })
  const mtd = mtdRes?.data || {}
  const mtdTotals = mtd.totals || {}

  const { data: deptRes } = useQuery({
    queryKey: ['ee-dept', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getEarlyExitDeptSummary({
      month: selectedMonth, year: selectedYear,
      ...(selectedCompany ? { company: selectedCompany } : {})
    }),
    retry: 0
  })
  const deptRows = deptRes?.data?.data || []

  // Department options — from range data
  const departments = useMemo(() =>
    [...new Set(rows.map(r => r.department).filter(Boolean))].sort(),
    [rows])

  // Apply filters + sort client-side
  const filtered = useMemo(() => {
    let arr = rows
    if (search.trim()) {
      const s = search.toLowerCase()
      arr = arr.filter(r =>
        (r.employee_code && r.employee_code.toLowerCase().includes(s)) ||
        (r.employee_name && r.employee_name.toLowerCase().includes(s))
      )
    }
    if (deptFilter) arr = arr.filter(r => r.department === deptFilter)
    if (minMinutes !== '' && !isNaN(Number(minMinutes))) {
      const m = Number(minMinutes)
      arr = arr.filter(r => (r.minutes_early || 0) >= m)
    }
    return [...arr].sort(sort.sortFn)
  }, [rows, search, deptFilter, minMinutes, sort.sortKey, sort.sortDir])

  // ─── Handlers ─────────────────────────────────────────
  const applyPreset = (preset) => {
    const r = computePreset(preset)
    if (!r) return
    setStartDate(r.start); setEndDate(r.end); setActivePreset(preset)
  }

  const detectMut = useMutation({
    mutationFn: () => detectEarlyExits({ date: detectDate }),
    onSuccess: (res) => {
      const d = res.data
      toast.success(`Detection complete: ${d.detected} flagged, ${d.exempted} exempted, ${d.skipped} skipped`)
      queryClient.invalidateQueries({ queryKey: ['ee-range'] })
      queryClient.invalidateQueries({ queryKey: ['ee-mtd'] })
      queryClient.invalidateQueries({ queryKey: ['ee-dept'] })
      setShowDetectModal(false)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Detection failed')
  })

  const handleExport = async () => {
    if (!rangeValid) return
    setExporting(true)
    try {
      const params = {
        startDate, endDate,
        ...(selectedCompany ? { company: selectedCompany } : {}),
        ...(deptFilter ? { department: deptFilter } : {}),
        ...(minMinutes !== '' && !isNaN(Number(minMinutes)) ? { minMinutes } : {})
      }
      const res = await exportEarlyExitReport(params)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `EarlyExitReport_${startDate}_to_${endDate}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const today = toIso(new Date())
  const isFutureDetect = detectDate > today

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Early Exit Management</h3>
          <p className="text-xs text-slate-500">
            Detect, review &amp; act on employees leaving before shift end
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
                  disabled={!rangeValid || exporting || filtered.length === 0}
                  className="btn-secondary text-sm">
            {exporting ? 'Exporting…' : '⬇ Export Excel'}
          </button>
          <button onClick={() => setShowDetectModal(true)} className="btn-secondary text-sm">
            Re-run Detection
          </button>
        </div>
      </div>

      {/* ── MTD KPI cards (mirror Late Coming layout) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="🚪" label="Early Exits (MTD)" value={mtdTotals.total_this_month || 0}
             sub={<span>vs prev {mtdTotals.total_last_month || 0} <TrendArrow trend={mtdTotals.trend} /></span>}
             color="red" />
        <KPI icon="👥" label="Unique Employees" value={mtdTotals.unique_employees || 0}
             sub="this month" color="amber" />
        <KPI icon="⏱" label="Avg Minutes Early" value={summary.avgMinutesEarly || 0}
             sub="in selected range" color="purple" />
        <KPI icon="🎫" label="With Gate Pass" value={summary.withGatePass || 0}
             sub={`of ${summary.totalIncidents || 0} incidents`} color="blue" />
      </div>

      {/* ── Department Summary cards ── */}
      {deptRows.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h4 className="font-semibold text-slate-700">Department Breakdown (This Month)</h4>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {deptRows.slice(0, 6).map(d => (
                <div key={d.department} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm text-slate-700 truncate">{d.department}</div>
                    <TrendArrow trend={d.trend} />
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <div className="text-2xl font-bold text-red-600">{d.total_incidents}</div>
                    <div className="text-xs text-slate-500">exits · {d.employee_count} emps</div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Avg {d.avg_minutes_early || 0} min early
                  </div>
                  {d.worst_offender && (
                    <div className="text-[11px] text-slate-600 mt-1 truncate">
                      Worst: <strong>{d.worst_offender.name}</strong> ({d.worst_offender.exit_count})
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Date Range Picker ── */}
      <div className="card">
        <div className="card-body space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { k: 'today', label: 'Today' },
              { k: 'week', label: 'This Week' },
              { k: 'month', label: 'This Month' },
              { k: 'lastMonth', label: 'Last Month' },
              { k: 'last3', label: 'Last 3 Months' }
            ].map(p => (
              <button key={p.k} onClick={() => applyPreset(p.k)}
                      className={clsx('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                        activePreset === p.k
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}>
                {p.label}
              </button>
            ))}
            <div className="h-6 w-px bg-slate-300 mx-1" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">From</label>
              <input type="date" value={startDate}
                     onChange={e => { setStartDate(e.target.value); setActivePreset('custom') }}
                     className="input text-sm py-1" />
              <label className="text-xs text-slate-500">To</label>
              <input type="date" value={endDate}
                     onChange={e => { setEndDate(e.target.value); setActivePreset('custom') }}
                     className="input text-sm py-1" />
            </div>
            {rangeValid && (
              <span className="text-xs text-slate-400">
                {daysDiff(startDate, endDate)} day{daysDiff(startDate, endDate) !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {rangeError && (
            <div className="text-xs text-red-600 font-medium">{rangeError}</div>
          )}

          {/* ── Filters row ── */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100">
            <input className="input text-sm w-56" placeholder="Search code or name…"
                   value={search} onChange={e => setSearch(e.target.value)} />
            <select className="select text-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <label className="text-xs text-slate-500">Min min</label>
              <input type="number" min="0" className="input text-sm w-20"
                     value={minMinutes} onChange={e => setMinMinutes(e.target.value)} />
            </div>
            <div className="flex-1" />
            <div className="text-xs text-slate-500">
              Showing <strong>{filtered.length}</strong> of {rows.length}
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <SortTh sort={sort} k="date">Date</SortTh>
                <SortTh sort={sort} k="employee_name">Employee</SortTh>
                <th>Code</th>
                <SortTh sort={sort} k="department">Dept</SortTh>
                <th className="text-center">Shift End</th>
                <SortTh sort={sort} k="actual_punch_out_time" className="text-center">Punch Out</SortTh>
                <SortTh sort={sort} k="minutes_early" className="text-center">Min Early</SortTh>
                <SortTh sort={sort} k="flagged_minutes" className="text-center">Flagged</SortTh>
                <th className="text-center">Gate Pass</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {!rangeValid ? (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">Select a valid date range</td></tr>
              ) : isLoading ? (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                  <div className="text-4xl mb-2 opacity-40">🚪</div>
                  <div className="text-sm">No early exits detected in the selected date range</div>
                  <div className="text-xs mt-1">Try widening the range or clearing filters</div>
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelectedRow(r)}>
                  <td className="text-sm">{r.date}</td>
                  <td className="font-medium text-slate-800">{r.employee_name}</td>
                  <td className="text-xs font-mono text-slate-500">{r.employee_code}</td>
                  <td className="text-sm text-slate-600">{r.department}</td>
                  <td className="text-center text-xs">{r.shift_end_time}</td>
                  <td className="text-center text-xs">{r.actual_punch_out_time}</td>
                  <td className="text-center font-semibold text-slate-700">{r.minutes_early}m</td>
                  <td className="text-center">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-bold', flagColor(r.flagged_minutes))}>
                      {r.flagged_minutes}m
                    </span>
                  </td>
                  <td className="text-center">
                    {r.has_gate_pass ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Yes</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-center">
                    <StatusBadge status={r.detection_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detection modal */}
      {showDetectModal && (
        <Modal show={true} onClose={() => setShowDetectModal(false)} title="Run Early Exit Detection" size="sm">
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Detection Date</label>
              <input type="date"
                     className={clsx('input w-full', isFutureDetect && 'border-red-400')}
                     value={detectDate} max={today}
                     onChange={e => setDetectDate(e.target.value)} />
              {isFutureDetect && <div className="text-xs text-red-500 mt-1">Date cannot be in the future</div>}
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn" onClick={() => setShowDetectModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => detectMut.mutate()}
                      disabled={detectMut.isPending || isFutureDetect}>
                {detectMut.isPending ? 'Running…' : 'Run Detection'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail panel */}
      {selectedRow && (
        <EarlyExitDetailPanel
          detection={selectedRow}
          onClose={() => setSelectedRow(null)}
          month={selectedMonth}
          year={selectedYear}
        />
      )}
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────
function StatusBadge({ status, deductionStatus }) {
  if (deductionStatus === 'approved') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Approved</span>
  if (deductionStatus === 'pending') return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Pending</span>
  if (deductionStatus === 'rejected') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Rejected</span>
  if (status === 'actioned') return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Actioned</span>
  if (status === 'exempted') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Exempted</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Flagged</span>
}

// ─── Detail panel (HR deduction workflow — unchanged logic) ──
function EarlyExitDetailPanel({ detection, onClose, month, year }) {
  const queryClient = useQueryClient()
  const [deductionType, setDeductionType] = useState('half_day')
  const [customAmount, setCustomAmount] = useState('')
  const [hrRemark, setHrRemark] = useState('')
  const [remarkError, setRemarkError] = useState(false)

  const { data: analyticsRes } = useQuery({
    queryKey: ['early-exit-employee-analytics', detection.employee_code],
    queryFn: () => getEarlyExitEmployeeAnalytics(detection.employee_code)
  })
  const analytics = analyticsRes?.data || {}

  const dailyGross = detection.daily_gross_at_time || 0
  const halfDayAmount = Math.round(dailyGross / 2)
  const fullDayAmount = dailyGross

  const computedAmount = deductionType === 'warning' ? 0
    : deductionType === 'half_day' ? halfDayAmount
    : deductionType === 'full_day' ? fullDayAmount
    : parseInt(customAmount) || 0

  const autoRemark = `Early exit on ${detection.date}: left at ${detection.actual_punch_out_time} (shift ends ${detection.shift_end_time}), ${detection.flagged_minutes} min early.${detection.has_gate_pass ? ' Had gate pass.' : ''}`

  const submitMut = useMutation({
    mutationFn: (data) => submitEarlyExitDeduction(data),
    onSuccess: () => {
      toast.success('Deduction submitted for finance approval')
      queryClient.invalidateQueries({ queryKey: ['ee-range'] })
      queryClient.invalidateQueries({ queryKey: ['ee-mtd'] })
      onClose()
    }
  })

  const cancelMut = useMutation({
    mutationFn: () => cancelEarlyExitDeduction(detection.deduction_id),
    onSuccess: () => {
      toast.success('Deduction cancelled')
      queryClient.invalidateQueries({ queryKey: ['ee-range'] })
      onClose()
    }
  })

  const reviseMut = useMutation({
    mutationFn: (data) => reviseEarlyExitDeduction(detection.deduction_id, data),
    onSuccess: () => {
      toast.success('Deduction revised and resubmitted')
      queryClient.invalidateQueries({ queryKey: ['ee-range'] })
      onClose()
    }
  })

  const handleSubmit = () => {
    const remarkText = hrRemark.trim() || autoRemark
    if (!remarkText) { setRemarkError(true); return }
    submitMut.mutate({
      early_exit_detection_id: detection.id,
      deduction_type: deductionType,
      deduction_amount: computedAmount || undefined,
      hr_remark: remarkText
    })
  }

  const handleRevise = () => {
    const remarkText = hrRemark.trim() || autoRemark
    if (!remarkText) { setRemarkError(true); return }
    reviseMut.mutate({
      deduction_type: deductionType,
      deduction_amount: computedAmount || undefined,
      hr_remark: remarkText
    })
  }

  const canAction = detection.detection_status === 'flagged' && !detection.deduction_finance_status
  const isRejected = detection.deduction_finance_status === 'rejected'
  const isPending = detection.deduction_finance_status === 'pending'

  return (
    <Modal show={true} onClose={onClose} title={`Early Exit — ${detection.employee_name}`} size="lg">
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="flex gap-4 items-center">
          <div>
            <div className="font-semibold text-lg">{detection.employee_name}</div>
            <div className="text-sm text-slate-500">{detection.employee_code} — {detection.department}</div>
          </div>
          {analytics.is_habitual && (
            <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-bold">HABITUAL</span>
          )}
        </div>

        {analytics.chart_data?.length > 0 && (
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">30-Day Rolling Windows</div>
            <div className="flex gap-2">
              {analytics.chart_data.map((w, i) => (
                <div key={i} className="flex-1 text-center">
                  <div className={clsx('text-lg font-bold', w.count >= 3 ? 'text-red-600' : w.count > 0 ? 'text-amber-600' : 'text-green-600')}>
                    {w.count}
                  </div>
                  <div className="text-[10px] text-slate-400">{w.period}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card p-3 grid grid-cols-3 gap-3 text-sm">
          <div><span className="text-slate-500">Date:</span> {detection.date}</div>
          <div><span className="text-slate-500">Shift End:</span> {detection.shift_end_time}</div>
          <div><span className="text-slate-500">Punch Out:</span> {detection.actual_punch_out_time}</div>
          <div><span className="text-slate-500">Minutes Early:</span> {detection.minutes_early}</div>
          <div><span className="text-slate-500">Flagged:</span> {detection.flagged_minutes} min</div>
          <div><span className="text-slate-500">Gate Pass:</span> {detection.has_gate_pass ? 'Yes' : 'No'}</div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          {autoRemark}
        </div>

        {isPending && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
            <div className="font-semibold text-blue-800">Pending Finance Approval</div>
            <div className="text-blue-600 mt-1">Type: {detection.deduction_type} | Amount: ₹{detection.deduction_amount}</div>
            <button className="btn text-xs mt-2 text-red-600 border-red-200" onClick={() => cancelMut.mutate()}>
              Cancel Submission
            </button>
          </div>
        )}

        {isRejected && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
            <div className="font-semibold text-red-800">Rejected by Finance</div>
            {detection.finance_remark && <div className="text-red-600 mt-1">Remark: {detection.finance_remark}</div>}
          </div>
        )}

        {(canAction || isRejected) && (
          <div className="space-y-3 border-t pt-3">
            <div className="font-semibold text-sm">
              {isRejected ? 'Revise and Resubmit' : 'HR Deduction Action'}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Deduction Type</label>
              <select className="input w-full" value={deductionType} onChange={e => setDeductionType(e.target.value)}>
                <option value="warning">Warning (no deduction)</option>
                <option value="half_day">Half-Day ({halfDayAmount > 0 ? `₹${halfDayAmount}` : ''})</option>
                <option value="full_day">Full-Day ({fullDayAmount > 0 ? `₹${fullDayAmount}` : ''})</option>
                <option value="custom">Custom Amount</option>
              </select>
            </div>
            {deductionType === 'custom' && (
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">Amount (₹)</label>
                <input type="number" className="input w-full" value={customAmount}
                       onChange={e => setCustomAmount(e.target.value)} min="1" />
              </div>
            )}
            {deductionType !== 'warning' && computedAmount > 0 && (
              <div className="text-sm text-slate-600">Deduction amount: <strong>₹{computedAmount}</strong></div>
            )}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">HR Remark</label>
              <textarea
                className={clsx('input w-full', remarkError && 'border-red-400')}
                rows={2} value={hrRemark}
                onChange={e => { setHrRemark(e.target.value); setRemarkError(false) }}
                placeholder={autoRemark}
              />
              {remarkError && <div className="text-xs text-red-500 mt-1">Remark is required</div>}
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn" onClick={onClose}>Close</button>
              {isRejected ? (
                <button className="btn btn-primary" onClick={handleRevise} disabled={reviseMut.isPending}>
                  {reviseMut.isPending ? 'Submitting…' : 'Revise and Resubmit'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitMut.isPending}>
                  {submitMut.isPending ? 'Submitting…' : 'Submit for Finance Approval'}
                </button>
              )}
            </div>
          </div>
        )}

        {analytics.history?.length > 0 && (
          <div className="border-t pt-3">
            <div className="font-semibold text-sm mb-2">Detection History</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500 uppercase">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Flagged</th>
                    <th className="px-2 py-1">Gate Pass</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Deduction</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.history.slice(0, 20).map(h => (
                    <tr key={h.id} className="border-b border-slate-100">
                      <td className="px-2 py-1">{h.date}</td>
                      <td className="px-2 py-1">{h.flagged_minutes}m</td>
                      <td className="px-2 py-1">{h.has_gate_pass ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1"><StatusBadge status={h.detection_status} deductionStatus={h.deduction_finance_status} /></td>
                      <td className="px-2 py-1">{h.deduction_type || '—'} {h.deduction_amount ? `₹${h.deduction_amount}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
