import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getMissPunches, resolveMissPunch, bulkResolveMissPunches } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, statusColor } from '../utils/formatters'
import clsx from 'clsx'

const SOURCES = ['Gate Register', 'Production Office', 'Supervisor Confirmed', 'Other']
const ISSUE_LABELS = { MISSING_IN: 'Missing IN', MISSING_OUT: 'Missing OUT', NO_PUNCH: 'No Punch', NIGHT_UNPAIRED: 'Night Unpaired' }

function EditRow({ record, onSave, onCancel }) {
  const [inTime, setInTime] = useState(record.in_time_final || record.in_time_original || '')
  const [outTime, setOutTime] = useState(record.out_time_final || record.out_time_original || '')
  const [source, setSource] = useState('Gate Register')
  const [remark, setRemark] = useState('')
  const [convertToLeave, setConvertToLeave] = useState(false)

  return (
    <tr className="bg-blue-50">
      <td colSpan={9} className="px-4 py-3">
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
              <input type="checkbox" checked={convertToLeave} onChange={e => setConvertToLeave(e.target.checked)} />
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

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['miss-punches', selectedMonth, selectedYear, filterDept, filterType, filterResolved],
    queryFn: () => getMissPunches({ month: selectedMonth, year: selectedYear, department: filterDept, resolved: filterResolved }),
    retry: 0
  })

  const records = (res?.data?.data || []).filter(r => !filterType || r.miss_punch_type === filterType)
  const summary = res?.data?.summary || {}

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
    <div>
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'active' }} />

      <div className="p-6 space-y-4 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Stage 2: Miss Punch Detection & Rectification</h2>
            <p className="text-sm text-slate-500">Review and correct missing IN/OUT punches. Night shift records are automatically handled in Stage 4.</p>
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
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Resolution Progress</span>
            <span className="text-sm text-slate-500">{resolvedCount} of {records.length} resolved</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span>🔴 Missing IN: {summary.byType?.MISSING_IN || 0}</span>
            <span>🟡 Missing OUT: {summary.byType?.MISSING_OUT || 0}</span>
            <span>⚫ No Punch: {summary.byType?.NO_PUNCH || 0}</span>
            <span>🌙 Night Unpaired: {summary.byType?.NIGHT_UNPAIRED || 0}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="label">Department</label>
            <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
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
                  <th>Employee</th>
                  <th>Dept</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>IN</th>
                  <th>OUT</th>
                  <th>Issue</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading...</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">
                    {filterResolved === 'false' ? '✅ All miss punches resolved!' : 'No records found'}
                  </td></tr>
                ) : (
                  records.map(rec => (
                    <React.Fragment key={rec.id}>
                      <tr className={clsx(rec.miss_punch_resolved && 'opacity-50', editId === rec.id && 'hidden')}>
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
                          <div className="text-xs text-slate-400">{rec.employee_code}</div>
                        </td>
                        <td className="text-slate-600">{rec.department}</td>
                        <td className="font-mono text-sm">{fmtDate(rec.date)}</td>
                        <td><span className={clsx('badge text-xs', statusColor(rec.status_final || rec.status_original))}>{rec.status_final || rec.status_original}</span></td>
                        <td className={clsx('font-mono', !rec.in_time_final && 'text-red-500')}>{rec.in_time_final || rec.in_time_original || <span className="text-red-500">—</span>}</td>
                        <td className={clsx('font-mono', !rec.out_time_final && 'text-red-500')}>{rec.out_time_final || rec.out_time_original || <span className="text-red-500">—</span>}</td>
                        <td>
                          <span className={clsx('badge-yellow text-xs', rec.miss_punch_type === 'NO_PUNCH' && 'badge-red', rec.miss_punch_type === 'NIGHT_UNPAIRED' && 'badge-purple')}>
                            {ISSUE_LABELS[rec.miss_punch_type] || rec.miss_punch_type}
                          </span>
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
          <div className="card p-4 bg-green-50 border-green-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">✅</span>
              <div>
                <p className="font-semibold text-green-700">All miss punches resolved!</p>
                <p className="text-sm text-green-600">Proceed to Stage 3: Shift Verification</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk correction modal */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-slate-800 mb-4">Bulk Correct {selected.size} Records</h3>
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
            <div className="flex gap-3 mt-4">
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
