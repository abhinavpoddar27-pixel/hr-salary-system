import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getNightShifts, confirmNightShift, rejectNightShift } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate } from '../utils/formatters'
import { Abbr, Tip } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

function ConfidenceBadge({ confidence }) {
  if (confidence === 'high') return <span className="badge-green">High ✓ Auto-paired</span>
  if (confidence === 'medium') return <span className="badge-yellow">Medium — Needs confirmation</span>
  return <span className="badge-red">Low — Manual required</span>
}

export default function NightShift() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [filter, setFilter] = useState('all')
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const { toggle, isExpanded } = useExpandableRows()

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['night-shifts', selectedMonth, selectedYear],
    queryFn: () => getNightShifts({ month: selectedMonth, year: selectedYear }),
    retry: 0
  })

  const pairs = res?.data?.data || []
  const summary = res?.data?.summary || {}

  const confirmMutation = useMutation({
    mutationFn: confirmNightShift,
    onSuccess: () => { toast.success('Night shift confirmed'); refetch() }
  })

  const rejectMutation = useMutation({
    mutationFn: rejectNightShift,
    onSuccess: () => { toast.success('Pairing rejected — record moved to Miss Punches'); refetch() }
  })

  const filtered = pairs.filter(p => {
    if (filter === 'pending') return !p.is_confirmed && !p.is_rejected
    if (filter === 'confirmed') return p.is_confirmed
    if (filter === 'medium') return p.confidence === 'medium' && !p.is_confirmed
    return true
  })

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div>
          <h2 className="section-title">Stage 4: Night Shift Pairing</h2>
          <p className="section-subtitle mt-1">
            Workers who punch IN at ~20:00 and OUT next morning at ~08:00 are automatically paired here.
            High-confidence pairs are auto-confirmed. Medium and low pairs need your review.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Pairs', value: summary.total || 0, color: 'slate' },
            { label: 'Auto-confirmed', value: summary.confirmed || 0, color: 'green' },
            { label: 'Needs Review', value: (summary.mediumConfidence || 0) + (summary.lowConfidence || 0), color: 'amber' },
            { label: 'High Confidence', value: summary.highConfidence || 0, color: 'emerald' },
            { label: 'Low Confidence', value: summary.lowConfidence || 0, color: 'red' },
          ].map(s => (
            <div key={s.label} className={clsx('stat-card border-l-4', `border-l-${s.color}-400`)}>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</span>
              <span className={clsx('text-2xl font-bold', `text-${s.color}-700`)}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All Pairs' },
            { key: 'pending', label: `Needs Review (${(summary.mediumConfidence || 0) + (summary.lowConfidence || 0)})` },
            { key: 'confirmed', label: 'Confirmed' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={clsx('px-4 py-2 text-sm rounded-lg font-medium transition-colors',
                filter === tab.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Calendar Panel */}
        {calendarEmployee && (
          <div className="card p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">
                Daily Attendance: {calendarEmployee.name} ({calendarEmployee.code})
              </h3>
              <button onClick={() => setCalendarEmployee(null)} className="btn-ghost text-xs">Close</button>
            </div>
            <CalendarView employeeCode={calendarEmployee.code} month={selectedMonth} year={selectedYear} />
          </div>
        )}

        {/* Pairs table */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">Night Shift Pairs — {filtered.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-compact text-xs">
              <thead>
                <tr>
                  <th><Abbr code="Emp">Employee</Abbr></th>
                  <th><Abbr code="Dept">Dept</Abbr></th>
                  <th><Tip text="Date when the night shift IN punch was recorded">IN Date</Tip></th>
                  <th>IN Time</th>
                  <th><Tip text="Date when the morning OUT punch was recorded (next day)">OUT Date</Tip></th>
                  <th>OUT Time</th>
                  <th><Tip text="Total hours worked in the night shift"><Abbr code="Hrs">Hours</Abbr></Tip></th>
                  <th><Tip text="System confidence in the IN/OUT pairing: High=auto-confirmed, Medium/Low=needs review">Confidence</Tip></th>
                  <th>Status</th>
                  <th>Action</th>
                  <th>Cal</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading night shift data...</span>
                    </div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                    {pairs.length === 0 ? 'No night shift data. Import attendance first.' : 'No records in this filter.'}
                  </td></tr>
                ) : (
                  filtered.map(pair => (
                    <React.Fragment key={pair.id}>
                    <tr onClick={() => toggle(pair.id)} className={clsx(
                      pair.is_confirmed && 'bg-green-50/30',
                      pair.is_rejected && 'opacity-40 line-through',
                      'cursor-pointer hover:bg-blue-50/50',
                      isExpanded(pair.id) && 'bg-blue-50/70'
                    )}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <DrillDownChevron isExpanded={isExpanded(pair.id)} />
                          <div>
                            <div className="font-medium text-sm">{pair.employee_name || pair.employee_code}</div>
                            <div className="text-xs text-slate-400 font-mono">{pair.employee_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-slate-600">{pair.department}</td>
                      <td className="font-mono">{fmtDate(pair.in_date)}</td>
                      <td className="font-mono text-purple-700 font-medium">{pair.in_time}</td>
                      <td className="font-mono">{fmtDate(pair.out_date)}</td>
                      <td className="font-mono text-purple-700 font-medium">{pair.out_time}</td>
                      <td className={clsx('font-bold', pair.calculated_hours >= 10 ? 'text-green-600' : 'text-yellow-600')}>
                        {pair.calculated_hours?.toFixed(1)}h
                      </td>
                      <td><ConfidenceBadge confidence={pair.confidence} /></td>
                      <td>
                        {pair.is_rejected ? <span className="badge-red text-xs">Rejected</span>
                          : pair.is_confirmed ? <span className="badge-green text-xs">✓ Confirmed</span>
                          : <span className="badge-yellow text-xs">Pending</span>}
                      </td>
                      <td>
                        {!pair.is_rejected && !pair.is_confirmed && (
                          <div className="flex gap-1">
                            <button onClick={() => confirmMutation.mutate(pair.id)} className="btn-success text-xs px-2 py-1">✓ Confirm</button>
                            <button onClick={() => rejectMutation.mutate(pair.id)} className="btn-danger text-xs px-2 py-1">✕</button>
                          </div>
                        )}
                        {pair.is_confirmed && pair.confidence !== 'high' && (
                          <button onClick={() => rejectMutation.mutate(pair.id)} className="text-xs text-red-400 hover:text-red-600">Undo</button>
                        )}
                      </td>
                      <td>
                        <button
                          onClick={(e) => { e.stopPropagation(); setCalendarEmployee({ code: pair.employee_code, name: pair.employee_name || pair.employee_code }); }}
                          className="btn-ghost text-xs px-2 py-1 text-blue-600"
                          title="View daily attendance"
                        >
                          📅
                        </button>
                      </td>
                    </tr>
                    {isExpanded(pair.id) && (
                      <DrillDownRow colSpan={11}>
                        <EmployeeQuickView
                          employeeCode={pair.employee_code}
                          contextContent={
                            <div>
                              <div className="text-xs font-semibold text-slate-500 mb-2">Night Shift Details</div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><span className="text-slate-400">IN Date:</span> <span className="font-medium">{fmtDate(pair.in_date)}</span></div>
                                <div><span className="text-slate-400">IN Time:</span> <span className="font-mono text-purple-700">{pair.in_time}</span></div>
                                <div><span className="text-slate-400">OUT Date:</span> <span className="font-medium">{fmtDate(pair.out_date)}</span></div>
                                <div><span className="text-slate-400">OUT Time:</span> <span className="font-mono text-purple-700">{pair.out_time}</span></div>
                                <div><span className="text-slate-400">Total Hours:</span> <span className="font-bold">{pair.calculated_hours?.toFixed(1)}h</span></div>
                                <div><span className="text-slate-400">Confidence:</span> <span className="font-medium">{pair.confidence}</span></div>
                                <div><span className="text-slate-400">Status:</span> <span className="font-medium">{pair.is_confirmed ? 'Confirmed' : pair.is_rejected ? 'Rejected' : 'Pending'}</span></div>
                              </div>
                            </div>
                          }
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

        {summary.mediumConfidence === 0 && summary.lowConfidence === 0 && pairs.length > 0 && (
          <div className="card p-4 bg-green-50 border-green-200 flex items-center gap-3 animate-slide-up">
            <span className="text-2xl">🌙</span>
            <div>
              <p className="font-semibold text-green-700">All night shifts confirmed!</p>
              <p className="text-sm text-green-600">{summary.total} night shifts paired. Proceed to Stage 5.</p>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'Dept', 'Hrs', 'Emp', 'Att']} />
      </div>
    </div>
  )
}
