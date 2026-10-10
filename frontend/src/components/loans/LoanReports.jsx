// Loans PR-9 — loan reports (SPEC §7 screen 6): outstanding register, 12-month
// recovery forecast, exceptions (deferred / shortfall / no salary / residual),
// leavers with a balance, the perquisite list for the CA, and the write-off (TDS)
// list. Read-only; every figure comes from the loan ledger (GET /api/loans/reports/*).
// Each view downloads the same figures as Excel.
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { MONTH_OPTIONS } from '../../utils/formatters'
import { useAppStore } from '../../store/appStore'
import { getLoanReport, downloadLoanReport, getLoanWriteOffs, downloadLoanWriteOffs } from '../../utils/api'
import { LOAN_STATE, INSTALMENT_STATE, stateLabel, stateCls, rupees, monthLabel, errText, todayIst } from './loanUi'

const VIEWS = [
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'forecast', label: 'Recovery forecast' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'leavers', label: 'Leavers' },
  { id: 'perquisite', label: 'Perquisite list' },
  { id: 'write-offs', label: 'Write-offs (TDS)' },
]

const EXCEPTION_KIND = {
  shortfall: 'Shortfall (pay bore less)', no_salary: 'No salary that month', held: 'Held past the wait',
  deferred: 'Deferred (approved)', reversal: 'Admin reversal', extension_limit: 'Extension limit reached — not scheduled', exit_residual: 'Exit residual',
}
const LEAVER_STAGE = {
  awaiting_final_payroll: 'Awaiting final payroll', residual: 'Residual — receipt or write-off', held_pending: 'Final salary held',
  not_disbursed: 'Not paid out (exit flagged)',
}
const PAYROLL_TAG = (p) => (p === 'sales'
  ? <span className="ml-1 text-[10px] font-semibold px-1 rounded bg-violet-100 text-violet-700">Sales</span>
  : null)
const ml = (m) => (m ? monthLabel(m.month, m.year) : '—')

function currentMonth() {
  const [y, m] = todayIst().split('-').map(Number)
  return { month: m, year: y }
}
function fyStart() {
  const { month, year } = currentMonth()
  return { month: 4, year: month >= 4 ? year : year - 1 }
}

function MonthPick({ value, onChange, testid }) {
  const now = currentMonth()
  const years = []
  for (let y = 2026; y <= Math.max(now.year + 1, 2026); y++) years.push(y)
  return (
    <span className="inline-flex gap-1" data-testid={testid}>
      <select className="select text-sm w-32" value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}>
        {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select className="select text-sm w-24" value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </span>
  )
}

function saveBlob(res, fallback) {
  const cd = res?.headers?.['content-disposition'] || ''
  const m = /filename="?([^";]+)"?/.exec(cd)
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = m ? m[1] : fallback
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function Card({ title, children, right, testid }) {
  return (
    <div className="card overflow-hidden" data-testid={testid}>
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-slate-700">{title}</span>{right}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

const Empty = ({ cols, text }) => <tr><td colSpan={cols} className="text-center py-8 text-slate-400">{text}</td></tr>

function Outstanding({ d, navigate }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card border-l-4 border-l-purple-400" data-testid="rep-total-outstanding">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Outstanding</span>
          <span className="text-xl font-bold text-slate-800">{rupees(d.totals.balance)}</span>
          <span className="text-xs text-slate-500">{d.totals.loans} live loan{d.totals.loans === 1 ? '' : 's'}</span>
        </div>
        {d.byCompany.map((c) => (
          <div key={`${c.payroll}|${c.company}`} className="stat-card border-l-4 border-l-slate-300">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{c.payroll} · {c.company}</span>
            <span className="text-xl font-bold text-slate-800">{rupees(c.balance)}</span>
            <span className="text-xs text-slate-500">{c.loans} loan{c.loans === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
      {d.reconcileProblems > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" data-testid="rep-recon-problem">
          {d.reconcileProblems} loan{d.reconcileProblems === 1 ? ' does' : 's do'} not reconcile — see the rows marked ✗.
        </div>
      )}
      <Card title="By company and department" testid="rep-groups">
        <table className="table-compact w-full min-w-[820px]">
          <thead><tr><th>Payroll</th><th>Company</th><th>Department</th><th className="text-center">Loans</th><th className="text-right">Disbursed</th>
            <th className="text-right">Recovered (payroll)</th><th className="text-right">Cash</th><th className="text-right">Written off</th><th className="text-right">Outstanding</th></tr></thead>
          <tbody>
            {d.groups.length === 0 ? <Empty cols={9} text="No live loans." /> : d.groups.map((g) => (
              <tr key={`${g.payroll}|${g.company}|${g.department}`}>
                <td className="text-xs">{g.payroll}</td><td className="text-xs">{g.company}</td><td className="text-xs">{g.department}</td>
                <td className="text-center">{g.loans}</td><td className="text-right font-mono">{rupees(g.disbursed)}</td><td className="text-right font-mono">{rupees(g.recovered)}</td>
                <td className="text-right font-mono">{rupees(g.cash)}</td><td className="text-right font-mono">{rupees(g.writtenOff)}</td><td className="text-right font-mono font-semibold">{rupees(g.balance)}</td>
              </tr>
            ))}
          </tbody>
          {d.groups.length > 0 && (
            <tfoot><tr className="font-semibold bg-slate-50">
              <td colSpan={3}>Total</td><td className="text-center">{d.totals.loans}</td><td className="text-right font-mono">{rupees(d.totals.disbursed)}</td>
              <td className="text-right font-mono">{rupees(d.totals.recovered)}</td><td className="text-right font-mono">{rupees(d.totals.cash)}</td>
              <td className="text-right font-mono">{rupees(d.totals.writtenOff)}</td><td className="text-right font-mono" data-testid="rep-groups-total">{rupees(d.totals.balance)}</td>
            </tr></tfoot>
          )}
        </table>
      </Card>
      <Card title="Loans" testid="rep-outstanding-rows">
        <table className="table-compact w-full min-w-[1100px]">
          <thead><tr><th>#</th><th>Borrower</th><th>Company</th><th>Department</th><th>Type</th><th>Status</th><th className="text-right">Disbursed</th>
            <th className="text-right">Recovered</th><th className="text-right">Cash</th><th className="text-right">Outstanding</th><th className="text-right">Not scheduled</th><th>Next due</th><th className="text-center">Reconciles</th></tr></thead>
          <tbody>
            {d.rows.length === 0 ? <Empty cols={13} text="No live loans." /> : d.rows.map((r) => (
              <tr key={r.loanId} className="cursor-pointer hover:bg-blue-50/50" onClick={() => navigate(`/loans/${r.loanId}`)}>
                <td className="text-xs text-slate-400">{r.loanId}</td>
                <td><div className="text-sm">{r.employeeName || r.employeeCode}</div><div className="text-[11px] text-slate-400 font-mono">{r.employeeCode}{PAYROLL_TAG(r.payroll)}</div></td>
                <td className="text-xs">{r.company}</td><td className="text-xs">{r.department}{r.headquarters ? ` · ${r.headquarters}` : ''}</td><td className="text-xs">{r.loanType}</td>
                <td><span className={clsx('text-xs px-2 py-0.5 rounded-full', stateCls(LOAN_STATE, r.status))}>{stateLabel(LOAN_STATE, r.status)}</span></td>
                <td className="text-right font-mono">{rupees(r.disbursed)}</td><td className="text-right font-mono">{rupees(r.recovered)}</td><td className="text-right font-mono">{rupees(r.cash)}</td>
                <td className="text-right font-mono font-semibold">{rupees(r.balance)}</td><td className="text-right font-mono">{r.uncovered ? rupees(r.uncovered) : '—'}</td>
                <td className="text-xs">{r.nextDue ? `${monthLabel(r.nextDue.month, r.nextDue.year)} · ${rupees(r.nextDue.amount)}` : '—'}</td>
                <td className="text-center">{r.reconciles ? <span className="text-green-600">✓</span> : <span className="text-red-600 font-semibold" title={(r.problems || []).join('; ')}>✗</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function Forecast({ d }) {
  const line = (label, b, testid, cls) => (
    <tr key={label} className={cls} data-testid={testid}>
      <td className="text-sm">{label}</td><td className="text-center text-xs">{b.count || '—'}</td>
      {d.columns.map((c) => <td key={c.key} className="text-right font-mono">{b.byKey[c.key] ? rupees(b.byKey[c.key]) : '—'}</td>)}
      <td className="text-right font-mono font-semibold">{rupees(b.amount)}</td>
    </tr>
  )
  return (
    <div className="space-y-3">
      <div className={clsx('rounded-xl border px-4 py-2 text-sm', d.reconciles ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700')} data-testid="rep-forecast-check">
        Forecast total {rupees(d.total)} {d.reconciles ? '=' : '≠'} outstanding {rupees(d.outstanding)}.
      </div>
      <Card title={`Open instalments from ${ml(d.from)}`} testid="rep-forecast">
        <table className="table-compact w-full min-w-[720px]">
          <thead><tr><th>Month</th><th className="text-center">Instalments</th>{d.columns.map((c) => <th key={c.key} className="text-right">{c.payroll} · {c.company}</th>)}<th className="text-right">Total</th></tr></thead>
          <tbody>
            {line('Overdue — due before, not yet closed', d.overdue, 'rep-forecast-overdue', 'bg-amber-50/60')}
            {d.months.map((b) => line(monthLabel(b.month, b.year), b, `rep-forecast-${b.month}-${b.year}`))}
            {line('Later than 12 months', d.later, 'rep-forecast-later')}
            {line('Not scheduled (extension limit / exit residual)', d.unscheduled, 'rep-forecast-unscheduled', 'bg-slate-50')}
          </tbody>
          <tfoot><tr className="font-semibold bg-slate-50"><td colSpan={2 + d.columns.length}>Total</td><td className="text-right font-mono" data-testid="rep-forecast-total">{rupees(d.total)}</td></tr></tfoot>
        </table>
      </Card>
    </div>
  )
}

function Exceptions({ d, navigate }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {Object.entries(d.summary).map(([k, v]) => (
          <span key={k} className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-700">{EXCEPTION_KIND[k] || k}: <strong>{v.count}</strong> · {rupees(v.amount)}</span>
        ))}
        {Object.keys(d.summary).length === 0 && <span className="text-sm text-slate-500">No exceptions: every loan is on its original schedule.</span>}
      </div>
      <Card title="Deferred, shortfall, no-salary and residual items still open" testid="rep-exceptions">
        <table className="table-compact w-full min-w-[960px]">
          <thead><tr><th>Kind</th><th>#</th><th>Borrower</th><th>Company</th><th>Due</th><th>Moved from</th><th>Instalment</th><th className="text-right">Amount</th><th className="text-right">Held pending</th></tr></thead>
          <tbody>
            {d.rows.length === 0 ? <Empty cols={9} text="Nothing open." /> : d.rows.map((r, i) => (
              <tr key={`${r.kind}-${r.loanId}-${r.instalmentId || i}`} className="cursor-pointer hover:bg-blue-50/50" onClick={() => navigate(`/loans/${r.loanId}`)}>
                <td className="text-xs">{EXCEPTION_KIND[r.kind] || r.kind}</td><td className="text-xs text-slate-400">{r.loanId}</td>
                <td><div className="text-sm">{r.employeeName || r.employeeCode}</div><div className="text-[11px] text-slate-400 font-mono">{r.employeeCode}{PAYROLL_TAG(r.payroll)}</div></td>
                <td className="text-xs">{r.company}</td><td className="text-xs">{ml(r.dueMonth)}</td><td className="text-xs">{ml(r.fromMonth)}</td>
                <td>{r.status ? <span className={clsx('text-xs px-2 py-0.5 rounded-full', stateCls(INSTALMENT_STATE, r.status))}>{stateLabel(INSTALMENT_STATE, r.status)}</span> : '—'}</td>
                <td className="text-right font-mono">{rupees(r.amount)}</td><td className="text-right font-mono">{r.heldPending ? rupees(r.heldPending) : '—'}</td>
              </tr>
            ))}
          </tbody>
          {d.rows.length > 0 && <tfoot><tr className="font-semibold bg-slate-50"><td colSpan={7}>Total</td><td className="text-right font-mono">{rupees(d.total)}</td><td /></tr></tfoot>}
        </table>
      </Card>
    </div>
  )
}

function Leavers({ d, navigate }) {
  return (
    <Card title="Borrowers marked Left" testid="rep-leavers">
      <table className="table-compact w-full min-w-[1000px]">
        <thead><tr><th>#</th><th>Borrower</th><th>Company</th><th>Exit date</th><th>Final payroll</th><th>Stage</th><th className="text-right">Outstanding</th>
          <th className="text-right">Due in final payroll</th><th className="text-right">Residual</th><th className="text-right">Held pending</th><th>Pending request</th></tr></thead>
        <tbody>
          {d.rows.length === 0 ? <Empty cols={11} text="No leaver has a loan balance." /> : d.rows.map((r) => (
            <tr key={r.loanId} className="cursor-pointer hover:bg-blue-50/50" onClick={() => navigate(`/loans/${r.loanId}`)}>
              <td className="text-xs text-slate-400">{r.loanId}</td>
              <td><div className="text-sm">{r.employeeName || r.employeeCode}</div><div className="text-[11px] text-slate-400 font-mono">{r.employeeCode}{PAYROLL_TAG(r.borrowerType)}</div></td>
              <td className="text-xs">{r.company}</td><td className="text-xs">{r.exitDate || '—'}</td><td className="text-xs">{ml(r.finalMonth)}</td>
              <td className="text-xs">{LEAVER_STAGE[r.stage] || r.stage}</td><td className="text-right font-mono">{rupees(r.balance)}</td>
              <td className="text-right font-mono">{r.dueInFinalPayroll ? rupees(r.dueInFinalPayroll) : '—'}</td><td className="text-right font-mono">{r.residual ? rupees(r.residual) : '—'}</td>
              <td className="text-right font-mono">{r.heldPending ? rupees(r.heldPending) : '—'}</td><td className="text-xs">{r.pendingRequest || '—'}</td>
            </tr>
          ))}
        </tbody>
        {d.rows.length > 0 && (
          <tfoot><tr className="font-semibold bg-slate-50"><td colSpan={6}>Total</td><td className="text-right font-mono">{rupees(d.totals.balance)}</td>
            <td className="text-right font-mono">{rupees(d.totals.dueInFinalPayroll)}</td><td className="text-right font-mono">{rupees(d.totals.residual)}</td>
            <td className="text-right font-mono">{rupees(d.totals.heldPending)}</td><td /></tr></tfoot>
        )}
      </table>
    </Card>
  )
}

function Perquisite({ d }) {
  const any = d.months.some((m) => m.borrowers.length)
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="rep-perq-threshold">
        Threshold <strong>{rupees(d.threshold)}</strong> — {d.thresholdPending}. Listed: borrowers whose aggregate outstanding (all their loans with one
        employer) went above the threshold in the month. <em>Peak</em> = opening + paid out in the month; <em>month-end</em> = the balance on the last day,
        after that month's posted EMI (a month not yet closed shows it before its EMI). No tax is calculated here.
      </div>
      {!any && <div className="text-sm text-slate-500" data-testid="rep-perq-empty">No borrower went above the threshold from {ml(d.from)} to {ml(d.to)}.</div>}
      {d.months.filter((m) => m.borrowers.length).map((m) => (
        <Card key={m.label} title={`${monthLabel(m.month, m.year)} — ${m.borrowers.length} borrower${m.borrowers.length === 1 ? '' : 's'}`} testid={`rep-perq-${m.month}-${m.year}`}
          right={<span className="text-xs text-slate-500">loan close: plant {m.closed.plant ? 'run' : 'not run'} · sales {m.closed.sales ? 'run' : 'not run'}</span>}>
          <table className="table-compact w-full min-w-[720px]">
            <thead><tr><th>Borrower</th><th>Company</th><th>Loans</th><th className="text-right">Peak outstanding</th><th className="text-right">Month-end outstanding</th></tr></thead>
            <tbody>
              {m.borrowers.map((b) => (
                <tr key={`${b.payroll}|${b.employeeCode}|${b.company}`}>
                  <td><div className="text-sm">{b.employeeName || b.employeeCode}</div><div className="text-[11px] text-slate-400 font-mono">{b.employeeCode}{PAYROLL_TAG(b.payroll)}</div></td>
                  <td className="text-xs">{b.company}</td><td className="text-xs">{b.loans.map((x) => `#${x}`).join(', ')}</td>
                  <td className="text-right font-mono font-semibold">{rupees(b.peak)}</td><td className="text-right font-mono">{rupees(b.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  )
}

function WriteOffs({ d }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
        A written-off balance is reportable for TDS. How TDS is applied is pending CA confirmation (SPEC Q4).
      </div>
      <Card title="Write-offs" testid="rep-writeoffs">
        <table className="table-compact w-full min-w-[960px]">
          <thead><tr><th>#</th><th>Borrower</th><th>Company</th><th>Type</th><th className="text-right">Written off</th><th>Write-off month</th><th>Approved by</th><th>Exit date</th><th>Final payroll</th><th>Reason</th></tr></thead>
          <tbody>
            {d.rows.length === 0 ? <Empty cols={10} text="No write-off in this month." /> : d.rows.map((r) => (
              <tr key={r.loanId}>
                <td className="text-xs text-slate-400">{r.loanId}</td><td className="font-mono text-xs">{r.employeeCode}{PAYROLL_TAG(r.borrowerType)}</td><td className="text-xs">{r.company}</td>
                <td className="text-xs">{r.loanType}</td><td className="text-right font-mono">{rupees(r.amount)}</td><td className="text-xs">{ml(r.writeOffMonth)}</td>
                <td className="text-xs">{r.writtenOffBy}</td><td className="text-xs">{r.exitDate || '—'}</td><td className="text-xs">{ml(r.finalMonth)}</td><td className="text-xs max-w-xs truncate" title={r.reason}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
          {d.rows.length > 0 && <tfoot><tr className="font-semibold bg-slate-50"><td colSpan={4}>Total</td><td className="text-right font-mono">{rupees(d.total)}</td><td colSpan={5} /></tr></tfoot>}
        </table>
      </Card>
    </div>
  )
}

export default function LoanReports() {
  const navigate = useNavigate()
  const selectedCompany = useAppStore((s) => s.selectedCompany)
  const [view, setView] = useState('outstanding')
  const [from, setFrom] = useState(currentMonth)
  const [perqFrom, setPerqFrom] = useState(fyStart)
  const [perqTo, setPerqTo] = useState(currentMonth)
  const [wo, setWo] = useState(currentMonth)
  const [basis, setBasis] = useState('writeoff')
  const [busy, setBusy] = useState(false)

  const company = selectedCompany ? { company: selectedCompany } : {}
  const params = view === 'forecast' ? { ...company, fromMonth: from.month, fromYear: from.year }
    : view === 'perquisite' ? { ...company, fromMonth: perqFrom.month, fromYear: perqFrom.year, toMonth: perqTo.month, toYear: perqTo.year }
      : view === 'write-offs' ? { month: wo.month, year: wo.year, basis }
        : company
  const q = useQuery({
    queryKey: ['loan-report', view, params],
    queryFn: () => (view === 'write-offs' ? getLoanWriteOffs(params) : getLoanReport(view, params)),
    retry: 0,
  })
  const body = q.data?.data
  const d = view === 'write-offs' ? body && { rows: body.data || [], total: body.total || 0 } : body?.data

  const download = async () => {
    setBusy(true)
    try {
      const res = view === 'write-offs' ? await downloadLoanWriteOffs(params) : await downloadLoanReport(view, params)
      saveBlob(res, `Loans_${view}.xlsx`)
    } catch (e) {
      toast.error(errText(e, 'The Excel download failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="loan-reports">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} data-testid={`rep-view-${v.id}`}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium', view === v.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {view === 'forecast' && <><span className="text-xs text-slate-500">From</span><MonthPick value={from} onChange={setFrom} testid="rep-forecast-from" /></>}
          {view === 'perquisite' && (
            <>
              <span className="text-xs text-slate-500">From</span><MonthPick value={perqFrom} onChange={setPerqFrom} testid="rep-perq-from" />
              <span className="text-xs text-slate-500">to</span><MonthPick value={perqTo} onChange={setPerqTo} testid="rep-perq-to" />
            </>
          )}
          {view === 'write-offs' && (
            <>
              <MonthPick value={wo} onChange={setWo} testid="rep-wo-month" />
              <select className="select text-sm w-44" value={basis} onChange={(e) => setBasis(e.target.value)} data-testid="rep-wo-basis">
                <option value="writeoff">by write-off month</option>
                <option value="final">by final payroll month</option>
              </select>
            </>
          )}
          <button className="btn-ghost text-sm" disabled={busy || !d} onClick={download} data-testid="rep-download">{busy ? 'Preparing…' : 'Download Excel'}</button>
        </div>
      </div>
      {selectedCompany && view !== 'write-offs' && <div className="text-xs text-slate-500">Company filter: {selectedCompany}</div>}

      {q.isLoading ? <div className="text-sm text-slate-400">Loading…</div>
        : q.error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="rep-error">{errText(q.error)}</div>
          : d && (
            <div data-testid={`rep-${view}`}>
              {view === 'outstanding' && <Outstanding d={d} navigate={navigate} />}
              {view === 'forecast' && <Forecast d={d} />}
              {view === 'exceptions' && <Exceptions d={d} navigate={navigate} />}
              {view === 'leavers' && <Leavers d={d} navigate={navigate} />}
              {view === 'perquisite' && <Perquisite d={d} />}
              {view === 'write-offs' && <WriteOffs d={d} />}
            </div>
          )}
    </div>
  )
}
