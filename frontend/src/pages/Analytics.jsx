import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter
} from 'recharts'
import { getOrgOverview, getChronicAbsentees, getPunctualityReport, getAttendanceHeatmap } from '../utils/api'
import { useAppStore } from '../store/appStore'
import StatCard from '../components/common/StatCard'
import { fmtDate } from '../utils/formatters'

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4']

export default function Analytics() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [activeTab, setActiveTab] = useState('overview')

  const { data: overviewRes } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  const { data: absenteesRes } = useQuery({
    queryKey: ['chronic-absentees', selectedMonth, selectedYear],
    queryFn: () => getChronicAbsentees(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'absenteeism'
  })
  const absentees = absenteesRes?.data?.data || []

  const { data: punctualityRes } = useQuery({
    queryKey: ['punctuality', selectedMonth, selectedYear],
    queryFn: () => getPunctualityReport(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'punctuality'
  })
  const punctuality = punctualityRes?.data?.data || {}

  const { data: heatmapRes } = useQuery({
    queryKey: ['heatmap', selectedMonth, selectedYear],
    queryFn: () => getAttendanceHeatmap(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'heatmap'
  })
  const heatmap = heatmapRes?.data?.data || {}

  const deptData = Object.values(overview.departments || {}).map(d => ({
    name: d.department?.split(' ').slice(0, 2).join(' ') || 'N/A',
    attendanceRate: parseFloat(d.attendanceRate || 0),
    employees: d.totalEmployees || 0
  }))

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'absenteeism', label: 'Absenteeism' },
    { id: 'punctuality', label: 'Punctuality' },
    { id: 'heatmap', label: 'Heatmap' }
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Attendance Analytics</h2>
        <p className="text-sm text-slate-500">Organisation-wide insights for the selected month</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Avg Attendance Rate" value={`${overview.avgAttendanceRate?.toFixed(1) || 0}%`} color="green" />
        <StatCard label="Total Employees" value={overview.totalEmployees || 0} color="blue" />
        <StatCard label="Total Present Days" value={(overview.totalPresentDays || 0).toLocaleString()} color="purple" />
        <StatCard label="Total Absent Days" value={(overview.totalAbsentDays || 0).toLocaleString()} color="red" />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Dept Attendance Rate Bar Chart */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Department Attendance Rate</h3>
            </div>
            <div className="p-4">
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
            </div>
          </div>

          {/* Dept Table */}
          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Department Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="text-center">Employees</th>
                    <th className="text-center">Present Days</th>
                    <th className="text-center">Absent Days</th>
                    <th className="text-center">Attendance Rate</th>
                    <th className="text-center">Avg Hours</th>
                    <th className="text-center">Miss Punches</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(overview.departments || {}).map((d, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-800">{d.department}</td>
                      <td className="text-center">{d.totalEmployees}</td>
                      <td className="text-center text-green-700">{d.presentDays}</td>
                      <td className="text-center text-red-600">{d.absentDays}</td>
                      <td className="text-center">
                        <span className={`badge ${parseFloat(d.attendanceRate) >= 85 ? 'badge-present' : parseFloat(d.attendanceRate) >= 70 ? 'badge-corrected' : 'badge-absent'}`}>
                          {d.attendanceRate}%
                        </span>
                      </td>
                      <td className="text-center">{d.avgActualHours || '—'}</td>
                      <td className="text-center">{d.missPunchCount || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Absenteeism Tab */}
      {activeTab === 'absenteeism' && (
        <div className="space-y-4">
          <div className="card p-4 bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800">
              <strong>Chronic Absentees</strong> — Employees with less than 50% attendance this month.
              These may require HR intervention.
            </p>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>Department</th>
                    <th className="text-center">Attendance %</th>
                    <th className="text-center">Present</th>
                    <th className="text-center">Absent</th>
                    <th className="text-center">Miss Punches</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {absentees.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-6 text-slate-400">No chronic absentees found</td></tr>
                  ) : absentees.map((a, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-800">{a.employee_name}</td>
                      <td className="text-slate-500">{a.employee_code}</td>
                      <td>{a.department}</td>
                      <td className="text-center">
                        <span className="badge badge-absent">{a.attendanceRate}%</span>
                      </td>
                      <td className="text-center text-green-700">{a.presentDays}</td>
                      <td className="text-center text-red-600">{a.absentDays}</td>
                      <td className="text-center">{a.missPunchCount}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${a.attendanceRate < 25 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {a.attendanceRate < 25 ? 'Critical' : 'At Risk'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Punctuality Tab */}
      {activeTab === 'punctuality' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Habitual Latecomers" value={punctuality.habitualLatecomers?.length || 0} color="red" />
            <StatCard label="Avg Late Minutes" value={`${punctuality.avgLateMinutes?.toFixed(0) || 0} min`} color="amber" />
            <StatCard label="Dept Most Late" value={punctuality.worstDept || '—'} color="purple" />
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Habitual Latecomers (Late ≥ 5 days)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>Department</th>
                    <th className="text-center">Days Late</th>
                    <th className="text-center">Avg Late (min)</th>
                    <th className="text-center">Max Late (min)</th>
                    <th className="text-center">Worst Day</th>
                  </tr>
                </thead>
                <tbody>
                  {(punctuality.habitualLatecomers || []).length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-slate-400">No habitual latecomers found</td></tr>
                  ) : (punctuality.habitualLatecomers || []).map((p, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-800">{p.employee_name}</td>
                      <td className="text-slate-500">{p.employee_code}</td>
                      <td>{p.department}</td>
                      <td className="text-center">
                        <span className="badge badge-absent">{p.daysLate}</span>
                      </td>
                      <td className="text-center text-amber-700">{p.avgLateMinutes?.toFixed(0)} min</td>
                      <td className="text-center text-red-600">{p.maxLateMinutes?.toFixed(0)} min</td>
                      <td className="text-center text-slate-500">{p.worstDay ? fmtDate(p.worstDay) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Department */}
          {punctuality.byDepartment && (
            <div className="card">
              <div className="card-header">
                <h3 className="font-semibold text-slate-700">Late Arrivals by Department</h3>
              </div>
              <div className="p-4">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={Object.entries(punctuality.byDepartment).map(([dept, d]) => ({
                    name: dept.split(' ').slice(0, 2).join(' '),
                    lateEmployees: d.employeesWithLate || 0,
                    avgLate: parseFloat(d.avgLateMinutes || 0).toFixed(0)
                  }))} margin={{ bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="lateEmployees" name="Employees Late" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Heatmap Tab */}
      {activeTab === 'heatmap' && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="text-sm text-slate-500">Attendance heatmap — each cell shows the attendance rate for that employee on that day. Darker green = better attendance.</p>
          </div>
          {heatmap.employees ? (
            <div className="card overflow-auto">
              <div className="p-4 min-w-max">
                <div className="text-xs font-medium text-slate-500 mb-2">
                  Employees × Days — {['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][selectedMonth]} {selectedYear}
                </div>
                {/* Compact heatmap */}
                <div className="space-y-0.5">
                  {(heatmap.employees || []).slice(0, 50).map((emp, ri) => (
                    <div key={ri} className="flex items-center gap-0.5">
                      <div className="w-36 text-xs text-slate-600 truncate pr-2">{emp.name}</div>
                      {(emp.days || []).map((day, di) => (
                        <div
                          key={di}
                          title={`${emp.name} — Day ${di + 1}: ${day.status}`}
                          className={`w-4 h-4 rounded-sm ${
                            day.status === 'P' ? 'bg-green-400' :
                            day.status === 'WOP' ? 'bg-green-600' :
                            day.status === 'A' ? 'bg-red-400' :
                            day.status === 'WO' ? 'bg-slate-200' :
                            day.status === '½P' ? 'bg-yellow-300' :
                            day.status === 'WO½P' ? 'bg-yellow-400' :
                            'bg-slate-100'
                          }`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {/* Legend */}
                <div className="flex gap-3 mt-4 text-xs flex-wrap">
                  {[['P','bg-green-400','Present'],['WOP','bg-green-600','WO Present'],['A','bg-red-400','Absent'],['WO','bg-slate-200','Week Off'],['½P','bg-yellow-300','Half Day']].map(([code, cls, label]) => (
                    <span key={code} className="flex items-center gap-1">
                      <span className={`w-3 h-3 rounded-sm ${cls} inline-block`} />
                      {code} = {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-slate-400">
              <p>Heatmap data not available. Run the salary pipeline first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
