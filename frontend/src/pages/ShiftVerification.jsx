import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProcessedRecords } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import clsx from 'clsx'

export default function ShiftVerification() {
  const { selectedMonth, selectedYear } = useAppStore()

  const { data: res, isLoading } = useQuery({
    queryKey: ['processed-records', selectedMonth, selectedYear],
    queryFn: () => getProcessedRecords({ month: selectedMonth, year: selectedYear }),
    retry: 0
  })

  const records = (res?.data?.data || [])
    .filter(r => r.is_late_arrival || (r.shift_detected && r.shift_detected !== 'DAY'))
    .slice(0, 200)

  return (
    <div>
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'active' }} />
      <div className="p-6 max-w-screen-xl">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-800">Stage 3: Shift Verification</h2>
          <p className="text-sm text-slate-500 mt-1">Review attendance records against assigned shift schedules. Late arrivals and shift mismatches are highlighted.</p>
        </div>

        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">Shift Exceptions — {records.length} records</span>
            <span className="badge-yellow">Late arrivals flagged</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-compact">
              <thead>
                <tr>
                  <th>Employee</th><th>Dept</th><th>Date</th>
                  <th>Shift</th><th>IN Time</th><th>Late By</th><th>OUT Time</th>
                  <th>Hours</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading...</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">
                    No shift exceptions found. Import attendance data first.
                  </td></tr>
                ) : records.map(r => (
                  <tr key={r.id}>
                    <td><div className="font-medium text-sm">{r.employee_name || r.employee_code}</div><div className="text-xs text-slate-400">{r.employee_code}</div></td>
                    <td className="text-xs text-slate-600">{r.department}</td>
                    <td className="font-mono text-sm">{fmtDate(r.date)}</td>
                    <td><span className="badge-gray text-xs">{r.shift_name || 'DAY'}</span></td>
                    <td className={clsx('font-mono', r.is_late_arrival ? 'text-red-600 font-medium' : '')}>{r.in_time_final || r.in_time_original || '—'}</td>
                    <td>{r.is_late_arrival ? <span className="badge-red text-xs">+{r.late_by_minutes} min</span> : '—'}</td>
                    <td className="font-mono">{r.out_time_final || r.out_time_original || '—'}</td>
                    <td>{r.actual_hours?.toFixed(1) || '—'}h</td>
                    <td><span className={clsx('badge text-xs px-2 py-0.5 rounded-full', statusColor(r.status_final || r.status_original))}>{r.status_final || r.status_original}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
