import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '../ui/Button'
import StatusBadge from '../ui/StatusBadge'
import { getBulkBatches, getBulkBatch, undoBulkBatch } from '../../utils/bulkApi'
import { promptDialog, alertDialog } from '../../hooks/useConfirm'
import { fmtIstDateTime } from '../../utils/formatters'
import toast from 'react-hot-toast'

/**
 * Undo one batch after asking for a reason (≥ 5 characters). Returns true when undone.
 * Shared by BulkBatchList and the bulk result screens. Never call from inside an open <Modal>.
 */
export async function undoBatchWithReason(batch) {
  const label = `batch #${batch.id}${batch.summary ? ` (${batch.summary})` : ''}`
  const reason = await promptDialog({
    title: `Undo ${label}?`,
    message: batch.requiresApproval
      ? `Reverses the ${batch.applyCount ?? ''} row(s) this approved batch applied. Refused if anything has moved on since. Reason (at least 5 characters):`
      : `Removes the ${batch.applyCount ?? ''} grant(s) this batch saved and puts back any system entry it replaced. ` +
        'Refused if HR or finance has already acted on any of them. Reason (at least 5 characters):',
    confirmText: 'Undo batch', placeholder: 'e.g. wrong date', inputLabel: 'Reason for undo', variant: 'danger',
  })
  if (reason === null) return false
  if (String(reason).trim().length < 5) { toast.error('Give a reason of at least 5 characters'); return false }
  try {
    const res = await undoBulkBatch(batch.id, String(reason).trim())
    toast.success(batch.requiresApproval ? `Batch #${batch.id} undone — ${res?.data?.undone ?? 0} row(s) reversed`
      : `Batch #${batch.id} undone — ${res?.data?.undone ?? 0} grant(s) removed or restored`)
    return true
  } catch (err) {
    const rows = err?.response?.data?.rows
    if (err?.response?.data?.code === 'BULK_UNDO_BLOCKED' && Array.isArray(rows)) {
      await alertDialog({
        title: 'Batch not undone',
        message: `${err.response.data.error}:\n` + rows.slice(0, 20).map(r => `• ${r.code}: ${r.reason}`).join('\n') +
          (rows.length > 20 ? `\n…and ${rows.length - 20} more` : ''),
      })
    }
    return false
  }
}

/**
 * BulkBatchList (P3-01) — recent bulk batches for one kind, with View rows + Undo.
 * Props: kind ('extra-duty'), month, year, onChanged() (refresh the page's own lists),
 *        whatLabel (column header for the summary; default "Grant"),
 *        canUndo (P5-01: approval kinds are undone by finance/admin — the caller decides; default true).
 * P5-01: approval kinds show "Waiting for finance" and the finance note on returned / rejected batches.
 */
export default function BulkBatchList({ kind, month, year, onChanged, whatLabel = 'Grant', canUndo = true }) {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState(null)
  const { data, isLoading } = useQuery({
    queryKey: ['bulk-batches', kind, month, year],
    queryFn: () => getBulkBatches({ kind, month, year, limit: 20 }),
    retry: 0,
  })
  const batches = data?.data?.data || []
  const { data: detail } = useQuery({
    queryKey: ['bulk-batch', openId],
    queryFn: () => getBulkBatch(openId),
    enabled: !!openId,
    retry: 0,
  })
  const rows = detail?.data?.data?.rows || []

  const doUndo = async (b) => {
    if (await undoBatchWithReason(b)) {
      qc.invalidateQueries({ queryKey: ['bulk-batches'] })
      qc.invalidateQueries({ queryKey: ['bulk-batch'] })
      onChanged?.()
    }
  }

  return (
    <div className="card p-3 space-y-2" data-testid="bulk-batch-list">
      <div className="text-sm font-semibold text-slate-700">Recent bulk batches</div>
      {isLoading ? <div className="text-xs text-slate-400">Loading...</div>
        : !batches.length ? <div className="text-xs text-slate-400">No bulk batches for this month yet</div>
        : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full text-[11px]">
              <thead><tr><th>#</th><th>Saved</th><th>By</th><th>{whatLabel}</th><th>Saved rows</th><th>Left as is</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {batches.map(b => (
                  <React.Fragment key={b.id}>
                    <tr data-batch-id={b.id}>
                      <td className="font-mono">{b.id}{b.groupSize > 1 && <span className="text-slate-400"> ({(b.groupIndex ?? 0) + 1}/{b.groupSize})</span>}</td>
                      <td>{fmtIstDateTime(b.createdAt)}</td>
                      <td>{b.createdBy}</td>
                      <td>{b.summary}{b.options?.hrApprove ? <span className="text-slate-400"> · HR-approved</span> : null}</td>
                      <td className="text-center">{b.applyCount}</td>
                      <td className="text-center">{b.skippedCount}</td>
                      <td><StatusBadge domain="bulk_batch" status={b.status} size="xs" title={b.undoReason ? `Undone by ${b.undoneBy}: ${b.undoReason}` : undefined} /></td>
                      <td className="whitespace-nowrap">
                        <Button variant="link" tone="slate" onClick={() => setOpenId(openId === b.id ? null : b.id)} aria-expanded={openId === b.id}>
                          {openId === b.id ? 'Hide rows' : 'View rows'}
                        </Button>
                        {b.status === 'applied' && canUndo && <Button variant="link" tone="red" onClick={() => doUndo(b)}>Undo</Button>}
                      </td>
                    </tr>
                    {(b.status === 'returned' || b.status === 'rejected') && (b.returnNote || b.rejectReason) && (
                      <tr data-testid="bulk-decision-note"><td colSpan={8} className={b.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}>
                        {b.status === 'returned' ? 'Returned' : 'Rejected'} by {b.decidedBy}{b.decidedAt ? ` on ${fmtIstDateTime(b.decidedAt)}` : ''}: {b.returnNote || b.rejectReason}
                        {b.status === 'returned' ? <span className="text-slate-500"> — fix it and send a new batch</span> : null}
                      </td></tr>
                    )}
                    {openId === b.id && (
                      <tr><td colSpan={8} className="bg-slate-50">
                        <div className="max-h-64 overflow-auto">
                          {rows.map(r => (
                            <div key={r.rowNo} className="text-[11px] py-0.5">
                              <span className="font-mono">{r.code}</span> {r.name} · {r.state === 'skipped' ? 'left as is' : r.action === 'update' ? 'replaced system entry' : 'created'}
                              {r.undone ? ' · undone' : ''}{r.messages?.length ? <span className="text-slate-500"> — {r.messages.join('; ')}</span> : null}
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
