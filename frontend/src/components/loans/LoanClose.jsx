// Loans PR-6b — the monthly loan close screen (SPEC §7 screen 5), on the PR-6 API:
//   GET  /api/loans/close/preview?month&year&payroll   read roles; company-restricted users get 403
//   POST /api/loans/close {month, year, payroll}       finance / admin; 201, 409 ALREADY_CLOSED
//   GET  /api/loans/closes                             read roles (history, notes parsed)
// Loans PR-9: a Plant / Sales toggle. The two payrolls close separately (plant never waits
// for sales); sales month M is the cycle 26th of M−1 to 25th of M (SPEC §5.3).
import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../ui/Modal'
import { MONTH_OPTIONS } from '../../utils/formatters'
import { getLoanClosePreview, runLoanClose, getLoanCloses, getLoansDue } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import {
  loanCaps, rupees, monthLabel, istDateTime, errText, todayIst, closeReadinessText, companyRestricted, triggerLabel,
} from './loanUi'

const RESTRICTED_TEXT = 'The loan close covers both companies, so only a user with access to all companies can preview or run it.'

/** The month before the current IST month. */
function previousIstMonth() {
  const [y, m] = todayIst().split('-').map(Number)
  return m === 1 ? { month: 12, year: y - 1 } : { month: m - 1, year: y }
}

function Tile({ label, value, sub, tone = 'slate', testid }) {
  const tones = {
    slate: 'border-l-slate-300', blue: 'border-l-blue-400', green: 'border-l-green-500',
    amber: 'border-l-amber-400', red: 'border-l-red-400', purple: 'border-l-purple-400',
  }
  return (
    <div className={clsx('stat-card border-l-4', tones[tone])} data-testid={testid}>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-xl font-bold text-slate-800">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

function NotesDetail({ notes }) {
  if (!notes || typeof notes !== 'object') return <div className="text-xs text-slate-500">{notes ? String(notes) : 'No notes.'}</div>
  const lists = [
    ['Payslip ≠ ledger (left provisional)', notes.mismatches, (x) => `${x.employeeCode}: payslip ${rupees(x.payslip)}, ledger ${rupees(x.ledger)}${x.salaryRows > 1 ? ` (${x.salaryRows} salary rows)` : ''}`],
    ['Held (left provisional for the daily sweep)', notes.held, (x) => `Loan #${x.loanId} · ${x.employeeCode} · ${rupees(x.amount)}`],
    ['No salary (instalment moved to the end)', notes.noSalary, (x) => `Loan #${x.loanId} · ${x.employeeCode} · ${rupees(x.amount)} — ${x.note}`],
    ['Left scheduled (employee mismatched)', notes.leftScheduled, (x) => `Loan #${x.loanId} · ${x.employeeCode} · instalment id ${x.instalmentId}`],
    ['Refused by the engine', notes.refusals, (x) => `${x.loanId ? `Loan #${x.loanId}: ` : ''}${x.code} — ${x.message}`],
    ['Warnings', notes.warnings, (x) => x.message || x.code],
    ['Reconciliation problems (pre-existing)', notes.reconciliation, (x) => `Loan #${x.loanId}: ${(x.problems || []).join('; ')}`],
  ].filter(([, rows]) => Array.isArray(rows) && rows.length)
  if (!lists.length) return <div className="text-xs text-slate-500">Nothing left over: every deduction posted cleanly.</div>
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {lists.map(([title, rows, fmt]) => (
        <div key={title}>
          <div className="text-xs font-semibold text-slate-600">{title} ({rows.length})</div>
          <ul className="list-disc ml-5 text-xs text-slate-600">{rows.map((x, i) => <li key={i}>{fmt(x)}</li>)}</ul>
        </div>
      ))}
    </div>
  )
}

export default function LoanClose() {
  const user = useAppStore((s) => s.user)
  const caps = loanCaps(user)
  const restricted = companyRestricted(user)
  const qc = useQueryClient()
  const [sel, setSel] = useState(previousIstMonth)
  const [confirming, setConfirming] = useState(false)
  const [open, setOpen] = useState(null)
  const [payroll, setPayroll] = useState('plant')
  const payrollName = payroll === 'sales' ? 'sales' : 'plant'
  const { month, year } = sel
  const label = monthLabel(month, year)
  const thisYear = Number(todayIst().slice(0, 4))
  const years = []
  for (let y = 2026; y <= Math.max(thisYear, 2026); y++) years.push(y)

  const preview = useQuery({
    queryKey: ['loan-close-preview', payroll, month, year],
    queryFn: () => getLoanClosePreview(month, year, payroll),
    enabled: !restricted,
    retry: 0,
  })
  const p = preview.data?.data?.data
  const previewForbidden = restricted || preview.error?.response?.data?.code === 'COMPANY_NOT_ALLOWED'
  const due = useQuery({ queryKey: ['loans-due', month, year], queryFn: () => getLoansDue(month, year), retry: 0 })
  // /loans/due lists both payrolls; keep this payroll's rows (borrower_type).
  const dueRows = (due.data?.data?.data || []).filter((x) => x.borrower_type === payroll)
  const dueOpen = dueRows.filter((x) => x.status !== 'posted').reduce((s, x) => s + Math.round(Number(x.amount_due || 0) * 100), 0) / 100
  const history = useQuery({ queryKey: ['loan-closes'], queryFn: getLoanCloses, retry: 0 })
  const closes = history.data?.data?.data || []

  const refresh = () => {
    for (const k of ['loan-close-preview', 'loan-closes', 'loan-stats', 'loans', 'loan', 'loans-due', 'employee-loans']) qc.invalidateQueries({ queryKey: [k] })
  }
  const close = useMutation({
    mutationFn: () => runLoanClose(month, year, payroll),
    onSuccess: (res) => {
      const d = res?.data?.data || {}
      toast.success(`Closed ${payroll === 'sales' ? 'sales ' : ''}${label}: posted ${d.posted} (${rupees(d.postedAmount)}), held ${d.held}, shortfall ${d.shortfall}, no salary ${d.noSalary}`, { duration: 6000 })
      if (d.mismatches?.length) toast(`${d.mismatches.length} payslip/ledger mismatch(es) left provisional — ${payroll === 'sales' ? 'recompute the sales salary for those reps' : 're-run Stage 7 for those employees'}`, { icon: '⚠️', duration: 8000 })
      if (d.reconciliationOk === false) toast.error('A loan did not reconcile before this close; it is recorded in the close notes', { duration: 8000 })
      setConfirming(false)
      refresh()
    },
    onError: (err) => {
      toast.error(errText(err, 'The loan close failed'))
      setConfirming(false)
      refresh()
    },
  })

  const r = p?.readiness
  const closedRow = p?.close
  const canRun = caps.canClose && !restricted && r?.ok === true

  return (
    <div className="space-y-4" data-testid="loan-close">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-600 max-w-3xl space-y-1">
          <div>
            The loan close posts each month's payroll loan deductions to the loan balances. Plant and sales payrolls close separately;
            pick one below.{payroll === 'sales' && ' Sales month M is the cycle from the 26th of the month before to the 25th of M.'}
          </div>
          <div className="text-xs text-slate-500" data-testid="close-auto-note">
            It also runs <strong>automatically every day at 06:15 IST</strong>. From the 13th it closes last month, and any earlier open
            month oldest first, once {payroll === 'sales' ? "that month's sales upload is computed" : 'plant payroll (Stage 7) for that month is computed'}.
            Use <em>Close now</em> to close earlier, or after fixing whatever it was waiting for.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="group" data-testid="close-payroll">
            {['plant', 'sales'].map((pr) => (
              <button key={pr} type="button" data-testid={`close-payroll-${pr}`} aria-pressed={payroll === pr}
                className={clsx('px-3 py-1.5 text-sm font-medium', payroll === pr ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                onClick={() => { setPayroll(pr); setConfirming(false) }}>
                {pr === 'plant' ? 'Plant' : 'Sales'}
              </button>
            ))}
          </div>
          <select className="select text-sm w-36" value={month} data-testid="close-month"
            onChange={(e) => setSel({ month: Number(e.target.value), year })}>
            {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="select text-sm w-24" value={year} data-testid="close-year"
            onChange={(e) => setSel({ month, year: Number(e.target.value) })}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {previewForbidden ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="close-restricted">
          {RESTRICTED_TEXT}
        </div>
      ) : preview.isLoading ? (
        <div className="text-sm text-slate-400">Loading {label}…</div>
      ) : preview.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="close-error">{errText(preview.error)}</div>
      ) : p && (
        <>
          <div className={clsx('rounded-xl border px-4 py-3 text-sm space-y-1',
            r.ok ? 'border-green-200 bg-green-50 text-green-800'
              : r.code === 'ALREADY_CLOSED' ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-amber-200 bg-amber-50 text-amber-800')}
            data-testid="close-readiness" data-code={r.ok ? 'READY' : r.code}>
            <div className="font-semibold">{r.ok ? `${payroll === 'sales' ? 'Sales' : 'Plant'} ${label} is ready to close.` : closeReadinessText(r, label, payroll)}</div>
            {!r.ok && r.code === 'EARLIER_MONTH_OPEN' && Array.isArray(r.earlier) && (
              <div className="flex gap-2 flex-wrap items-center">
                <span>Close first:</span>
                {r.earlier.map((m) => (
                  <button key={`${m.month}-${m.year}`} className="underline font-semibold" data-testid={`close-earlier-${m.month}-${m.year}`}
                    onClick={() => setSel({ month: m.month, year: m.year })}>{monthLabel(m.month, m.year)}</button>
                ))}
              </div>
            )}
            {!r.ok && r.code === 'ALREADY_CLOSED' && closedRow && (
              <div data-testid="close-done">
                Closed {istDateTime(closedRow.run_at)} by <strong>{closedRow.run_by}</strong> ({triggerLabel(closedRow.trigger_kind)}): posted {closedRow.posted_count} ({rupees(closedRow.posted_amount)}),
                {' '}deferred {closedRow.deferred_count}, held {closedRow.held_count}, no salary {closedRow.no_salary_count}, shortfall {closedRow.shortfall_count}.
                {closedRow.reconciliation_ok === 0 && <span className="font-semibold text-red-700"> A loan did not reconcile (see the history notes).</span>}
              </div>
            )}
            {!r.ok && !['ALREADY_CLOSED', 'NOT_NEEDED'].includes(r.code) && r.message && <div className="text-xs opacity-80">{r.message}</div>}
            {r.ok && r.warnings?.length > 0 && (
              <ul className="list-disc ml-5 text-xs text-amber-800">{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Tile label="Due this month" value={dueRows.length} sub={`${rupees(dueOpen)} not yet posted`} tone="blue" testid="close-tile-due" />
            <Tile label="Provisional" value={p.provisional.count} sub={rupees(p.provisional.amount)} tone="amber" testid="close-tile-provisional" />
            <Tile label={closedRow ? 'Would post now' : 'Would post'} value={p.wouldPost.count} sub={rupees(p.wouldPost.amount)} tone="green" testid="close-tile-post" />
            <Tile label={closedRow ? 'Still held' : 'Held'} value={p.held} sub="salary on hold — stays provisional" tone="purple" testid="close-tile-held" />
            <Tile label="Shortfalls" value={p.shortfalls} sub="pay bore less than the EMI" tone="slate" testid="close-tile-shortfalls" />
            <Tile label="No salary" value={p.noSalary} sub="instalment moves to the end" tone="slate" testid="close-tile-nosalary" />
            <Tile label="Payslip ≠ ledger" value={p.mismatches.length} sub="left provisional" tone={p.mismatches.length ? 'red' : 'slate'} testid="close-tile-mismatch" />
          </div>
          {closedRow && (p.held > 0 || p.mismatches.length > 0 || p.provisional.count > 0) && (
            <div className="text-xs text-slate-500">This month is closed; the rows above are still waiting for the daily sweep, which posts each one once its hold is released and its payslip agrees with the ledger.</div>
          )}
          {!r.ok && r.code !== 'ALREADY_CLOSED' && (
            <div className="text-xs text-slate-500" data-testid="close-not-ready-hint">These numbers show where {label} stands today. Nothing is posted or moved until the month can be closed.</div>
          )}

          {p.mismatches.length > 0 && (
            <div className="card overflow-hidden" data-testid="close-mismatches">
              <div className="px-4 py-2 border-b border-slate-100 text-sm font-semibold text-slate-700">Payslip and loan ledger disagree</div>
              <table className="table-compact w-full">
                <thead><tr><th>Employee</th>{payroll === 'sales' && <th>Company</th>}<th className="text-right">Payslip loan</th><th className="text-right">Ledger</th><th className="text-center">Salary rows</th><th>What to do</th></tr></thead>
                <tbody>
                  {p.mismatches.map((x) => (
                    <tr key={`${x.employeeCode}|${x.company || ''}`}>
                      <td className="font-mono text-xs">{x.employeeCode}</td>
                      {payroll === 'sales' && <td className="text-xs">{x.company}</td>}
                      <td className="text-right font-mono">{rupees(x.payslip)}</td>
                      <td className="text-right font-mono">{rupees(x.ledger)}</td>
                      <td className="text-center">{x.salaryRows}</td>
                      <td className="text-xs text-slate-600">{payroll === 'sales' ? 'Recompute the sales salary for this rep.' : 'Re-run Stage 7 for this employee.'} The close leaves the row provisional; the daily sweep posts it once they agree.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {caps.canClose ? (
              <button className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed" disabled={!canRun || close.isPending}
                data-testid="close-run" onClick={() => setConfirming(true)}>
                {close.isPending ? 'Closing…' : `Close ${payrollName} ${label} now`}
              </button>
            ) : (
              <span className="text-xs text-slate-500 bg-slate-100 rounded-lg px-2 py-1.5" data-testid="close-readonly">
                Only finance or the admin can run the loan close.
              </span>
            )}
          </div>
        </>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm text-slate-700">Past closes</div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full min-w-[960px]" data-testid="close-history">
            <thead><tr>
              <th>Month</th><th>Payroll</th><th>Closed (IST)</th><th>By</th><th>How</th><th className="text-right">Posted</th>
              <th className="text-center">Deferred</th><th className="text-center">Held</th><th className="text-center">No salary</th>
              <th className="text-center">Shortfall</th><th className="text-center">Reconciles</th><th />
            </tr></thead>
            <tbody>
              {history.isLoading ? <tr><td colSpan={12} className="text-center py-6 text-slate-400">Loading…</td></tr>
                : history.error ? <tr><td colSpan={12} className="text-center py-6 text-red-600">{errText(history.error)}</td></tr>
                  : closes.length === 0 ? <tr><td colSpan={12} className="text-center py-6 text-slate-400">No loan close has run yet.</td></tr>
                    : closes.map((c) => (
                      <React.Fragment key={c.id}>
                        <tr data-testid={`close-row-${c.month}-${c.year}`}>
                          <td><button className="text-blue-700 hover:underline text-sm" onClick={() => { setSel({ month: c.month, year: c.year }); setPayroll(c.payroll === 'sales' ? 'sales' : 'plant') }}>{monthLabel(c.month, c.year)}</button></td>
                          <td className="text-xs">{c.payroll}</td>
                          <td className="text-xs whitespace-nowrap">{istDateTime(c.run_at)}</td>
                          <td className="text-xs">{c.run_by}</td>
                          <td className="text-xs">{triggerLabel(c.trigger_kind)}</td>
                          <td className="text-right font-mono text-xs">{c.posted_count} · {rupees(c.posted_amount)}</td>
                          <td className="text-center text-xs">{c.deferred_count}</td>
                          <td className="text-center text-xs">{c.held_count}</td>
                          <td className="text-center text-xs">{c.no_salary_count}</td>
                          <td className="text-center text-xs">{c.shortfall_count}</td>
                          <td className="text-center">{c.reconciliation_ok === 0 ? <span className="text-red-600 font-semibold">✗</span> : <span className="text-green-600">✓</span>}</td>
                          <td><button className="text-xs text-blue-700" data-testid={`close-notes-${c.id}`} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide' : 'Details'}</button></td>
                        </tr>
                        {open === c.id && <tr><td colSpan={12} className="bg-slate-50" data-testid={`close-notes-body-${c.id}`}><NotesDetail notes={c.notes} /></td></tr>}
                      </React.Fragment>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirming && p && (
        <Modal title={`Close ${payrollName} loans for ${label}?`} onClose={() => !close.isPending && setConfirming(false)} size="md">
          <div className="space-y-3 text-sm text-slate-700" data-testid="close-confirm">
            <ul className="list-disc ml-5 space-y-1">
              <li>Posts <strong>{p.wouldPost.count}</strong> deduction{p.wouldPost.count === 1 ? '' : 's'} totalling <strong>{rupees(p.wouldPost.amount)}</strong> to the loan balances.</li>
              {p.shortfalls > 0 && <li>{p.shortfalls} shortfall{p.shortfalls === 1 ? '' : 's'}: the part pay could not bear moves to the end of that schedule.</li>}
              {p.held > 0 && <li>{p.held} held salar{p.held === 1 ? 'y stays' : 'ies stay'} provisional; the daily sweep posts each once its hold is released.</li>}
              {p.noSalary > 0 && <li>{p.noSalary} instalment{p.noSalary === 1 ? '' : 's'} with no salary deduction move to the end of the schedule.</li>}
              {p.mismatches.length > 0 && <li className="text-red-700">Payslip and ledger disagree for {p.mismatches.length} employee{p.mismatches.length === 1 ? '' : 's'}: {p.mismatches.length === 1 ? 'that deduction stays' : 'those deductions stay'} provisional.</li>}
            </ul>
            <div className="text-xs text-slate-500">
              A posted deduction is never edited. Only the admin can reverse one, with a reason, from the loan's page.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" disabled={close.isPending} onClick={() => setConfirming(false)}>Back</button>
              <button className="btn-primary" disabled={close.isPending} data-testid="close-confirm-run" onClick={() => close.mutate()}>
                {close.isPending ? 'Closing…' : `Close ${label}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
