// Loans PR-11 — the production dry run (admin only), on:
//   POST /api/loans/dry-run         runs the REAL loan engine on live data inside one transaction
//                                   that is always rolled back; returns the report
//   GET  /api/loans/dry-run/pack    suggests real eligible borrowers for the latest computed month
// Nothing a dry run does is saved (the server proves it: rollbackVerified). The only record
// kept is one audit row saying who ran it.
import React, { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import * as XLSX from 'xlsx'
import { MONTH_OPTIONS } from '../../utils/formatters'
import { runLoanDryRun, getLoanDryRunPack, searchLoanBorrowers, getLoanTypes } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { loanCaps, rupees, monthLabel, errText, todayIst, companyRestricted, closeReadinessText } from './loanUi'

const MAX = 10

function previousIstMonth() {
  const [y, m] = todayIst().split('-').map(Number)
  return m === 1 ? { month: 12, year: y - 1 } : { month: m - 1, year: y }
}

const blankRow = () => ({ key: Math.random().toString(36).slice(2), emp: null, principal: '', tenure: '', loanType: 'Personal', offset: -1, markLeft: false, hold: false })

function useDebounced(v, ms) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

function BorrowerPicker({ payroll, value, onPick, testid }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const { data, isFetching } = useQuery({
    queryKey: ['loan-borrower-search', dq],
    queryFn: () => searchLoanBorrowers(dq),
    enabled: !value && dq.length >= 2,
    retry: 0,
  })
  const results = (data?.data?.data || []).filter((e) => e.borrowerType === payroll)
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono text-xs">{value.code}</span>
        <span className="truncate max-w-[10rem]">{value.name || ''}</span>
        {payroll === 'sales' && <span className="text-[11px] text-slate-400">{value.company}</span>}
        <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onPick(null)}>change</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input className="input text-sm w-44" placeholder="Code or name…" value={q} onChange={(e) => setQ(e.target.value)} data-testid={testid} />
      {dq.length >= 2 && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {isFetching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
          {!isFetching && results.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No active {payroll} employee found</div>}
          {results.map((e) => (
            <button type="button" key={`${e.code}|${e.company || ''}`} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => { onPick(e); setQ('') }}>
              <span className="font-mono text-xs">{e.code}</span> {e.name}
              <span className="text-xs text-slate-400"> · {e.company || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const fmtDelta = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${rupees(v)}`)

function Banner({ r }) {
  const ok = r?.verification?.rollbackVerified
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', ok ? 'bg-green-50 border-green-300 text-green-900' : 'bg-red-50 border-red-300 text-red-900')}
      data-testid="dry-run-banner">
      {ok ? (
        <><strong>Nothing was saved.</strong> Every change this rehearsal made was rolled back, and the server checked it: the database
          after the run matches the snapshot taken before it ({r.verification.tablesChecked} tables). Only one audit line records that you ran it.</>
      ) : (
        <><strong>The rollback could not be verified.</strong> The admin has been notified; check the server log before doing anything else.</>
      )}
    </div>
  )
}

function closeText(c, label, payroll) {
  if (!c) return '—'
  if (c.ok) return `Closed: posted ${c.posted} (${rupees(c.postedAmount)}), held ${c.held}, shortfall ${c.shortfall}, no salary ${c.noSalary}${c.reconciliationOk ? '' : ' — reconciliation mismatch'}`
  return closeReadinessText(c, label, payroll) || c.message || c.code
}

function scenarioOutcome(s, r) {
  if (s.refusal) return { text: `Refused at ${s.refusal.stage}: ${s.refusal.message}`, tone: 'text-red-700' }
  const d = (s.deductions || []).find((x) => x.month === r.month && x.year === r.year)
  if (!d) return { text: s.dueInMonth > 0 ? 'Nothing deducted' : `Nothing due in ${monthLabel(r.month, r.year)}`, tone: 'text-slate-500' }
  if (d.state === 'provisional') return { text: s.salary.heldAtClose ? 'Held — waits for the hold to be released' : 'Left provisional', tone: 'text-amber-700' }
  if (Number(d.amount) < Number(s.dueInMonth)) return { text: `Posted ${rupees(d.amount)}; ${rupees(s.dueInMonth - d.amount)} moved to the end`, tone: 'text-amber-700' }
  return { text: `Posted ${rupees(d.amount)}`, tone: 'text-green-700' }
}

function Report({ r }) {
  const label = monthLabel(r.month, r.year)
  const stale = (r.scenarios || []).filter((s) => s.salary?.staleNetDifference !== null && Math.abs(s.salary?.staleNetDifference || 0) > 1)
  const exitRows = [...(r.exitResiduals?.residuals || []), ...(r.exitResiduals?.awaitingFinalPayroll || [])]
  return (
    <div className="space-y-4" data-testid="dry-run-report">
      <Banner r={r} />
      <div className="text-xs text-slate-500">
        Run {r.dryRunId} · {r.payroll} · {label} · held the database for {r.timings?.lockMs} ms (snapshots {r.timings?.fingerprintBeforeMs} + {r.timings?.fingerprintAfterMs} ms)
      </div>

      <div className={clsx('rounded-lg border px-4 py-3 text-sm', stale.length ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700')}
        data-testid="dry-run-stale-note">
        <strong>Stored salary vs a fresh re-run.</strong>{' '}
        {stale.length
          ? <>For {stale.length} of {r.scenarios.length} employee(s), re-running {label}'s salary <em>without any loan</em> already gives a different net pay from the one stored
            (and paid). That difference is <strong>not caused by the loan</strong>: attendance or day calculations changed after the salary was computed
            (production marks every September day-calculation row as changed). The loan's own effect is the “Loan effect” column, measured against that re-run.</>
          : <>Re-running {label}'s salary without the loan gives the same net pay as the stored one for every employee here, so the “Loan effect” column is the whole difference.</>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="stat-card"><span className="text-[11px] font-semibold text-slate-400 uppercase">Loans created</span><span className="text-xl font-bold">{r.totals.loansCreated}</span>{r.totals.refused > 0 && <span className="text-xs text-red-600">{r.totals.refused} refused</span>}</div>
        <div className="stat-card"><span className="text-[11px] font-semibold text-slate-400 uppercase">Paid out</span><span className="text-xl font-bold">{rupees(r.totals.disbursed)}</span></div>
        <div className="stat-card"><span className="text-[11px] font-semibold text-slate-400 uppercase">Due in {label}</span><span className="text-xl font-bold">{rupees(r.totals.dueInMonth)}</span></div>
        <div className="stat-card"><span className="text-[11px] font-semibold text-slate-400 uppercase">Deducted in {label}</span><span className="text-xl font-bold">{rupees(r.totals.deductedInMonth)}</span></div>
        <div className="stat-card"><span className="text-[11px] font-semibold text-slate-400 uppercase">Outstanding after (all live loans)</span><span className="text-xl font-bold">{rupees(r.totals.outstandingAfter?.balance)}</span></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-compact w-full text-sm min-w-[1100px]" data-testid="dry-run-table">
          <thead>
            <tr>
              <th>#</th><th>Employee</th><th>Loan</th><th className="text-right">Due</th><th className="text-right">Headroom</th>
              <th className="text-right">Deducted</th><th className="text-right">Net stored</th><th className="text-right">Net re-run, no loan</th>
              <th className="text-right">Net with loan</th><th className="text-right">Stale difference</th><th className="text-right">Loan effect</th>
              <th>At the close</th><th className="text-right">Balance after</th><th>Reconciles</th>
            </tr>
          </thead>
          <tbody>
            {r.scenarios.map((s) => {
              const o = scenarioOutcome(s, r)
              return (
                <tr key={s.index} data-testid={`dry-run-row-${s.index}`}>
                  <td>{s.index}</td>
                  <td><span className="font-mono text-xs">{s.employeeCode}</span>
                    {s.markLeft && <span className="ml-1 text-[10px] px-1 rounded bg-orange-100 text-orange-800">Left {s.exitDate}</span>}
                    {s.hold && <span className="ml-1 text-[10px] px-1 rounded bg-amber-100 text-amber-800">Hold</span>}
                    {payrollCompany(r, s)}</td>
                  <td>{rupees(s.principal)} / {s.tenure} m{s.emi ? <span className="text-xs text-slate-500"> · EMI {rupees(s.emi)}</span> : null}
                    {s.firstEmiMonth && <div className="text-[11px] text-slate-400">first EMI {monthLabel(s.firstEmiMonth.month, s.firstEmiMonth.year)}</div>}</td>
                  <td className="text-right whitespace-nowrap">{s.refusal ? '—' : rupees(s.dueInMonth)}</td>
                  <td className="text-right whitespace-nowrap">{s.headroom ? rupees(s.headroom.headroom) : '—'}</td>
                  <td className="text-right font-semibold">{s.refusal ? '—' : rupees(s.deductedInMonth)}</td>
                  <td className="text-right whitespace-nowrap">{rupees(s.salary?.stored?.net_salary)}</td>
                  <td className="text-right whitespace-nowrap">{rupees(s.salary?.rerunNoLoan?.net_salary)}</td>
                  <td className="text-right whitespace-nowrap">{rupees(s.salary?.rerunWithLoan?.net_salary)}</td>
                  <td className={clsx('text-right whitespace-nowrap', Math.abs(s.salary?.staleNetDifference || 0) > 1 && 'text-amber-700 font-semibold')}>{fmtDelta(s.salary?.staleNetDifference)}</td>
                  <td className="text-right whitespace-nowrap">{fmtDelta(s.salary?.loanEffectOnNet)}</td>
                  <td className={clsx('text-xs', o.tone)}>{o.text}</td>
                  <td className="text-right whitespace-nowrap">{s.loanAfter ? rupees(s.loanAfter.remainingBalance) : '—'}</td>
                  <td>{s.reconciliation ? (s.reconciliation.ok ? 'Yes' : <span className="text-red-700">No</span>) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <div className="card p-3" data-testid="dry-run-close">
          <div className="font-semibold text-slate-700 mb-1">Loan close — {label}</div>
          <div>{closeText(r.close?.result, label, r.payroll)}</div>
          <div className="text-[11px] text-slate-400 mt-1">The close covers every {r.payroll} loan due this month, real ones included — all of it was rolled back.</div>
          {r.nextMonth && (
            <div className="mt-2 text-slate-600">
              <span className="font-semibold">{monthLabel(r.nextMonth.month, r.nextMonth.year)}:</span>{' '}
              {r.nextMonth.skipped ? r.nextMonth.reason : closeText(r.nextMonth.close, monthLabel(r.nextMonth.month, r.nextMonth.year), r.payroll)}
            </div>
          )}
        </div>
        <div className="card p-3" data-testid="dry-run-checks">
          <div className="font-semibold text-slate-700 mb-1">Checks on the rows this rehearsal touched</div>
          <div className={r.checks?.ok ? 'text-green-700' : 'text-red-700'}>
            {r.checks?.ok ? 'Net = earned − deductions, deductions add up, payslip = loan ledger: all clean.'
              : `Drift ${r.checks?.drift?.length || 0}, deductions not adding up ${r.checks?.componentShort?.length || 0}, payslip ≠ ledger ${r.checks?.payslipLedger?.length || 0}.`}
          </div>
          {exitRows.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-slate-700">Leavers</div>
              <ul className="list-disc ml-5 text-xs">
                {exitRows.map((x) => <li key={x.loanId}>{x.employeeCode}: balance {rupees(x.balance)}{x.residual !== undefined ? `, residual ${rupees(x.residual)}` : ''}{x.dueInFinalPayroll !== undefined ? `, due in final payroll ${rupees(x.dueInFinalPayroll)}` : ''}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <details className="card p-3 text-xs">
        <summary className="cursor-pointer text-slate-600">Schedules and eligibility (per loan)</summary>
        {r.scenarios.map((s) => (
          <div key={s.index} className="mt-2">
            <div className="font-semibold">#{s.index} {s.employeeCode}</div>
            {s.eligibility && <div>Eligibility: {s.eligibility.eligible ? 'eligible' : (s.eligibility.refusals || []).map((x) => x.message).join('; ')}{(s.eligibility.warnings || []).length ? ` · warnings: ${s.eligibility.warnings.map((w) => w.message).join('; ')}` : ''}</div>}
            {s.scheduleAfter && <div>Schedule after: {s.scheduleAfter.map((i) => `${monthLabel(i.month, i.year)} ${rupees(i.amountDue)} ${i.status}${i.origin !== 'schedule' ? ` (${i.origin})` : ''}`).join(' · ')}</div>}
          </div>
        ))}
      </details>
    </div>
  )
}

function payrollCompany(r, s) {
  return r.payroll === 'sales' ? <div className="text-[11px] text-slate-400">{s.company}</div> : null
}

function FailedReport({ r }) {
  return (
    <div className="space-y-3" data-testid="dry-run-report">
      <Banner r={r} />
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="dry-run-failed">
        The rehearsal stopped at step <strong>{r.failedAt}</strong>: {r.error || r.message}. Nothing was saved.
      </div>
    </div>
  )
}

function downloadJson(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${r.dryRunId || 'loan-dry-run'}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadExcel(r) {
  const rows = r.scenarios.map((s) => ({
    '#': s.index, Employee: s.employeeCode, Company: s.company, Principal: s.principal, Tenure: s.tenure, 'Loan type': s.loanType,
    'Mark Left': s.markLeft ? s.exitDate : '', Hold: s.hold ? 'yes' : '', Refused: s.refusal ? `${s.refusal.stage}: ${s.refusal.message}` : '',
    EMI: s.emi ?? '', 'First EMI': s.firstEmiMonth ? monthLabel(s.firstEmiMonth.month, s.firstEmiMonth.year) : '',
    Due: s.dueInMonth ?? '', Headroom: s.headroom?.headroom ?? '', Deducted: s.deductedInMonth ?? '',
    'Net stored': s.salary?.stored?.net_salary ?? '', 'Net re-run, no loan': s.salary?.rerunNoLoan?.net_salary ?? '',
    'Net with loan': s.salary?.rerunWithLoan?.net_salary ?? '', 'Stale difference': s.salary?.staleNetDifference ?? '',
    'Loan effect': s.salary?.loanEffectOnNet ?? '', 'Balance after': s.loanAfter?.remainingBalance ?? '',
    Reconciles: s.reconciliation ? (s.reconciliation.ok ? 'yes' : 'NO') : '',
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Scenarios')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    Run: r.dryRunId, Payroll: r.payroll, Month: monthLabel(r.month, r.year), 'Nothing saved (verified)': r.verification?.rollbackVerified ? 'yes' : 'NO',
    'Loans created': r.totals.loansCreated, Refused: r.totals.refused, 'Due in month': r.totals.dueInMonth, 'Deducted in month': r.totals.deductedInMonth,
    Close: closeText(r.close?.result, monthLabel(r.month, r.year), r.payroll), 'Held the database (ms)': r.timings?.lockMs,
  }]), 'Summary')
  XLSX.writeFile(wb, `${r.dryRunId || 'loan-dry-run'}.xlsx`)
}

export default function LoanDryRun() {
  const user = useAppStore((s) => s.user)
  const caps = loanCaps(user)
  const restricted = companyRestricted(user)
  const [sel, setSel] = useState(previousIstMonth)
  const [payroll, setPayroll] = useState('plant')
  const [nextMonth, setNextMonth] = useState(true)
  const [rows, setRows] = useState([blankRow()])
  const [busy, setBusy] = useState(false)
  const [reports, setReports] = useState([])
  const { data: typesRes } = useQuery({ queryKey: ['loan-types'], queryFn: getLoanTypes, retry: 0 })
  const loanTypes = typesRes?.data?.data || ['Personal']
  const thisYear = Number(todayIst().slice(0, 4))
  const years = useMemo(() => { const y = []; for (let v = 2026; v <= Math.max(thisYear, 2026); v++) y.push(v); return y }, [thisYear])

  if (!caps.canDecide) return <div className="card p-4 text-sm text-slate-600">Only the admin can run a loan dry run.</div>
  if (restricted) return <div className="card p-4 text-sm text-slate-600">The dry run runs the loan close, which covers both companies, so only an admin with access to all companies can use it.</div>

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const switchPayroll = (p) => { setPayroll(p); setRows([blankRow()]) }

  const toBody = (p, m, scenarios) => ({ month: m.month, year: m.year, payroll: p, includeNextMonth: nextMonth, scenarios })

  async function execute(body) {
    try {
      const res = await runLoanDryRun(body)
      return res.data.data
    } catch (e) {
      const d = e?.response?.data
      if (d && d.code === 'DRY_RUN_FAILED') return d
      if (d && d.verification) return { ...d, failedAt: d.failedAt || 'verification' }
      throw e
    }
  }

  async function run() {
    const scenarios = rows.filter((r) => r.emp).map((r) => ({
      employeeCode: r.emp.code, company: r.emp.company || undefined, principal: Number(r.principal), tenure: Number(r.tenure),
      loanType: r.loanType, disburseMonthOffset: Number(r.offset), markLeft: r.markLeft, hold: r.hold,
    }))
    if (!scenarios.length) { toast.error('Pick at least one employee'); return }
    setBusy(true)
    try {
      const r = await execute(toBody(payroll, sel, scenarios))
      setReports([r])
      toast.success('Dry run finished — nothing was saved')
    } catch (e) {
      toast.error(errText(e, 'Dry run failed'))
    } finally { setBusy(false) }
  }

  async function runPack() {
    setBusy(true)
    const out = []
    try {
      for (const p of ['plant', 'sales']) {
        let pack
        try {
          pack = (await getLoanDryRunPack({ payroll: p })).data.data
        } catch (e) {
          out.push({ payroll: p, emptyPack: true, note: errText(e, `No ${p} pack`) })
          continue
        }
        if (!pack.scenarios.length) {
          out.push({ payroll: p, emptyPack: true, note: `No eligible ${p} borrower found for ${monthLabel(pack.month, pack.year)} (${pack.candidates} eligible, ${pack.ineligible} not eligible).` })
          continue
        }
        const r = await execute(toBody(p, { month: pack.month, year: pack.year }, pack.scenarios.map(({ why: _w, name: _n, headroom: _h, emi: _e, reallyHeld: _r, ...s }) => s)))
        out.push({ ...r, packWhy: pack.scenarios.map((s) => `${s.employeeCode}: ${s.why}`) })
      }
      setReports(out)
      if (out.some((r) => r.scenarios)) toast.success('Rehearsal pack finished — nothing was saved')
    } catch (e) {
      toast.error(errText(e, 'Rehearsal pack failed'))
      if (out.length) setReports(out)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-slate-800">Dry run — rehearse loans on live data</h3>
          <p className="text-sm text-slate-500 mt-1">
            Raises, approves and pays out the loans below, re-runs the real salary computation for these employees, runs the real loan close,
            and shows the result — then undoes everything. Nothing is saved, nobody is notified, no salary or loan changes.
            The server proves it after every run. Up to {MAX} employees per run; the whole app pauses for the moment it takes.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden" data-testid="dry-run-payroll">
            {['plant', 'sales'].map((p) => (
              <button key={p} type="button" onClick={() => switchPayroll(p)} data-testid={`dry-run-payroll-${p}`}
                className={clsx('px-3 py-1.5 text-sm', payroll === p ? 'bg-blue-600 text-white' : 'bg-white text-slate-600')}>{p === 'plant' ? 'Plant' : 'Sales'}</button>
            ))}
          </div>
          <label className="text-xs text-slate-500">Month
            <select className="select block" value={sel.month} onChange={(e) => setSel((s) => ({ ...s, month: Number(e.target.value) }))} data-testid="dry-run-month">
              {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Year
            <select className="select block" value={sel.year} onChange={(e) => setSel((s) => ({ ...s, year: Number(e.target.value) }))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-600 flex items-center gap-1">
            <input type="checkbox" checked={nextMonth} onChange={(e) => setNextMonth(e.target.checked)} /> also the next month, if its payroll exists
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="table-compact w-full text-sm min-w-[900px]">
            <thead><tr><th>Employee</th><th>Amount (₹)</th><th>Months</th><th>Type</th><th>Paid out</th><th>Mark Left</th><th>Hold salary</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} data-testid={`dry-run-scenario-${i + 1}`}>
                  <td><BorrowerPicker payroll={payroll} value={r.emp} onPick={(e) => setRow(r.key, { emp: e })} testid={`dry-run-emp-${i + 1}`} /></td>
                  <td><input className="input w-28 text-sm" type="number" min="1" value={r.principal} onChange={(e) => setRow(r.key, { principal: e.target.value })} data-testid={`dry-run-principal-${i + 1}`} /></td>
                  <td><input className="input w-16 text-sm" type="number" min="1" max="12" value={r.tenure} onChange={(e) => setRow(r.key, { tenure: e.target.value })} data-testid={`dry-run-tenure-${i + 1}`} /></td>
                  <td><select className="select text-sm" value={r.loanType} onChange={(e) => setRow(r.key, { loanType: e.target.value })}>{loanTypes.map((t) => <option key={t}>{t}</option>)}</select></td>
                  <td><select className="select text-sm" value={r.offset} onChange={(e) => setRow(r.key, { offset: Number(e.target.value) })}>
                    <option value={-1}>month before (first EMI in {monthLabel(sel.month, sel.year)})</option>
                    <option value={0}>in {monthLabel(sel.month, sel.year)} (first EMI the month after)</option>
                  </select></td>
                  <td className="text-center"><input type="checkbox" checked={r.markLeft} onChange={(e) => setRow(r.key, { markLeft: e.target.checked })} data-testid={`dry-run-left-${i + 1}`} /></td>
                  <td className="text-center"><input type="checkbox" checked={r.hold} onChange={(e) => setRow(r.key, { hold: e.target.checked })} data-testid={`dry-run-hold-${i + 1}`} /></td>
                  <td><button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={rows.length >= MAX} onClick={() => setRows((rs) => [...rs, blankRow()])}>+ Add employee</button>
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={run} data-testid="dry-run-run">{busy ? 'Running…' : 'Run dry run'}</button>
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={runPack} data-testid="dry-run-pack">Rehearsal pack (3 plant + 2 sales, latest month)</button>
        </div>
        <p className="text-xs text-slate-400">
          “Mark Left” flags the loan as if the borrower left on the last day of the month (sales: the 25th) — the employee record is not touched.
          “Hold salary” holds that month's salary before the close.
        </p>
      </div>

      {reports.map((r, i) => (
        <div key={r.dryRunId || i} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">{reports.length > 1 ? `${r.payroll === 'sales' ? 'Sales' : 'Plant'} rehearsal` : 'Result'}</h3>
            {r.scenarios && (
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => downloadJson(r)} data-testid="dry-run-export-json">Export JSON</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => downloadExcel(r)} data-testid="dry-run-export-xlsx">Export Excel</button>
              </div>
            )}
          </div>
          {r.packWhy && <ul className="list-disc ml-5 text-xs text-slate-500">{r.packWhy.map((w) => <li key={w}>{w}</li>)}</ul>}
          {r.emptyPack
            ? <div className="card p-3 text-sm text-slate-600" data-testid="dry-run-pack-empty">{r.note}</div>
            : (r.scenarios ? <Report r={r} /> : <FailedReport r={r} />)}
        </div>
      ))}
    </div>
  )
}
