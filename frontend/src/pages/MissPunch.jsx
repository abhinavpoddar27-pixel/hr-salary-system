import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal'
import {
  getMissPunches, resolveMissPunch, bulkResolveMissPunches,
  approveMissPunch, rejectMissPunch
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn, canHR as canHRFn } from '../utils/role'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

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
      <td colSpan={12} className="px-4 py-3">
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
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()
  const canFinance = canFinanceFn(user)
  const canHR = canHRFn(user)
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [filterDept, setFilterDept] = useState('')
  const [filterType, setFilterType] = useState('')
  // April 2026: filter by full pipeline state, not just resolved/unresolved.
  //   all | hr-pending | finance-pending | approved | rejected
  // Default to 'all' so nothing is hidden from the user — the old default
  // ('resolved=false') hid every HR-resolved-finance-pending row which was
  // the root cause of the "45 miss punches" confusion.
  const [filterState, setFilterState] = useState('all')
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm] = useState({ inTime: '', outTime: '', source: 'Gate Register', remark: '' })
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('asc')
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const { toggle, isExpanded } = useExpandableRows()
  const [filterDate, setFilterDate] = useState('')
  // Finance reject-reason modal state
  const [finRejectId, setFinRejectId] = useState(null)
  const [finRejectReason, setFinRejectReason] = useState('')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['miss-punches', month, year, filterDept, filterType, filterState, selectedCompany],
    queryFn: () => getMissPunches({ month: month, year: year, department: filterDept, state: filterState, company: selectedCompany }),
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

  // ── Finance approve/reject (April 2026) ──────────────────
  // Inline actions on HR-resolved rows for finance users. Backend
  // endpoints are gated by requireFinanceOrAdmin via
  // /finance-audit/miss-punch/:id/approve|reject. The API helpers
  // pass skipErrorToast so the onError handlers below own the error
  // surface — one toast per failure, with the actual backend message
  // instead of a generic "Reject failed".
  const financeErrorMessage = (e, fallback) => {
    const backendError = e?.response?.data?.error
    if (backendError) return backendError
    if (e?.message === 'Network Error') {
      return 'Network error — backend unreachable. Retry in a moment or check your connection.'
    }
    if (e?.code === 'ECONNABORTED') return 'Request timed out — retry in a moment'
    return e?.message || fallback
  }
  const finApproveMut = useMutation({
    mutationFn: (id) => approveMissPunch(id, ''),
    onSuccess: () => { toast.success('Approved — Stage 6 recalculation required'); refetch() },
    onError: (e) => {
      console.error('[finance approve]', e)
      toast.error(financeErrorMessage(e, 'Approve failed'))
    }
  })
  const finRejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectMissPunch(id, reason),
    onSuccess: () => {
      toast.success('Rejected — ½P credited, awaiting HR re-resolution')
      setFinRejectId(null); setFinRejectReason('')
      refetch()
    },
    onError: (e) => {
      console.error('[finance reject]', e)
      toast.error(financeErrorMessage(e, 'Reject failed'))
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
          <div className="flex items-center gap-3">
            <CompanyFilter />
            <DateSelector {...dateProps} />
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

        {/* Pipeline-state banner + filter chips (April 2026).
            Shows the full breakdown so finance can see the complete
            picture: Detected · HR Pending · Finance Pending · Approved ·
            Rejected. Clicking a chip filters the table to that state;
            counts come from the server-side summary so they stay
            correct regardless of which chip is currently active. */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span><strong>Detected:</strong> <code className="bg-white px-1.5 py-0.5 rounded">{summary.total || 0}</code></span>
            <span><strong>HR Pending:</strong> <code className="bg-white px-1.5 py-0.5 rounded">{summary.hrPending || 0}</code></span>
            <span><strong>Finance Pending:</strong> <code className="bg-white px-1.5 py-0.5 rounded">{summary.financePending || 0}</code></span>
            <span><strong>Approved:</strong> <code className="bg-white px-1.5 py-0.5 rounded text-green-700">{summary.approved || 0}</code></span>
            <span><strong>Rejected:</strong> <code className="bg-white px-1.5 py-0.5 rounded text-red-700">{summary.rejected || 0}</code></span>
            <span className="ml-auto text-slate-500">
              Finance-approved flow to Stage 6/7 · rejected credited as ½P
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: 'all', label: `All (${summary.total || 0})`, color: 'slate' },
              { key: 'hr-pending', label: `HR Pending (${summary.hrPending || 0})`, color: 'amber' },
              { key: 'finance-pending', label: `Finance Pending (${summary.financePending || 0})`, color: 'blue' },
              { key: 'approved', label: `Approved (${summary.approved || 0})`, color: 'green' },
              { key: 'rejected', label: `Rejected (${summary.rejected || 0})`, color: 'red' },
            ].map(c => (
              <button key={c.key} onClick={() => setFilterState(c.key)}
                className={clsx('text-xs px-3 py-1 rounded-full border font-medium transition-colors',
                  filterState === c.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                )}
              >{c.label}</button>
            ))}
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
            <CalendarView employeeCode={calendarEmployee.code} month={month} year={year} />
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
                  <th>HR Review</th>
                  <th>Finance Review</th>
                  <th>Calendar</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={12} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading records...</span>
                    </div>
                  </td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-12 text-slate-400">
                    {filterState === 'hr-pending' ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-3xl">✅</span>
                        <span className="font-medium text-emerald-600">No HR-pending miss punches — all caught up!</span>
                      </div>
                    ) : 'No records in this filter'}
                  </td></tr>
                ) : (
                  records.map(rec => (
                    <React.Fragment key={rec.id}>
                      <tr 
                        onClick={() => editId !== rec.id && toggle(rec.id)}
                        className={clsx(
                          rec.miss_punch_resolved && 'opacity-50',
                          editId === rec.id && 'hidden',
                          'transition-all duration-100 cursor-pointer hover:bg-blue-50/50',
                          isExpanded(rec.id) && 'bg-blue-50/70'
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
                          <div className="flex items-center gap-1.5">
                            <DrillDownChevron isExpanded={isExpanded(rec.id)} />
                            <div>
                              <div className="font-medium text-sm">{rec.employee_name || rec.employee_code}</div>
                              <div className="text-xs text-slate-400 font-mono">{rec.employee_code}</div>
                            </div>
                          </div>
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
                        {/* HR Review column — shows what HR has done.
                            Rejected rows are back in the HR queue and
                            display a distinct red badge so HR knows to
                            re-resolve. Finance-rejected rows get ½P
                            credit at Stage 6 regardless. */}
                        <td>
                          {rec.miss_punch_finance_status === 'rejected' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium"
                              title={rec.miss_punch_finance_notes || 'Finance rejected — HR must re-resolve'}>
                              ⟲ Needs re-resolution
                            </span>
                          ) : rec.miss_punch_resolved ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                              ✓ Resolved
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                              ⏳ Pending
                            </span>
                          )}
                        </td>
                        {/* Finance Review column — parallel to HR status.
                            Pending = HR resolved, waiting for finance.
                            Approved = flows to Stage 6/7.
                            Rejected = ½P credit, visible reason. */}
                        <td>
                          {rec.miss_punch_finance_status === 'approved' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                              ✓ Approved
                            </span>
                          ) : rec.miss_punch_finance_status === 'rejected' ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                                ✕ Rejected
                              </span>
                              {rec.miss_punch_finance_notes && (
                                <span className="text-[9px] text-red-500 max-w-[140px] truncate" title={rec.miss_punch_finance_notes}>
                                  {rec.miss_punch_finance_notes}
                                </span>
                              )}
                              <span className="text-[9px] text-amber-600 italic">½P credited until re-resolved</span>
                            </div>
                          ) : rec.miss_punch_resolved ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                              ⏳ Pending
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCalendarEmployee({ code: rec.employee_code, name: rec.employee_name || rec.employee_code }); }}
                            className="btn-ghost text-xs px-2 py-1 text-blue-600"
                            title="View daily attendance calendar"
                          >
                            📅
                          </button>
                        </td>
                        {/* Action column — role-specific:
                             • HR-pending or finance-rejected (back-to-HR) → Correct button
                             • HR-resolved + finance-pending → finance sees ✓ / ✕ buttons
                             • Approved → read-only (green elsewhere) */}
                        <td onClick={(e) => e.stopPropagation()}>
                          {(!rec.miss_punch_resolved || rec.miss_punch_finance_status === 'rejected') && canHR && (
                            <button onClick={() => setEditId(rec.id)} className="btn-secondary text-xs px-2 py-1">
                              {rec.miss_punch_finance_status === 'rejected' ? 'Re-resolve' : 'Correct'}
                            </button>
                          )}
                          {rec.miss_punch_resolved
                            && (rec.miss_punch_finance_status === 'pending' || !rec.miss_punch_finance_status || rec.miss_punch_finance_status === '')
                            && canFinance && (
                            <div className="flex gap-1">
                              <button onClick={() => finApproveMut.mutate(rec.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✓ Approve</button>
                              <button onClick={() => { setFinRejectId(rec.id); setFinRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✕ Reject</button>
                            </div>
                          )}
                          {rec.miss_punch_finance_status === 'approved' && (
                            <span className="text-[10px] text-green-600">Finalised</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded(rec.id) && (
                        <DrillDownRow colSpan={12}>
                          <EmployeeQuickView
                            employeeCode={rec.employee_code}
                            contextContent={
                              <div>
                                <div className="text-xs font-semibold text-slate-500 mb-2">Miss Punch Details</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div><span className="text-slate-400">Date:</span> <span className="font-medium">{fmtDate(rec.date)}</span></div>
                                  <div><span className="text-slate-400">Issue:</span> <span className="font-medium">{ISSUE_LABELS[rec.miss_punch_type] || rec.miss_punch_type}</span></div>
                                  <div><span className="text-slate-400">Original IN:</span> <span className="font-mono">{rec.in_time_original || '—'}</span></div>
                                  <div><span className="text-slate-400">Original OUT:</span> <span className="font-mono">{rec.out_time_original || '—'}</span></div>
                                  <div><span className="text-slate-400">Final IN:</span> <span className="font-mono">{rec.in_time_final || '—'}</span></div>
                                  <div><span className="text-slate-400">Final OUT:</span> <span className="font-mono">{rec.out_time_final || '—'}</span></div>
                                  {rec.correction_source && <div><span className="text-slate-400">Source:</span> <span className="font-medium">{rec.correction_source}</span></div>}
                                  {rec.correction_remark && <div><span className="text-slate-400">Remark:</span> <span>{rec.correction_remark}</span></div>}
                                </div>
                              </div>
                            }
                          />
                        </DrillDownRow>
                      )}
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

      {/* Finance Reject modal — opened from the Action column on HR-
          resolved rows. Rejection reverts HR's in/out times, sets
          finance_status='rejected' (→ Stage 6 credits ½P), and puts
          the row back in the HR queue for re-resolution. */}
      {finRejectId && (
        <Modal open={true} onClose={() => setFinRejectId(null)} title="Reject Miss Punch Resolution">
          <ModalBody>
            <div className="space-y-3 text-sm">
              <p className="text-xs text-slate-500">
                Rejecting will revert HR's in/out correction. The day will be credited as <strong>½P (half-day present)</strong> in Stage 6 / Stage 7 until HR re-resolves and finance re-approves.
              </p>
              <textarea
                value={finRejectReason}
                onChange={e => setFinRejectReason(e.target.value)}
                className="input w-full h-24"
                placeholder="Rejection reason (required) — e.g. &quot;IN time inconsistent with gate register&quot;, &quot;No supporting evidence provided&quot;, etc."
                autoFocus
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              onClick={() => finRejectMut.mutate({ id: finRejectId, reason: finRejectReason })}
              disabled={!finRejectReason.trim() || finRejectMut.isPending}
              className="btn-danger text-sm"
            >
              {finRejectMut.isPending ? 'Rejecting...' : 'Reject & Credit ½P'}
            </button>
            <button onClick={() => setFinRejectId(null)} className="btn-ghost text-sm">Cancel</button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
