import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '../ui/Button'
import StatusBadge from '../ui/StatusBadge'
import { getBulkBatches, getBulkBatch, undoBulkBatch } from '../../utils/bulkApi'
import { promptDialog, alertDialog } from '../../hooks/useConfirm'
import { fmtIstDateTime, fmtINR, fmtDate } from '../../utils/formatters'
import { statusInfo } from '../../utils/statusMap'
import toast from 'react-hot-toast'

/**
 * BULK-WORD — the words this list uses, per bulk kind. Extra duty keeps the exact P3-01 wording.
 * A kind not listed here falls back to ED words (direct kinds) or GENERIC_APPROVAL (approval kinds).
 * The server's kind `noun` is not in the batch row, so the words live here — add a kind here when one is added.
 */
const ED_WORDS = {
  when: 'Saved', rows: 'Saved rows', empty: 'No bulk batches for this month yet',
  undoMessage: (b) => `Removes the ${b.applyCount ?? ''} grant(s) this batch saved and puts back any system entry it replaced. ` +
    'Refused if HR or finance has already acted on any of them. Reason (at least 5 characters):',
  undoToast: (b, n) => `Batch #${b.id} undone — ${n} grant(s) removed or restored`,
  rowText: (r) => `${r.state === 'skipped' ? 'left as is' : r.action === 'update' ? 'replaced system entry' : 'created'}${r.undone ? ' · undone' : ''}`,
  rowExtra: () => null,
  appliedLabel: null,
}
const GENERIC_APPROVAL = {
  ...ED_WORDS,
  undoMessage: (b) => `Reverses the ${b.applyCount ?? ''} row(s) this approved batch applied. Refused if anything has moved on since. Reason (at least 5 characters):`,
  undoToast: (b, n) => `Batch #${b.id} undone — ${n} row(s) reversed`,
}
// What happened to one row of an approval batch, from the batch status (nothing is applied before approval).
const approvalRowState = (r, b) => {
  if (r.state === 'skipped') return 'left as is'
  if (b.status === 'submitted') return 'waiting for finance'
  if (b.status === 'returned' || b.status === 'rejected') return 'not applied'
  if (r.undone || b.status === 'undone') return 'undone'
  return 'applied'
}
const KIND_WORDS = {
  'extra-duty': ED_WORDS,
  'salary-revision': {
    when: 'Sent', rows: 'Revisions', empty: 'No bulk salary revisions yet',
    undoMessage: (b) => `Puts the ${b.applyCount ?? ''} salary change(s) in this batch back to the old gross and salary structure. ` +
      'Refused if a later salary change exists, the payroll month is finalised, or salary (Stage 7) was computed with the new pay. ' +
      'Reason (at least 5 characters):',
    undoToast: (b, n) => `Batch #${b.id} undone — ${n} salary change(s) reversed`,
    rowText: approvalRowState,
    rowExtra: (r) => (r.oldGross != null || r.newGross != null
      ? `${fmtINR(r.oldGross)} → ${fmtINR(r.newGross)}${r.effectiveFrom ? ` from ${fmtDate(r.effectiveFrom)}` : ''}`
      : null),
    appliedLabel: 'Approved',
  },
}
export function batchWords(batch) {
  return KIND_WORDS[batch?.kind] || (batch?.requiresApproval ? GENERIC_APPROVAL : ED_WORDS)
}

/** Status pill; an approval kind may name 'applied' differently (salary revision: "Approved"). */
function BatchStatus({ b, words }) {
  const title = b.undoReason ? `Undone by ${b.undoneBy}: ${b.undoReason}`
    : b.status === 'applied' && b.approvedBy ? `Approved by ${b.approvedBy}${b.approvedAt ? ` on ${fmtIstDateTime(b.approvedAt)}` : ''}`
    : undefined
  if (b.status === 'applied' && words.appliedLabel) {
    const { className } = statusInfo('bulk_batch', 'applied')
    return <span data-status={b.status} title={title} className={`text-[10px] px-1.5 py-0.5 rounded-full ${className}`}>{words.appliedLabel}</span>
  }
  return <StatusBadge domain="bulk_batch" status={b.status} size="xs" title={title} />
}

/**
 * Undo one batch after asking for a reason (≥ 5 characters). Returns true when undone.
 * Shared by BulkBatchList and the bulk result screens. Never call from inside an open <Modal>.
 */
export async function undoBatchWithReason(batch) {
  const label = `batch #${batch.id}${batch.summary ? ` (${batch.summary})` : ''}`
  const words = batchWords(batch)
  const reason = await promptDialog({
    title: `Undo ${label}?`,
    message: words.undoMessage(batch),
    confirmText: 'Undo batch', placeholder: 'e.g. wrong date', inputLabel: 'Reason for undo', variant: 'danger',
  })
  if (reason === null) return false
  if (String(reason).trim().length < 5) { toast.error('Give a reason of at least 5 characters'); return false }
  try {
    const res = await undoBulkBatch(batch.id, String(reason).trim())
    toast.success(words.undoToast(batch, res?.data?.undone ?? 0))
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
 * BULK-WORD: headers, row words, undo prompt and toast come from batchWords(kind) — ED wording unchanged.
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
  const listWords = batchWords({ kind, requiresApproval: batches[0]?.requiresApproval })

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
        : !batches.length ? <div className="text-xs text-slate-400" data-testid="bulk-batch-empty">{listWords.empty}</div>
        : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full text-[11px]">
              <thead><tr><th>#</th><th>{listWords.when}</th><th>By</th><th>{whatLabel}</th><th>{listWords.rows}</th><th>Left as is</th><th>Status</th><th></th></tr></thead>
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
                      <td><BatchStatus b={b} words={batchWords(b)} /></td>
                      <td className="whitespace-nowrap">
                        <Button variant="link" tone="slate" onClick={() => setOpenId(openId === b.id ? null : b.id)} aria-expanded={openId === b.id}>
                          {openId === b.id ? 'Hide rows' : 'View rows'}
                        </Button>
                        {b.status === 'applied' && canUndo && <Button variant="link" tone="red" onClick={() => doUndo(b)}>Undo</Button>}
                      </td>
                    </tr>
                    {b.status === 'submitted' && b.requiresApproval && (
                      <tr data-testid="bulk-waiting-note"><td colSpan={8} className="bg-slate-50 text-slate-600">
                        Sent by {b.submittedBy || b.createdBy}{(b.submittedAt || b.createdAt) ? ` on ${fmtIstDateTime(b.submittedAt || b.createdAt)}` : ''} — waiting for finance to decide
                      </td></tr>
                    )}
                    {(b.status === 'returned' || b.status === 'rejected') && (b.returnNote || b.rejectReason) && (
                      <tr data-testid="bulk-decision-note"><td colSpan={8} className={b.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}>
                        {b.status === 'returned' ? 'Returned' : 'Rejected'} by {b.decidedBy}{b.decidedAt ? ` on ${fmtIstDateTime(b.decidedAt)}` : ''}: {b.returnNote || b.rejectReason}
                        {b.status === 'returned' ? <span className="text-slate-500"> — fix it and send a new batch</span> : null}
                      </td></tr>
                    )}
                    {openId === b.id && (
                      <tr><td colSpan={8} className="bg-slate-50">
                        <div className="max-h-64 overflow-auto">
                          {rows.map(r => {
                            const w = batchWords(b)
                            const extra = w.rowExtra(r)
                            return (
                              <div key={r.rowNo} className="text-[11px] py-0.5" data-testid="bulk-batch-row">
                                <span className="font-mono">{r.code}</span> {r.name} · {extra ? <>{extra} · </> : null}{w.rowText(r, b)}
                                {r.messages?.length ? <span className="text-slate-500"> — {r.messages.join('; ')}</span> : null}
                              </div>
                            )
                          })}
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
