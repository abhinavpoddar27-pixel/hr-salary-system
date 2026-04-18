import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDWEntries, getDWContractors, submitDWEntry, batchSubmitDWEntries, getDWEntry } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canHR as canHRFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const STATUS_STYLES = {
  hr_entered: 'bg-slate-100 text-slate-600',
  pending_finance: 'bg-amber-100 text-amber-700',
  needs_correction: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
  flagged: 'bg-orange-100 text-orange-700',
  paid: 'bg-blue-100 text-blue-800',
  rejected: 'bg-rose-100 text-rose-700'
}
const STATUS_LABELS = {
  hr_entered: 'Draft', pending_finance: 'Pending Finance', needs_correction: 'Needs Correction',
  approved: 'Approved', flagged: 'Flagged', paid: 'Paid', rejected: 'Rejected'
}

function StatusBadge({ status }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status] || 'bg-slate-100 text-slate-500')}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

export default function DailyWageRecords() {
  const navigate = useNavigate()
  const { user } = useAppStore()
  const canHR = canHRFn(user)
  const qc = useQueryClient()

  // ── Filters ─────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [contractorFilter, setContractorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchText, setSearchText] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])

  // ── Queries ─────────────────────────────────────────────────
  const { data: entriesRes, isLoading } = useQuery({
    queryKey: ['dw-entries', page, statusFilter, contractorFilter, dateFrom, dateTo, searchText],
    queryFn: () => getDWEntries({
      page, limit: 25,
      status: statusFilter || undefined,
      contractor_id: contractorFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: searchText || undefined
    }),
    retry: 0
  })
  const entries = entriesRes?.data?.data || []
  const pagination = entriesRes?.data?.pagination || {}
  const summary = entriesRes?.data?.summary || {}

  const { data: cRes } = useQuery({
    queryKey: ['dw-contractors-all'],
    queryFn: () => getDWContractors(),
    retry: 0
  })
  const contractors = cRes?.data?.data || []

  // ── Mutations ───────────────────────────────────────────────
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['dw-entries'] }) }

  const submitMut = useMutation({
    mutationFn: (id) => submitDWEntry(id),
    onSuccess: () => { invalidate(); toast.success('Submitted for review') },
    onError: (e) => toast.error(e.response?.data?.error || 'Submit failed')
  })

  const batchSubmitMut = useMutation({
    mutationFn: (ids) => batchSubmitDWEntries(ids),
    onSuccess: (res) => { invalidate(); setSelectedIds([]); toast.success(`${res?.data?.submitted || 0} entries submitted`) },
    onError: (e) => toast.error(e.response?.data?.error || 'Batch submit failed')
  })

  // ── Selection ───────────────────────────────────────────────
  const selectableIds = useMemo(() => entries.filter(e => e.status === 'hr_entered').map(e => e.id), [entries])
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id))
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : selectableIds)
  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // ── KPI filter shortcut ─────────────────────────────────────
  const setKPIFilter = (s) => { setStatusFilter(s); setPage(1) }

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Daily Wage Records</h1>
          <p className="text-sm text-slate-500 mt-0.5">All daily wage entries and their status</p>
        </div>
        {canHR && (
          <div className="flex gap-2">
            <button onClick={() => navigate('/daily-wage/import')} className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Batch Import</button>
            <button onClick={() => navigate('/daily-wage/new')} className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">+ New Entry</button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: summary.total || 0, color: 'slate', filter: '' },
          { label: 'Pending Finance', value: summary.pending_finance || 0, color: 'amber', filter: 'pending_finance' },
          { label: 'Approved', value: summary.approved || 0, color: 'green', filter: 'approved' },
          { label: 'Paid', value: summary.paid || 0, color: 'blue', filter: 'paid' },
          { label: 'Rejected', value: summary.rejected || 0, color: 'rose', filter: 'rejected' }
        ].map(kpi => (
          <button key={kpi.label} onClick={() => setKPIFilter(kpi.filter)}
            className={clsx('bg-white rounded-lg border p-3 text-left transition-colors hover:border-blue-300',
              statusFilter === kpi.filter ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200')}>
            <div className={clsx('text-xl font-bold', `text-${kpi.color}-700`)}>{kpi.value}</div>
            <div className="text-[10px] text-slate-400 uppercase font-medium">{kpi.label}</div>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-2">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={contractorFilter} onChange={e => { setContractorFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.contractor_name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} placeholder="From"
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} placeholder="To"
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="text" value={searchText} onChange={e => { setSearchText(e.target.value); setPage(1) }} placeholder="Search gate ref / notes..."
          className="flex-1 min-w-[150px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        {(statusFilter || contractorFilter || dateFrom || dateTo || searchText) && (
          <button onClick={() => { setStatusFilter(''); setContractorFilter(''); setDateFrom(''); setDateTo(''); setSearchText(''); setPage(1) }}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Clear</button>
        )}
      </div>

      {/* Batch Submit Bar */}
      {canHR && selectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-blue-700">{selectedIds.length} entries selected</span>
          <button onClick={() => batchSubmitMut.mutate(selectedIds)} disabled={batchSubmitMut.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {batchSubmitMut.isPending ? 'Submitting...' : 'Submit Selected for Review'}
          </button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-slate-400">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg">No entries found</p>
          <p className="text-sm mt-1">Create a new entry or adjust your filters</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                {canHR && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="rounded border-slate-300" disabled={selectableIds.length === 0} />
                  </th>
                )}
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Contractor</th>
                <th className="px-3 py-3">Workers</th>
                <th className="px-3 py-3">Departments</th>
                <th className="px-3 py-3">Liability</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map(e => (
                <React.Fragment key={e.id}>
                  <tr className={clsx('hover:bg-slate-50 cursor-pointer transition-colors', expandedId === e.id && 'bg-blue-50/50')}
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                    {canHR && (
                      <td className="px-3 py-3" onClick={ev => ev.stopPropagation()}>
                        {e.status === 'hr_entered' && (
                          <input type="checkbox" checked={selectedIds.includes(e.id)}
                            onChange={() => toggleSelect(e.id)} className="rounded border-slate-300" />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-3 font-medium text-slate-700">{e.entry_date}</td>
                    <td className="px-3 py-3 text-slate-700">{e.contractor_name}</td>
                    <td className="px-3 py-3">{e.total_worker_count}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {(e.department_allocations || []).map(a => a.department).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-700">{fmt(e.total_liability)}</td>
                    <td className="px-3 py-3"><StatusBadge status={e.status} /></td>
                    <td className="px-3 py-3 text-slate-400">{expandedId === e.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandedId === e.id && (
                    <tr><td colSpan={canHR ? 8 : 7} className="px-4 py-3 bg-slate-50/70">
                      <ExpandedEntry entryId={e.id} status={e.status} canHR={canHR}
                        onSubmit={() => submitMut.mutate(e.id)}
                        onEdit={() => navigate(`/daily-wage/new?edit=${e.id}`)}
                        submitting={submitMut.isPending} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Expanded Entry Detail ─────────────────────────────────────
function ExpandedEntry({ entryId, status, canHR, onSubmit, onEdit, submitting }) {
  const { data: detailRes } = useQuery({
    queryKey: ['dw-entry-detail', entryId],
    queryFn: () => getDWEntry(entryId),
    retry: 0
  })
  const entry = detailRes?.data?.data
  if (!entry) return <div className="text-sm text-slate-400 py-2">Loading...</div>

  const allocs = entry.department_allocations || []
  const approvals = entry.approval_history || []
  // Find the latest needs_correction remark
  const correctionRemark = status === 'needs_correction'
    ? approvals.find(a => a.action === 'needs_correction')?.remarks
    : null

  return (
    <div className="space-y-3">
      {correctionRemark && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          <strong>Finance correction note:</strong> {correctionRemark}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><span className="text-slate-400">Time:</span> {entry.in_time} — {entry.out_time}</div>
        <div><span className="text-slate-400">Gate Ref:</span> {entry.gate_entry_reference}</div>
        <div><span className="text-slate-400">Wage Rate:</span> {fmt(entry.wage_rate_applied)}</div>
        <div><span className="text-slate-400">Commission Rate:</span> {fmt(entry.commission_rate_applied)}</div>
        <div><span className="text-slate-400">Total Wages:</span> {fmt(entry.total_wage_amount)}</div>
        <div><span className="text-slate-400">Total Commission:</span> {fmt(entry.total_commission_amount)}</div>
        <div><span className="text-slate-400">Total Liability:</span> <strong className="text-blue-700">{fmt(entry.total_liability)}</strong></div>
        <div><span className="text-slate-400">Created:</span> {entry.created_by} — {entry.created_at?.slice(0, 10)}</div>
      </div>

      {entry.notes && <div className="text-sm text-slate-500"><span className="text-slate-400">Notes:</span> {entry.notes}</div>}

      {/* Department breakdown */}
      {allocs.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Department Breakdown</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {allocs.map((a, i) => (
              <div key={i} className="bg-white rounded border border-slate-200 px-2 py-1.5">
                <span className="font-medium text-slate-700">{a.department}</span>
                <span className="text-slate-400 ml-1">({a.worker_count} workers)</span>
                <div className="text-slate-400">W: {fmt(a.allocated_wage_amount)} | C: {fmt(a.allocated_commission_amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval history */}
      {approvals.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Approval History</h4>
          <div className="space-y-1 text-xs">
            {approvals.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-slate-400">{a.acted_at?.slice(0, 16)}</span>
                <span className="font-medium text-slate-600">{a.acted_by}</span>
                <span className="text-slate-500">{a.action}</span>
                {a.remarks && <span className="text-slate-400">— {a.remarks}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {canHR && (status === 'hr_entered' || status === 'needs_correction') && (
        <div className="flex gap-2 pt-1">
          <button onClick={onEdit} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            {status === 'needs_correction' ? 'Edit & Resubmit' : 'Edit'}
          </button>
          {status === 'hr_entered' && (
            <button onClick={onSubmit} disabled={submitting}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Submit for Review'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
