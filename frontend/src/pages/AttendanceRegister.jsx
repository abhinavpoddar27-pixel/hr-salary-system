import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getAttendanceRegister, updateAttendanceRecord, getMonthlyAttendanceSummary, recalculateMetrics } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { statusColor } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import clsx from 'clsx'

/* ── CellEditor (kept from original) ──────────────────────────────── */

function CellEditor({ record, onSave, onClose }) {
  const [status, setStatus] = useState(record.status_final || record.status_original || '')
  const [inTime, setInTime] = useState(record.in_time_final || record.in_time_original || '')
  const [outTime, setOutTime] = useState(record.out_time_final || record.out_time_original || '')
  const [remark, setRemark] = useState(record.correction_remark || '')

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-80 shadow-glass-xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800 mb-3 text-sm">Edit: {record.employee_name} — {record.date}</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="select">
              {['P','A','WO','WOP','½P','WO½P'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">IN Time</label>
            <input type="time" value={inTime} onChange={e => setInTime(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">OUT Time</label>
            <input type="time" value={outTime} onChange={e => setOutTime(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Remark</label>
            <input type="text" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Correction note..." className="input" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSave({ statusFinal: status, inTimeFinal: inTime, outTimeFinal: outTime, remark })} className="btn-primary flex-1">Save</button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

/* ── Expanded row: daily attendance detail for one employee ──────── */

function ExpandedEmployeeDetail({ emp, month, year, onEditRecord }) {
  const [showCalendar, setShowCalendar] = useState(false)

  const { data: res, isLoading } = useQuery({
    queryKey: ['attendance-register', month, year, emp.employee_code],
    queryFn: () => getAttendanceRegister({ month, year, employeeCode: emp.employee_code }),
    retry: 0,
  })

  const records = res?.data?.data || []
  const daysInMonth = new Date(year, month, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const recordByDay = {}
  for (const r of records) {
    const day = parseInt(r.date.split('-')[2])
    recordByDay[day] = r
  }

  function cellClass(rec) {
    if (!rec) return 'bg-slate-50 text-slate-300'
    const status = rec.status_final || rec.status_original
    if (rec.is_miss_punch && !rec.miss_punch_resolved) return 'bg-red-100 text-red-700 ring-1 ring-red-300'
    if (rec.stage_5_done || rec.correction_remark) return 'bg-amber-50 text-amber-700'
    if (rec.is_night_shift && !rec.is_night_out_only) return 'bg-purple-50 text-purple-700'
    if (rec.is_night_out_only) return 'hidden'
    return statusColor(status) || 'bg-slate-50 text-slate-400'
  }

  return (
    <div className="space-y-4">
      {/* Employee quick view */}
      <EmployeeQuickView
        employeeCode={emp.employee_code}
        month={month}
        year={year}
        compact
        extraInfo={{
          'Present': `${emp.present_days || 0}d`,
          'Absent': `${emp.absent_days || 0}d`,
          'Late': `${emp.late_days || 0}d`,
          'Avg Hrs': emp.avg_hours ? `${Number(emp.avg_hours).toFixed(1)}h` : '--',
        }}
      />

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCalendar(false)}
          className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
            !showCalendar ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          )}
        >
          Grid View
        </button>
        <button
          onClick={() => setShowCalendar(true)}
          className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
            showCalendar ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          )}
        >
          Calendar View
        </button>
      </div>

      {/* Calendar View */}
      {showCalendar && (
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <CalendarView employeeCode={emp.employee_code} month={month} year={year} />
        </div>
      )}

      {/* Grid View */}
      {!showCalendar && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <h4 className="font-semibold text-slate-700 text-sm">
              {emp.employee_name} — Daily Grid
            </h4>
            <div className="flex gap-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /><Abbr code="P">Present</Abbr></span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /><Abbr code="A">Absent</Abbr></span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200 inline-block" />Night</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 inline-block" />Corrected</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200 inline-block" /><Abbr code="WO">Week Off</Abbr></span>
            </div>
          </div>
          <div className="overflow-x-auto p-4">
            {isLoading ? (
              <div className="text-center py-6 text-slate-400">
                <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2" />
                Loading daily records...
              </div>
            ) : (
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(52px, 1fr))` }}>
                {days.map(d => {
                  const rec = recordByDay[d]
                  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`).getDay()]
                  const status = rec ? (rec.status_final || rec.status_original) : '?'
                  const isSun = dow === 'Sun'

                  return (
                    <div
                      key={d}
                      onClick={() => rec && onEditRecord(rec)}
                      className={clsx(
                        'rounded-lg p-1.5 text-center text-xs cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all min-h-[60px] flex flex-col',
                        isSun ? 'bg-slate-100 text-slate-400' : cellClass(rec)
                      )}
                    >
                      <div className="font-bold">{d}</div>
                      <div className="text-xs opacity-70">{dow}</div>
                      <div className="font-semibold mt-0.5">{status}</div>
                      {rec?.in_time_final && <div className="text-xs opacity-70">{rec.in_time_final}</div>}
                      {rec?.out_time_final && <div className="text-xs opacity-70">{rec.out_time_final}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main page component ─────────────────────────────────────────── */

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COL_SPAN = 13

export default function AttendanceRegister() {
  const { selectedMonth, selectedYear } = useAppStore()
  const { toggle, isExpanded } = useExpandableRows()
  const [filterDept, setFilterDept] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editRecord, setEditRecord] = useState(null)
  const [sortKey, setSortKey] = useState('department')
  const [sortDir, setSortDir] = useState('asc')

  /* ── Fetch all employees summary (auto-loads on mount) ── */
  const { data: summaryRes, isLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['monthly-attendance-summary', selectedMonth, selectedYear],
    queryFn: () => getMonthlyAttendanceSummary(selectedMonth, selectedYear),
    staleTime: 120000,
    keepPreviousData: true,
  })

  const allEmployees = summaryRes?.data?.data || []

  /* ── Mutations ── */
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateAttendanceRecord(id, data),
    onSuccess: () => {
      toast.success('Record updated')
      setEditRecord(null)
      refetchSummary()
    },
  })

  const recalcMutation = useMutation({
    mutationFn: () => recalculateMetrics(selectedMonth, selectedYear),
    onSuccess: (r) => {
      toast.success(`Recalculated metrics for ${r.data.updated} records`)
      refetchSummary()
    },
  })

  /* ── Filters ── */
  const departments = useMemo(() => {
    const set = new Set()
    allEmployees.forEach(e => { if (e.department) set.add(e.department) })
    return Array.from(set).sort()
  }, [allEmployees])

  const employees = useMemo(() => {
    let filtered = allEmployees
    if (filterDept) {
      filtered = filtered.filter(e => e.department?.toLowerCase().includes(filterDept.toLowerCase()))
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(e =>
        e.employee_name?.toLowerCase().includes(term) ||
        e.employee_code?.toLowerCase().includes(term)
      )
    }
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aVal = a[sortKey], bVal = b[sortKey]
      if (typeof aVal === 'string') aVal = (aVal || '').toLowerCase()
      if (typeof bVal === 'string') bVal = (bVal || '').toLowerCase()
      if (aVal == null) aVal = sortDir === 'asc' ? Infinity : -Infinity
      if (bVal == null) bVal = sortDir === 'asc' ? Infinity : -Infinity
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [allEmployees, filterDept, searchTerm, sortKey, sortDir])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="text-slate-300 ml-0.5">&#8645;</span>
    return <span className="text-blue-600 ml-0.5">{sortDir === 'asc' ? '&#9650;' : '&#9660;'}</span>
  }

  /* ── Summary stats ── */
  const stats = useMemo(() => {
    if (!allEmployees.length) return { total: 0, avgAttendance: 0, totalLate: 0, totalCorrections: 0, unresolvedMissPunches: 0 }
    const total = allEmployees.length
    const avgPresent = allEmployees.reduce((sum, e) => sum + (e.present_days || 0), 0)
    const avgTotal = allEmployees.reduce((sum, e) => sum + (e.total_records || 0), 0)
    const avgAttendance = avgTotal > 0 ? ((avgPresent / avgTotal) * 100) : 0
    const totalLate = allEmployees.reduce((sum, e) => sum + (e.late_days || 0), 0)
    const totalCorrections = allEmployees.reduce((sum, e) => sum + (e.corrected_records || 0), 0)
    const unresolvedMissPunches = allEmployees.reduce((sum, e) => sum + (e.unresolved_miss_punches || 0), 0)
    return { total, avgAttendance, totalLate, totalCorrections, unresolvedMissPunches }
  }, [allEmployees])

  /* ── Row styling helper ── */
  function rowBgClass(emp) {
    if (emp.employee_status === 'Left' || emp.employee_status === 'Inactive') return 'bg-slate-50 italic'
    if ((emp.unresolved_miss_punches || 0) > 0) return 'bg-red-50'
    if ((emp.corrected_records || 0) > 0) return 'bg-amber-50'
    return ''
  }

  /* ── Status badge ── */
  function statusBadge(emp) {
    const s = emp.employee_status
    if (s === 'Active') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
    if (s === 'Left') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">Left</span>
    if (s === 'Inactive') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-600">Inactive</span>
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">{s || '--'}</span>
  }

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'active' }} />
      <div className="p-6 space-y-5 max-w-screen-2xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 5: Corrections & Attendance Register</h2>
            <p className="section-subtitle mt-1">
              All employees for {MONTH_NAMES[selectedMonth]} {selectedYear}. Click a row to expand daily detail and make corrections. Click column headers to sort.
            </p>
          </div>
          <button
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
            className="btn-secondary text-xs whitespace-nowrap"
            title="Recalculate actual hours, late arrivals, and night shift flags for all records"
          >
            {recalcMutation.isPending ? 'Recalculating...' : 'Recalculate Metrics'}
          </button>
        </div>

        {/* ── Summary stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="stat-card border-l-4 border-l-blue-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Employees</span>
            <span className="text-2xl font-bold text-blue-700">{stats.total}</span>
          </div>
          <div className="stat-card border-l-4 border-l-green-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Attendance Rate</span>
            <span className="text-2xl font-bold text-green-700">{stats.avgAttendance.toFixed(1)}%</span>
          </div>
          <div className="stat-card border-l-4 border-l-orange-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Late Days</span>
            <span className="text-2xl font-bold text-orange-600">{stats.totalLate}</span>
          </div>
          <div className="stat-card border-l-4 border-l-amber-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Corrections Made</span>
            <span className="text-2xl font-bold text-amber-600">{stats.totalCorrections}</span>
          </div>
          <div className="stat-card border-l-4 border-l-red-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Unresolved Miss Punches</span>
            <span className="text-2xl font-bold text-red-600">{stats.unresolvedMissPunches}</span>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="label">Department</label>
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="select">
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="w-64">
            <label className="label">Search Employee</label>
            <input
              type="search"
              placeholder="Name or code..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input"
            />
          </div>
          <div className="text-xs text-slate-400 self-end pb-2">
            Showing {employees.length} of {allEmployees.length} employees
          </div>
        </div>

        {/* ── Master table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left w-8"></th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('employee_code')}><Abbr code="Emp">Code</Abbr><SortIcon col="employee_code" /></th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('employee_name')}>Name<SortIcon col="employee_name" /></th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('department')}><Abbr code="Dept">Dept</Abbr><SortIcon col="department" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('present_days')}><Abbr code="P">Present</Abbr><SortIcon col="present_days" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('absent_days')}><Abbr code="A">Absent</Abbr><SortIcon col="absent_days" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('half_days')}><Abbr code="½P">Half</Abbr><SortIcon col="half_days" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('late_days')}>Late<SortIcon col="late_days" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('avg_hours')}><Abbr code="Hrs">Avg Hrs</Abbr><SortIcon col="avg_hours" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('unresolved_miss_punches')}>Miss P.<SortIcon col="unresolved_miss_punches" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('corrected_records')}>Corr.<SortIcon col="corrected_records" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort('night_shifts')}>Night<SortIcon col="night_shifts" /></th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={COL_SPAN} className="text-center py-12 text-slate-400">
                      <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2" />
                      Loading employee attendance summary...
                    </td>
                  </tr>
                ) : employees.length === 0 ? (
                  <tr>
                    <td colSpan={COL_SPAN} className="text-center py-12 text-slate-400">
                      {allEmployees.length === 0
                        ? 'No attendance data found for this month. Ensure earlier pipeline stages are complete.'
                        : 'No employees match the current filters.'}
                    </td>
                  </tr>
                ) : (
                  employees.map(emp => (
                    <React.Fragment key={emp.employee_code}>
                      {/* ── Master row ── */}
                      <tr
                        onClick={() => toggle(emp.employee_code)}
                        className={clsx(
                          'border-b border-slate-100 cursor-pointer transition-colors hover:bg-blue-50/50',
                          isExpanded(emp.employee_code) && 'bg-blue-50',
                          rowBgClass(emp)
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <DrillDownChevron isExpanded={isExpanded(emp.employee_code)} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{emp.employee_code}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{emp.employee_name}</td>
                        <td className="px-3 py-2.5 text-slate-600">{emp.department || '--'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold text-xs">
                            {emp.present_days ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={clsx(
                            'inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded font-semibold text-xs',
                            (emp.absent_days || 0) > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-50 text-slate-400'
                          )}>
                            {emp.absent_days ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={clsx(
                            'inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded font-semibold text-xs',
                            (emp.half_days || 0) > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-50 text-slate-400'
                          )}>
                            {emp.half_days ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {(emp.late_days || 0) >= 5 ? (
                            <span className="inline-flex items-center gap-1 font-bold text-red-600 text-xs">
                              <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                              </svg>
                              {emp.late_days}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">{emp.late_days ?? 0}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                          {emp.avg_hours ? Number(emp.avg_hours).toFixed(1) : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {(emp.unresolved_miss_punches || 0) > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold text-xs ring-1 ring-red-200">
                              {emp.unresolved_miss_punches}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {(emp.corrected_records || 0) > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-xs">
                              {emp.corrected_records}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                          {emp.night_shifts ?? 0}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {statusBadge(emp)}
                        </td>
                      </tr>

                      {/* ── Drill-down row ── */}
                      {isExpanded(emp.employee_code) && (
                        <DrillDownRow colSpan={COL_SPAN}>
                          <ExpandedEmployeeDetail
                            emp={emp}
                            month={selectedMonth}
                            year={selectedYear}
                            onEditRecord={setEditRecord}
                          />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'OT', 'Dept', 'Hrs', 'Emp', 'Att']} />
      </div>

      {/* ── CellEditor modal ── */}
      {editRecord && (
        <CellEditor
          record={editRecord}
          onSave={(data) => updateMutation.mutate({ id: editRecord.id, data })}
          onClose={() => setEditRecord(null)}
        />
      )}
    </div>
  )
}
