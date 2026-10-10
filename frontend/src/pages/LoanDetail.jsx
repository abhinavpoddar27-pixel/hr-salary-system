// Loans PR-4 — loan detail (SPEC §7 screens 3 and 4): facts, reconciliation,
// the admin's approval panel, schedule, receipts, change requests, the event
// trail, the actions each role may take, and the printable statement.
import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  getLoan, getLoanStats, getLoanStatement, getLoanPolicy, approveLoan, rejectLoan, cancelLoan, disburseLoan,
  recordLoanReceipt, requestLoanChange, reverseLoanDeduction,
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { ReasonModal, DisburseModal, ReceiptModal, ChangeRequestModal } from '../components/loans/LoanActionModals'
import { openStatementWindow } from '../components/loans/printStatement'
import {
  loanCaps, sameUser, IMPORT_MODE, LOAN_STATE, INSTALMENT_STATE, REQUEST_STATE, KIND_LABEL, ORIGIN_LABEL, LIVE_STATES,
  stateCls, stateLabel, rupees, paiseToRupees, monthLabel, istDateTime, errText, requestSummary, GATE_OFF_TEXT,
  ADJUSTMENT_KIND,
} from '../components/loans/loanUi'

const DEDUCTION_STATE = {
  provisional: { label: 'Provisional', cls: 'bg-amber-100 text-amber-800' },
  posted: { label: 'Posted', cls: 'bg-green-100 text-green-800' },
  reversed: { label: 'Superseded', cls: 'bg-slate-100 text-slate-500' },
}

function Fact({ label, children }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{children}</div>
    </div>
  )
}

/** A button that, when disabled, says why (tooltip + data attribute for tests). */
function GatedButton({ disabledReason, className, children, ...rest }) {
  return (
    <span title={disabledReason || ''} className="inline-block">
      <button {...rest} disabled={!!disabledReason || rest.disabled} data-disabled-reason={disabledReason || ''}
        className={clsx(className, 'disabled:opacity-40 disabled:cursor-not-allowed')}>{children}</button>
    </span>
  )
}

function Section({ title, right, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-sm text-slate-700">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function ApprovalPanel({ check, policyWarnPct }) {
  if (!check) return null
  const h = check.history
  const months = h?.months || 0
  const avgBase = months ? paiseToRupees(h.earnedBasePaise / months) : 0
  const avgDed = months ? paiseToRupees(h.totalDeductionsPaise / months) : 0
  const avgPrior = months ? paiseToRupees(h.priorDeductionsPaise / months) : 0
  const load = months && h.earnedBasePaise > 0 ? (h.totalDeductionsPaise * 100) / h.earnedBasePaise : null
  return (
    <div className={clsx('rounded-xl border p-4 space-y-3', check.eligible ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50')} data-testid="approval-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={clsx('font-semibold', check.eligible ? 'text-green-700' : 'text-red-700')}>
          Eligibility re-checked now: {check.eligible ? 'eligible' : 'NOT eligible'}
        </span>
        {check.urgent && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-600 text-white">URGENT</span>}
        {check.exitFlagged && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-600 text-white">BORROWER MARKED LEFT</span>}
      </div>
      {check.limits && (
        <div className="text-xs text-slate-600 flex gap-4 flex-wrap">
          <span>Max amount {rupees(check.limits.maxAmount)} ({check.limits.amountMultiple}× gross)</span>
          <span>Max tenure {check.limits.maxTenure} months</span>
          <span>Max EMI {rupees(check.limits.maxEmi)}</span>
          {check.emi !== null && <span>EMI <strong>{rupees(check.emi)}</strong></span>}
        </div>
      )}
      {check.refusals?.length > 0 && (
        <ul className="list-disc ml-5 text-xs text-red-700">{check.refusals.map((r) => <li key={r.code}><span className="font-mono">{r.code}</span> — {r.message}</li>)}</ul>
      )}
      {check.warnings?.length > 0 && (
        <ul className="list-disc ml-5 text-xs text-amber-700">{check.warnings.map((w) => <li key={w.code}><span className="font-mono">{w.code}</span> — {w.message}</li>)}</ul>
      )}
      <div>
        <div className="text-xs font-semibold text-slate-600 mb-1">Deductions, last {months || 0} computed salary month{months === 1 ? '' : 's'} (plant Stage 7)</div>
        {months ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">Avg earned base<div className="font-mono font-semibold">{rupees(avgBase)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">Avg all deductions<div className="font-mono font-semibold">{rupees(avgDed)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">Avg deductions ahead of the loan<div className="font-mono font-semibold">{rupees(avgPrior)}</div></div>
            <div className={clsx('rounded-lg border px-2 py-1.5', load !== null && load > policyWarnPct ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200')}>
              Deduction load<div className="font-mono font-semibold">{load === null ? 'n/a' : `${load.toFixed(1)}%`}</div>
              <div className="text-[10px] text-slate-500">warning above {policyWarnPct}%</div>
            </div>
          </div>
        ) : <div className="text-xs text-slate-500">No computed salary in the system yet.</div>}
      </div>
      {check.schedulePreview?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {check.schedulePreview.map((i) => <span key={i.sequence} className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">#{i.sequence} {rupees(i.amount)}</span>)}
        </div>
      )}
    </div>
  )
}

export default function LoanDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAppStore((s) => s.user)
  const caps = loanCaps(user)
  const [modal, setModal] = useState(null)

  const { data, isLoading, error } = useQuery({ queryKey: ['loan', id], queryFn: () => getLoan(id), retry: 0 })
  const loan = data?.data?.data
  const { data: statsRes } = useQuery({ queryKey: ['loan-stats', 'gate'], queryFn: () => getLoanStats({}), retry: 0 })
  const gateOn = !!statsRes?.data?.data?.disbursementEnabled
  const { data: polRes } = useQuery({ queryKey: ['loan-policy'], queryFn: getLoanPolicy, retry: 0, enabled: loan?.status === 'requested' })
  const warnPct = polRes?.data?.data?.values?.deductionLoadWarningPct ?? 30

  const refresh = () => {
    for (const k of ['loan', 'loans', 'loan-stats', 'loan-queue', 'loans-due', 'employee-loans']) qc.invalidateQueries({ queryKey: [k] })
  }
  const run = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (res, { ok }) => {
      const d = res?.data?.data || {}
      toast.success(typeof ok === 'function' ? ok(d) : ok)
      for (const w of d.warnings || []) if (w.code === 'RECEIPT_BY_REQUESTER') toast(w.message, { icon: '⚠️' })
      setModal(null)
      refresh()
    },
    onError: (err) => toast.error(errText(err)),
  })

  const statement = useMutation({
    mutationFn: () => getLoanStatement(id),
    onSuccess: (res) => {
      if (!openStatementWindow(loan, res?.data?.data || {})) toast.error('Allow pop-ups to print the statement')
    },
    onError: (err) => toast.error(errText(err, 'Could not load the statement')),
  })

  if (isLoading) return <div className="p-6 text-slate-400">Loading loan…</div>
  if (error || !loan) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-red-600">{errText(error, 'Loan not found')}</div>
        <Link to="/loans" className="text-blue-700 text-sm">← Back to loans</Link>
      </div>
    )
  }

  const own = sameUser(loan.requested_by, caps.username)
  const live = LIVE_STATES.includes(loan.status)
  const pending = (loan.requests || []).find((r) => r.status === 'pending')
  const ownTip = 'You raised this loan — nobody approves their own request (maker-checker)'
  const disburseReason = !gateOn ? GATE_OFF_TEXT
    : own ? 'You requested this loan, so you cannot record its disbursement — another finance user (or the admin) must'
      : loan.exit_flag === 1 ? 'The borrower has been marked Left; this loan cannot be disbursed (the admin may cancel it)' : ''
  const rec = loan.reconciliation

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-screen-xl animate-fade-in" data-testid="loan-detail">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate('/loans')} className="text-xs text-blue-700 hover:underline">← Loans</button>
          <h2 className="section-title flex items-center gap-2 flex-wrap">
            Loan #{loan.id} — {loan.employee_name || loan.employee_code}
            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', stateCls(LOAN_STATE, loan.status))} data-testid="loan-status">
              {stateLabel(LOAN_STATE, loan.status)}{String(loan.decision_reason || '').startsWith('Cancelled after approval') ? ' (cancelled)' : ''}
            </span>
            {loan.urgent && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-600 text-white">URGENT</span>}
            {loan.exit_flag === 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-600 text-white">EXIT FLAGGED</span>}
            {loan.disbursement_mode === IMPORT_MODE && <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800" data-testid="loan-imported">Imported opening balance ({loan.disbursement_reference})</span>}
            {pending && <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-800">{KIND_LABEL[pending.kind]} request pending</span>}
          </h2>
          <div className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono">{loan.employee_code}</span>{loan.department ? ` · ${loan.department}` : ''} · {loan.company} · {loan.loan_type} · {loan.borrower_type}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-start">
          {caps.canDecide && loan.status === 'requested' && (
            <>
              <GatedButton disabledReason={own ? ownTip : ''} className="btn-success" data-testid="approve-loan"
                onClick={() => setModal('approve')}>Approve</GatedButton>
              <GatedButton disabledReason={own ? ownTip : ''} className="btn-danger" data-testid="reject-loan"
                onClick={() => setModal('reject')}>Reject</GatedButton>
            </>
          )}
          {caps.canPay && loan.status === 'approved' && (
            <GatedButton disabledReason={disburseReason} className="btn-primary" data-testid="disburse-loan"
              onClick={() => setModal('disburse')}>Record disbursement</GatedButton>
          )}
          {caps.canDecide && loan.status === 'approved' && (
            <button className="btn-ghost text-red-700" data-testid="cancel-loan" onClick={() => setModal('cancel')}>Cancel loan</button>
          )}
          {caps.canPay && live && (
            <button className="btn-secondary" data-testid="receipt-loan" onClick={() => setModal('receipt')}>Record receipt</button>
          )}
          {caps.canRaise && live && (
            <GatedButton disabledReason={pending ? 'A change request is already waiting for the admin on this loan' : ''}
              className="btn-secondary" data-testid="change-loan" onClick={() => setModal('change')}>Request change</GatedButton>
          )}
          <button className="btn-ghost" data-testid="print-statement" disabled={statement.isPending} onClick={() => statement.mutate()}>
            {statement.isPending ? 'Loading…' : 'Print statement'}
          </button>
        </div>
      </div>

      {caps.canPay && loan.status === 'approved' && disburseReason && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800" data-testid="disburse-blocked">
          <strong>Disbursement not available:</strong> {disburseReason}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Fact label="Principal">{rupees(loan.principal_amount)}</Fact>
        <Fact label="Tenure">{loan.tenure_months} months</Fact>
        <Fact label="EMI">{rupees(loan.emi_amount)}</Fact>
        <Fact label={loan.disbursement_mode === IMPORT_MODE ? IMPORT_MODE : 'Disbursed'}>{loan.disbursed_amount !== null ? rupees(loan.disbursed_amount) : '—'}</Fact>
        <Fact label="Balance">{loan.disbursed_amount !== null ? rupees(loan.remaining_balance) : '—'}</Fact>
        <Fact label="First EMI">{monthLabel(loan.first_emi_month, loan.first_emi_year)}</Fact>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
        <div className="card p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-500">Request</div>
          <div>By <strong>{loan.requested_by}</strong> · {istDateTime(loan.requested_at)}</div>
          <div className="text-slate-600">{loan.request_reason || '—'}</div>
          {loan.remarks && <div className="text-xs text-slate-500">Remarks: {loan.remarks}</div>}
        </div>
        <div className="card p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-500">Decision</div>
          {loan.decided_by ? (
            <>
              <div>By <strong>{loan.decided_by}</strong> · {istDateTime(loan.decided_at)}</div>
              <div className="text-slate-600">{loan.decision_reason || '—'}</div>
            </>
          ) : <div className="text-slate-400">Waiting for the admin</div>}
        </div>
        <div className="card p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-500">{loan.disbursement_mode === IMPORT_MODE ? 'Opening balance (imported — no money paid out)' : 'Disbursement'}</div>
          {loan.disbursed_on ? (
            <>
              <div>{loan.disbursement_mode} · ref <span className="font-mono">{loan.disbursement_reference}</span> · {loan.disbursed_on}</div>
              <div>Recorded by <strong>{loan.disbursed_by}</strong></div>
              <div className="text-xs text-slate-500">Signed agreement: <span className="font-mono">{loan.agreement_file_path || '—'}</span></div>
            </>
          ) : <div className="text-slate-400">Not paid out</div>}
        </div>
      </div>

      {rec && (
        <div className={clsx('rounded-xl border px-4 py-2.5 text-sm', rec.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800')} data-testid="reconciliation">
          <strong>{rec.ok ? '✓ Reconciles' : '✗ Does not reconcile'}</strong>: disbursed {rupees(rec.disbursed)} − (posted {rupees(rec.posted)}
          {' '}− opposite entries {rupees(rec.adjusted || 0)}) − receipts {rupees(rec.receipts)} − written off {rupees(rec.writtenOff)} = {rupees(rec.expectedBalance)}; balance {rupees(rec.balance)}.
          {Number(rec.uncovered) > 0 && <span> Uncovered by the schedule: {rupees(rec.uncovered)}.</span>}
          {rec.problems?.length > 0 && <ul className="list-disc ml-5 text-xs mt-1">{rec.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      {loan.status === 'requested' && <ApprovalPanel check={loan.approvalCheck} policyWarnPct={warnPct} />}

      {loan.instalments?.length > 0 && (
        <Section title={`Schedule (${loan.instalments.length} instalments)`}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full" data-testid="schedule">
              <thead><tr><th>#</th><th>Due</th><th className="text-right">Amount due</th><th>Status</th><th>Origin</th><th className="text-right">Posted</th><th>Posted at</th></tr></thead>
              <tbody>
                {loan.instalments.map((i) => (
                  <tr key={i.id}>
                    <td className="text-xs">{i.sequence}</td>
                    <td className="text-xs">{monthLabel(i.due_month, i.due_year)}</td>
                    <td className="text-right font-mono">{rupees(i.amount_due)}</td>
                    <td><span className={clsx('text-xs px-2 py-0.5 rounded-full', stateCls(INSTALMENT_STATE, i.status))}>{stateLabel(INSTALMENT_STATE, i.status)}</span></td>
                    <td className="text-xs">{ORIGIN_LABEL[i.origin] || i.origin}</td>
                    <td className="text-right font-mono text-xs">{i.posted_amount !== null ? rupees(i.posted_amount) : '—'}</td>
                    <td className="text-xs">{i.posted_at ? istDateTime(i.posted_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {loan.deductions?.length > 0 && (
        <Section title="Payroll deductions"
          right={caps.canReverse ? <span className="text-[11px] text-slate-500">Reverse returns a posted amount to the schedule as a new last instalment</span> : null}>
          <div className="overflow-x-auto">
            <table className="table-compact w-full" data-testid="deductions">
              <thead><tr>
                <th>Payroll month</th><th>State</th><th className="text-right">Amount</th><th className="text-right">Opposite entries</th>
                <th className="text-right">Standing</th><th>Posted at</th>{caps.canReverse && <th />}
              </tr></thead>
              <tbody>
                {loan.deductions.map((d) => {
                  const reverseReason = d.state !== 'posted' ? ''
                    : Number(d.effective_posted) <= 0 ? 'Already reversed in full'
                      : !live ? `The loan is ${stateLabel(LOAN_STATE, loan.status).toLowerCase()} — an opposite entry applies to a live loan only` : ''
                  return (
                    <tr key={d.id} data-testid={`deduction-${d.id}`}>
                      <td className="text-xs">{monthLabel(d.month, d.year)} <span className="text-slate-400">· {d.payroll}</span></td>
                      <td>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full', stateCls(DEDUCTION_STATE, d.state))} title={d.reversal_reason || ''}>{stateLabel(DEDUCTION_STATE, d.state)}</span>
                      </td>
                      <td className="text-right font-mono text-xs">{rupees(d.amount)}</td>
                      <td className="text-right font-mono text-xs">{Number(d.adjusted) > 0 ? `− ${rupees(d.adjusted)}` : '—'}</td>
                      <td className="text-right font-mono text-xs font-semibold">{d.state === 'posted' ? rupees(d.effective_posted) : '—'}</td>
                      <td className="text-xs">{d.posted_at ? istDateTime(d.posted_at) : '—'}</td>
                      {caps.canReverse && (
                        <td className="text-right">
                          {d.state === 'posted' && (
                            <GatedButton disabledReason={reverseReason} className="btn-ghost text-xs text-red-700" data-testid={`reverse-${d.id}`}
                              onClick={() => setModal({ kind: 'reverse', deduction: d })}>Reverse</GatedButton>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {loan.adjustments?.length > 0 && (
        <Section title="Opposite entries">
          <table className="table-compact w-full" data-testid="adjustments">
            <thead><tr><th>When (IST)</th><th>Kind</th><th>Of</th><th className="text-right">Amount</th><th>Back in the schedule as</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {loan.adjustments.map((a) => {
                const ded = (loan.deductions || []).find((d) => d.id === a.deduction_id)
                const added = (loan.instalments || []).find((i) => i.id === a.added_instalment_id)
                return (
                  <tr key={a.id}>
                    <td className="text-xs whitespace-nowrap">{istDateTime(a.created_at)}</td>
                    <td className="text-xs">{ADJUSTMENT_KIND[a.kind] || a.kind}</td>
                    <td className="text-xs">{ded ? `${monthLabel(ded.month, ded.year)} deduction` : `deduction ${a.deduction_id}`}</td>
                    <td className="text-right font-mono text-xs">{rupees(a.amount)}</td>
                    <td className="text-xs">{added ? `#${added.sequence}, ${monthLabel(added.due_month, added.due_year)}` : 'not scheduled (extension limit) — uncovered'}</td>
                    <td className="text-xs">{a.actor}</td>
                    <td className="text-xs text-slate-600">{a.reason}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}

      {loan.receipts?.length > 0 && (
        <Section title="Cash receipts">
          <table className="table-compact w-full" data-testid="receipts">
            <thead><tr><th>Receipt no.</th><th>Date</th><th className="text-right">Amount</th><th>Mode</th><th>Reference</th><th>Recorded by</th><th>Remarks</th></tr></thead>
            <tbody>
              {loan.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.receipt_no}</td><td className="text-xs">{r.receipt_date}</td>
                  <td className="text-right font-mono">{rupees(r.amount)}</td><td className="text-xs">{r.mode}</td>
                  <td className="text-xs">{r.reference || '—'}</td><td className="text-xs">{r.recorded_by}</td><td className="text-xs">{r.remarks || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {loan.requests?.length > 0 && (
        <Section title="Change requests" right={caps.canDecide && pending ? <button className="text-xs text-blue-700" onClick={() => navigate('/loans?tab=queue')}>Decide in the queue →</button> : null}>
          <table className="table-compact w-full" data-testid="requests">
            <thead><tr><th>#</th><th>Kind</th><th>What</th><th>Reason</th><th>Raised by</th><th>Status</th><th>Decided</th></tr></thead>
            <tbody>
              {loan.requests.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs">{r.id}</td><td className="text-xs">{KIND_LABEL[r.kind]}</td>
                  <td className="text-xs">{requestSummary(r, loan.instalments)}</td><td className="text-xs">{r.reason}</td>
                  <td className="text-xs">{r.requested_by}<div className="text-slate-400">{istDateTime(r.requested_at)}</div></td>
                  <td><span className={clsx('text-xs px-2 py-0.5 rounded-full', stateCls(REQUEST_STATE, r.status))}>{stateLabel(REQUEST_STATE, r.status)}</span></td>
                  <td className="text-xs">{r.decided_by ? `${r.decided_by} · ${istDateTime(r.decided_at)}` : '—'}{r.decision_reason ? <div className="text-slate-500">{r.decision_reason}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={`Event trail (${loan.events?.length || 0})`}>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="table-compact w-full" data-testid="events">
            <thead><tr><th>When (IST)</th><th>Event</th><th>From → to</th><th className="text-right">Amount</th><th>By</th><th>Detail</th></tr></thead>
            <tbody>
              {(loan.events || []).map((e) => (
                <tr key={e.id}>
                  <td className="text-xs whitespace-nowrap">{istDateTime(e.created_at)}</td>
                  <td className="text-xs font-medium">{String(e.event).replace(/_/g, ' ')}</td>
                  <td className="text-xs">{e.from_state || '—'} → {e.to_state || '—'}</td>
                  <td className="text-right font-mono text-xs">{e.amount !== null ? rupees(e.amount) : ''}</td>
                  <td className="text-xs">{e.actor}</td>
                  <td className="text-xs text-slate-600 max-w-[360px]">{e.reason || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {modal === 'approve' && (
        <ReasonModal title={`Approve loan #${loan.id}`} label="Note" required={false} confirmText="Approve" busy={run.isPending}
          message={`${loan.employee_name || loan.employee_code}: ${rupees(loan.principal_amount)} over ${loan.tenure_months} months. Eligibility is re-checked by the server on approval.`}
          onSubmit={(reason) => run.mutate({ fn: () => approveLoan(loan.id, { reason: reason || undefined }), ok: `Loan #${loan.id} approved — finance records the payout` })}
          onClose={() => setModal(null)} />
      )}
      {modal === 'reject' && (
        <ReasonModal title={`Reject loan #${loan.id}`} danger confirmText="Reject" busy={run.isPending}
          onSubmit={(reason) => run.mutate({ fn: () => rejectLoan(loan.id, { reason }), ok: `Loan #${loan.id} rejected` })}
          onClose={() => setModal(null)} />
      )}
      {modal === 'cancel' && (
        <ReasonModal title={`Cancel loan #${loan.id}`} danger confirmText="Cancel the loan" busy={run.isPending}
          message="Approved but not paid out. The loan ends as rejected, with a cancelled event."
          onSubmit={(reason) => run.mutate({ fn: () => cancelLoan(loan.id, { reason }), ok: `Loan #${loan.id} cancelled` })}
          onClose={() => setModal(null)} />
      )}
      {modal === 'disburse' && (
        <DisburseModal loan={loan} busy={run.isPending} onClose={() => setModal(null)}
          onSubmit={(body) => run.mutate({ fn: () => disburseLoan(loan.id, body), ok: (d) => `Disbursed — first EMI ${monthLabel(d.firstEmiMonth?.month, d.firstEmiMonth?.year)}` })} />
      )}
      {modal === 'receipt' && (
        <ReceiptModal loan={loan} busy={run.isPending} onClose={() => setModal(null)}
          onSubmit={(body) => run.mutate({ fn: () => recordLoanReceipt(loan.id, body), ok: (d) => `Receipt ${d.receiptNo} recorded — balance ${rupees(d.balance)}` })} />
      )}
      {modal?.kind === 'reverse' && (
        <ReasonModal title={`Reverse the ${monthLabel(modal.deduction.month, modal.deduction.year)} deduction`} danger minLength={10}
          confirmText={`Reverse ${rupees(modal.deduction.effective_posted)}`} busy={run.isPending}
          message={`${rupees(modal.deduction.effective_posted)} goes back on the balance and onto the end of the schedule as a new instalment. `
            + 'The posted row is never edited; an opposite entry is recorded. Then re-run Stage 7 for this employee and month so the payslip matches.'}
          onSubmit={(reason) => run.mutate({
            fn: () => reverseLoanDeduction(modal.deduction.id, reason),
            ok: (d) => `${rupees(d.amount)} reversed — re-run Stage 7 for ${d.employeeCode} ${monthLabel(d.month, d.year)}`,
          })}
          onClose={() => setModal(null)} />
      )}
      {modal === 'change' && (
        <ChangeRequestModal loan={loan} instalments={loan.instalments} busy={run.isPending} onClose={() => setModal(null)}
          onSubmit={(body) => run.mutate({ fn: () => requestLoanChange(loan.id, body), ok: (d) => `${KIND_LABEL[d.kind]} request #${d.requestId} sent to the admin` })} />
      )}
    </div>
  )
}
