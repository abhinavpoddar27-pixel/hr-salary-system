import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getNightShifts, confirmNightShift, rejectNightShift } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate } from '../utils/formatters'
import clsx from 'clsx'

function ConfidenceBadge({ confidence }) {
  if (confidence === 'high') return <span className="badge-green">High ✓ Auto-paired</span>
  if (confidence === 'medium') return <span className="badge-yellow">Medium — Needs confirmation</span>
  return <span className="badge-red">Low — Manual required</span>
}

export default function NightShift() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [filter, setFilter] = useState('all')

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
    <div>
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'active' }} />

      <div className="p-6 space-y-4 max-w-screen-xl">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Stage 4: Night Shift Pairing</h2>
          <p className="text-sm text-slate-500 mt-1">
            The EESL system treats each calendar date independently. Workers who punch IN at ~20:00 and OUT next morning at ~08:00 are automatically paired here.
            High-confidence pairs are auto-confirmed. Medium and low confidence pairs need your review.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Pairs', value: summary.total || 0, color: 'bg-slate-50' },
            { label: 'Auto-confirmed', value: summary.confirmed || 0, color: 'bg-green-50 text-green-700' },
            { label: 'Needs Review', value: (summary.mediumConfidence || 0) + (summary.lowConfidence || 0), color: 'bg-yellow-50 text-yellow-700' },
            { label: 'High Confidence', value: summary.highConfidence || 0, color: 'bg-green-50 text-green-600' },
            { label: 'Low Confidence', value: summary.lowConfidence || 0, color: 'bg-red-50 text-red-600' },
          ].map(s => (
            <div key={s.label} className={clsx('rounded-xl p-3 text-center', s.color, 'border border-slate-200')}>
              <div className="text-xl font-bold">{s.value}</div>
              <div className="text-xs mt-0.5">{s.label}</div>
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

        {/* Pairs table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-compact">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Dept</th>
                  <th>IN Date</th>
                  <th>IN Time</th>
                  <th>OUT Date</th>
                  <th>OUT Time</th>
                  <th>Hours</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-400">Loading night shift data...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-400">
                    {pairs.length === 0 ? 'No night shift data. Import attendance first.' : 'No records in this filter.'}
                  </td></tr>
                ) : (
                  filtered.map(pair => (
                    <tr key={pair.id} className={clsx(
                      pair.is_confirmed && 'bg-green-50/30',
                      pair.is_rejected && 'opacity-40 line-through'
                    )}>
                      <td>
                        <div className="font-medium text-sm">{pair.employee_name || pair.employee_code}</div>
                        <div className="text-xs text-slate-400">{pair.employee_code}</div>
                      </td>
                      <td className="text-slate-600 text-xs">{pair.department}</td>
                      <td className="font-mono text-sm">{fmtDate(pair.in_date)}</td>
                      <td className="font-mono text-purple-700 font-medium">{pair.in_time}</td>
                      <td className="font-mono text-sm">{fmtDate(pair.out_date)}</td>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {summary.mediumConfidence === 0 && summary.lowConfidence === 0 && pairs.length > 0 && (
          <div className="card p-4 bg-green-50 border-green-200 flex items-center gap-3">
            <span className="text-2xl">🌙</span>
            <div>
              <p className="font-semibold text-green-700">All night shifts confirmed!</p>
              <p className="text-sm text-green-600">{summary.total} night shifts paired. Proceed to Stage 5.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
