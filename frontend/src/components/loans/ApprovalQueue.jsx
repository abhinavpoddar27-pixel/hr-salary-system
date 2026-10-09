// Loans PR-4 — the admin's approval queue (SPEC §7 screen 3). Urgent first.
// Loans are decided on the detail page (eligibility re-run + deduction
// history in view); change requests are decided here.
import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { getLoanQueue, approveLoanChange, rejectLoanChange, withdrawLoanChange } from '../../utils/api'
import { ReasonModal, TopupApproveModal } from './LoanActionModals'
import { KIND_LABEL, rupees, errText, sameUser, requestSummary, istDateTime } from './loanUi'

export default function ApprovalQueue({ caps, disbursementEnabled, namesByCode }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [decide, setDecide] = useState(null) // {req, action: 'approve'|'reject'|'withdraw'}
  const { data, isLoading } = useQuery({ queryKey: ['loan-queue'], queryFn: getLoanQueue, retry: 0 })
  const loans = data?.data?.data?.loans || []
  const changes = data?.data?.data?.changes || []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['loan-queue'] })
    qc.invalidateQueries({ queryKey: ['loans'] })
    qc.invalidateQueries({ queryKey: ['loan-stats'] })
    qc.invalidateQueries({ queryKey: ['loan'] })
  }
  const act = useMutation({
    mutationFn: ({ req, action, body }) => (action === 'approve' ? approveLoanChange(req.id, body)
      : action === 'reject' ? rejectLoanChange(req.id, body) : withdrawLoanChange(req.id, body)),
    onSuccess: (_r, { req, action }) => {
      toast.success(`${KIND_LABEL[req.kind]} request #${req.id} ${{ approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[action]}`)
      setDecide(null)
      refresh()
    },
    onError: (err) => toast.error(errText(err)),
  })

  const ownTip = 'You raised this request — nobody approves their own request (maker-checker)'

  return (
    <div className="space-y-5" data-testid="approval-queue">
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-slate-700 text-sm">Loan requests <span className="text-slate-400">({loans.length})</span></div>
          <div className="text-xs text-slate-400">Emergency / medical first, then oldest first</div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr>
              <th>#</th><th>Borrower</th><th>Company</th><th>Type</th><th className="text-right">Principal</th>
              <th className="text-center">Tenure</th><th className="text-right">EMI</th><th>Requested by</th><th>Waiting</th><th></th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={10} className="text-center py-8 text-slate-400">Loading…</td></tr>
                : loans.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-slate-400">No loan is waiting for the admin.</td></tr>
                  : loans.map((l) => (
                    <tr key={l.id} className={clsx(l.urgent && 'bg-red-50/40')}>
                      <td className="text-xs text-slate-400">{l.id}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {l.urgent && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">URGENT</span>}
                          <div>
                            <div className="text-sm font-medium">{l.employee_name || l.employee_code}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{l.employee_code} · {l.department || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-xs">{l.company}</td>
                      <td className="text-xs">{l.loan_type}</td>
                      <td className="text-right font-mono">{rupees(l.principal_amount)}</td>
                      <td className="text-center">{l.tenure_months}m</td>
                      <td className="text-right font-mono">{rupees(l.emi_amount)}</td>
                      <td className="text-xs">{l.requested_by}</td>
                      <td className={clsx('text-xs', l.waiting_days >= 3 ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                        {l.waiting_days} day{l.waiting_days === 1 ? '' : 's'}
                      </td>
                      <td>
                        <button className="btn-secondary btn-sm text-xs" onClick={() => navigate(`/loans/${l.id}`)} data-testid={`review-loan-${l.id}`}>
                          {caps.canDecide ? 'Review & decide' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
          Change requests — defer, restructure, write-off <span className="text-slate-400">({changes.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr><th>#</th><th>Kind</th><th>Loan</th><th>What</th><th>Reason</th><th>Requested by</th><th>Waiting</th><th></th></tr></thead>
            <tbody>
              {changes.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">No change request is waiting.</td></tr>
                : changes.map((r) => {
                  const own = sameUser(r.requested_by, caps.username)
                  const topup = r.kind === 'restructure' && r.payload?.topupAmount
                  const topupBlocked = topup && !disbursementEnabled
                  return (
                    <tr key={r.id}>
                      <td className="text-xs text-slate-400">{r.id}</td>
                      <td><span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-100 text-purple-800">{KIND_LABEL[r.kind]}</span></td>
                      <td className="text-xs">
                        <button className="text-blue-700 hover:underline" onClick={() => navigate(`/loans/${r.loan_id}`)}>#{r.loan_id}</button>
                        <div className="text-slate-500">{namesByCode?.[r.employee_code] || ''} <span className="font-mono">{r.employee_code}</span></div>
                      </td>
                      <td className="text-xs">{requestSummary(r)}</td>
                      <td className="text-xs max-w-[220px]">{r.reason}</td>
                      <td className="text-xs">{r.requested_by}<div className="text-slate-400">{istDateTime(r.requested_at)}</div></td>
                      <td className="text-xs">{r.waiting_days} d</td>
                      <td>
                        <div className="flex gap-1 justify-end flex-wrap">
                          {caps.canDecide && (
                            <>
                              <span title={own ? ownTip : topupBlocked ? 'Disbursement is switched off: a top-up cannot be paid until cutover' : ''}>
                                <button className="text-xs px-2 py-1 rounded bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                  disabled={own || topupBlocked} data-testid={`approve-change-${r.id}`}
                                  onClick={() => setDecide({ req: r, action: topup ? 'approve-topup' : 'approve' })}>Approve</button>
                              </span>
                              <span title={own ? ownTip : ''}>
                                <button className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                  disabled={own} data-testid={`reject-change-${r.id}`}
                                  onClick={() => setDecide({ req: r, action: 'reject' })}>Reject</button>
                              </span>
                            </>
                          )}
                          {caps.canRaise && own && (
                            <button className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700" data-testid={`withdraw-change-${r.id}`}
                              onClick={() => setDecide({ req: r, action: 'withdraw' })}>Withdraw</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {decide?.action === 'approve' && (
        <ReasonModal title={`Approve ${KIND_LABEL[decide.req.kind].toLowerCase()} request #${decide.req.id}`}
          message={`${requestSummary(decide.req)} — loan #${decide.req.loan_id}. Re-checked against the loan as it is now.`}
          label="Note" required={false} confirmText="Approve" busy={act.isPending}
          onSubmit={(reason) => act.mutate({ req: decide.req, action: 'approve', body: { reason: reason || undefined } })}
          onClose={() => setDecide(null)} />
      )}
      {decide?.action === 'approve-topup' && (
        <TopupApproveModal request={decide.req} busy={act.isPending}
          onSubmit={(body) => act.mutate({ req: decide.req, action: 'approve', body })} onClose={() => setDecide(null)} />
      )}
      {decide?.action === 'reject' && (
        <ReasonModal title={`Reject ${KIND_LABEL[decide.req.kind].toLowerCase()} request #${decide.req.id}`} danger confirmText="Reject"
          busy={act.isPending} onSubmit={(reason) => act.mutate({ req: decide.req, action: 'reject', body: { reason } })}
          onClose={() => setDecide(null)} />
      )}
      {decide?.action === 'withdraw' && (
        <ReasonModal title={`Withdraw your ${KIND_LABEL[decide.req.kind].toLowerCase()} request #${decide.req.id}`} required={false}
          confirmText="Withdraw" busy={act.isPending}
          onSubmit={(reason) => act.mutate({ req: decide.req, action: 'withdraw', body: { reason: reason || undefined } })}
          onClose={() => setDecide(null)} />
      )}
    </div>
  )
}
