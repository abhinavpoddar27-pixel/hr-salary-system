import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getProcessedRecords, getShifts, updateRecordShift } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import { Abbr, Tip } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'

const SHIFT_COLORS = {
  DAY: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', ring: 'ring-blue-400', hoverBg: 'hover:bg-blue-100', activeBg: 'bg-blue-600 text-white' },
  NIGHT: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300', ring: 'ring-purple-400', hoverBg: 'hover:bg-purple-100', activeBg: 'bg-purple-600 text-white' },
  GENERAL: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', ring: 'ring-emerald-400', hoverBg: 'hover:bg-emerald-100', activeBg: 'bg-emerald-600 text-white' },
  DEFAULT: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-300', ring: 'ring-slate-400', hoverBg: 'hover:bg-slate-100', activeBg: 'bg-slate-600 text-white' },
}

function getShiftColor(shiftName) {
  if (!shiftName) return SHIFT_COLORS.DEFAULT
  const name = shiftName.toUpperCase()
  if (name.includes('NIGHT') || name === 'N') return SHIFT_COLORS.NIGHT
  if (name.includes('DAY') || name === 'D') return SHIFT_COLORS.DAY
  if (name.includes('GEN') || name === 'G') return SHIFT_COLORS.GENERAL
  return SHIFT_COLORS.DEFAULT
}

function ShiftPills({ shifts, currentShiftId, onSelect, disabled }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {shifts.map(s => {
        const isActive = s.id === currentShiftId
        const color = getShiftColor(s.name)
        return (
          <button
            key={s.id}
            onClick={() => !isActive && onSelect(s.id)}
            disabled={disabled}
            className={clsx(
              'px-2 py-1 rounded-lg text-xs font-semibold border transition-all duration-150 cursor-pointer',
              isActive
                ? `${color.activeBg} border-transparent shadow-sm scale-105`
                : `${color.bg} ${color.text} ${color.border} ${color.hoverBg} hover:shadow-sm active:scale-95`
            )}
            title={`${s.name}: ${s.start_time}–${s.end_time}${s.grace_minutes > 0 ? ` (+${s.grace_minutes}m grace)` : ''}`}
          >
            {s.name}
          </button>
        )
      })}
    </div>
  )
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>
  return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export default function ShiftVerification() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selected, setSelected] = useState(new Set())
  const [batchShift, setBatchShift] = useState('')
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('asc')

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

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const records = useMemo(() => {
    let filtered = allRecords
    if (filterDept) filtered = filtered.filter(r => r.department?.toLowerCase().includes(filterDept.toLowerCase()))

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date': cmp = (a.date || '').localeCompare(b.date || ''); break
        case 'employee': cmp = (a.employee_name || a.employee_code || '').localeCompare(b.employee_name || b.employee_code || ''); break
        case 'department': cmp = (a.department || '').localeCompare(b.department || ''); break
        case 'late': cmp = (a.late_by_minutes || 0) - (b.late_by_minutes || 0); break
        default: cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted.slice(0, 500)
  }, [allRecords, filterDept, sortField, sortDir])

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
            <p className="section-subtitle mt-1">Click the shift pills to assign the correct shift. Late arrivals and shift mismatches are highlighted.</p>
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

        {/* Shift legend cards */}
        {shifts.length > 0 && (
          <div className="card p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Available Shifts (click on shift pills in each row to assign)</h3>
            <div className="flex flex-wrap gap-2">
              {shifts.map(s => {
                const color = getShiftColor(s.name)
                return (
                  <div key={s.id} className={clsx('px-3 py-2 rounded-xl border text-sm font-medium', color.bg, color.text, color.border)}>
                    <span className="font-bold">{s.name}</span>
                    <span className="text-xs opacity-70 ml-2">{s.start_time}–{s.end_time}</span>
                    {s.grace_minutes > 0 && <span className="text-xs opacity-50 ml-1">(+{s.grace_minutes}m grace)</span>}
                  </div>
                )
              })}
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
                <div className="flex gap-1">
                  {shifts.map(s => {
                    const color = getShiftColor(s.name)
                    const isActive = batchShift === String(s.id)
                    return (
                      <button
                        key={s.id}
                        onClick={() => setBatchShift(String(s.id))}
                        className={clsx(
                          'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                          isActive
                            ? `${color.activeBg} border-transparent shadow-sm`
                            : `${color.bg} ${color.text} ${color.border} ${color.hoverBg}`
                        )}
                      >
                        {s.name}
                      </button>
                    )
                  })}
                </div>
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
            <table className="w-full table-compact text-xs">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" onChange={e => {
                      if (e.target.checked) setSelected(new Set(records.map(r => r.id)))
                      else setSelected(new Set())
                    }} className="rounded" />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('employee')}>
                    <Abbr code="Emp">Employee</Abbr>
                    <SortIcon field="employee" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('department')}>
                    <Abbr code="Dept">Dept</Abbr>
                    <SortIcon field="department" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('date')}>
                    Date
                    <SortIcon field="date" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th><Tip text="Auto-detected shift based on IN time">Current</Tip></th>
                  <th><Tip text="Click a shift pill to assign the correct shift to this record">Assign Shift</Tip></th>
                  <th>IN Time</th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('late')}>
                    <Tip text="Minutes late beyond shift start + grace period">Late</Tip>
                    <SortIcon field="late" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th>OUT Time</th>
                  <th><Abbr code="Hrs">Hours</Abbr></th>
                  <th>Cal</th>
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
                ) : records.map(r => {
                  const currentColor = getShiftColor(r.shift_name || r.shift_detected)
                  return (
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
                      <td className="text-slate-600">{r.department}</td>
                      <td className="font-mono text-sm">{fmtDate(r.date)}</td>
                      <td>
                        <span className={clsx(
                          'inline-flex px-2 py-1 rounded-lg text-xs font-semibold border',
                          currentColor.bg, currentColor.text, currentColor.border
                        )}>
                          {r.shift_name || r.shift_detected || 'DAY'}
                        </span>
                      </td>
                      <td>
                        <ShiftPills
                          shifts={shifts}
                          currentShiftId={r.shift_id}
                          onSelect={(shiftId) => handleShiftChange(r.id, shiftId)}
                          disabled={shiftMutation.isPending}
                        />
                      </td>
                      <td className={clsx('font-mono text-sm', r.is_late_arrival && 'text-red-600 font-semibold')}>
                        {r.in_time_final || r.in_time_original || '—'}
                      </td>
                      <td>
                        {r.is_late_arrival ? (
                          <span className="badge-red text-xs">+{r.late_by_minutes}m</span>
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
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'OT', 'Dept', 'Hrs', 'Att']} />
      </div>
    </div>
  )
}
