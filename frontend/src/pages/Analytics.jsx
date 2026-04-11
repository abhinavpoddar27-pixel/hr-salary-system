import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts'
import {
  getOrgOverview, getChronicAbsentees, getPunctualityReport,
  getAttendanceHeatmap, getOvertimeReport, getWorkingHoursReport,
  getDepartmentDeepDive,
  getLateComingAnalytics, getLateComingDeptSummary, getLateComingDeductions,
  applyLateComingDeduction, exportLateComingReport
} from '../utils/api'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
// useMutation is already imported above from '@tanstack/react-query'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import DepartmentQuickView from '../components/ui/DepartmentQuickView'
import CompanyFilter from '../components/shared/CompanyFilter'
import { useAppStore } from '../store/appStore'
import EarlyExitDetection from '../components/EarlyExitDetection'
import clsx from 'clsx'

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']

/* ── Reusable sort hook ────────────────────────────── */
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
    <th onClick={() => sort.toggle(k)} className={clsx('cursor-pointer select-none hover:text-blue-600 transition-colors', className)}>
      {children}{sort.indicator(k)}
    </th>
  )
}

function KPI({ label, value, sub, color = 'blue', icon }) {
  const colors = {
    blue: 'from-blue-500 to-blue-600', green: 'from-emerald-500 to-emerald-600',
    red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-amber-600',
    purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-cyan-600',
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

/* ── Collapsible section for Punctuality tab ─── */
function Section({ title, badge, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full card-header flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
      >
        <h4 className="font-semibold text-slate-700 flex items-center gap-2">
          <span className={clsx('text-xs transition-transform', open && 'rotate-90')}>▶</span>
          {title}
          {badge != null && badge > 0 && (
            <span className="ml-1 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{badge}</span>
          )}
        </h4>
        <span className="text-xs text-slate-400">{open ? 'collapse' : 'expand'}</span>
      </button>
      {open && children}
    </div>
  )
}

const TABS = [
  { id: 'overview', label: 'Overview', path: '/analytics/overview' },
  { id: 'absenteeism', label: 'Absenteeism', path: '/analytics/absenteeism' },
  { id: 'punctuality', label: 'Punctuality', path: '/analytics/punctuality' },
  { id: 'overtime', label: 'Overtime', path: '/analytics/overtime' },
  { id: 'hours', label: 'Working Hours', path: '/analytics/hours' },
  { id: 'early-exit', label: 'Early Exit', path: '/analytics/early-exit' },
]

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════
function OverviewTab({ selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }) {
  const [expandedDept, setExpandedDept] = useState(null)
  const empExpand = useExpandableRows()
  const sort = useSortable('headcount', 'desc')

  const { data: overviewRes, isLoading } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getOrgOverview(null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getOrgOverview(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  const { data: deptRes } = useQuery({
    queryKey: ['dept-deepdive', expandedDept, selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getDepartmentDeepDive(expandedDept, null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getDepartmentDeepDive(expandedDept, selectedMonth, selectedYear, selectedCompany),
    enabled: !!expandedDept,
    retry: 0
  })
  const deptDetail = deptRes?.data?.data || {}

  const departments = useMemo(() => {
    const raw = overview.departments || []
    return [...raw].sort(sort.sortFn)
  }, [overview.departments, sort.sortKey, sort.sortDir])

  const deptData = departments.map(d => ({
    name: d.department?.split(' ').slice(0, 2).join(' ') || 'N/A',
    full: d.department,
    attendanceRate: parseFloat(d.attendanceRate || 0),
    employees: d.totalEmployees || 0
  }))

  return (
    <div className="space-y-5">
      {dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          📅 Showing data for custom range: <strong>{new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong> to <strong>{new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong>
        </div>
      )}
      {isLoading && <div className="text-center py-8 text-slate-400">Loading analytics...</div>}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KPI icon="👥" label="Active Employees" value={overview.totalHeadcount || 0} sub={`${overview.permanentCount || 0} perm / ${overview.contractorCount || 0} cont`} color="blue" />
        <KPI icon="✅" label="Attendance Rate" value={`${overview.attendanceRate || 0}%`} color={parseFloat(overview.attendanceRate || 0) >= 85 ? 'green' : 'amber'} />
        <KPI icon="📊" label="Present Days" value={(overview.totalPresentDays || 0).toLocaleString()} color="green" />
        <KPI icon="❌" label="Absent Days" value={(overview.totalAbsentDays || 0).toLocaleString()} color="red" />
        <KPI icon="⏱" label="Avg Hours" value={overview.avgHours || '—'} sub="per working day" color="purple" />
        <KPI icon="🔍" label="Miss Punches" value={overview.missPunchCount || 0} color="amber" />
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Department Attendance Rate</h3></div>
        <div className="p-4">
          {deptData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={deptData} margin={{ top: 5, right: 20, left: 0, bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v}%`, 'Attendance Rate']} />
                <Bar dataKey="attendanceRate" name="Attendance %" radius={[4, 4, 0, 0]}>
                  {deptData.map((d, i) => <Cell key={i} fill={d.attendanceRate >= 85 ? '#22c55e' : d.attendanceRate >= 70 ? '#f59e0b' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-center py-8 text-slate-400">No data — import attendance first</div>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Department Breakdown — click row to expand | click headers to sort</h3></div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <SortTh sort={sort} k="department">Department</SortTh>
                <SortTh sort={sort} k="headcount" className="text-center">HC</SortTh>
                <SortTh sort={sort} k="presentDays" className="text-center">Present</SortTh>
                <SortTh sort={sort} k="absentDays" className="text-center">Absent</SortTh>
                <SortTh sort={sort} k="attendanceRate" className="text-center">Att %</SortTh>
                <SortTh sort={sort} k="avgActualHours" className="text-center">Avg Hrs</SortTh>
                <SortTh sort={sort} k="punctualityIssues" className="text-center">Late</SortTh>
                <SortTh sort={sort} k="overtimeHours" className="text-center">OT Hrs</SortTh>
                <SortTh sort={sort} k="missPunchCount" className="text-center">Miss</SortTh>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">No department data</td></tr>
              ) : departments.map((d, i) => (
                <React.Fragment key={i}>
                  <tr className={clsx('cursor-pointer transition-colors', expandedDept === d.department && 'bg-blue-50')}
                    onClick={() => setExpandedDept(expandedDept === d.department ? null : d.department)}>
                    <td className="font-medium text-slate-800">
                      <span className="mr-1.5 text-xs text-slate-400">{expandedDept === d.department ? '▼' : '▶'}</span>
                      {d.department}{d.isContractor && <span className="badge-amber text-xs ml-2">Contractor</span>}
                    </td>
                    <td className="text-center font-bold text-slate-700">{d.headcount}</td>
                    <td className="text-center text-green-700">{d.presentDays}</td>
                    <td className="text-center text-red-600">{d.absentDays}</td>
                    <td className="text-center">
                      <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold',
                        parseFloat(d.attendanceRate) >= 85 ? 'bg-green-100 text-green-700' : parseFloat(d.attendanceRate) >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      )}>{d.attendanceRate}%</span>
                    </td>
                    <td className="text-center">{d.avgActualHours || '—'}</td>
                    <td className="text-center text-amber-600">{d.punctualityIssues || 0}</td>
                    <td className="text-center">{d.overtimeHours || 0}h</td>
                    <td className="text-center">{d.missPunchCount || 0}</td>
                  </tr>
                  {expandedDept === d.department && (
                    <tr><td colSpan={9} className="p-0 bg-slate-50">
                      <div className="p-4 animate-slide-up">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Employees in {d.department}</h4>
                        {!deptDetail.employees || deptDetail.employees.length === 0 ? (
                          <div className="text-sm text-slate-400 py-2">Loading...</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-slate-200">
                              <th className="py-1 text-left text-slate-500">Employee</th>
                              <th className="py-1 text-center text-slate-500">Present</th>
                              <th className="py-1 text-center text-slate-500">Absent</th>
                              <th className="py-1 text-center text-slate-500">Att %</th>
                              <th className="py-1 text-center text-slate-500">Avg Hrs</th>
                              <th className="py-1 text-center text-slate-500">Late</th>
                              <th className="py-1 text-center text-slate-500">Miss</th>
                            </tr></thead>
                            <tbody>
                              {deptDetail.employees.map((emp, ei) => (
                                <React.Fragment key={emp.code || ei}>
                                  <tr onClick={(e) => { e.stopPropagation(); empExpand.toggle(emp.code || ei); }} className={clsx('border-b border-slate-100 cursor-pointer transition-colors', empExpand.isExpanded(emp.code || ei) ? 'bg-blue-50' : 'hover:bg-white')}>
                                    <td className="py-1.5"><DrillDownChevron isExpanded={empExpand.isExpanded(emp.code || ei)} /> <span className="font-medium text-slate-700">{emp.name}</span><span className="text-slate-400 ml-1">({emp.code})</span></td>
                                    <td className="text-center text-green-600">{emp.present}</td>
                                    <td className="text-center text-red-500">{emp.absent}</td>
                                    <td className="text-center"><span className={clsx(emp.attendanceRate >= 85 ? 'text-green-600' : emp.attendanceRate >= 70 ? 'text-amber-600' : 'text-red-600')}>{emp.attendanceRate}%</span></td>
                                    <td className="text-center">{emp.avgHours || '—'}</td>
                                    <td className="text-center text-amber-600">{emp.late}</td>
                                    <td className="text-center">{emp.missPunch}</td>
                                  </tr>
                                  {empExpand.isExpanded(emp.code || ei) && (
                                    <DrillDownRow colSpan={7}>
                                      <EmployeeQuickView
                                        employeeCode={emp.code}
                                        showBehavioral
                                        contextContent={
                                          <div>
                                            <div className="text-xs font-semibold text-slate-500 mb-2">Department Overview Stats</div>
                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                              <div className="bg-green-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Present:</span> <span className="font-bold text-green-700">{emp.present}</span></div>
                                              <div className="bg-red-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Absent:</span> <span className="font-bold text-red-600">{emp.absent}</span></div>
                                              <div className="bg-amber-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Late:</span> <span className="font-bold text-amber-700">{emp.late}</span></div>
                                            </div>
                                          </div>
                                        }
                                      />
                                    </DrillDownRow>
                                  )}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'OT', 'HC', 'LOP', 'Hrs']} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ABSENTEEISM TAB
// ═══════════════════════════════════════════════════════════
function AbsenteeismTab({ selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }) {
  const { toggle, isExpanded } = useExpandableRows()
  const sort = useSortable('attendanceRate', 'asc')

  const { data: res, isLoading } = useQuery({
    queryKey: ['chronic-absentees', selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getChronicAbsentees(null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getChronicAbsentees(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const absentees = useMemo(() => [...(res?.data?.data || [])].sort(sort.sortFn), [res, sort.sortKey, sort.sortDir])
  const critical = absentees.filter(a => a.attendanceRate < 25)
  const atRisk = absentees.filter(a => a.attendanceRate >= 25)

  return (
    <div className="space-y-5">
      {dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          📅 Showing data for custom range: <strong>{new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong> to <strong>{new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <KPI icon="⚠️" label="Chronic Absentees" value={absentees.length} sub="<50% attendance" color="red" />
        <KPI icon="🔴" label="Critical" value={critical.length} sub="<25% attendance" color="red" />
        <KPI icon="🟡" label="At Risk" value={atRisk.length} sub="25-50% attendance" color="amber" />
      </div>
      <div className="card p-4 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-800"><strong>Chronic Absentees</strong> — active employees below 50% attendance. Inactive/left employees are excluded.</p>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr>
              <SortTh sort={sort} k="name">Employee</SortTh>
              <SortTh sort={sort} k="code">Code</SortTh>
              <SortTh sort={sort} k="department">Dept</SortTh>
              <SortTh sort={sort} k="attendanceRate" className="text-center">Att %</SortTh>
              <SortTh sort={sort} k="presentDays" className="text-center">Present</SortTh>
              <SortTh sort={sort} k="totalDays" className="text-center">Total Days</SortTh>
              <th>Risk</th>
            </tr></thead>
            <tbody>
              {absentees.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">{isLoading ? 'Loading...' : 'No chronic absentees among active employees'}</td></tr>
              ) : absentees.map((a, i) => (
                <React.Fragment key={a.code || i}>
                  <tr onClick={() => toggle(a.code || i)} className={clsx('cursor-pointer transition-colors', isExpanded(a.code || i) && 'bg-blue-50')}>
                    <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={isExpanded(a.code || i)} /> {a.name}</td>
                    <td className="text-slate-500 font-mono text-xs">{a.code}</td>
                    <td className="text-sm">{a.department}</td>
                    <td className="text-center"><span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-bold', a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{a.attendanceRate}%</span></td>
                    <td className="text-center text-green-700 font-medium">{a.presentDays}</td>
                    <td className="text-center">{a.totalDays}</td>
                    <td><span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{a.attendanceRate < 25 ? 'Critical' : 'At Risk'}</span></td>
                  </tr>
                  {isExpanded(a.code || i) && (
                    <DrillDownRow colSpan={7}>
                      <EmployeeQuickView
                        employeeCode={a.code}
                        showBehavioral
                        contextContent={
                          <div>
                            <div className="text-xs font-semibold text-slate-500 mb-2">Absence Details</div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="bg-red-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Attendance:</span> <span className="font-bold text-red-700">{a.attendanceRate}%</span></div>
                              <div className="bg-green-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Present Days:</span> <span className="font-bold text-green-700">{a.presentDays}</span></div>
                              <div className="bg-slate-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Total Days:</span> <span className="font-bold text-slate-700">{a.totalDays}</span></div>
                            </div>
                            <div className="mt-2">
                              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                                {a.attendanceRate < 25 ? 'Critical — below 25% attendance' : 'At Risk — below 50% attendance'}
                              </span>
                            </div>
                          </div>
                        }
                      />
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// PUNCTUALITY TAB
// ═══════════════════════════════════════════════════════════
// ── Late Coming Phase 1: trend arrow helpers ────────────────
function TrendArrow({ trend }) {
  if (trend === 'up') return <span className="text-red-600 font-bold">↑</span>
  if (trend === 'down') return <span className="text-green-600 font-bold">↓</span>
  return <span className="text-slate-400">→</span>
}

// Late Coming Phase 1: HR deduction modal
function LateComingDeductionModal({ employee, month, year, company, onClose, onSubmit, isPending }) {
  const suggested = `Late coming deduction: ${employee.late_count_this_month} late instances in ${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}. Policy: 4 late = 1 day deduction.`
  const [days, setDays] = useState(Math.max(0.5, Math.min(5, Math.round((employee.late_count_this_month / 4) * 2) / 2 || 0.5)))
  const [remark, setRemark] = useState(suggested)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">Apply Late Coming Deduction</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {employee.employee_code} · {employee.name} · {employee.department || '—'} · Shift {employee.shift_code || '—'}
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-1">
            <div>
              Late <strong>{employee.late_count_this_month} times</strong> this month,{' '}
              <strong>{employee.late_count_last_month} times</strong> last month
              {' '}<TrendArrow trend={employee.trend} />
            </div>
            <div className="text-xs text-slate-600">
              Left late (20+ min past shift end): <strong>{employee.left_late_count_this_month || 0}</strong> times this month
              {employee.left_late_count_last_month ? ` · ${employee.left_late_count_last_month} last month` : ''}
            </div>
          </div>
          <div>
            <label className="label">Deduction Days</label>
            <input
              type="number"
              min="0.5"
              max="5"
              step="0.5"
              value={days}
              onChange={e => setDays(parseFloat(e.target.value))}
              className="input"
            />
            <p className="text-xs text-slate-400 mt-1">Allowed range: 0.5 – 5 days</p>
          </div>
          <div>
            <label className="label">Remark (required)</label>
            <textarea
              rows={3}
              value={remark}
              onChange={e => setRemark(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="p-5 border-t flex gap-2">
          <button
            className="btn-primary flex-1 disabled:opacity-50"
            disabled={isPending || !remark.trim() || !(days > 0 && days <= 5)}
            onClick={() => onSubmit({
              employeeCode: employee.employee_code,
              month, year, company,
              lateCount: employee.late_count_this_month,
              deductionDays: days,
              remark: remark.trim()
            })}
          >
            {isPending ? 'Applying…' : 'Apply Deduction (Pending Finance Review)'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function PunctualityTab({ selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }) {
  const qc = useQueryClient()
  const { user } = useAppStore()
  const canApplyDeduction = user?.role === 'admin' || user?.role === 'hr'
  const sort = useSortable('lateRate', 'desc')
  const deptSort = useSortable('lateRate', 'desc')
  const lcSort = useSortable('late_count_this_month', 'desc')
  const lcDeptSort = useSortable('total_late_instances', 'desc')
  const pendingSort = useSortable('deduction_days', 'desc')
  const lcDeptSummarySort = useSortable('total_late_instances', 'desc')
  const empExpand = useExpandableRows()
  const deptExpand = useExpandableRows()

  // Late Coming Phase 1: filters + deduction modal state
  const [lcShiftFilter, setLcShiftFilter] = useState('')
  const [lcDeptFilter, setLcDeptFilter] = useState('')
  const [deductionEmp, setDeductionEmp] = useState(null)
  // Phase 2: view mode toggle (employee list vs department rollup)
  const [lcViewMode, setLcViewMode] = useState('employee')
  const [lcExpandedDept, setLcExpandedDept] = useState(null)

  const { data: res, isLoading } = useQuery({
    queryKey: ['punctuality', selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getPunctualityReport(null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getPunctualityReport(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const data = res?.data?.data || {}
  const habituals = useMemo(() => [...(data.habitualLatecomers || [])].sort(sort.sortFn), [data, sort.sortKey, sort.sortDir])
  const allEmployees = useMemo(() => [...(data.allEmployees || [])].sort(sort.sortFn), [data, sort.sortKey, sort.sortDir])
  const deptSummary = useMemo(() => [...(data.departmentSummary || [])].sort(deptSort.sortFn), [data, deptSort.sortKey, deptSort.sortDir])

  // Late Coming Phase 1 queries — fed by /api/late-coming endpoints.
  const { data: lcAnalytics } = useQuery({
    queryKey: ['lc-analytics', selectedMonth, selectedYear, selectedCompany, lcShiftFilter],
    queryFn: () => getLateComingAnalytics(selectedMonth, selectedYear, {
      ...(selectedCompany ? { company: selectedCompany } : {}),
      ...(lcShiftFilter ? { shiftCode: lcShiftFilter } : {})
    }),
    retry: 0
  })
  const lcRows = lcAnalytics?.data?.data || []

  const { data: lcDepts } = useQuery({
    queryKey: ['lc-depts', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getLateComingDeptSummary(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const lcDeptRows = lcDepts?.data?.data || []

  const { data: lcDeductions } = useQuery({
    queryKey: ['lc-deductions', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getLateComingDeductions(selectedMonth, selectedYear, {
      ...(selectedCompany ? { company: selectedCompany } : {}),
      status: 'pending'
    }),
    retry: 0
  })
  const pendingDeductions = lcDeductions?.data?.data || []

  const lcDeptsFiltered = useMemo(() => {
    if (!lcDeptFilter) return lcRows
    return lcRows.filter(r => r.department === lcDeptFilter)
  }, [lcRows, lcDeptFilter])
  const lcDisplayRows = useMemo(() => [...lcDeptsFiltered].sort(lcSort.sortFn), [lcDeptsFiltered, lcSort.sortKey, lcSort.sortDir])
  const uniqueLcDepts = useMemo(() => [...new Set(lcRows.map(r => r.department).filter(Boolean))].sort(), [lcRows])
  const lcDeptRowsSorted = useMemo(() => [...lcDeptRows].sort(lcDeptSummarySort.sortFn), [lcDeptRows, lcDeptSummarySort.sortKey, lcDeptSummarySort.sortDir])
  const lcDeptDetailSorted = useMemo(() => [...lcDeptRows].sort(lcDeptSort.sortFn), [lcDeptRows, lcDeptSort.sortKey, lcDeptSort.sortDir])
  const pendingDeductionsSorted = useMemo(() => [...(lcDeductions?.data?.data || [])].sort(pendingSort.sortFn), [lcDeductions, pendingSort.sortKey, pendingSort.sortDir])

  // Summary cards
  const totalLateInstances = lcRows.reduce((s, r) => s + (r.late_count_this_month || 0), 0)
  const habitualCount = lcRows.filter(r => r.late_count_this_month >= 10).length
  const totalLateMinutes = lcRows.reduce((s, r) => s + (r.avg_late_minutes || 0) * (r.late_count_this_month || 0), 0)
  const avgLateDuration = totalLateInstances > 0 ? Math.round(totalLateMinutes / totalLateInstances) : 0
  const totalLeftLate = lcRows.reduce((s, r) => s + (r.left_late_count_this_month || 0), 0)

  const deductionMutation = useMutation({
    mutationFn: (data) => applyLateComingDeduction(data),
    onSuccess: (_, vars) => {
      toast.success(`Deduction applied for ${vars.employeeCode}. Pending finance review.`)
      qc.invalidateQueries({ queryKey: ['lc-deductions'] })
      qc.invalidateQueries({ queryKey: ['lc-analytics'] })
      setDeductionEmp(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to apply deduction')
  })

  const handleExport = async () => {
    try {
      const res = await exportLateComingReport(selectedMonth, selectedYear, selectedCompany)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `late_coming_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error('Export failed')
    }
  }

  const avgLateMin = habituals.length > 0 ? Math.round(habituals.reduce((s, e) => s + e.avgLateMinutes, 0) / habituals.length) : 0
  const displayEmps = habituals.length > 0 ? habituals : allEmployees.filter(e => e.lateDays > 0)

  return (
    <div className="space-y-4">
      {dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          Showing data for custom range: <strong>{new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong> to <strong>{new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong>
        </div>
      )}

      {/* ─── Toolbar: filters + export + view toggle ─── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Late Coming Management</h3>
          <p className="text-xs text-slate-500">Shift-based punctuality tracking &amp; discretionary deductions</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            <button onClick={() => setLcViewMode('employee')}
              className={clsx('px-3 py-1.5 font-medium transition-colors',
                lcViewMode === 'employee' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>Employees</button>
            <button onClick={() => setLcViewMode('department')}
              className={clsx('px-3 py-1.5 font-medium transition-colors border-l border-slate-300',
                lcViewMode === 'department' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>Departments</button>
          </div>
          <select value={lcShiftFilter} onChange={e => setLcShiftFilter(e.target.value)} className="select text-sm">
            <option value="">All Shifts</option>
            <option value="12HR">12-Hour</option>
            <option value="10HR">10-Hour</option>
            <option value="9HR">9-Hour</option>
          </select>
          <select value={lcDeptFilter} onChange={e => setLcDeptFilter(e.target.value)} className="select text-sm">
            <option value="">All Departments</option>
            {uniqueLcDepts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={handleExport} className="btn-secondary text-sm">Export Excel</button>
        </div>
      </div>

      {/* ─── KPI summary (always visible) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="⏰" label="Total Late Instances" value={totalLateInstances} sub="this month" color="amber" />
        <KPI icon="⚠️" label="Habitual Latecomers" value={habitualCount} sub="≥10 late days" color="red" />
        <KPI icon="⏳" label="Avg Late Duration" value={`${avgLateDuration} min`} sub="across all instances" color="amber" />
        <KPI icon="🌙" label="Left Late Count" value={totalLeftLate} sub="20+ min past shift end" color="purple" />
      </div>

      {isLoading && <div className="text-center py-4 text-slate-400">Loading punctuality data...</div>}

      {/* ═══ SECTION: Employee Wise Data ═══ */}
      {lcViewMode === 'employee' && (
        <Section title={`Employee Late Coming Detail (${lcDisplayRows.length})`} defaultOpen={true}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <SortTh sort={lcSort} k="employee_code">Code</SortTh>
                  <SortTh sort={lcSort} k="name">Name</SortTh>
                  <SortTh sort={lcSort} k="department">Dept</SortTh>
                  <SortTh sort={lcSort} k="shift_code" className="text-center">Shift</SortTh>
                  <SortTh sort={lcSort} k="late_count_this_month" className="text-center">Late (Month)</SortTh>
                  <SortTh sort={lcSort} k="late_count_last_month" className="text-center">Late (Prev)</SortTh>
                  <th className="text-center">Trend</th>
                  <SortTh sort={lcSort} k="avg_late_minutes" className="text-center">Avg Min</SortTh>
                  <SortTh sort={lcSort} k="left_late_count_this_month" className="text-center">Left Late</SortTh>
                  <SortTh sort={lcSort} k="left_late_count_last_month" className="text-center">Left Late (Prev)</SortTh>
                  {canApplyDeduction && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {lcDisplayRows.length === 0 ? (
                  <tr><td colSpan={canApplyDeduction ? 11 : 10} className="text-center py-8 text-slate-400">No late arrivals for this period</td></tr>
                ) : lcDisplayRows.map(r => (
                  <tr key={r.employee_code}>
                    <td className="font-mono text-xs text-slate-500">{r.employee_code}</td>
                    <td className="font-medium text-slate-800">{r.name}</td>
                    <td className="text-sm">{r.department}</td>
                    <td className="text-center text-xs">{r.shift_code || '—'}</td>
                    <td className="text-center font-bold text-red-600">{r.late_count_this_month}</td>
                    <td className="text-center text-slate-500">{r.late_count_last_month}</td>
                    <td className="text-center"><TrendArrow trend={r.trend} /></td>
                    <td className="text-center text-amber-600">{r.avg_late_minutes || 0}</td>
                    <td className="text-center text-purple-600">{r.left_late_count_this_month}</td>
                    <td className="text-center text-slate-500">{r.left_late_count_last_month}</td>
                    {canApplyDeduction && (
                      <td>
                        {r.late_count_this_month > 0 && (
                          <button onClick={() => setDeductionEmp(r)} className="text-xs py-0.5 px-2 bg-red-50 text-red-700 rounded hover:bg-red-100 border border-red-200">
                            Apply Deduction
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══ SECTION: Department Wise Data ═══ */}
      {lcViewMode === 'department' && (
        <Section title={`Department Report (${lcDeptRows.length} depts)`} defaultOpen={true}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th></th>
                  <SortTh sort={lcDeptSort} k="department">Department</SortTh>
                  <SortTh sort={lcDeptSort} k="employee_count" className="text-center">Employees</SortTh>
                  <SortTh sort={lcDeptSort} k="total_late_instances" className="text-center">Total Late</SortTh>
                  <th className="text-center">Trend</th>
                  <th className="text-center">Avg Min</th>
                  <SortTh sort={lcDeptSort} k="left_late_count" className="text-center">Left Late</SortTh>
                  <th className="text-center">Ded Days</th>
                  <th>Top 5 Latecomers</th>
                </tr>
              </thead>
              <tbody>
                {lcDeptDetailSorted.map(d => {
                  const deptEmps = lcRows.filter(r => r.department === d.department)
                  const topLatecomers = [...deptEmps]
                    .sort((a, b) => (b.late_count_this_month || 0) - (a.late_count_this_month || 0))
                    .slice(0, 5)
                  const totalMinutes = deptEmps.reduce((s, e) => s + (e.avg_late_minutes || 0) * (e.late_count_this_month || 0), 0)
                  const totalLate = deptEmps.reduce((s, e) => s + (e.late_count_this_month || 0), 0)
                  const avgMin = totalLate > 0 ? Math.round(totalMinutes / totalLate) : 0
                  const deptDedDays = pendingDeductions
                    .filter(p => p.department === d.department)
                    .reduce((s, p) => s + Number(p.deduction_days || 0), 0)
                  const isExpanded = lcExpandedDept === d.department
                  return (
                    <React.Fragment key={d.department}>
                      <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setLcExpandedDept(isExpanded ? null : d.department)}>
                        <td className="text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</td>
                        <td className="font-medium text-slate-700">{d.department}</td>
                        <td className="text-center">{d.employee_count}</td>
                        <td className="text-center font-bold text-amber-600">{d.total_late_instances}</td>
                        <td className="text-center"><TrendArrow trend={d.trend} /></td>
                        <td className="text-center text-amber-600">{avgMin} min</td>
                        <td className="text-center text-purple-600">{d.left_late_count}</td>
                        <td className="text-center text-red-600 font-semibold">{deptDedDays > 0 ? deptDedDays + 'd' : '—'}</td>
                        <td className="text-xs text-slate-600 max-w-[260px]">
                          {topLatecomers.map((e, i) =>
                            <span key={e.employee_code} className="inline-block mr-1">{i > 0 && ', '}{e.name} ({e.late_count_this_month})</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && deptEmps.length > 0 && (
                        <tr>
                          <td colSpan={9} className="bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-600 mb-2">All employees in {d.department}</div>
                            <table className="text-xs w-full">
                              <thead className="text-slate-500">
                                <tr className="border-b border-slate-200">
                                  <th className="py-1 text-left">Name</th>
                                  <th className="py-1 text-left">Shift</th>
                                  <th className="py-1 text-right">Late (Month)</th>
                                  <th className="py-1 text-right">Late (Prev)</th>
                                  <th className="py-1 text-center">Trend</th>
                                  <th className="py-1 text-right">Avg Min</th>
                                  <th className="py-1 text-right">Left Late</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deptEmps
                                  .sort((a, b) => (b.late_count_this_month || 0) - (a.late_count_this_month || 0))
                                  .map(e => (
                                    <tr key={e.employee_code} className="border-b border-slate-100">
                                      <td className="py-1"><span className="font-medium">{e.name}</span> <span className="text-slate-400">({e.employee_code})</span></td>
                                      <td className="py-1">{e.shift_code || '—'}</td>
                                      <td className="py-1 text-right font-bold text-red-600">{e.late_count_this_month}</td>
                                      <td className="py-1 text-right text-slate-500">{e.late_count_last_month}</td>
                                      <td className="py-1 text-center"><TrendArrow trend={e.trend} /></td>
                                      <td className="py-1 text-right text-amber-600">{e.avg_late_minutes || 0}</td>
                                      <td className="py-1 text-right text-purple-600">{e.left_late_count_this_month}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {lcDeptRows.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">No department data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══ SECTION: Department Summary (employee mode compact) ═══ */}
      {lcViewMode === 'employee' && lcDeptRows.length > 0 && (
        <Section title={`Department Summary (${lcDeptRows.length})`} defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <SortTh sort={lcDeptSummarySort} k="department">Department</SortTh>
                  <SortTh sort={lcDeptSummarySort} k="employee_count" className="text-center">Employees</SortTh>
                  <SortTh sort={lcDeptSummarySort} k="total_late_instances" className="text-center">Total Late</SortTh>
                  <th className="text-center">Trend</th>
                  <SortTh sort={lcDeptSummarySort} k="left_late_count" className="text-center">Left Late</SortTh>
                  <th>Worst Offender</th>
                </tr>
              </thead>
              <tbody>
                {lcDeptRowsSorted.map(d => (
                  <tr key={d.department}>
                    <td className="font-medium text-slate-700">{d.department}</td>
                    <td className="text-center">{d.employee_count}</td>
                    <td className="text-center font-bold text-amber-600">{d.total_late_instances}</td>
                    <td className="text-center"><TrendArrow trend={d.trend} /></td>
                    <td className="text-center text-purple-600">{d.left_late_count}</td>
                    <td className="text-xs text-slate-600">
                      {d.worst_offender ? `${d.worst_offender.name} (${d.worst_offender.late_count}×)` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══ SECTION: Pending Deductions ═══ */}
      {pendingDeductions.length > 0 && (
        <Section title="Pending Deductions — Awaiting Finance Review" badge={pendingDeductions.length} defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <SortTh sort={pendingSort} k="name">Employee</SortTh>
                  <SortTh sort={pendingSort} k="department">Dept</SortTh>
                  <SortTh sort={pendingSort} k="late_count" className="text-center">Late Count</SortTh>
                  <SortTh sort={pendingSort} k="deduction_days" className="text-center">Deduction Days</SortTh>
                  <th>Remark</th>
                  <SortTh sort={pendingSort} k="applied_by">Applied By</SortTh>
                  <SortTh sort={pendingSort} k="applied_at">Date</SortTh>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingDeductionsSorted.map(d => (
                  <tr key={d.id}>
                    <td>
                      <div className="font-medium text-slate-800">{d.name || d.employee_code}</div>
                      <div className="font-mono text-xs text-slate-500">{d.employee_code}</div>
                    </td>
                    <td className="text-sm text-slate-600">{d.department || '—'}</td>
                    <td className="text-center">{d.late_count}</td>
                    <td className="text-center font-bold text-red-600">{d.deduction_days}</td>
                    <td className="text-xs text-slate-600 max-w-[320px] truncate" title={d.remark}>{d.remark}</td>
                    <td className="text-xs text-slate-500">{d.applied_by}</td>
                    <td className="text-xs text-slate-500">{(d.applied_at || '').split(' ')[0]}</td>
                    <td className="text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Pending</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {deductionEmp && (
        <LateComingDeductionModal
          employee={deductionEmp}
          month={selectedMonth}
          year={selectedYear}
          company={selectedCompany}
          isPending={deductionMutation.isPending}
          onSubmit={(payload) => deductionMutation.mutate(payload)}
          onClose={() => setDeductionEmp(null)}
        />
      )}

      {/* ═══ SECTION: Habitual Latecomers ═══ */}
      <Section title={habituals.length > 0 ? `Habitual Latecomers — Late ≥50% (${habituals.length})` : `Employees with Late Arrivals (${displayEmps.length})`} defaultOpen={false}>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr>
              <SortTh sort={sort} k="name">Employee</SortTh>
              <SortTh sort={sort} k="code">Code</SortTh>
              <SortTh sort={sort} k="department">Dept</SortTh>
              <SortTh sort={sort} k="lateDays" className="text-center">Late Days</SortTh>
              <SortTh sort={sort} k="totalDays" className="text-center">Total Days</SortTh>
              <SortTh sort={sort} k="lateRate" className="text-center">Late Rate</SortTh>
              <SortTh sort={sort} k="avgLateMinutes" className="text-center">Avg Late (min)</SortTh>
              <SortTh sort={sort} k="totalLateMinutes" className="text-center">Total Late (min)</SortTh>
            </tr></thead>
            <tbody>
              {displayEmps.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">{isLoading ? 'Loading...' : 'No late arrivals recorded'}</td></tr>
              ) : displayEmps.map((e, i) => (
                <React.Fragment key={e.code || i}>
                  <tr onClick={() => empExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', empExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                    <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={empExpand.isExpanded(e.code || i)} /> {e.name}</td>
                    <td className="font-mono text-xs text-slate-500">{e.code}</td>
                    <td className="text-sm">{e.department}</td>
                    <td className="text-center font-bold text-red-600">{e.lateDays}</td>
                    <td className="text-center">{e.totalDays}</td>
                    <td className="text-center"><span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold', e.lateRate >= 50 ? 'bg-red-100 text-red-700' : e.lateRate >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>{e.lateRate}%</span></td>
                    <td className="text-center text-amber-600">{e.avgLateMinutes} min</td>
                    <td className="text-center">{e.totalLateMinutes} min</td>
                  </tr>
                  {empExpand.isExpanded(e.code || i) && (
                    <DrillDownRow colSpan={8}>
                      <EmployeeQuickView
                        employeeCode={e.code}
                        showBehavioral
                        contextContent={
                          <div>
                            <div className="text-xs font-semibold text-slate-500 mb-2">Late Arrival Pattern</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-red-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Late Days:</span> <span className="font-bold text-red-700">{e.lateDays} / {e.totalDays}</span></div>
                              <div className="bg-amber-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Late Rate:</span> <span className="font-bold text-amber-700">{e.lateRate}%</span></div>
                              <div className="bg-orange-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Avg Late:</span> <span className="font-bold text-orange-700">{e.avgLateMinutes} min</span></div>
                              <div className="bg-slate-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Total Late:</span> <span className="font-bold text-slate-700">{e.totalLateMinutes} min</span></div>
                            </div>
                          </div>
                        }
                      />
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ═══ SECTION: Late Arrivals Chart ═══ */}
      {deptSummary.length > 0 && (
        <Section title="Late Arrivals by Department (Chart)" defaultOpen={false}>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deptSummary.map(d => ({ name: d.department?.split(' ').slice(0, 2).join(' '), lateRate: d.lateRate, lostHours: d.totalLostHours }))} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip /><Legend />
                <Bar yAxisId="left" dataKey="lateRate" name="Late %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="lostHours" name="Lost Hours" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ═══ SECTION: Department Punctuality Summary (expandable) ═══ */}
      {deptSummary.length > 0 && (
        <Section title={`Department Punctuality Summary (${deptSummary.length})`} defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr>
                <SortTh sort={deptSort} k="department">Department</SortTh>
                <SortTh sort={deptSort} k="employees" className="text-center">Employees</SortTh>
                <SortTh sort={deptSort} k="lateRate" className="text-center">Late Rate</SortTh>
                <SortTh sort={deptSort} k="avgLateMinutes" className="text-center">Avg Late (min)</SortTh>
                <SortTh sort={deptSort} k="totalLostHours" className="text-center">Total Lost (hrs)</SortTh>
              </tr></thead>
              <tbody>
                {deptSummary.map((d, i) => (
                  <React.Fragment key={d.department || i}>
                    <tr onClick={() => deptExpand.toggle(d.department || i)} className={clsx('cursor-pointer transition-colors', deptExpand.isExpanded(d.department || i) && 'bg-blue-50')}>
                      <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={deptExpand.isExpanded(d.department || i)} /> {d.department}</td>
                      <td className="text-center">{d.employees}</td>
                      <td className="text-center"><span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold', d.lateRate > 30 ? 'bg-red-100 text-red-700' : d.lateRate > 15 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>{d.lateRate}%</span></td>
                      <td className="text-center text-amber-600">{d.avgLateMinutes} min</td>
                      <td className="text-center text-red-600 font-bold">{d.totalLostHours}h</td>
                    </tr>
                    {deptExpand.isExpanded(d.department || i) && (
                      <DrillDownRow colSpan={5}>
                        <DepartmentQuickView department={d.department} />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// OVERTIME TAB
// ═══════════════════════════════════════════════════════════
function OvertimeTab({ selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }) {
  const sort = useSortable('totalOTMinutes', 'desc')
  const deptSort = useSortable('totalHours', 'desc')
  const empExpand = useExpandableRows()
  const deptExpand = useExpandableRows()

  const { data: res, isLoading } = useQuery({
    queryKey: ['overtime-report', selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getOvertimeReport(null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getOvertimeReport(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const data = res?.data?.data || {}
  const topOT = useMemo(() => [...(data.topOTEmployees || [])].sort(sort.sortFn), [data, sort.sortKey, sort.sortDir])
  const deptSummary = useMemo(() => [...(data.departmentSummary || [])].sort(deptSort.sortFn), [data, deptSort.sortKey, deptSort.sortDir])

  return (
    <div className="space-y-5">
      {dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          📅 Showing data for custom range: <strong>{new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong> to <strong>{new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="⏱" label="Total OT Hours" value={data.totalOTHours || 0} color="purple" />
        <KPI icon="👥" label="Employees with OT" value={data.employeesWithOT || 0} color="blue" />
        <KPI icon="📊" label="Top Dept" value={deptSummary[0]?.department?.split(' ').slice(0,2).join(' ') || '—'} sub={`${deptSummary[0]?.totalHours || 0}h`} color="amber" />
        <KPI icon="💰" label="Avg OT/Employee" value={data.employeesWithOT ? `${Math.round(data.totalOTHours / data.employeesWithOT * 10) / 10}h` : '0h'} color="cyan" />
      </div>
      {isLoading && <div className="text-center py-4 text-slate-400">Loading overtime data...</div>}
      {deptSummary.length > 0 && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">OT by Department</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deptSummary.map(d => ({ name: d.department?.split(' ').slice(0, 2).join(' '), hours: d.totalHours, employees: d.employees }))} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="hours" name="OT Hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Top Overtime Employees — {topOT.length}</h3></div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr>
              <th>#</th>
              <SortTh sort={sort} k="name">Employee</SortTh>
              <SortTh sort={sort} k="code">Code</SortTh>
              <SortTh sort={sort} k="department">Dept</SortTh>
              <SortTh sort={sort} k="totalOTHours" className="text-center">OT Hours</SortTh>
              <SortTh sort={sort} k="otDays" className="text-center">OT Days</SortTh>
              <SortTh sort={sort} k="avgOTMinutes" className="text-center">Avg/Day</SortTh>
              <SortTh sort={sort} k="maxOT" className="text-center">Max (min)</SortTh>
            </tr></thead>
            <tbody>
              {topOT.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">{isLoading ? 'Loading...' : 'No overtime data'}</td></tr>
              ) : topOT.map((e, i) => (
                <React.Fragment key={e.code || i}>
                  <tr onClick={() => empExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', empExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={empExpand.isExpanded(e.code || i)} /> {e.name}</td>
                    <td className="font-mono text-xs text-slate-500">{e.code}</td>
                    <td className="text-sm">{e.department}</td>
                    <td className="text-center font-bold text-purple-600">{e.totalOTHours}h</td>
                    <td className="text-center">{e.otDays}</td>
                    <td className="text-center">{e.avgOTMinutes} min</td>
                    <td className="text-center text-amber-600">{e.maxOT} min</td>
                  </tr>
                  {empExpand.isExpanded(e.code || i) && (
                    <DrillDownRow colSpan={8}>
                      <EmployeeQuickView
                        employeeCode={e.code}
                        showBehavioral
                        contextContent={
                          <div>
                            <div className="text-xs font-semibold text-slate-500 mb-2">Overtime Details</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-purple-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Total OT:</span> <span className="font-bold text-purple-700">{e.totalOTHours}h</span></div>
                              <div className="bg-blue-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">OT Days:</span> <span className="font-bold text-blue-700">{e.otDays}</span></div>
                              <div className="bg-amber-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Avg/Day:</span> <span className="font-bold text-amber-700">{e.avgOTMinutes} min</span></div>
                              <div className="bg-red-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Max OT:</span> <span className="font-bold text-red-700">{e.maxOT} min</span></div>
                            </div>
                          </div>
                        }
                      />
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {deptSummary.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Department OT Summary</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr>
                <SortTh sort={deptSort} k="department">Department</SortTh>
                <SortTh sort={deptSort} k="employees" className="text-center">Employees</SortTh>
                <SortTh sort={deptSort} k="totalHours" className="text-center">Total Hours</SortTh>
                <SortTh sort={deptSort} k="totalDays" className="text-center">Total Days</SortTh>
                <SortTh sort={deptSort} k="avgPerEmployee" className="text-center">Avg/Employee</SortTh>
              </tr></thead>
              <tbody>
                {deptSummary.map((d, i) => (
                  <React.Fragment key={d.department || i}>
                    <tr onClick={() => deptExpand.toggle(d.department || i)} className={clsx('cursor-pointer transition-colors', deptExpand.isExpanded(d.department || i) && 'bg-blue-50')}>
                      <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={deptExpand.isExpanded(d.department || i)} /> {d.department}</td>
                      <td className="text-center">{d.employees}</td>
                      <td className="text-center font-bold text-purple-600">{d.totalHours}h</td>
                      <td className="text-center">{d.totalDays}</td>
                      <td className="text-center">{d.avgPerEmployee}h</td>
                    </tr>
                    {deptExpand.isExpanded(d.department || i) && (
                      <DrillDownRow colSpan={5}>
                        <DepartmentQuickView department={d.department} />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <AbbreviationLegend keys={['OT', 'Dept', 'Hrs']} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// WORKING HOURS TAB
// ═══════════════════════════════════════════════════════════
function WorkingHoursTab({ selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }) {
  const topSort = useSortable('avgHours', 'desc')
  const lowSort = useSortable('avgHours', 'asc')
  const topExpand = useExpandableRows()
  const lowExpand = useExpandableRows()

  const { data: res, isLoading } = useQuery({
    queryKey: ['working-hours', selectedMonth, selectedYear, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany],
    queryFn: () => dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd
      ? getWorkingHoursReport(null, null, dateRangeStart, dateRangeEnd, selectedCompany)
      : getWorkingHoursReport(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const data = res?.data?.data || {}
  const distribution = data.distribution || []
  const topWorkers = useMemo(() => [...(data.topWorkers || [])].sort(topSort.sortFn), [data, topSort.sortKey, topSort.sortDir])
  const lowWorkers = useMemo(() => [...(data.lowWorkers || [])].sort(lowSort.sortFn), [data, lowSort.sortKey, lowSort.sortDir])

  return (
    <div className="space-y-5">
      {dateRangeMode === 'custom' && dateRangeStart && dateRangeEnd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          📅 Showing data for custom range: <strong>{new Date(dateRangeStart + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong> to <strong>{new Date(dateRangeEnd + 'T12:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'})}</strong>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPI icon="⏱" label="Avg Hours/Day" value={data.avgHoursPerDay || '—'} color="blue" />
        <KPI icon="📊" label="Total Records" value={(data.totalRecords || 0).toLocaleString()} color="green" />
        <KPI icon="⚠️" label="Low Hours (<7h)" value={lowWorkers.length} sub="employees" color="amber" />
      </div>
      {isLoading && <div className="text-center py-4 text-slate-400">Loading working hours...</div>}
      {distribution.length > 0 && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Working Hours Distribution</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {distribution.map((d, i) => <Cell key={i} fill={d.range === '8-9h' || d.range === '9-10h' ? '#22c55e' : d.range === '<6h' || d.range === '>12h' ? '#ef4444' : '#3b82f6'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Highest Avg Hours — {topWorkers.length}</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr>
                <SortTh sort={topSort} k="name">Employee</SortTh>
                <SortTh sort={topSort} k="department">Dept</SortTh>
                <SortTh sort={topSort} k="avgHours" className="text-center">Avg Hrs</SortTh>
                <SortTh sort={topSort} k="count" className="text-center">Days</SortTh>
              </tr></thead>
              <tbody>
                {topWorkers.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400">{isLoading ? 'Loading...' : 'No data'}</td></tr>
                ) : topWorkers.map((e, i) => (
                  <React.Fragment key={e.code || i}>
                    <tr onClick={() => topExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', topExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                      <td><DrillDownChevron isExpanded={topExpand.isExpanded(e.code || i)} /> <span className="font-medium text-sm text-slate-800">{e.name}</span><div className="text-xs text-slate-400 font-mono ml-4">{e.code}</div></td>
                      <td className="text-sm">{e.department}</td>
                      <td className="text-center font-bold text-green-600">{e.avgHours}h</td>
                      <td className="text-center">{e.count}</td>
                    </tr>
                    {topExpand.isExpanded(e.code || i) && (
                      <DrillDownRow colSpan={4}>
                        <EmployeeQuickView
                          employeeCode={e.code}
                          showBehavioral
                          contextContent={
                            <div>
                              <div className="text-xs font-semibold text-slate-500 mb-2">Working Hours Details</div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-green-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Avg Hours:</span> <span className="font-bold text-green-700">{e.avgHours}h</span></div>
                                <div className="bg-blue-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Working Days:</span> <span className="font-bold text-blue-700">{e.count}</span></div>
                              </div>
                            </div>
                          }
                        />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Lowest Avg Hours (&lt;7h) — {lowWorkers.length}</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr>
                <SortTh sort={lowSort} k="name">Employee</SortTh>
                <SortTh sort={lowSort} k="department">Dept</SortTh>
                <SortTh sort={lowSort} k="avgHours" className="text-center">Avg Hrs</SortTh>
                <SortTh sort={lowSort} k="count" className="text-center">Days</SortTh>
              </tr></thead>
              <tbody>
                {lowWorkers.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400">{isLoading ? 'Loading...' : 'No low-hour employees'}</td></tr>
                ) : lowWorkers.map((e, i) => (
                  <React.Fragment key={e.code || i}>
                    <tr onClick={() => lowExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', lowExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                      <td><DrillDownChevron isExpanded={lowExpand.isExpanded(e.code || i)} /> <span className="font-medium text-sm text-slate-800">{e.name}</span><div className="text-xs text-slate-400 font-mono ml-4">{e.code}</div></td>
                      <td className="text-sm">{e.department}</td>
                      <td className="text-center font-bold text-red-600">{e.avgHours}h</td>
                      <td className="text-center">{e.count}</td>
                    </tr>
                    {lowExpand.isExpanded(e.code || i) && (
                      <DrillDownRow colSpan={4}>
                        <EmployeeQuickView
                          employeeCode={e.code}
                          showBehavioral
                          contextContent={
                            <div>
                              <div className="text-xs font-semibold text-slate-500 mb-2">Working Hours Details</div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-red-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Avg Hours:</span> <span className="font-bold text-red-700">{e.avgHours}h</span></div>
                                <div className="bg-blue-50 rounded-lg px-2 py-1.5"><span className="text-slate-400">Working Days:</span> <span className="font-bold text-blue-700">{e.count}</span></div>
                              </div>
                            </div>
                          }
                        />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <AbbreviationLegend keys={['Hrs', 'OT', 'Dept']} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN ANALYTICS COMPONENT
// ═══════════════════════════════════════════════════════════
export default function Analytics() {
  const { month, year, dateRangeMode, dateRangeStart, dateRangeEnd, dateProps } = useDateSelector({ mode: 'range', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const dp = { selectedMonth: month, selectedYear: year, dateRangeMode, dateRangeStart, dateRangeEnd, selectedCompany }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <h2 className="section-title">Attendance Analytics</h2>
        <p className="section-subtitle mt-1">Organisation-wide insights (active employees only, inactive/left excluded)</p>
      </div>
      <div className="flex items-center gap-3">
        <CompanyFilter />
        <DateSelector {...dateProps} />
      </div>
      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {TABS.map(t => (
          <NavLink key={t.id} to={t.path}
            className={({ isActive }) => clsx('px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>{t.label}</NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewTab {...dp} />} />
        <Route path="absenteeism" element={<AbsenteeismTab {...dp} />} />
        <Route path="punctuality" element={<PunctualityTab {...dp} />} />
        <Route path="overtime" element={<OvertimeTab {...dp} />} />
        <Route path="hours" element={<WorkingHoursTab {...dp} />} />
        <Route path="early-exit" element={<EarlyExitDetection {...dp} />} />
      </Routes>
    </div>
  )
}
