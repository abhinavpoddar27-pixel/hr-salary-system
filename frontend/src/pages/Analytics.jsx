import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts'
import {
  getOrgOverview, getChronicAbsentees, getPunctualityReport,
  getAttendanceHeatmap, getOvertimeReport, getWorkingHoursReport,
  getDepartmentDeepDive
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']

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
      <div className={clsx('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-lg shrink-0', colors[color] || colors.blue)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

const TABS = [
  { id: 'overview', label: 'Overview', path: '/analytics/overview' },
  { id: 'absenteeism', label: 'Absenteeism', path: '/analytics/absenteeism' },
  { id: 'punctuality', label: 'Punctuality', path: '/analytics/punctuality' },
  { id: 'overtime', label: 'Overtime', path: '/analytics/overtime' },
  { id: 'hours', label: 'Working Hours', path: '/analytics/hours' },
]

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════
function OverviewTab() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [expandedDept, setExpandedDept] = useState(null)
  const [calendarEmp, setCalendarEmp] = useState(null)

  const { data: overviewRes } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  const { data: deptRes } = useQuery({
    queryKey: ['dept-deepdive', expandedDept, selectedMonth, selectedYear],
    queryFn: () => getDepartmentDeepDive(expandedDept, selectedMonth, selectedYear),
    enabled: !!expandedDept,
    retry: 0
  })
  const deptDetail = deptRes?.data?.data || {}

  const departments = overview.departments || []
  const deptData = departments.map(d => ({
    name: d.department?.split(' ').slice(0, 2).join(' ') || 'N/A',
    full: d.department,
    attendanceRate: parseFloat(d.attendanceRate || 0),
    employees: d.totalEmployees || 0
  }))

  return (
    <div className="space-y-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KPI icon="👥" label="Employees" value={overview.totalHeadcount || 0} sub={`${overview.permanentCount || 0} perm / ${overview.contractorCount || 0} cont`} color="blue" />
        <KPI icon="✅" label="Attendance Rate" value={`${overview.attendanceRate || 0}%`} color={parseFloat(overview.attendanceRate || 0) >= 85 ? 'green' : 'amber'} />
        <KPI icon="📊" label="Present Days" value={(overview.totalPresentDays || 0).toLocaleString()} color="green" />
        <KPI icon="❌" label="Absent Days" value={(overview.totalAbsentDays || 0).toLocaleString()} color="red" />
        <KPI icon="⏱" label="Avg Hours" value={overview.avgHours || '—'} sub="per working day" color="purple" />
        <KPI icon="🔍" label="Miss Punches" value={overview.missPunchCount || 0} color="amber" />
      </div>

      {/* Dept Attendance Chart */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-700">Department Attendance Rate</h3>
        </div>
        <div className="p-4">
          {deptData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={deptData} margin={{ top: 5, right: 20, left: 0, bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v}%`, 'Attendance Rate']} />
                <Bar dataKey="attendanceRate" name="Attendance %" radius={[4, 4, 0, 0]}>
                  {deptData.map((d, i) => (
                    <Cell key={i} fill={d.attendanceRate >= 85 ? '#22c55e' : d.attendanceRate >= 70 ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-center py-8 text-slate-400">No data — import attendance first</div>}
        </div>
      </div>

      {/* Dept Table */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="font-semibold text-slate-700">Department Breakdown — click row to expand</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Department</th>
                <th className="text-center"><Abbr code="HC">Headcount</Abbr></th>
                <th className="text-center"><Abbr code="P">Present</Abbr></th>
                <th className="text-center"><Abbr code="A">Absent</Abbr></th>
                <th className="text-center">Attendance %</th>
                <th className="text-center"><Abbr code="Hrs">Avg Hours</Abbr></th>
                <th className="text-center">Late</th>
                <th className="text-center"><Abbr code="OT">OT Hrs</Abbr></th>
                <th className="text-center">Miss Punches</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">No department data</td></tr>
              ) : departments.map((d, i) => (
                <React.Fragment key={i}>
                  <tr
                    className={clsx('cursor-pointer transition-colors', expandedDept === d.department && 'bg-blue-50')}
                    onClick={() => setExpandedDept(expandedDept === d.department ? null : d.department)}
                  >
                    <td className="font-medium text-slate-800">
                      <span className="mr-1.5 text-xs text-slate-400">{expandedDept === d.department ? '▼' : '▶'}</span>
                      {d.department}
                      {d.isContractor && <span className="badge-amber text-xs ml-2">Contractor</span>}
                    </td>
                    <td className="text-center font-bold text-slate-700">{d.headcount}</td>
                    <td className="text-center text-green-700">{d.presentDays}</td>
                    <td className="text-center text-red-600">{d.absentDays}</td>
                    <td className="text-center">
                      <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold',
                        parseFloat(d.attendanceRate) >= 85 ? 'bg-green-100 text-green-700' :
                        parseFloat(d.attendanceRate) >= 70 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      )}>
                        {d.attendanceRate}%
                      </span>
                    </td>
                    <td className="text-center">{d.avgActualHours || '—'}</td>
                    <td className="text-center text-amber-600">{d.punctualityIssues || 0}</td>
                    <td className="text-center">{d.overtimeHours || 0}h</td>
                    <td className="text-center">{d.missPunchCount || 0}</td>
                  </tr>

                  {/* Expanded employee rows */}
                  {expandedDept === d.department && (
                    <tr>
                      <td colSpan={9} className="p-0 bg-slate-50">
                        <div className="p-4 animate-slide-up">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Employees in {d.department}</h4>
                          {!deptDetail.employees || deptDetail.employees.length === 0 ? (
                            <div className="text-sm text-slate-400 py-2">Loading...</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-200">
                                  <th className="py-1 text-left text-slate-500">Employee</th>
                                  <th className="py-1 text-center text-slate-500">Present</th>
                                  <th className="py-1 text-center text-slate-500">Absent</th>
                                  <th className="py-1 text-center text-slate-500">Att %</th>
                                  <th className="py-1 text-center text-slate-500">Avg Hrs</th>
                                  <th className="py-1 text-center text-slate-500">Late</th>
                                  <th className="py-1 text-center text-slate-500">Miss</th>
                                  <th className="py-1 text-center text-slate-500">Cal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deptDetail.employees.map((emp, ei) => (
                                  <tr key={ei} className="border-b border-slate-100 hover:bg-white">
                                    <td className="py-1.5">
                                      <span className="font-medium text-slate-700">{emp.name}</span>
                                      <span className="text-slate-400 ml-1">({emp.code})</span>
                                    </td>
                                    <td className="text-center text-green-600">{emp.present}</td>
                                    <td className="text-center text-red-500">{emp.absent}</td>
                                    <td className="text-center">
                                      <span className={clsx(
                                        emp.attendanceRate >= 85 ? 'text-green-600' : emp.attendanceRate >= 70 ? 'text-amber-600' : 'text-red-600'
                                      )}>{emp.attendanceRate}%</span>
                                    </td>
                                    <td className="text-center">{emp.avgHours || '—'}</td>
                                    <td className="text-center text-amber-600">{emp.late}</td>
                                    <td className="text-center">{emp.missPunch}</td>
                                    <td className="text-center">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setCalendarEmp({ code: emp.code, name: emp.name }); }}
                                        className="text-blue-600 hover:text-blue-800"
                                      >📅</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Calendar Overlay */}
      {calendarEmp && (
        <div className="card p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-700">
              Daily Attendance: {calendarEmp.name} ({calendarEmp.code})
            </h3>
            <button onClick={() => setCalendarEmp(null)} className="btn-ghost text-xs">Close</button>
          </div>
          <CalendarView employeeCode={calendarEmp.code} month={selectedMonth} year={selectedYear} />
        </div>
      )}

      <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'OT', 'HC', 'LOP', 'Hrs']} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ABSENTEEISM TAB
// ═══════════════════════════════════════════════════════════
function AbsenteeismTab() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [calendarEmp, setCalendarEmp] = useState(null)

  const { data: res } = useQuery({
    queryKey: ['chronic-absentees', selectedMonth, selectedYear],
    queryFn: () => getChronicAbsentees(selectedMonth, selectedYear),
    retry: 0
  })
  const absentees = res?.data?.data || []

  const critical = absentees.filter(a => a.attendanceRate < 25)
  const atRisk = absentees.filter(a => a.attendanceRate >= 25)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KPI icon="⚠️" label="Chronic Absentees" value={absentees.length} sub="<50% attendance" color="red" />
        <KPI icon="🔴" label="Critical" value={critical.length} sub="<25% attendance" color="red" />
        <KPI icon="🟡" label="At Risk" value={atRisk.length} sub="25-50% attendance" color="amber" />
      </div>

      <div className="card p-4 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-800">
          <strong>Chronic Absentees</strong> — employees below 50% attendance. These may require HR intervention or investigation.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th className="text-center">Attendance %</th>
                <th className="text-center"><Abbr code="P">Present</Abbr></th>
                <th className="text-center">Total Days</th>
                <th>Risk Level</th>
                <th>Cal</th>
              </tr>
            </thead>
            <tbody>
              {absentees.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">No chronic absentees — great news!</td></tr>
              ) : absentees.map((a, i) => (
                <tr key={i}>
                  <td className="font-medium text-slate-800">{a.name}</td>
                  <td className="text-slate-500 font-mono text-xs">{a.code}</td>
                  <td className="text-sm">{a.department}</td>
                  <td className="text-center">
                    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-bold',
                      a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    )}>{a.attendanceRate}%</span>
                  </td>
                  <td className="text-center text-green-700 font-medium">{a.presentDays}</td>
                  <td className="text-center">{a.totalDays}</td>
                  <td>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                      a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {a.attendanceRate < 25 ? 'Critical' : 'At Risk'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => setCalendarEmp({ code: a.code, name: a.name })} className="text-blue-600 hover:text-blue-800">📅</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {calendarEmp && (
        <div className="card p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-700">
              Daily Attendance: {calendarEmp.name} ({calendarEmp.code})
            </h3>
            <button onClick={() => setCalendarEmp(null)} className="btn-ghost text-xs">Close</button>
          </div>
          <CalendarView employeeCode={calendarEmp.code} month={selectedMonth} year={selectedYear} />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// PUNCTUALITY TAB
// ═══════════════════════════════════════════════════════════
function PunctualityTab() {
  const { selectedMonth, selectedYear } = useAppStore()

  const { data: res } = useQuery({
    queryKey: ['punctuality', selectedMonth, selectedYear],
    queryFn: () => getPunctualityReport(selectedMonth, selectedYear),
    retry: 0
  })
  const data = res?.data?.data || {}
  const habituals = data.habitualLatecomers || []
  const deptSummary = data.departmentSummary || []

  const worstDept = deptSummary[0]?.department || '—'
  const avgLateMin = habituals.length > 0 ? Math.round(habituals.reduce((s, e) => s + e.avgLateMinutes, 0) / habituals.length) : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="⏰" label="Habitual Latecomers" value={habituals.length} sub="Late >=50% of days" color="red" />
        <KPI icon="⏳" label="Avg Late" value={`${avgLateMin} min`} color="amber" />
        <KPI icon="📍" label="Worst Dept" value={worstDept.split(' ').slice(0,2).join(' ')} color="purple" />
        <KPI icon="⏱" label="Total Lost Hours" value={deptSummary.reduce((s, d) => s + d.totalLostHours, 0)} sub="across all depts" color="red" />
      </div>

      {/* Department late comparison chart */}
      {deptSummary.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Late Arrivals by Department</h3>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deptSummary.map(d => ({
                name: d.department.split(' ').slice(0, 2).join(' '),
                lateRate: d.lateRate,
                lostHours: d.totalLostHours
              }))} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="lateRate" name="Late %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="lostHours" name="Lost Hours" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Habitual Latecomers Table */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="font-semibold text-slate-700">Habitual Latecomers (Late &ge;50% of working days)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th className="text-center">Late Days</th>
                <th className="text-center">Total Days</th>
                <th className="text-center">Late Rate</th>
                <th className="text-center">Avg Late (min)</th>
                <th className="text-center">Total Late (min)</th>
              </tr>
            </thead>
            <tbody>
              {habituals.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">No habitual latecomers</td></tr>
              ) : habituals.map((e, i) => (
                <tr key={i}>
                  <td className="font-medium text-slate-800">{e.name}</td>
                  <td className="font-mono text-xs text-slate-500">{e.code}</td>
                  <td className="text-sm">{e.department}</td>
                  <td className="text-center font-bold text-red-600">{e.lateDays}</td>
                  <td className="text-center">{e.totalDays}</td>
                  <td className="text-center">
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">{e.lateRate}%</span>
                  </td>
                  <td className="text-center text-amber-600">{e.avgLateMinutes} min</td>
                  <td className="text-center">{e.totalLateMinutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Department Summary Table */}
      {deptSummary.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Department Punctuality Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="text-center">Employees</th>
                  <th className="text-center">Late Rate</th>
                  <th className="text-center">Avg Late (min)</th>
                  <th className="text-center">Total Lost (hrs)</th>
                </tr>
              </thead>
              <tbody>
                {deptSummary.map((d, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-800">{d.department}</td>
                    <td className="text-center">{d.employees}</td>
                    <td className="text-center">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold',
                        d.lateRate > 30 ? 'bg-red-100 text-red-700' : d.lateRate > 15 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                      )}>{d.lateRate}%</span>
                    </td>
                    <td className="text-center text-amber-600">{d.avgLateMinutes} min</td>
                    <td className="text-center text-red-600 font-bold">{d.totalLostHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// OVERTIME TAB
// ═══════════════════════════════════════════════════════════
function OvertimeTab() {
  const { selectedMonth, selectedYear } = useAppStore()

  const { data: res } = useQuery({
    queryKey: ['overtime-report', selectedMonth, selectedYear],
    queryFn: () => getOvertimeReport(selectedMonth, selectedYear),
    retry: 0
  })
  const data = res?.data?.data || {}
  const topOT = data.topOTEmployees || []
  const deptSummary = data.departmentSummary || []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="⏱" label="Total OT Hours" value={data.totalOTHours || 0} color="purple" />
        <KPI icon="👥" label="Employees with OT" value={data.employeesWithOT || 0} color="blue" />
        <KPI icon="📊" label="Top Dept" value={deptSummary[0]?.department?.split(' ').slice(0,2).join(' ') || '—'} sub={`${deptSummary[0]?.totalHours || 0}h`} color="amber" />
        <KPI icon="💰" label="Avg OT/Employee" value={data.employeesWithOT ? `${Math.round(data.totalOTHours / data.employeesWithOT * 10) / 10}h` : '0h'} color="cyan" />
      </div>

      {/* Dept OT Chart */}
      {deptSummary.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700"><Abbr code="OT">Overtime</Abbr> by Department</h3>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deptSummary.map(d => ({
                name: d.department.split(' ').slice(0, 2).join(' '),
                hours: d.totalHours,
                employees: d.employees
              }))} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="hours" name="OT Hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top OT Employees */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="font-semibold text-slate-700">Top Overtime Employees</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>#</th>
                <th>Employee</th>
                <th>Code</th>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th className="text-center"><Abbr code="OT">OT Hours</Abbr></th>
                <th className="text-center">OT Days</th>
                <th className="text-center">Avg/Day</th>
                <th className="text-center">Max (min)</th>
              </tr>
            </thead>
            <tbody>
              {topOT.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">No overtime data</td></tr>
              ) : topOT.map((e, i) => (
                <tr key={i}>
                  <td className="text-slate-400 text-xs">{i + 1}</td>
                  <td className="font-medium text-slate-800">{e.name}</td>
                  <td className="font-mono text-xs text-slate-500">{e.code}</td>
                  <td className="text-sm">{e.department}</td>
                  <td className="text-center font-bold text-purple-600">{e.totalOTHours}h</td>
                  <td className="text-center">{e.otDays}</td>
                  <td className="text-center">{e.avgOTMinutes} min</td>
                  <td className="text-center text-amber-600">{e.maxOT} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dept Summary Table */}
      {deptSummary.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Department OT Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="text-center">Employees</th>
                  <th className="text-center">Total Hours</th>
                  <th className="text-center">Total Days</th>
                  <th className="text-center">Avg/Employee</th>
                </tr>
              </thead>
              <tbody>
                {deptSummary.map((d, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-800">{d.department}</td>
                    <td className="text-center">{d.employees}</td>
                    <td className="text-center font-bold text-purple-600">{d.totalHours}h</td>
                    <td className="text-center">{d.totalDays}</td>
                    <td className="text-center">{d.avgPerEmployee}h</td>
                  </tr>
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
function WorkingHoursTab() {
  const { selectedMonth, selectedYear } = useAppStore()

  const { data: res } = useQuery({
    queryKey: ['working-hours', selectedMonth, selectedYear],
    queryFn: () => getWorkingHoursReport(selectedMonth, selectedYear),
    retry: 0
  })
  const data = res?.data?.data || {}
  const distribution = data.distribution || []
  const topWorkers = data.topWorkers || []
  const lowWorkers = data.lowWorkers || []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPI icon="⏱" label="Avg Hours/Day" value={data.avgHoursPerDay || '—'} color="blue" />
        <KPI icon="📊" label="Total Records" value={(data.totalRecords || 0).toLocaleString()} color="green" />
        <KPI icon="⚠️" label="Low Hours (<7h)" value={lowWorkers.length} sub="employees" color="amber" />
      </div>

      {/* Distribution Histogram */}
      {distribution.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Working Hours Distribution</h3>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                  {distribution.map((d, i) => (
                    <Cell key={i} fill={
                      d.range === '8-9h' || d.range === '9-10h' ? '#22c55e' :
                      d.range === '<6h' || d.range === '>12h' ? '#ef4444' :
                      '#3b82f6'
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Workers */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Highest Avg Hours</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th><Abbr code="Dept">Dept</Abbr></th>
                  <th className="text-center">Avg Hrs</th>
                  <th className="text-center">Days</th>
                </tr>
              </thead>
              <tbody>
                {topWorkers.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400">No data</td></tr>
                ) : topWorkers.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <div className="font-medium text-sm text-slate-800">{e.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{e.code}</div>
                    </td>
                    <td className="text-sm">{e.department}</td>
                    <td className="text-center font-bold text-green-600">{e.avgHours}h</td>
                    <td className="text-center">{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Workers */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Lowest Avg Hours (&lt;7h)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th><Abbr code="Dept">Dept</Abbr></th>
                  <th className="text-center">Avg Hrs</th>
                  <th className="text-center">Days</th>
                </tr>
              </thead>
              <tbody>
                {lowWorkers.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400">No low-hour employees</td></tr>
                ) : lowWorkers.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <div className="font-medium text-sm text-slate-800">{e.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{e.code}</div>
                    </td>
                    <td className="text-sm">{e.department}</td>
                    <td className="text-center font-bold text-red-600">{e.avgHours}h</td>
                    <td className="text-center">{e.count}</td>
                  </tr>
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
  const location = useLocation()

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <h2 className="section-title">Attendance Analytics</h2>
        <p className="section-subtitle mt-1">Organisation-wide insights, trends, and deep-dive analysis</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {TABS.map(t => (
          <NavLink
            key={t.id}
            to={t.path}
            className={({ isActive }) => clsx(
              'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {/* Sub-routes */}
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewTab />} />
        <Route path="absenteeism" element={<AbsenteeismTab />} />
        <Route path="punctuality" element={<PunctualityTab />} />
        <Route path="overtime" element={<OvertimeTab />} />
        <Route path="hours" element={<WorkingHoursTab />} />
      </Routes>
    </div>
  )
}
