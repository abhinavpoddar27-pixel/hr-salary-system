import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getMissPunches, resolveMissPunch, bulkResolveMissPunches } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'

const SOURCES = ['Gate Register', 'Production Office', 'Supervisor Confirmed', 'Other']
const ISSUE_LABELS = { MISSING_IN: 'Missing IN', MISSING_OUT: 'Missing OUT', NO_PUNCH: 'No Punch', NIGHT_UNPAIRED: 'Night Unpaired' }

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>
  return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

function EditRow({ record, onSave, onCancel }) {
  const [inTime, setInTime] = useState(record.in_time_final || record.in_time_original || '')
  const [outTime, setOutTime] = useState(record.out_time_final || record.out_time_original || '')
  const [source, setSource] = useState('Gate Register')
  const [remark, setRemark] = useState('')
  const [convertToLeave, setConvertToLeave] = useState(false)

  return (
    <tr className="bg-blue-50/80">
      <td colSpan={10} className="px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">IN Time</label>
            <input type="time" value={inTime} onChange={e => setInTime(e.target.value)} className="input w-32" disabled={convertToLeave} />
          </div>
          <div>
            <label className="label">OUT Time</label>
            <input type="time" value={outTime} onChange={e => setOutTime(e.target.value)} className="input w-32" disabled={convertToLeave} />
          </div>
          <div>
            <label className="label">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)} className="select w-44" disabled={convertToLeave}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="label">Remark</label>
            <input type="text" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Add remark..." className="input w-full" />
          </div>
          <div>
            <label className="label flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={convertToLeave} onChange={e => setConvertToLeave(e.target.checked)} className="rounded" />
              Mark as Leave (Absent)
            </label>
          </div>
          <button onClick={() => onSave({ inTime, outTime, source, remark, convertToLeave })} className="btn-success">Save</button>
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
      </td>
    </tr>
  )
}

export default function MissPunch() {
  const { selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [filterDept, setFilterDept] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterResolved, setFilterResolved] = useState('false')
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm] = useState({ inTime: '', outTime: '', source: 'Gate Register', remark: '' })
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('asc')
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [filterDate, setFilterDate] = useState('')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['miss-punches', selectedMonth, selectedYear, filterDept, filterType, filterResolved],
    queryFn: () => getMissPunches({ month: selectedMonth, year: selectedYear, department: filterDept, resolved: filterResolved }),
    retry: 0
  })

  const filteredRecords = (res?.data?.data || []).filter(r => {
    if (filterType && r.miss_punch_type !== filterType) return false
    if (filterDate && r.date !== filterDate) return false
    return true
  })
  const summary = res?.data?.summary || {}

  // Sorting
  const records = useMemo(() => {
    const sorted = [...filteredRecords]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date':
          cmp = (a.date || '').localeCompare(b.date || '')
          break
        case 'employee':
          cmp = (a.employee_name || a.employee_code || '').localeCompare(b.employee_name || b.employee_code || '')
          break
        case 'department':
          cmp = (a.department || '').localeCompare(b.department || '')
          break
        case 'type':
          cmp = (a.miss_punch_type || '').localeCompare(b.miss_punch_type || '')
          break
        default:
          cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [filteredRecords, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const resolveMutation = useMutation({
    mutationFn: ({ id, data }) => resolveMissPunch(id, data),
    onSuccess: () => { toast.success('Corrected'); setEditId(null); refetch() }
  })

  const bulkMutation = useMutation({
    mutationFn: (data) => bulkResolveMissPunches(data),
    onSuccess: (res) => {
      toast.success(`${res.data.result.success} records corrected`)
      setBulkModal(false)
      setSelected(new Set())
      refetch()
    }
  })

  const handleSave = (id, data) => resolveMutation.mutate({ id, data })

  const handleBulkResolve = () => {
    if (selected.size === 0) return toast.error('Select records first')
    setBulkModal(true)
  }

  const pendingCount = records.filter(r => !r.miss_punch_resolved).length
  const resolvedCount = records.filter(r => r.miss_punch_resolved).length
  const progress = records.length > 0 ? Math.round(resolvedCount / records.length * 100) : 0

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 2: Miss Punch Detection & Rectification</h2>
            <p className="section-subtitle mt-1">Review and correct missing IN/OUT punches. Night shift records are automatically handled in Stage 4.</p>
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <button onClick={handleBulkResolve} className="btn-primary">
                Bulk Correct ({selected.size} selected)
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Resolution Progress</span>
            <span className="text-sm text-slate-500">{resolvedCount} of {records.length} resolved</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400"></span> Missing IN: {summary.byType?.MISSING_IN || 0}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"></span> Missing OUT: {summary.byType?.MISSING_OUT || 0}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span> No Punch: {summary.byType?.NO_PUNCH || 0}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400"></span> Night Unpaired: {summary.byType?.NIGHT_UNPAIRED || 0}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="label"><Abbr code="Dept">Dept</Abbr></label>
            <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="input w-40" />
          </div>
          <div>
            <label className="label">Issue Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="select w-44">
              <option value="">All Types</option>
              {Object.entries(ISSUE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select value={filterResolved} onChange={e => setFilterResolved(e.target.value)} className="select w-36">
              <option value="">All</option>
              <option value="false">Pending</option>
              <option value="true">Resolved</option>
            </select>
          </div>
        </div>

        {/* Calendar slide-out for selected employee */}
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
          <div className="overflow-x-auto">
            <table className="w-full table-compact">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" onChange={e => {
                      if (e.target.checked) setSelected(new Set(records.filter(r => !r.miss_punch_resolved).map(r => r.id)))
                      else setSelected(new Set())
                    }} className="rounded" />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('employee')}>
                    <Abbr code="Emp">Employee</Abbr> <SortIcon field="employee" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('department')}>
                    <Abbr code="Dept">Dept</Abbr> <SortIcon field="department" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('date')}>
                    Date <SortIcon field="date" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th>Status</th>
                  <th>IN</th>
                  <th>OUT</th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('type')}>
                    Issue <SortIcon field="type" sortField={sortField} sortDir={sortDir} />
                  </th>
                  <th>Calendar</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading records...</span>
                    </div>
                  </td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                    {filterResolved === 'false' ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-3xl">✅</span>
                        <span className="font-medium text-emerald-600">All miss punches resolved!</span>
                      </div>
                    ) : 'No records found'}
                  </td></tr>
                ) : (
                  records.map(rec => (
                    <React.Fragment key={rec.id}>
                      <tr className={clsx(
                        rec.miss_punch_resolved && 'opacity-50',
                        editId === rec.id && 'hidden',
                        'transition-all duration-100'
                      )}>
                        <td>
                          {!rec.miss_punch_resolved && (
                            <input type="checkbox" checked={selected.has(rec.id)} onChange={() => {
                              const next = new Set(selected)
                              if (next.has(rec.id)) next.delete(rec.id)
                              else next.add(rec.id)
                              setSelected(next)
                            }} className="rounded" />
                          )}
                        </td>
                        <td>
                          <div className="font-medium text-sm">{rec.employee_name || rec.employee_code}</div>
                          <div className="text-xs text-slate-400 font-mono">{rec.employee_code}</div>
                        </td>
                        <td className="text-slate-600">{rec.department}</td>
                        <td className="font-mono text-sm">{fmtDate(rec.date)}</td>
                        <td><span className={clsx('inline-flex px-2 py-0.5 rounded-md text-xs font-semibold', statusColor(rec.status_final || rec.status_original))}>{rec.status_final || rec.status_original}</span></td>
                        <td className={clsx('font-mono text-sm', !rec.in_time_final && !rec.in_time_original && 'text-red-500 font-bold')}>
                          {rec.in_time_final || rec.in_time_original || '—'}
                        </td>
                        <td className={clsx('font-mono text-sm', !rec.out_time_final && !rec.out_time_original && 'text-red-500 font-bold')}>
                          {rec.out_time_final || rec.out_time_original || '—'}
                        </td>
                        <td>
                          <span className={clsx(
                            'text-xs font-semibold px-2 py-0.5 rounded-md',
                            rec.miss_punch_type === 'NO_PUNCH' ? 'badge-red' :
                            rec.miss_punch_type === 'NIGHT_UNPAIRED' ? 'badge-purple' :
                            rec.miss_punch_type === 'MISSING_IN' ? 'badge-red' :
                            'badge-yellow'
                          )}>
                            {ISSUE_LABELS[rec.miss_punch_type] || rec.miss_punch_type}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => setCalendarEmployee({ code: rec.employee_code, name: rec.employee_name || rec.employee_code })}
                            className="btn-ghost text-xs px-2 py-1 text-blue-600"
                            title="View daily attendance calendar"
                          >
                            📅
                          </button>
                        </td>
                        <td>
                          {rec.miss_punch_resolved ? (
                            <span className="badge-green text-xs">✓ {rec.correction_source}</span>
                          ) : (
                            <button onClick={() => setEditId(rec.id)} className="btn-secondary text-xs px-2 py-1">Correct</button>
                          )}
                        </td>
                      </tr>
                      {editId === rec.id && (
                        <EditRow
                          record={rec}
                          onSave={(data) => handleSave(rec.id, data)}
                          onCancel={() => setEditId(null)}
                        />
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Proceed button */}
        {pendingCount === 0 && records.length > 0 && (
          <div className="card p-5 bg-emerald-50/80 border-emerald-200 flex items-center justify-between animate-slide-up">
            <div className="flex items-center gap-3">
              <span className="text-3xl">✅</span>
              <div>
                <p className="font-bold text-emerald-700">All miss punches resolved!</p>
                <p className="text-sm text-emerald-600">Proceed to Stage 3: Shift Verification</p>
              </div>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['P', 'A', 'WO', 'WOP', '½P', 'Dept', 'Emp', 'Att']} />
      </div>

      {/* Bulk correction modal */}
      {bulkModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-glass-xl animate-scale-in">
            <h3 className="font-bold text-slate-800 text-base mb-4">Bulk Correct {selected.size} Records</h3>
            <div className="space-y-3">
              <div>
                <label className="label">IN Time (apply to all selected)</label>
                <input type="time" value={bulkForm.inTime} onChange={e => setBulkForm(f => ({...f, inTime: e.target.value}))} className="input" />
              </div>
              <div>
                <label className="label">OUT Time (apply to all selected)</label>
                <input type="time" value={bulkForm.outTime} onChange={e => setBulkForm(f => ({...f, outTime: e.target.value}))} className="input" />
              </div>
              <div>
                <label className="label">Verification Source</label>
                <select value={bulkForm.source} onChange={e => setBulkForm(f => ({...f, source: e.target.value}))} className="select">
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Remark</label>
                <input type="text" value={bulkForm.remark} onChange={e => setBulkForm(f => ({...f, remark: e.target.value}))} placeholder="e.g. Biometric was down, all present per gate register" className="input" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => bulkMutation.mutate({ recordIds: [...selected], ...bulkForm })} className="btn-primary flex-1" disabled={bulkMutation.isPending}>
                {bulkMutation.isPending ? 'Applying...' : 'Apply to All Selected'}
              </button>
              <button onClick={() => setBulkModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
