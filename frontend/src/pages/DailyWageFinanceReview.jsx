import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDWFinancePending, getDWEntries,
  approveDWEntry, rejectDWEntry, needsCorrectionDWEntry, flagDWEntry,
  reopenDWEntry, batchApproveDWEntries
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { todayIST, addDaysIso } from '../utils/formatters'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// The four finance queues, in tab order (P4-04).
const QUEUES = [
  { key: 'pending', label: 'Pending review', tab: 'Pending Review', hint: 'waiting for your decision', tone: 'text-amber-600' },
  { key: 'corrections', label: 'Needs correction', tab: 'Needs Correction', hint: 'sent back to HR', tone: 'text-red-600' },
  { key: 'flagged', label: 'Flagged', tab: 'Flagged', hint: 'held for a closer look', tone: 'text-orange-600' },
  { key: 'approved', label: 'Approved', tab: 'Recently Approved', hint: 'in the last 7 days', tone: 'text-green-600' },
]

const STATUS_STYLES = {
  pending_finance: 'bg-amber-100 text-amber-700',
  needs_correction: 'bg-red-100 text-red-700',
  flagged: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700'
}

export default function DailyWageFinanceReview() {
  const { user } = useAppStore()
  const canFinance = canFinanceFn(user)
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState('pending')
  const [remarks, setRemarks] = useState({}) // { [entryId]: string }
  const [selectedIds, setSelectedIds] = useState([])
  const [expandedCtx, setExpandedCtx] = useState(null)

  // "Recently approved" = the last 7 days counted in IST (P2-03 rule: never the UTC date).
  const approvedFrom = addDaysIso(todayIST(), -7)

  // ── Queue counts up front (P4-04, finding D-2) ───────────────
  // The tab lists below only load when their tab is open, so the counts were
  // empty until clicked. GET /entries returns a whole-table status summary with
  // any page, so a one-row read gives every queue count; the approved count is
  // the total of a one-row read over the same 7-day window as the tab.
  const { data: countsRes, isError: countsFailed } = useQuery({
    queryKey: ['dw-finance-counts'],
    queryFn: () => getDWEntries({ limit: 1 }),
    retry: 0
  })
  const { data: approvedCountRes } = useQuery({
    queryKey: ['dw-finance-counts', 'approved', approvedFrom],
    queryFn: () => getDWEntries({ status: 'approved', date_from: approvedFrom, limit: 1 }),
    retry: 0
  })
  const queueSummary = countsRes?.data?.summary || null
  const approvedRecentCount = approvedCountRes?.data?.pagination?.total ?? null
  const queueCount = (key) => {
    if (key === 'approved') return approvedRecentCount
    if (!queueSummary) return null
    const col = { pending: 'pending_finance', corrections: 'needs_correction', flagged: 'flagged' }[key]
    return Number(queueSummary[col] || 0)
  }

  // ── Queries ─────────────────────────────────────────────────
  const { data: pendingRes, isLoading: loadingPending } = useQuery({
    queryKey: ['dw-finance-pending'],
    queryFn: getDWFinancePending,
    retry: 0, enabled: activeTab === 'pending'
  })
  const pendingEntries = pendingRes?.data?.data || []

  const { data: correctionRes } = useQuery({
    queryKey: ['dw-entries-needs-correction'],
    queryFn: () => getDWEntries({ status: 'needs_correction', limit: 100 }),
    retry: 0, enabled: activeTab === 'corrections'
  })
  const correctionEntries = correctionRes?.data?.data || []

  const { data: flaggedRes } = useQuery({
    queryKey: ['dw-entries-flagged'],
    queryFn: () => getDWEntries({ status: 'flagged', limit: 100 }),
    retry: 0, enabled: activeTab === 'flagged'
  })
  const flaggedEntries = flaggedRes?.data?.data || []

  const { data: approvedRes } = useQuery({
    queryKey: ['dw-entries-recently-approved'],
    queryFn: () => getDWEntries({ status: 'approved', date_from: approvedFrom, limit: 100 }),
    retry: 0, enabled: activeTab === 'approved'
  })
  const approvedEntries = approvedRes?.data?.data || []

  // ── Mutations ───────────────────────────────────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['dw-finance-pending'] })
    qc.invalidateQueries({ queryKey: ['dw-entries-needs-correction'] })
    qc.invalidateQueries({ queryKey: ['dw-entries-flagged'] })
    qc.invalidateQueries({ queryKey: ['dw-entries-recently-approved'] })
    qc.invalidateQueries({ queryKey: ['dw-finance-counts'] })
  }

  const approveMut = useMutation({
    mutationFn: ({ id, r }) => approveDWEntry(id, r),
    onSuccess: () => { invalidateAll(); toast.success('Entry approved') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const rejectMut = useMutation({
    mutationFn: ({ id, r }) => rejectDWEntry(id, r),
    onSuccess: () => { invalidateAll(); toast.success('Entry rejected and returned to HR') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const correctionMut = useMutation({
    mutationFn: ({ id, r }) => needsCorrectionDWEntry(id, r),
    onSuccess: () => { invalidateAll(); toast.success('Marked for correction') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const flagMut = useMutation({
    mutationFn: ({ id, r }) => flagDWEntry(id, r),
    onSuccess: () => { invalidateAll(); toast.success('Entry flagged') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const reopenMut = useMutation({
    mutationFn: ({ id, r }) => reopenDWEntry(id, r),
    onSuccess: () => { invalidateAll(); toast.success('Entry reopened for review') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const batchMut = useMutation({
    mutationFn: ({ ids, r }) => batchApproveDWEntries(ids, r),
    onSuccess: (res) => { invalidateAll(); setSelectedIds([]); toast.success(`${res?.data?.approved || 0} entries approved`) },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })

  // ── Helpers ─────────────────────────────────────────────────
  const getRemark = (id) => remarks[id] || ''
  const setRemark = (id, val) => setRemarks(prev => ({ ...prev, [id]: val }))

  const doAction = (action, id) => {
    const r = getRemark(id)
    if ((action === 'reject' || action === 'correction' || action === 'flag') && !r.trim()) {
      return toast.error('Remarks are required')
    }
    if (action === 'approve') approveMut.mutate({ id, r })
    else if (action === 'reject') rejectMut.mutate({ id, r })
    else if (action === 'correction') correctionMut.mutate({ id, r })
    else if (action === 'flag') flagMut.mutate({ id, r })
  }

  const doReopen = (id) => {
    const r = getRemark(id)
    if (!r.trim()) return toast.error('Remarks are required to reopen')
    reopenMut.mutate({ id, r })
  }

  // ── Selection ───────────────────────────────────────────────
  const pendingIds = useMemo(() => pendingEntries.map(e => e.id), [pendingEntries])
  const allSelected = pendingIds.length > 0 && pendingIds.every(id => selectedIds.includes(id))
  const toggleAll = () => setSelectedIds(allSelected ? [] : pendingIds)
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // ── Role gate ───────────────────────────────────────────────
  if (!canFinance) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-slate-700">Finance Access Required</h2>
        <p className="text-sm text-slate-500 mt-2">Only finance and admin users can access this page.</p>
      </div>
    )
  }

  const currentEntries = activeTab === 'pending' ? pendingEntries
    : activeTab === 'corrections' ? correctionEntries
    : activeTab === 'flagged' ? flaggedEntries
    : approvedEntries

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Finance Review</h1>
        <p className="text-sm text-slate-500 mt-0.5">Review and approve daily wage entries</p>
      </div>

      {/* Queue counts up front — click a card to open that queue */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="dw-queue-counts">
        {QUEUES.map(q => {
          const n = queueCount(q.key)
          return (
            <button key={q.key} type="button" data-testid={`dw-count-${q.key}`}
              onClick={() => { setActiveTab(q.key); setSelectedIds([]) }}
              className={clsx('text-left rounded-lg border px-4 py-3 transition-colors',
                activeTab === q.key ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{q.label}</div>
              <div className={clsx('text-2xl font-bold mt-0.5', n > 0 ? q.tone : 'text-slate-400')} data-testid={`dw-count-${q.key}-value`}>
                {n == null ? (countsFailed ? '—' : '…') : n}
              </div>
              <div className="text-xs text-slate-500">{q.hint}</div>
            </button>
          )
        })}
      </div>
      {countsFailed && (
        <p className="text-xs text-amber-700">Couldn't load the queue counts — open a tab to see its entries.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {QUEUES.map(q => ({ key: q.key, label: q.tab, count: queueCount(q.key) })).map(t => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSelectedIds([]) }}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Batch approve bar */}
      {activeTab === 'pending' && selectedIds.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-green-700">{selectedIds.length} entries selected</span>
          <button onClick={() => batchMut.mutate({ ids: selectedIds, r: '' })} disabled={batchMut.isPending}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
            {batchMut.isPending ? 'Approving...' : 'Approve Selected'}
          </button>
        </div>
      )}

      {/* Entry cards */}
      {loadingPending && activeTab === 'pending' ? (
        <div className="text-center py-8 text-slate-400">Loading...</div>
      ) : currentEntries.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg">No entries in this category</p>
        </div>
      ) : (
        <div className="space-y-3">
          {currentEntries.map(entry => (
            <EntryCard key={entry.id} entry={entry} tab={activeTab}
              remark={getRemark(entry.id)} setRemark={(v) => setRemark(entry.id, v)}
              onAction={(action) => doAction(action, entry.id)}
              onReopen={() => doReopen(entry.id)}
              selected={selectedIds.includes(entry.id)}
              onToggle={() => toggleOne(entry.id)}
              showCheckbox={activeTab === 'pending'}
              expandedCtx={expandedCtx} setExpandedCtx={setExpandedCtx}
              isPending={approveMut.isPending || rejectMut.isPending || correctionMut.isPending || flagMut.isPending || reopenMut.isPending} />
          ))}
        </div>
      )}

      {/* Select all for pending */}
      {activeTab === 'pending' && pendingEntries.length > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300" />
          <span>Select all {pendingEntries.length} entries</span>
        </div>
      )}
    </div>
  )
}

function EntryCard({ entry, tab, remark, setRemark, onAction, onReopen, selected, onToggle, showCheckbox, expandedCtx, setExpandedCtx, isPending }) {
  const e = entry
  const allocs = e.department_allocations || []
  const ctx = e.contractor_context
  const showCtx = expandedCtx === e.id

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        {showCheckbox && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 rounded border-slate-300" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800">{e.contractor_name}</span>
            <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[e.status] || 'bg-slate-100 text-slate-500')}>
              {e.status?.replace(/_/g, ' ')}
            </span>
            <span className="text-sm text-slate-500">{e.entry_date}</span>
          </div>
          <div className="flex items-center gap-4 text-sm mt-1 text-slate-500 flex-wrap">
            <span>{e.total_worker_count} workers</span>
            <span>{e.in_time} — {e.out_time}</span>
            <span>Gate: {e.gate_entry_reference}</span>
            {e.created_by && <span>By: {e.created_by}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-blue-700">{fmt(e.total_liability)}</div>
          <div className="text-xs text-slate-400">W: {fmt(e.total_wage_amount)} | C: {fmt(e.total_commission_amount)}</div>
        </div>
      </div>

      {/* Departments */}
      {allocs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allocs.map((a, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
              {a.department}: {a.worker_count}
            </span>
          ))}
        </div>
      )}

      {e.notes && <p className="text-sm text-slate-500 italic">{e.notes}</p>}

      {/* Contractor Context */}
      {ctx && tab === 'pending' && (
        <div>
          <button onClick={() => setExpandedCtx(showCtx ? null : e.id)} className="text-xs text-blue-600 hover:text-blue-700">
            {showCtx ? '▲ Hide' : '▼ Show'} contractor context
          </button>
          {showCtx && (
            <div className="mt-2 bg-slate-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div><span className="text-slate-400">Month entries:</span> {ctx.entries_this_month || 0}</div>
              <div><span className="text-slate-400">Workers this month:</span> {ctx.workers_this_month || 0}</div>
              <div><span className="text-slate-400">Spend this month:</span> {fmt(ctx.spend_this_month)}</div>
              <div><span className="text-slate-400">Avg rate:</span> {fmt(ctx.avg_rate)}</div>
            </div>
          )}
        </div>
      )}

      {/* Actions for pending */}
      {tab === 'pending' && (
        <div className="space-y-2 pt-1">
          <input type="text" value={remark} onChange={ev => setRemark(ev.target.value)} placeholder="Remarks (required for reject/correct/flag)"
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => onAction('approve')} disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
            <button onClick={() => onAction('reject')} disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">Reject</button>
            <button onClick={() => onAction('correction')} disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-600 hover:bg-amber-50 disabled:opacity-50">Needs Correction</button>
            <button onClick={() => onAction('flag')} disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-50">Flag</button>
          </div>
        </div>
      )}

      {/* Reopen on approved tab */}
      {tab === 'approved' && (
        <div className="space-y-2 pt-1">
          <input type="text" value={remark} onChange={ev => setRemark(ev.target.value)} placeholder="Reason for reopening (required)"
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          <button onClick={onReopen} disabled={isPending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50">Reopen for Review</button>
        </div>
      )}
    </div>
  )
}
