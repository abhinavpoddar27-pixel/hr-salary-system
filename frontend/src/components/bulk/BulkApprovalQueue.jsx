import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ReviewQueue from './ReviewQueue'
import Button from '../ui/Button'
import StatusBadge from '../ui/StatusBadge'
import { useAppStore } from '../../store/appStore'
import { getBulkQueue, getBulkBatch, approveBulkBatch, rejectBulkBatch, returnBulkBatch } from '../../utils/bulkApi'
import { fmtINR, fmtDate, fmtIstDateTime } from '../../utils/formatters'

/**
 * BulkApprovalQueue (P5-01) — Finance Verification → "Bulk batches". Batches of approval kinds that
 * HR sent for finance approval. Approve applies the whole batch (or nothing); Reject (reason) and
 * Return (note for the creator) decide it without applying. Nobody decides a batch they saved
 * (the server refuses with SELF_APPROVAL; the box is disabled here).
 */
const sameUser = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Waiting', tone: 'amber' },
  { id: 'returned', label: 'Returned' },
  { id: 'rejected', label: 'Rejected', tone: 'red', rowClass: 'bg-red-50/40' },
  { id: 'applied', label: 'Approved' },
]
const ORDER = { submitted: 0, returned: 1, rejected: 2, applied: 3, undone: 4 }

function cellValue(col, row) {
  const v = row[col.key]
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>
  if (col.type === 'money') return fmtINR(v)
  if (col.type === 'date') return fmtDate(v)
  if (col.type === 'pct') return `${v}%`
  return String(v)
}

function BatchRows({ id }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['bulk-batch', id], queryFn: () => getBulkBatch(id), retry: 0 })
  const b = data?.data?.data
  if (isLoading) return <div className="text-xs text-slate-400 p-2">Loading rows...</div>
  if (isError || !b) return <div className="text-xs text-red-600 p-2">Could not load the rows of this batch</div>
  const cols = b.columns || [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]
  return (
    <div className="card p-3 space-y-2" data-testid="bulk-queue-rows" data-batch-id={b.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-slate-700">Batch #{b.id} — {b.kindLabel}</span>
        <span className="text-xs text-slate-500">{b.summary}</span>
        {b.moneyTotal !== null && b.moneyTotal !== undefined && (
          <span className="text-xs text-slate-700">Change per month: <b>{fmtINR(b.moneyTotal)}</b></span>
        )}
      </div>
      <div className="overflow-x-auto max-h-80">
        <table className="table-compact w-full text-[11px]">
          <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}<th>Check</th></tr></thead>
          <tbody>
            {b.rows.map(r => (
              <tr key={r.rowNo} className={r.state === 'skipped' ? 'text-slate-400' : undefined}>
                {cols.map(c => <td key={c.key} className={c.type === 'money' ? 'text-right' : undefined}>{cellValue(c, r)}</td>)}
                <td>{r.state === 'skipped' ? 'left as is' : r.state === 'warning' ? 'check' : r.state === 'error' ? 'problem' : 'ready'}
                  {r.messages?.length ? <span className="text-slate-500"> — {r.messages.join('; ')}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BulkApprovalQueue() {
  const { user } = useAppStore()
  const qc = useQueryClient()
  const [openId, setOpenId] = useState(null)
  const [refused, setRefused] = useState(null) // { id, error, rows }
  const { data, isLoading, isError } = useQuery({ queryKey: ['bulk-queue'], queryFn: () => getBulkQueue(), retry: 0 })
  const batches = useMemo(() => data?.data?.data || [], [data])
  const me = user?.username

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bulk-queue'] })
    qc.invalidateQueries({ queryKey: ['bulk-batches'] })
    qc.invalidateQueries({ queryKey: ['bulk-batch'] })
  }

  // One request per batch, in order; stop at the first refusal and show why.
  const runEach = (fn, doneWord) => async (ids, why) => {
    let done = 0
    setRefused(null)
    for (const id of ids) {
      try {
        await fn(id, why)
        done++
      } catch (err) {
        const d = err?.response?.data || {}
        setRefused({ id, error: d.error || 'Not done', code: d.code, rows: Array.isArray(d.rows) ? d.rows : [] })
        refresh()
        if (done) toast.success(`${done} batch(es) ${doneWord}`)
        // A server refusal is shown in the banner above — close the dialog. A network failure keeps it open.
        if (err?.response) return
        throw err
      }
    }
    toast.success(`${done} batch(es) ${doneWord}`)
    refresh()
  }

  const eligible = (b) => b.status === 'submitted' && !sameUser(b.createdBy, me)
  const actions = [
    {
      id: 'approve', label: (n) => `Approve ${n}`, variant: 'success', eligible,
      confirmTitle: 'Approve and apply?',
      confirmText: (n, total) => `Approve and apply ${n} batch(es)? Change per month ${fmtINR(total)}. Each batch is applied whole or not at all.`,
      confirmLabel: 'Approve and apply',
      run: runEach((id) => approveBulkBatch(id), 'approved and applied'),
    },
    {
      id: 'return', label: (n) => `↩ Return ${n}`, variant: 'warning', eligible, needsReason: true,
      reasonTitle: (n) => `Return ${n} batch(es) to the person who sent them`,
      reasonIntro: 'Nothing is applied. They see your note, fix it and send a new batch.',
      reasonPlaceholder: 'What should they fix? (at least 5 characters)',
      submitLabel: 'Return', submitBusyLabel: 'Returning...', submitVariant: 'warning',
      run: runEach((id, why) => returnBulkBatch(id, why), 'returned'),
    },
    {
      id: 'reject', label: (n) => `Reject ${n}`, variant: 'danger', eligible, needsReason: true,
      reasonTitle: (n) => `Reject ${n} batch(es)`,
      reasonIntro: 'Nothing is applied and the batch is closed.',
      reasonPlaceholder: 'Why are you rejecting it? (at least 5 characters)',
      submitLabel: 'Reject', submitBusyLabel: 'Rejecting...', submitVariant: 'danger',
      run: runEach((id, why) => rejectBulkBatch(id, why), 'rejected'),
    },
  ]

  const columns = [
    { key: 'id', header: '#', render: (b) => <span className="font-mono">{b.id}{b.groupSize > 1 ? <span className="text-slate-400"> ({(b.groupIndex ?? 0) + 1}/{b.groupSize})</span> : null}</span> },
    { key: 'kind', header: 'Kind', render: (b) => b.kindLabel || b.kind },
    { key: 'createdBy', header: 'Sent by', render: (b) => b.createdBy },
    { key: 'createdAt', header: 'When', render: (b) => fmtIstDateTime(b.submittedAt || b.createdAt) },
    { key: 'applyCount', header: 'Rows', className: 'text-center', render: (b) => b.applyCount },
    { key: 'moneyTotal', header: 'Change / month', className: 'text-right', render: (b) => (b.moneyTotal === null || b.moneyTotal === undefined ? '—' : fmtINR(b.moneyTotal)) },
    { key: 'summary', header: 'What', render: (b) => b.summary },
    {
      key: 'status', header: 'Status', render: (b) => (
        <div>
          <StatusBadge domain="bulk_batch" status={b.status} size="xs" />
          {b.status === 'submitted' && sameUser(b.createdBy, me) && (
            <div className="text-[10px] text-slate-500" data-testid="bulk-own-note">You sent this — another finance user decides it</div>
          )}
          {b.status === 'returned' && b.returnNote && <div className="text-[10px] text-slate-500 max-w-[220px] truncate" title={b.returnNote}>{b.decidedBy}: {b.returnNote}</div>}
          {b.status === 'rejected' && b.rejectReason && <div className="text-[10px] text-slate-500 max-w-[220px] truncate" title={b.rejectReason}>{b.decidedBy}: {b.rejectReason}</div>}
          {b.status === 'applied' && b.approvedBy && <div className="text-[10px] text-slate-500">by {b.approvedBy}</div>}
        </div>
      ),
    },
    {
      key: 'open', header: '', render: (b) => (
        <Button variant="link" tone="slate" onClick={() => setOpenId(openId === b.id ? null : b.id)} aria-expanded={openId === b.id}>
          {openId === b.id ? 'Hide rows' : 'Open'}
        </Button>
      ),
    },
  ]

  if (isLoading) return <div className="text-sm text-slate-400">Loading...</div>
  if (isError) return <div className="text-sm text-red-600">Could not load bulk batches</div>

  return (
    <div className="space-y-3" data-testid="bulk-approval-queue">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-[11px] text-blue-900">
        Batches HR sent for finance approval. Approve applies a whole batch or nothing; data that changed since it was sent stops it.
        Return sends it back with your note; Reject closes it. Decided batches stay here for 30 days.
      </div>
      {refused && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800" data-testid="bulk-refused">
          <div className="font-medium">Batch #{refused.id} was not done: {refused.error}</div>
          {refused.code === 'SELF_APPROVAL' ? null : refused.rows.filter(r => r.state === 'error' || (r.messages || []).length).slice(0, 15).map(r => (
            <div key={r.rowNo}>• {r.code}{r.name ? ` ${r.name}` : ''}: {(r.messages || []).join('; ') || r.state}</div>
          ))}
          <button type="button" className="text-[11px] underline mt-1" onClick={() => setRefused(null)}>Dismiss</button>
        </div>
      )}
      <ReviewQueue
        rows={batches}
        rowKey="id"
        statusOf={(b) => b.status}
        filters={FILTERS}
        filtersTestId="bulk-queue-filters"
        order={ORDER}
        columns={columns}
        rowProps={(b) => ({ 'data-batch-id': b.id, 'data-status': b.status })}
        selectable
        allFilterActions={['approve']}
        actions={actions}
        moneyOf={(b) => b.moneyTotal || 0}
        emptyText="No bulk batches waiting for approval"
        emptyFilterText="No batches in this filter"
        maxHeight="max-h-[60vh]"
      />
      {openId && <BatchRows id={openId} />}
    </div>
  )
}
