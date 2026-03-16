import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getProcessedRecords, getShifts, updateRecordShift } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'

const SHIFT_COLORS = {
  DAY: 'bg-blue-50 text-blue-700 border-blue-200',
  NIGHT: 'bg-purple-50 text-purple-700 border-purple-200',
  GENERAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DEFAULT: 'bg-slate-50 text-slate-600 border-slate-200',
}

function getShiftColorClass(shiftName) {
  if (!shiftName) return SHIFT_COLORS.DEFAULT
  const name = shiftName.toUpperCase()
  if (name.includes('NIGHT') || name.includes('N')) return SHIFT_COLORS.NIGHT
  if (name.includes('DAY') || name.includes('D')) return SHIFT_COLORS.DAY
  if (name.includes('GEN') || name.includes('G')) return SHIFT_COLORS.GENERAL
  return SHIFT_COLORS.DEFAULT
}

export default function ShiftVerification() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selected, setSelected] = useState(new Set())
  const [batchShift, setBatchShift] = useState('')
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [showAll, setShowAll] = useState(false)

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['processed-records-shift', selectedMonth, selectedYear],
    queryFn: () => getProcessedRecords({ month: selectedMonth, year: selectedYear }),
    retry: 0
  })

  const { data: shiftsRes } = useQuery({
    queryKey: ['shifts'],
    queryFn: getShifts,
    staleTime: 300000
  })

  const shifts = shiftsRes?.data?.data || []

  const allRecords = (res?.data?.data || [])
    .filter(r => r.is_late_arrival || (r.shift_detected && r.shift_detected !== 'DAY') || showAll)

  const records = useMemo(() => {
    let filtered = allRecords
    if (filterDept) filtered = filtered.filter(r => r.department?.toLowerCase().includes(filterDept.toLowerCase()))
    return filtered.slice(0, 500)
  }, [allRecords, filterDept])

  const shiftMutation = useMutation({
    mutationFn: ({ id, shiftId }) => updateRecordShift(id, { shiftId }),
    onSuccess: (res) => {
      toast.success(`Shift updated to ${res.data.data.shiftName}`)
      refetch()
    }
  })

  const handleShiftChange = (recordId, shiftId) => {
    if (!shiftId) return
    shiftMutation.mutate({ id: recordId, shiftId: parseInt(shiftId) })
  }

  const handleBatchAssign = () => {
    if (!batchShift || selected.size === 0) return toast.error('Select records and a shift')
    const ids = [...selected]
    Promise.all(ids.map(id => updateRecordShift(id, { shiftId: parseInt(batchShift) })))
      .then(() => {
        toast.success(`Shift updated for ${ids.length} records`)
        setSelected(new Set())
        setBatchShift('')
        refetch()
      })
      .catch(() => toast.error('Some updates failed'))
  }

  const lateCount = records.filter(r => r.is_late_arrival).length
  const nightCount = records.filter(r => r.shift_detected?.toUpperCase().includes('NIGHT')).length

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 3: Shift Verification</h2>
            <p className="section-subtitle mt-1">Assign correct shifts to employees. Late arrivals and shift mismatches are highlighted.</p>
          </div>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded" />
              Show all records
            </label>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="stat-card border-l-4 border-l-blue-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Records</span>
            <span className="text-2xl font-bold text-slate-800">{records.length}</span>
          </div>
          <div className="stat-card border-l-4 border-l-red-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Late Arrivals</span>
            <span className="text-2xl font-bold text-red-600">{lateCount}</span>
          </div>
          <div className="stat-card border-l-4 border-l-purple-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Night Shifts</span>
            <span className="text-2xl font-bold text-purple-600">{nightCount}</span>
          </div>
          <div className="stat-card border-l-4 border-l-emerald-400">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Shifts Available</span>
            <span className="text-2xl font-bold text-slate-800">{shifts.length}</span>
          </div>
        </div>

        {/* Shift cards */}
        {shifts.length > 0 && (
          <div className="card p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Available Shifts</h3>
            <div className="flex flex-wrap gap-2">
              {shifts.map(s => (
                <div key={s.id} className={clsx(
                  'px-3 py-2 rounded-xl border text-sm font-medium transition-all',
                  getShiftColorClass(s.name)
                )}>
                  <span className="font-bold">{s.name}</span>
                  <span className="text-xs opacity-70 ml-2">{s.start_time}–{s.end_time}</span>
                  {s.grace_minutes > 0 && <span className="text-xs opacity-50 ml-1">(+{s.grace_minutes}m grace)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters & Batch */}
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="label"><Abbr code="Dept">Dept</Abbr></label>
            <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
          </div>
          {selected.size > 0 && (
            <div className="flex gap-2 items-end">
              <div>
                <label className="label">Batch Assign Shift</label>
                <select value={batchShift} onChange={e => setBatchShift(e.target.value)} className="select w-44">
                  <option value="">Select shift...</option>
                  {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
                </select>
              </div>
              <button onClick={handleBatchAssign} className="btn-primary">
                Apply to {selected.size} selected
              </button>
            </div>
          )}
        </div>

        {/* Calendar for selected employee */}
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

        {/* Records Table */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">Shift Exceptions — {records.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-compact">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" onChange={e => {
                      if (e.target.checked) setSelected(new Set(records.map(r => r.id)))
                      else setSelected(new Set())
                    }} className="rounded" />
                  </th>
                  <th><Abbr code="Emp">Employee</Abbr></th>
                  <th><Abbr code="Dept">Dept</Abbr></th>
                  <th>Date</th>
                  <th>Current Shift</th>
                  <th>Assign Shift</th>
                  <th>IN Time</th>
                  <th>Late By</th>
                  <th>OUT Time</th>
                  <th><Abbr code="Hrs">Hours</Abbr></th>
                  <th>Calendar</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading records...</span>
                    </div>
                  </td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                    No shift exceptions found. Import attendance data first.
                  </td></tr>
                ) : records.map(r => (
                  <tr key={r.id} className="transition-colors">
                    <td>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => {
                        const next = new Set(selected)
                        if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                        setSelected(next)
                      }} className="rounded" />
                    </td>
                    <td>
                      <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                      <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                    </td>
                    <td className="text-xs text-slate-600">{r.department}</td>
                    <td className="font-mono text-sm">{fmtDate(r.date)}</td>
                    <td>
                      <span className={clsx(
                        'inline-flex px-2 py-1 rounded-lg text-xs font-semibold border',
                        getShiftColorClass(r.shift_name || r.shift_detected)
                      )}>
                        {r.shift_name || r.shift_detected || 'DAY'}
                      </span>
                    </td>
                    <td>
                      <select
                        className="select text-xs py-1.5 px-2 w-36"
                        defaultValue={r.shift_id || ''}
                        onChange={e => handleShiftChange(r.id, e.target.value)}
                      >
                        <option value="">Change shift...</option>
                        {shifts.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.start_time}–{s.end_time})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={clsx('font-mono text-sm', r.is_late_arrival && 'text-red-600 font-semibold')}>
                      {r.in_time_final || r.in_time_original || '—'}
                    </td>
                    <td>
                      {r.is_late_arrival ? (
                        <span className="badge-red text-xs">+{r.late_by_minutes} min</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="font-mono text-sm">{r.out_time_final || r.out_time_original || '—'}</td>
                    <td className="font-mono text-sm">{r.actual_hours ? `${r.actual_hours.toFixed(1)}h` : '—'}</td>
                    <td>
                      <button
                        onClick={() => setCalendarEmployee({ code: r.employee_code, name: r.employee_name || r.employee_code })}
                        className="btn-ghost text-xs px-2 py-1 text-blue-600"
                        title="View daily attendance"
                      >
                        📅
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'OT', 'Dept', 'Hrs']} />
      </div>
    </div>
  )
}
