// Loans PR-10 — import the loans run outside the app (accounts Excel). SPEC D-9, K36, K37; §7 last row.
//   HR or finance uploads (template or the accounts file, with a column-mapping step);
//   HR confirms each name → employee code; finance confirms (or corrects, with a note) each balance;
//   the admin approves the batch and names the cutover month for each payroll in it (plant and sales
//   may differ). Approval creates opening-balance loans that Stage 7 deducts from that month. Then the
//   cutover check (EMI and headroom per borrower, the month per row).
// The server enforces every rule (routes/loanImport.js); this screen only hides what a role cannot do.
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  downloadLoanImportTemplate, parseLoanImport, createLoanImportBatch, getLoanImportBatches, getLoanImportBatch,
  confirmLoanImportMatch, excludeLoanImportRow, confirmLoanImportBalance, confirmLoanImportCleanMatches, confirmLoanImportFileBalances, approveLoanImportBatch, discardLoanImportBatch, remapLoanImportColumns,
  getLoanImportCutoverCheck, downloadLoanImportCutoverCheck, searchLoanBorrowers,
} from '../../utils/api'
import { LOAN_COMPANIES, rupees, monthLabel, istDateTime, errText, sameUser } from './loanUi'
import ConfirmDialog from '../ui/ConfirmDialog'

const TIER = {
  exact: { label: 'Exact name', cls: 'bg-green-100 text-green-800' },
  ambiguous: { label: 'Shared name', cls: 'bg-amber-100 text-amber-800' },
  close: { label: 'Close spelling', cls: 'bg-orange-100 text-orange-800' },
  none: { label: 'No match', cls: 'bg-red-100 text-red-700' },
  inactive: { label: 'Left', cls: 'bg-slate-200 text-slate-700' },
  code: { label: 'Code match', cls: 'bg-green-100 text-green-800' },
  code_close: { label: 'Code · name spelt differently', cls: 'bg-lime-100 text-lime-800' },
  code_mismatch: { label: 'Code · NAME DIFFERS', cls: 'bg-red-100 text-red-700' },
}
const STATE = {
  needs_match: { label: 'Needs HR', cls: 'bg-amber-100 text-amber-800' },
  needs_balance: { label: 'Needs finance', cls: 'bg-sky-100 text-sky-800' },
  in: { label: 'Ready', cls: 'bg-green-100 text-green-800' },
  out: { label: 'Not imported', cls: 'bg-slate-100 text-slate-600' },
  imported: { label: 'Imported', cls: 'bg-indigo-100 text-indigo-800' },
}
const FLAG = {
  EMI_DIFFERS: 'App EMI ≠ Excel EMI', HEADROOM_SHORT: 'Room under the cap is short', STAGE7_PENDING: 'Stage 7 not run',
  NOT_DEDUCTED: 'Not deducted', DEDUCTED_SHORT: 'Deducted less than due', LOAN_NOT_LIVE: 'Loan no longer live',
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

function Card({ title, right, children, testid }) {
  return (
    <div className="card overflow-hidden" data-testid={testid}>
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
        <span className="font-semibold text-sm text-slate-700">{title}</span>{right}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

const Chip = ({ map, k, testid }) => (
  <span data-testid={testid} className={clsx('text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap', (map[k] && map[k].cls) || 'bg-slate-100 text-slate-600')}>
    {(map[k] && map[k].label) || k || '—'}
  </span>
)

const PAYROLLS = ['plant', 'sales']
const PAYROLL_LABEL = { plant: 'Plant', sales: 'Sales' }
/** "Plant Sep 2026 · Sales Oct 2026" for a { plant, sales } cutover (null payrolls left out). */
const cutoverText = (c) => (c ? PAYROLLS.filter((p) => c[p]).map((p) => `${PAYROLL_LABEL[p]} ${monthLabel(c[p].month, c[p].year)}`).join(' · ') : '') || '—'
/** Query / body params for a { plant, sales } cutover, e.g. plantCutoverMonth. */
const cutoverParams = (c, prefix = 'Cutover') => Object.fromEntries(PAYROLLS.filter((p) => c && c[p]).flatMap((p) => [[`${p}${prefix}Month`, c[p].month], [`${p}${prefix}Year`, c[p].year]]))

function MonthPicker({ value, onChange, testid }) {
  const now = new Date().getFullYear()
  return (
    <span className="inline-flex gap-1" data-testid={testid}>
      <select className="select text-sm w-24" value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthLabel(m, 2000).slice(0, 3)}</option>)}
      </select>
      <select className="select text-sm w-24" value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
        {[now - 1, now, now + 1].map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </span>
  )
}

// ── upload with the mapping step ─────────────────────────────────────────────

function UploadPanel({ onCreated }) {
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [defaultCompany, setDefaultCompany] = useState('')
  const [busy, setBusy] = useState(false)

  const runParse = async (f, map = null, def = defaultCompany) => {
    setBusy(true)
    try {
      const res = await parseLoanImport(f, { mapping: map, defaultCompany: def || undefined })
      setParsed({ ok: true, ...res.data.data })
      setMapping(res.data.data.mapping || {})
    } catch (err) {
      const b = err?.response?.data
      if (b?.code === 'MAPPING_INVALID' && b.headers) {
        setParsed({ ok: false, error: b.error, headers: b.headers, fields: b.fields || [], preview: [] })
        setMapping(b.mapping || {})
      } else {
        setParsed(null)
        toast.error(errText(err, 'The file could not be read'))
      }
    } finally {
      setBusy(false)
    }
  }
  const create = useMutation({
    mutationFn: () => createLoanImportBatch(file, { mapping, defaultCompany: defaultCompany || undefined }),
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`Batch #${d.batchId} created: ${d.counts.rows} rows`)
      setFile(null); setParsed(null); setMapping({})
      onCreated(d.batchId)
    },
    onError: (err) => toast.error(errText(err, 'Upload failed')),
  })

  return (
    <Card title="Upload the accounts Excel" testid="imp-upload">
      <div className="p-4 space-y-3 text-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".xlsx,.xls" data-testid="imp-file"
            onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setParsed(null); if (f) runParse(f) }} />
          {busy && <span className="text-xs text-slate-500">Reading…</span>}
        </div>
        {parsed && (
          <div className="space-y-3">
            <div className={clsx('rounded-lg px-3 py-2 text-xs', parsed.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800')} data-testid="imp-parse-status">
              {parsed.ok
                ? `Sheet "${parsed.sheetName}", header on row ${parsed.headerRow}: ${parsed.rowCount} rows (${parsed.invalidCount} with a problem). Check the column mapping, then create the batch.`
                : `Map the columns: ${parsed.error}`}
            </div>
            {(parsed.balanceColumns || []).length > 1 && (
              <div className="rounded-lg bg-sky-50 text-sky-800 px-3 py-2 text-xs" data-testid="imp-balance-hint">
                The file has {parsed.balanceColumns.length} balance columns ({parsed.balanceColumns.map((i) => `"${(parsed.headers.find((h) => h.index === i) || {}).text}"`).join(', ')}).
                The last one is used as the outstanding by default. Pick the balance <strong>before the cutover month's EMI</strong> — it can also be changed on the batch later (uploader or admin).
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2" data-testid="imp-mapping">
              {(parsed.fields || []).map((f) => (
                <label key={f.key} className="text-xs">
                  <span className="text-slate-500">{f.label}{f.required ? ' *' : ''}</span>
                  <select className="select text-xs w-full" data-testid={`imp-map-${f.key}`} value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n })}>
                    <option value="">— not in the file —</option>
                    {(parsed.headers || []).map((h) => <option key={h.index} value={h.index}>{h.text}</option>)}
                  </select>
                </label>
              ))}
              {mapping.company === undefined && (
                <label className="text-xs">
                  <span className="text-slate-500">{mapping.code !== undefined ? 'Company where the employee master has none' : 'Company for every row *'}</span>
                  <select className="select text-xs w-full" value={defaultCompany} onChange={(e) => setDefaultCompany(e.target.value)} data-testid="imp-default-company">
                    <option value="">— choose —</option>
                    {LOAN_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" disabled={busy} onClick={() => runParse(file, mapping, defaultCompany)} data-testid="imp-reparse">Apply mapping</button>
              <button className="btn-primary text-xs" disabled={!parsed.ok || create.isPending} onClick={() => create.mutate()} data-testid="imp-create">
                {create.isPending ? 'Creating…' : 'Create batch'}
              </button>
            </div>
            {parsed.ok && parsed.preview?.length > 0 && (
              <table className="table-compact w-full text-xs" data-testid="imp-preview">
                <thead><tr><th>Row</th><th>Name</th><th>Company</th><th>Dept</th><th>Loan date</th><th className="text-right">Outstanding</th><th className="text-right">EMI</th><th>Type</th><th>Problems</th></tr></thead>
                <tbody>
                  {parsed.preview.map((r) => (
                    <tr key={r.rowNo}><td>{r.rowNo}</td><td>{r.name}</td><td>{r.company || '—'}</td><td>{r.department || '—'}</td><td>{r.loanDate || '—'}</td>
                      <td className="text-right font-mono">{rupees(r.outstanding)}</td><td className="text-right font-mono">{rupees(r.emi)}</td><td>{r.loanType}</td>
                      <td className="text-red-600">{(r.errors || []).map((e) => e.message).join('; ')}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── one row: HR match / finance balance ──────────────────────────────────────

function BorrowerSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [deb, setDeb] = useState('')
  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(t) }, [q])
  const { data } = useQuery({ queryKey: ['imp-borrower-search', deb], queryFn: () => searchLoanBorrowers(deb), enabled: deb.length >= 2, retry: 0 })
  const list = data?.data?.data || []
  return (
    <div className="mt-1">
      <input className="input text-xs w-full" placeholder="Search any employee…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="imp-search" />
      {list.length > 0 && (
        <div className="border border-slate-200 rounded mt-1 max-h-32 overflow-y-auto bg-white">
          {list.map((e) => (
            <button key={`${e.borrowerType}|${e.code}|${e.company}`} className="block w-full text-left px-2 py-1 text-xs hover:bg-blue-50"
              onClick={() => { onPick({ borrowerType: e.borrowerType, code: e.code, name: e.name, company: e.company, offList: true }); setQ('') }}>
              {e.code} · {e.name} <span className="text-slate-400">({e.borrowerType}{e.department ? `, ${e.department}` : ''})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MatchCell({ row, batchId, editable, onDone }) {
  const listed = row.candidates || []
  const initial = row.employee_code ? `${row.borrower_type}|${row.employee_code}` : ''
  const [sel, setSel] = useState(initial)
  const [offList, setOffList] = useState(null)
  const [note, setNote] = useState('')
  const [excluding, setExcluding] = useState(false)
  const [reason, setReason] = useState('')
  const confirm = useMutation({
    mutationFn: () => {
      const [borrowerType, employeeCode] = (offList ? `${offList.borrowerType}|${offList.code}` : sel).split('|')
      return confirmLoanImportMatch(batchId, row.id, { borrowerType, employeeCode, note: note || undefined })
    },
    onSuccess: () => { toast.success(`Row ${row.row_no}: match confirmed`); onDone() },
    onError: (err) => toast.error(errText(err, 'Could not confirm the match')),
  })
  const exclude = useMutation({
    mutationFn: () => excludeLoanImportRow(batchId, row.id, { reason }),
    onSuccess: () => { toast.success(`Row ${row.row_no}: excluded`); setExcluding(false); onDone() },
    onError: (err) => toast.error(errText(err, 'Could not exclude the row')),
  })
  const current = row.match_status === 'confirmed'
    ? (listed.find((c) => c.code === row.employee_code) || { code: row.employee_code, name: '' })
    : null
  if (!editable) {
    return (
      <div className="text-xs">
        {row.match_status === 'confirmed' && <div data-testid={`imp-matched-${row.row_no}`}>✓ {row.employee_code} {current?.name || ''} <span className="text-slate-400">by {row.match_confirmed_by}</span></div>}
        {row.match_status === 'excluded' && <div className="text-slate-500">Excluded by {row.match_confirmed_by}: {row.match_note}</div>}
        {row.match_status === 'pending' && listed.length > 0 && <div className="text-slate-500">{listed.length} candidate{listed.length === 1 ? '' : 's'}{row.employee_code ? ` · proposed ${row.employee_code}` : ''}</div>}
        {row.match_status === 'pending' && listed.length === 0 && <div className="text-slate-400">No candidate</div>}
      </div>
    )
  }
  return (
    <div className="text-xs space-y-1 min-w-[260px]" data-testid={`imp-match-${row.row_no}`}>
      {row.match_status === 'confirmed' && <div className="text-green-700">✓ {row.employee_code} {current?.name || ''} (by {row.match_confirmed_by})</div>}
      {row.match_status === 'excluded' && <div className="text-slate-500">Excluded: {row.match_note}</div>}
      {offList
        ? <div className="flex items-center gap-1">Picked {offList.code} · {offList.name} <button className="text-blue-600" onClick={() => setOffList(null)}>clear</button></div>
        : (
          <select className="select text-xs w-full" value={sel} onChange={(e) => setSel(e.target.value)} data-testid={`imp-cand-${row.row_no}`}>
            <option value="">— choose the employee —</option>
            {listed.map((c) => (
              <option key={`${c.borrowerType}|${c.code}`} value={`${c.borrowerType}|${c.code}`}>
                {c.code} · {c.name} · {c.borrowerType === 'sales' ? `Sales${c.designation ? ` ${c.designation}` : ''}` : c.department || 'no dept'} · {c.company || 'company unknown'}{c.doj ? ` · DOJ ${c.doj}` : ''} — {c.reason}
              </option>
            ))}
          </select>
        )}
      <BorrowerSearch onPick={setOffList} />
      {(offList || row.match_tier === 'code_mismatch') && (
        <input className="input text-xs w-full" data-testid={`imp-match-note-${row.row_no}`}
          placeholder={offList ? 'Note (required for an employee not proposed)' : 'Note (required — the Excel name differs from the master)'} value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="flex gap-1">
        <button className="btn-primary text-[11px] px-2 py-1" disabled={(!sel && !offList) || confirm.isPending} onClick={() => confirm.mutate()} data-testid={`imp-confirm-${row.row_no}`}>Confirm match</button>
        {!excluding && <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => setExcluding(true)} data-testid={`imp-exclude-${row.row_no}`}>Exclude</button>}
      </div>
      {excluding && (
        <div className="flex gap-1">
          <input className="input text-xs flex-1" placeholder="Why is this row left out?" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`imp-exclude-reason-${row.row_no}`} />
          <button className="btn-danger text-[11px] px-2 py-1" disabled={reason.trim().length < 3 || exclude.isPending} onClick={() => exclude.mutate()} data-testid={`imp-exclude-go-${row.row_no}`}>Exclude</button>
        </div>
      )}
    </div>
  )
}

function BalanceCell({ row, batchId, editable, onDone }) {
  const [out, setOut] = useState(row.confirmed_outstanding ?? row.outstanding ?? '')
  const [emi, setEmi] = useState(row.confirmed_emi ?? row.emi ?? '')
  const [note, setNote] = useState('')
  const changed = Number(out) !== Number(row.outstanding) || Number(emi) !== Number(row.emi)
  const save = useMutation({
    mutationFn: () => confirmLoanImportBalance(batchId, row.id, { outstanding: Number(out), emi: Number(emi), note: note || undefined }),
    onSuccess: () => { toast.success(`Row ${row.row_no}: balance confirmed`); onDone() },
    onError: (err) => toast.error(errText(err, 'Could not confirm the balance')),
  })
  const excel = <div className="text-[11px] text-slate-400">Excel: {rupees(row.outstanding)} · EMI {rupees(row.emi)}</div>
  if (!editable) {
    return (
      <div className="text-xs">
        {row.balance_status === 'confirmed'
          ? <div data-testid={`imp-balance-${row.row_no}`}>✓ {rupees(row.confirmed_outstanding)} · EMI {rupees(row.confirmed_emi)} <span className="text-slate-400">by {row.balance_confirmed_by}</span>
            {(row.confirmed_outstanding !== row.outstanding || row.confirmed_emi !== row.emi) && <div className="text-amber-700">changed: {row.balance_note}</div>}</div>
          : <div>{rupees(row.outstanding)} · EMI {rupees(row.emi)} <span className="text-slate-400">(not confirmed)</span></div>}
      </div>
    )
  }
  return (
    <div className="text-xs space-y-1 min-w-[220px]" data-testid={`imp-bal-${row.row_no}`}>
      {row.balance_status === 'confirmed' && <div className="text-green-700">✓ confirmed by {row.balance_confirmed_by}</div>}
      <div className="flex gap-1">
        <input className="input text-xs w-24" type="number" value={out} onChange={(e) => setOut(e.target.value)} title="Outstanding at cutover" data-testid={`imp-out-${row.row_no}`} />
        <input className="input text-xs w-20" type="number" value={emi} onChange={(e) => setEmi(e.target.value)} title="Monthly EMI" data-testid={`imp-emi-${row.row_no}`} />
      </div>
      {excel}
      {changed && <input className="input text-xs w-full" placeholder="Note (required — why it differs from the Excel)" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`imp-note-${row.row_no}`} />}
      <button className="btn-primary text-[11px] px-2 py-1" disabled={save.isPending || !(Number(out) > 0) || !(Number(emi) > 0) || (changed && note.trim().length < 5)} onClick={() => save.mutate()} data-testid={`imp-balance-confirm-${row.row_no}`}>Confirm balance</button>
    </div>
  )
}

// ── one batch ────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'needs_match', label: 'Needs HR', match: (r) => r.state === 'needs_match' },
  { id: 'needs_balance', label: 'Needs finance', match: (r) => r.state === 'needs_balance' },
  { id: 'in', label: 'Ready', match: (r) => r.state === 'in' },
  { id: 'out', label: 'Not imported', match: (r) => r.state === 'out' },
]

function ApprovePanel({ d, caps, onDone }) {
  const b = d.batch
  const ap = d.approval
  // One cutover month per payroll in the batch; each defaults to its own earliest allowed month.
  const [m, setM] = useState({ plant: ap.earliestCutover.plant, sales: ap.earliestCutover.sales })
  const chosen = Object.fromEntries(PAYROLLS.map((p) => [p, ap.payrolls.includes(p) ? m[p] : null]))
  const [note, setNote] = useState('')
  const qc = useQueryClient()
  const preview = useQuery({
    queryKey: ['loan-import-batch', b.id, cutoverText(chosen)],
    queryFn: () => getLoanImportBatch(b.id, cutoverParams(chosen)),
    retry: 0,
  })
  const s7 = preview.data?.data?.data?.approval?.stage7Computed || []
  const approve = useMutation({
    mutationFn: () => approveLoanImportBatch(b.id, { ...cutoverParams(chosen), note }),
    onSuccess: (res) => {
      const r = res.data.data
      toast.success(`${r.loans.length} loans imported; first EMI ${cutoverText(r.cutover)}`)
      qc.invalidateQueries({ queryKey: ['loans'] }); qc.invalidateQueries({ queryKey: ['loan-stats'] })
      onDone()
    },
    onError: (err) => toast.error(errText(err, 'Approval failed')),
  })
  const involved = [b.uploaded_by, ...d.rows.map((r) => r.match_confirmed_by), ...d.rows.map((r) => r.balance_confirmed_by)].some((u) => u && sameUser(u, caps.username))
  return (
    <Card title="Approve the import (admin)" testid="imp-approve">
      <div className="p-4 space-y-3 text-sm">
        {ap.blockers.length > 0 ? (
          <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs" data-testid="imp-blockers">
            {ap.blockers.length} row{ap.blockers.length === 1 ? '' : 's'} still need a decision: {ap.blockers.map((x) => `row ${x.rowNo} (${x.code === 'NEEDS_HR_MATCH' ? 'HR match' : 'finance balance'})`).join(', ')}.
          </div>
        ) : (
          <div className="rounded-lg bg-green-50 text-green-800 px-3 py-2 text-xs">Every row is decided.</div>
        )}
        <div className="flex gap-6 flex-wrap text-xs" data-testid="imp-totals">
          <span><strong>{ap.totals.loans}</strong> loans</span><span>Outstanding <strong>{rupees(ap.totals.outstanding)}</strong></span>
          <span>Monthly EMI <strong>{rupees(ap.totals.monthlyEmi)}</strong></span>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Cutover month (first EMI) for each payroll — sales = the cycle ending the 25th of that month:</div>
          {ap.payrolls.map((p) => (
            <div key={p} className="flex items-center gap-2 flex-wrap" data-testid={`imp-cutover-row-${p}`}>
              <span className="text-xs font-medium text-slate-600 w-12">{PAYROLL_LABEL[p]}</span>
              <MonthPicker value={m[p]} onChange={(v) => setM((x) => ({ ...x, [p]: v }))} testid={`imp-cutover-${p}`} />
              <span className="text-[11px] text-slate-400">
                {ap.byPayroll?.[p]?.loans} loan{ap.byPayroll?.[p]?.loans === 1 ? '' : 's'} · {rupees(ap.byPayroll?.[p]?.monthlyEmi)} a month · earliest {monthLabel(ap.earliestCutover[p].month, ap.earliestCutover[p].year)}
              </span>
            </div>
          ))}
        </div>
        {s7.length > 0 && (
          <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs" data-testid="imp-stage7-warning">
            Salary for the cutover month is already computed for {s7.length} borrower{s7.length === 1 ? '' : 's'} ({PAYROLLS.filter((p) => s7.some((x) => x.borrowerType === p))
              .map((p) => `${PAYROLL_LABEL[p]} ${monthLabel(chosen[p].month, chosen[p].year)}: ${s7.filter((x) => x.borrowerType === p).map((x) => x.employeeCode).join(', ')}`).join('; ')}).
            Re-run Stage 7 / the sales compute for them after approval, or their first EMI moves to the end at the loan close.
          </div>
        )}
        <input className="input text-sm w-full max-w-xl" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {involved && <div className="text-xs text-red-600">You uploaded this batch or confirmed rows in it — another admin must approve.</div>}
        <button className="btn-primary" disabled={!ap.canApprove || involved || approve.isPending} onClick={() => approve.mutate()} data-testid="imp-approve-go">
          {approve.isPending ? 'Approving…' : `Approve and import ${ap.totals.loans} loan${ap.totals.loans === 1 ? '' : 's'}`}
        </button>
      </div>
    </Card>
  )
}

function CutoverCheck({ batch }) {
  // Each loan is checked in its own payroll's cutover month; a picker per payroll looks at another month.
  const [m, setM] = useState(batch.cutover || {})
  const params = cutoverParams(m, '')
  const { data, isLoading } = useQuery({
    queryKey: ['loan-import-cutover', batch.id, cutoverText(m)],
    queryFn: () => getLoanImportCutoverCheck(batch.id, params),
    retry: 0,
  })
  const c = data?.data?.data
  const download = async () => {
    try { saveBlob(await downloadLoanImportCutoverCheck(batch.id, params), `loan_import_${batch.id}_cutover.xlsx`) } catch (err) { toast.error(errText(err, 'Download failed')) }
  }
  return (
    <Card title="Cutover check — app EMI vs Excel EMI, before the bank file goes out" testid="imp-cutover-check"
      right={<span className="flex items-center gap-2 flex-wrap">
        {PAYROLLS.filter((p) => m[p]).map((p) => (
          <span key={p} className="flex items-center gap-1"><span className="text-[11px] text-slate-500">{PAYROLL_LABEL[p]}</span>
            <MonthPicker value={m[p]} onChange={(v) => setM((x) => ({ ...x, [p]: v }))} testid={`imp-cc-month-${p}`} /></span>
        ))}
        <button className="btn-secondary text-xs" onClick={download} data-testid="imp-cutover-xlsx">Excel</button></span>}>
      {isLoading || !c ? <div className="p-4 text-sm text-slate-400">Loading…</div> : (
        <table className="table-compact w-full min-w-[1100px] text-xs">
          <thead><tr><th>Row</th><th>Loan</th><th>Borrower</th><th>Month</th><th className="text-right">Excel EMI</th><th className="text-right">App instalment</th><th className="text-right">Stage 7 deduction</th>
            <th className="text-right">Net salary</th><th className="text-right">Room under cap</th><th className="text-right">Balance</th><th>Flags</th></tr></thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.loanId} data-testid={`imp-cc-${r.rowNo}`} className={r.flags.length ? 'bg-amber-50/50' : ''}>
                <td>{r.rowNo}</td><td><a className="text-blue-600" href={`/loans/${r.loanId}`}>#{r.loanId}</a></td>
                <td>{r.name}<div className="text-[11px] text-slate-400 font-mono">{r.employeeCode} · {r.payroll}</div></td>
                <td className="whitespace-nowrap" data-testid={`imp-cc-row-month-${r.rowNo}`}>{monthLabel(r.month.month, r.month.year)}</td>
                <td className="text-right font-mono">{rupees(r.excelEmi)}</td><td className="text-right font-mono">{rupees(r.appInstalment)}</td>
                <td className="text-right font-mono">{r.deduction ? `${rupees(r.deduction.amount)} (${r.deduction.state})` : '—'}</td>
                <td className="text-right font-mono">{rupees(r.netSalary)}</td>
                <td className="text-right font-mono" title={r.headroomBasis}>{rupees(r.projectedHeadroom)}</td><td className="text-right font-mono">{rupees(r.balance)}</td>
                <td>{r.flags.length ? r.flags.map((f) => <span key={f} className="inline-block mr-1 mb-0.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{FLAG[f] || f}</span>) : <span className="text-green-600">✓</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-semibold bg-slate-50" data-testid="imp-cc-totals">
            <td colSpan={4}>{c.totals.loans} loans · {c.totals.flagged} flagged</td><td className="text-right font-mono">{rupees(c.totals.excelEmi)}</td>
            <td className="text-right font-mono">{rupees(c.totals.appInstalment)}</td><td className="text-right font-mono">{rupees(c.totals.deducted)}</td><td colSpan={4} />
          </tr></tfoot>
        </table>
      )}
    </Card>
  )
}

/** Which column is the cutover outstanding / the EMI — re-choosable on a batch in review (uploader or admin). */
function ColumnsCard({ batch, onDone }) {
  const cm = batch.column_map || {}
  const headers = cm.headers || []
  const balances = cm.balanceColumns || []
  const [out, setOut] = useState(cm.mapping?.outstanding ?? '')
  const [emi, setEmi] = useState(cm.mapping?.emi ?? '')
  const save = useMutation({
    mutationFn: () => remapLoanImportColumns(batch.id, { outstanding: Number(out), emi: Number(emi) }),
    onSuccess: (res) => { const r = res.data.data; toast.success(`Columns: "${r.outstandingColumn}" / "${r.emiColumn}" — ${r.rowsChanged} row(s) changed, ${r.confirmationsReset} finance confirmation(s) reset`); onDone() },
    onError: (err) => toast.error(errText(err, 'Could not change the columns')),
  })
  if (!headers.length) return null
  const changed = Number(out) !== cm.mapping?.outstanding || Number(emi) !== cm.mapping?.emi
  return (
    <Card title="Balance and EMI columns" testid="imp-columns">
      <div className="p-4 flex items-end gap-3 flex-wrap text-xs">
        <label>
          <div className="text-slate-500">Cutover outstanding (balance before the cutover month's EMI)</div>
          <select className="select text-xs w-64" value={out} onChange={(e) => setOut(e.target.value)} data-testid="imp-cols-outstanding">
            {headers.map((h) => <option key={h.index} value={h.index}>{h.text}{balances.includes(h.index) ? ' (balance column)' : ''}</option>)}
          </select>
        </label>
        <label>
          <div className="text-slate-500">Monthly EMI</div>
          <select className="select text-xs w-56" value={emi} onChange={(e) => setEmi(e.target.value)} data-testid="imp-cols-emi">
            {headers.map((h) => <option key={h.index} value={h.index}>{h.text}</option>)}
          </select>
        </label>
        <button className="btn-secondary text-xs" disabled={!changed || save.isPending} onClick={() => save.mutate()} data-testid="imp-cols-apply">Apply</button>
        <span className="text-slate-400">Changing a column resets every finance balance confirmation.</span>
      </div>
    </Card>
  )
}

/**
 * One click for the clean rows: HR confirms every clean match (code or exact name, one candidate, no flags),
 * finance confirms every clean balance as in the file. The server re-checks each row exactly as the
 * single-row buttons do; flagged rows stay below for one-by-one review.
 */
function BulkBar({ batchId, role, bulk, onDone }) {
  const [open, setOpen] = useState(false)
  const hr = role === 'hr'
  const n = hr ? bulk?.cleanMatches || 0 : bulk?.fileBalances || 0
  const run = useMutation({
    mutationFn: () => (hr ? confirmLoanImportCleanMatches(batchId) : confirmLoanImportFileBalances(batchId)),
    onSuccess: (res) => {
      const r = res.data.data
      toast.success(`Confirmed ${r.confirmed} · skipped ${r.skipped.length}`)
      setOpen(false)
      onDone()
    },
    onError: (err) => { toast.error(errText(err, 'Nothing was confirmed')); setOpen(false); onDone() },
  })
  if (!['hr', 'finance'].includes(role) || n === 0) return null
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap" data-testid="imp-bulk">
      <span className="text-xs text-blue-900">
        {hr
          ? `${n} row${n === 1 ? '' : 's'} match by employee code or an exact name to one employee with no flags.`
          : `${n} row${n === 1 ? '' : 's'} have a usable outstanding and EMI in the file and no balance flags.`}
        {' '}Flagged rows stay for one-by-one review.
      </span>
      <button className="btn-primary text-xs" disabled={run.isPending} onClick={() => setOpen(true)} data-testid={hr ? 'imp-bulk-match' : 'imp-bulk-balance'}>
        {run.isPending ? 'Confirming…' : (hr ? `Confirm all clean matches (${n})` : `Confirm all balances as in the file (${n})`)}
      </button>
      {open && (
        <ConfirmDialog
          title={hr ? 'Confirm clean matches' : 'Confirm balances as in the file'}
          message={`Confirm ${n} row${n === 1 ? '' : 's'} (${hr ? 'clean matches' : 'balances exactly as in the file'})? Each row is confirmed in your name with its own audit entry, exactly as the per-row button does. Flagged rows are left for you to do one by one.`}
          confirmText={`Confirm ${n}`}
          variant="warning"
          onConfirm={() => run.mutate()}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function BatchView({ id, caps, onBack }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('all')
  const [discardReason, setDiscardReason] = useState('')
  const { data, isLoading, error } = useQuery({ queryKey: ['loan-import-batch', id], queryFn: () => getLoanImportBatch(id), retry: 0 })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['loan-import-batch', id] }); qc.invalidateQueries({ queryKey: ['loan-import-batches'] }) }
  const discard = useMutation({
    mutationFn: () => discardLoanImportBatch(id, { reason: discardReason }),
    onSuccess: () => { toast.success(`Batch #${id} discarded`); refresh() },
    onError: (err) => toast.error(errText(err, 'Could not discard')),
  })
  const d = data?.data?.data
  const rows = useMemo(() => (d ? d.rows.filter((FILTERS.find((f) => f.id === filter) || FILTERS[0]).match) : []), [d, filter])
  if (isLoading) return <div className="text-sm text-slate-400">Loading batch…</div>
  if (error || !d) return <div className="text-sm text-red-600">{errText(error, 'Batch not found')}</div>
  const b = d.batch
  const review = b.status === 'review'
  const leftRows = d.rows.filter((r) => r.outReason === 'left')
  const canDiscard = review && (caps.role === 'admin' || sameUser(b.uploaded_by, caps.username))
  return (
    <div className="space-y-4" data-testid="imp-batch">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <button className="text-xs text-blue-600" onClick={onBack}>← All batches</button>
          <h3 className="font-semibold text-slate-800">Batch #{b.id} · {b.file_name}</h3>
          <div className="text-xs text-slate-500">
            Uploaded by {b.uploaded_by} · {istDateTime(b.uploaded_at)} · <span data-testid="imp-batch-status">{b.status}</span>
            {b.status === 'approved' && ` · approved by ${b.approved_by} · cutover ${cutoverText(b.cutover)}`}
          </div>
        </div>
        {canDiscard && (
          <span className="flex gap-1">
            <input className="input text-xs w-48" placeholder="Reason to discard" value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} />
            <button className="btn-danger text-xs" disabled={discardReason.trim().length < 3 || discard.isPending} onClick={() => discard.mutate()} data-testid="imp-discard">Discard batch</button>
          </span>
        )}
      </div>

      {b.status === 'approved' && b.result && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" data-testid="imp-result">
          {b.result.loans} loans imported ({rupees(b.result.outstanding)} outstanding, {rupees(b.result.monthlyEmi)} a month), first EMI {cutoverText(b.result.cutover)} · {b.result.leftOut} row{b.result.leftOut === 1 ? '' : 's'} left out.
          {b.result.stage7Computed > 0 && ` Salary for its cutover month was already computed for ${b.result.stage7Computed} borrower(s): re-run it before the bank file.`}
        </div>
      )}

      {review && (caps.role === 'admin' || sameUser(b.uploaded_by, caps.username)) && <ColumnsCard batch={b} onDone={refresh} />}

      {review && <BulkBar key={`${d.bulk?.cleanMatches}|${d.bulk?.fileBalances}`} batchId={b.id} role={caps.role} bulk={d.bulk} onDone={refresh} />}

      {leftRows.length > 0 && (
        <Card title={`Left — settle outside the app (${leftRows.length})`} testid="imp-left">
          <table className="table-compact w-full text-xs">
            <thead><tr><th>Row</th><th>Excel name</th><th>Found on</th><th className="text-right">Outstanding</th><th className="text-right">EMI</th></tr></thead>
            <tbody>{leftRows.map((r) => (
              <tr key={r.id}><td>{r.row_no}</td><td>{r.name}</td><td>{(r.candidates || []).map((c) => `${c.code} (${c.status})`).join(', ')}</td>
                <td className="text-right font-mono">{rupees(r.outstanding)}</td><td className="text-right font-mono">{rupees(r.emi)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      <Card title="Rows" testid="imp-rows" right={(
        <span className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} data-testid={`imp-filter-${f.id}`}
              className={clsx('text-xs px-2 py-1 rounded', filter === f.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>
              {f.label} ({d.rows.filter(f.match).length})
            </button>
          ))}
        </span>
      )}>
        <table className="table-compact w-full min-w-[1200px] text-xs">
          <thead><tr><th>Row</th><th>Excel</th><th>Match</th><th>Employee (HR)</th><th>Balance (finance)</th><th>Status</th><th>Warnings</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const importable = r.parse_status !== 'duplicate' && !(r.parse_status === 'invalid' && !r.amountFixable)
              return (
                <tr key={r.id} data-testid={`imp-row-${r.row_no}`} className="align-top">
                  <td>{r.row_no}</td>
                  <td className="min-w-[180px]"><div className="font-medium">{r.code && <span className="font-mono text-slate-500 mr-1">{r.code}</span>}{r.name || '—'}</div>
                    <div className="text-[11px] text-slate-500">{r.company || '—'}{r.department ? ` · ${r.department}` : ''}{r.loan_date ? ` · ${r.loan_date}` : ''}</div>
                    <div className="text-[11px] text-slate-500">{r.loan_type}{r.agreement_ref ? ` · ${r.agreement_ref}` : ''}</div>
                    {(r.parse_errors || []).length > 0 && r.parse_status !== 'ok' && <div className="text-[11px] text-red-600">{r.parse_errors.map((e) => e.message).join('; ')}</div>}
                  </td>
                  <td>{r.match_tier ? <Chip map={TIER} k={r.match_tier} testid={`imp-tier-${r.row_no}`} /> : '—'}</td>
                  <td><MatchCell key={`${r.id}|${r.match_status}|${r.employee_code}`} row={r} batchId={b.id} editable={review && caps.role === 'hr' && importable} onDone={refresh} /></td>
                  <td>{r.parse_status === 'duplicate' ? '—' : <BalanceCell key={`${r.id}|${r.outstanding}|${r.emi}|${r.balance_status}`} row={r} batchId={b.id} editable={review && caps.role === 'finance' && importable} onDone={refresh} />}</td>
                  <td><Chip map={STATE} k={r.outcome === 'imported' ? 'imported' : r.state} testid={`imp-state-${r.row_no}`} />{r.outLabel && <div className="text-[11px] text-slate-500 mt-0.5">{r.outLabel}</div>}
                    {r.loan_id && <div><a className="text-blue-600" href={`/loans/${r.loan_id}`}>Loan #{r.loan_id}</a></div>}</td>
                  <td className="max-w-[260px]">{(r.warnings || []).map((w) => <div key={w.code} className="text-[11px] text-amber-700" title={w.message}>⚠ {w.message}</div>)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {review && caps.role === 'admin' && <ApprovePanel d={d} caps={caps} onDone={refresh} />}
      {b.status === 'approved' && <CutoverCheck batch={b} />}
    </div>
  )
}

// ── tab ──────────────────────────────────────────────────────────────────────

export default function LoanImport({ caps }) {
  const [batchId, setBatchId] = useState(null)
  const canUpload = ['hr', 'finance'].includes(caps.role)
  const { data } = useQuery({ queryKey: ['loan-import-batches'], queryFn: getLoanImportBatches, retry: 0 })
  const batches = data?.data?.data?.batches || []
  const template = async () => {
    try { saveBlob(await downloadLoanImportTemplate(), 'loan_import_template.xlsx') } catch (err) { toast.error(errText(err, 'Download failed')) }
  }
  if (batchId) return <BatchView id={batchId} caps={caps} onBack={() => setBatchId(null)} />
  return (
    <div className="space-y-4" data-testid="imp-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-3xl">
          Bring in the loans accounts runs outside the app. HR {caps.role === 'hr' ? '(you) ' : ''}confirms each name to an employee code, finance
          {caps.role === 'finance' ? ' (you)' : ''} confirms each balance, and the admin approves the batch and names the cutover month — the first EMI
          the app deducts. No money moves: each loan starts as an opening balance. Rows for people who have left are listed to settle outside the app.
        </div>
        {caps.role !== 'viewer' && <button className="btn-secondary text-xs" onClick={template} data-testid="imp-template">Download template</button>}
      </div>
      {canUpload && <UploadPanel onCreated={setBatchId} />}
      <Card title="Import batches" testid="imp-batches">
        <table className="table-compact w-full min-w-[900px] text-xs">
          <thead><tr><th>#</th><th>File</th><th>Uploaded</th><th>Status</th><th className="text-center">Rows</th><th className="text-center">Needs HR</th><th className="text-center">Needs finance</th><th className="text-center">Ready</th><th className="text-center">Not imported</th><th>Cutover</th></tr></thead>
          <tbody>
            {batches.length === 0 ? <tr><td colSpan={10} className="text-center py-6 text-slate-400">No import yet.</td></tr> : batches.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-blue-50/50" onClick={() => setBatchId(b.id)} data-testid={`imp-batch-${b.id}`}>
                <td>{b.id}</td><td>{b.fileName}</td><td>{b.uploadedBy} · {istDateTime(b.uploadedAt)}</td><td>{b.status}</td><td className="text-center">{b.totalRows}</td>
                <td className="text-center">{b.counts.needsMatch}</td><td className="text-center">{b.counts.needsBalance}</td><td className="text-center">{b.status === 'approved' ? b.counts.imported : b.counts.ready}</td>
                <td className="text-center">{b.counts.out}</td><td>{b.cutover ? cutoverText(b.cutover) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
