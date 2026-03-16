import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fmtPct } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import clsx from 'clsx'
import api from '../utils/api'

export default function DailyMIS() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState('summary')

  const { data: summaryRes, isLoading } = useQuery({
    queryKey: ['daily-mis-summary', selectedDate],
    queryFn: () => api.get('/daily-mis/summary', { params: { date: selectedDate } })
  })

  const { data: nightRes } = useQuery({
    queryKey: ['daily-mis-night', selectedDate],
    queryFn: () => api.get('/daily-mis/night-shift', { params: { date: selectedDate } })
  })

  const { data: punchedInRes } = useQuery({
    queryKey: ['daily-mis-punched', selectedDate],
    queryFn: () => api.get('/daily-mis/punched-in', { params: { date: selectedDate } }),
    enabled: activeTab === 'punched-in'
  })

  const { data: absentRes } = useQuery({
    queryKey: ['daily-mis-absent', selectedDate],
    queryFn: () => api.get('/daily-mis/absentees', { params: { date: selectedDate } }),
    enabled: activeTab === 'absentees'
  })

  const summary = summaryRes?.data?.data || {}
  const nightShift = nightRes?.data?.data || {}
  const punchedIn = punchedInRes?.data?.data || []
  const absentees = absentRes?.data?.data || []
  const departments = summary.departments || []

  const dateDisplay = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Daily <Abbr code="MIS">MIS</Abbr></h2>
            <p className="section-subtitle mt-1">Real-time attendance dashboard — night shift report, punched-in employees, daily summary.</p>
          </div>
          <div>
            <label className="label">Select Date</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="input" />
          </div>
        </div>

        <p className="text-sm font-medium text-slate-600">{dateDisplay}</p>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="stat-card border-l-4 border-l-blue-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Headcount</span>
            <span className="text-2xl font-bold text-slate-800">{summary.totalEmployees || 0}</span>
          </div>
          <div className="stat-card border-l-4 border-l-emerald-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Present</span>
            <span className="text-2xl font-bold text-emerald-700">{summary.present || 0}</span>
          </div>
          <div className="stat-card border-l-4 border-l-red-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Absent</span>
            <span className="text-2xl font-bold text-red-600">{summary.absent || 0}</span>
          </div>
          <div className="stat-card border-l-4 border-l-amber-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Late</span>
            <span className="text-2xl font-bold text-amber-600">{summary.lateArrivals || 0}</span>
          </div>
          <div className="stat-card border-l-4 border-l-purple-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Punched In</span>
            <span className="text-2xl font-bold text-purple-600">{summary.punchedIn || 0}</span>
          </div>
          <div className="stat-card border-l-4 border-l-indigo-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider"><Abbr code="Att">Att.</Abbr> Rate</span>
            <span className={clsx('text-2xl font-bold', summary.attendanceRate >= 85 ? 'text-green-600' : summary.attendanceRate >= 70 ? 'text-amber-600' : 'text-red-600')}>
              {fmtPct(summary.attendanceRate)}
            </span>
          </div>
        </div>

        {/* Night Shift Report Card */}
        {nightShift.count > 0 && (
          <div className="card p-5 border-l-4 border-l-purple-500">
            <h3 className="text-sm font-bold text-purple-800 mb-3">
              Previous Night Shift Report ({nightShift.date}) — {nightShift.count} workers
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th>IN Time</th>
                    <th>OUT Time</th>
                    <th><Abbr code="Hrs">Hours</Abbr></th>
                    <th>Late</th>
                  </tr>
                </thead>
                <tbody>
                  {nightShift.workers?.map(w => (
                    <tr key={w.employee_code}>
                      <td>
                        <div className="font-medium">{w.employee_name || w.employee_code}</div>
                        <div className="text-xs text-slate-400 font-mono">{w.employee_code}</div>
                      </td>
                      <td className="text-xs">{w.department}</td>
                      <td className="font-mono">{w.in_time || '—'}</td>
                      <td className="font-mono">{w.out_time || '—'}</td>
                      <td className="font-mono">{w.actual_hours ? `${w.actual_hours.toFixed(1)}h` : '—'}</td>
                      <td>
                        {w.is_late_arrival ? (
                          <span className="badge-red text-xs">+{w.late_by_minutes}m</span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Total Night Hours: <span className="font-bold">{nightShift.totalHours?.toFixed(1)}h</span>
            </p>
          </div>
        )}

        {/* Department Breakdown */}
        {departments.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="font-semibold text-slate-700">Department Breakdown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th><Abbr code="Dept">Department</Abbr></th>
                    <th>Total</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Late</th>
                    <th><Abbr code="Att">Att.</Abbr> Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map(d => (
                    <tr key={d.department || 'Unknown'}>
                      <td className="font-medium">{d.department || 'Unknown'}</td>
                      <td className="font-mono">{d.total}</td>
                      <td className="font-mono text-emerald-600">{d.present}</td>
                      <td className="font-mono text-red-600">{d.absent}</td>
                      <td className="font-mono text-amber-600">{d.late}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={clsx('h-full rounded-full', d.rate >= 85 ? 'bg-emerald-500' : d.rate >= 70 ? 'bg-amber-500' : 'bg-red-500')}
                              style={{ width: `${Math.min(d.rate, 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs">{fmtPct(d.rate)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tabs: Punched In / Absentees */}
        <div className="flex gap-1 border-b border-slate-200">
          {['punched-in', 'absentees'].map(t => (
            <button key={t}
              onClick={() => setActiveTab(t)}
              className={clsx('px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px',
                activeTab === t ? 'bg-white text-blue-700 border border-slate-200 border-b-white' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {t === 'punched-in' ? `Currently Punched In (${summary.punchedIn || 0})` : `Absentees (${absentRes?.data?.count || '...'})`}
            </button>
          ))}
        </div>

        {activeTab === 'punched-in' && punchedIn.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th>IN Time</th>
                    <th>Hours So Far</th>
                    <th>Shift</th>
                  </tr>
                </thead>
                <tbody>
                  {punchedIn.map(r => (
                    <tr key={r.employee_code}>
                      <td>
                        <div className="font-medium">{r.employee_name || r.employee_code}</div>
                        <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                      </td>
                      <td className="text-xs">{r.department}</td>
                      <td className="font-mono">{r.in_time}</td>
                      <td className="font-mono">{r.hours_so_far ? `${r.hours_so_far}h` : '—'}</td>
                      <td><span className="badge-blue text-xs">{r.shift_detected || 'DAY'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'absentees' && absentees.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th>Designation</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {absentees.map(r => (
                    <tr key={r.code}>
                      <td>
                        <div className="font-medium">{r.name || r.code}</div>
                        <div className="text-xs text-slate-400 font-mono">{r.code}</div>
                      </td>
                      <td className="text-xs">{r.department}</td>
                      <td className="text-xs">{r.designation}</td>
                      <td>
                        <span className={clsx('text-xs px-2 py-0.5 rounded',
                          r.reason === 'Absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                        )}>{r.reason}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['MIS', 'Att', 'Dept', 'Hrs', 'Emp']} />
      </div>
    </div>
  )
}
