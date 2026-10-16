import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as XLSX from 'xlsx'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import ScrollTable from '../ui/ScrollTable'
import useDraft, { DraftRestoredBanner } from '../../hooks/useDraft'
import { confirmDialog } from '../../hooks/useConfirm'
import { bulkPreview, bulkSubmit } from '../../utils/bulkApi'
import { fmtINR, fmtDate, todayIST } from '../../utils/formatters'

/**
 * Salary revision batch (P5-04). Inline panel — NOT a Modal (useConfirm dialogs must not open inside a Modal).
 *   1 Effective date · 2 Paste or upload rows (code + new gross or % increase [+ date]) · 3 Check · 4 Send to finance.
 * Nothing changes until a finance/admin user who did not send the batch approves it (Finance Verification → Bulk batches).
 * Batches of ≤ 50 people; each is approved (or refused) as a whole.
 */
const KIND = 'salary-revision'
const STATE_LABEL = { ok: 'Ready', warning: 'Ready — check', skipped: 'No change', error: 'Problem' }
const STATE_CLS = {
  ok: 'bg-green-100 text-green-800', warning: 'bg-amber-100 text-amber-800',
  skipped: 'bg-slate-200 text-slate-700', error: 'bg-red-100 text-red-700',
}
const CHIPS = [['all', 'All'], ['ok', 'Ready'], ['warning', 'Ready — check'], ['skipped', 'No change'], ['error', 'Problems']]

/** 1st of next month in IST (ruling Q-B3: Stage 7 reads the structure in force on the 1st). */
function firstOfNextMonth() {
  const [y, m] = todayIST().split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** dd-mm-yyyy / dd/mm/yyyy → yyyy-mm-dd (Indian order, never guessed as US). */
function normDate(t) {
  const s = String(t || '').trim()
  if (DATE_RE.test(s)) return s
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}
const cleanNum = (t) => String(t ?? '').replace(/[₹,\s]/g, '')

/**
 * One row per line: "CODE VALUE [DATE]" (tab, space or semicolon separated; comma only when nothing else).
 * VALUE ending in % = % increase, else the mode decides. Amounts may carry commas / ₹.
 * Returns { rows: [{code, new_gross|pct, effective_from?}], bad: [line] }.
 */
export function parseRevisionLines(text, mode) {
  const rows = []; const bad = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Tabs (Excel copy) first; else spaces/semicolons — so "T9503 27,500" keeps its amount; commas only for "T9501,22000".
    const sep = line.includes('\t') ? /\t+/ : /[\s;]/.test(line) ? /[\s;]+/ : /[,;]+/
    const parts = line.split(sep).map(p => p.trim()).filter(Boolean)
    if (parts.length < 2) { bad.push(line); continue }
    const [code, value, date] = parts
    const isPct = /%$/.test(value) || mode === 'pct'
    const n = cleanNum(value.replace(/%$/, ''))
    if (n === '' || !Number.isFinite(Number(n))) { bad.push(line); continue }
    const row = { code: code.replace(/\.0$/, '') }
    if (isPct) row.pct = Number(n); else row.new_gross = Number(n)
    if (date) { const d = normDate(date); if (!d) { bad.push(line); continue } row.effective_from = d }
    rows.push(row)
  }
  return { rows, bad }
}

/** First sheet: columns Code + (New Gross | % Increase) [+ Effective From]; header names matched loosely. */
function rowsFromSheet(ws) {
  const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
  const key = (o, re) => Object.keys(o).find(k => re.test(k.toLowerCase().replace(/[^a-z%]/g, '')))
  const out = []; const bad = []
  for (const r of json) {
    const kc = key(r, /^(code|empcode|employeecode|punchno)$/); const kg = key(r, /gross/); const kp = key(r, /(%|pct|percent|increase)/)
    const kd = key(r, /(effective|from|date)/)
    const code = kc ? String(r[kc]).trim() : ''
    if (!code) continue
    const row = { code }
    const g = kg ? cleanNum(r[kg]) : ''; const p = kp ? cleanNum(String(r[kp]).replace(/%$/, '')) : ''
    if (g !== '') row.new_gross = Number(g)
    if (p !== '') row.pct = Number(p)
    if (kd && String(r[kd]).trim()) { const d = normDate(r[kd]); if (d) row.effective_from = d; else { bad.push(code); continue } }
    out.push(row)
  }
  return { rows: out, bad }
}
const toLines = (rows) => rows.map(r => [r.code, r.pct !== undefined && r.new_gross === undefined ? `${r.pct}%` : (r.new_gross ?? ''),
  r.effective_from || ''].join(' ').trim()).join('\n')

const splitLabel = (groups) => groups.map(g => g.applyCount).join(' + ')
const money = (v) => (v === null || v === undefined ? '—' : fmtINR(v))
const COMPONENTS = [['basic', 'Basic'], ['da', 'DA'], ['hra', 'HRA'], ['conveyance', 'Conv.'], ['special_allowance', 'Special'], ['other_allowances', 'Other']]

export default function SalaryRevisionBulk({ onClose, onSent }) {
  const draft = useDraft('salary-revision-bulk', { date: firstOfNextMonth(), reason: '', mode: 'gross', text: '' })
  const { date, reason, mode, text } = draft.value
  const set = (patch) => draft.setValue(v => ({ ...v, ...patch }))
  const parsed = useMemo(() => parseRevisionLines(text, mode), [text, mode])
  const fileRef = useRef(null)

  const request = useMemo(() => ({ common: { effective_from: date, reason }, rows: parsed.rows }), [date, reason, parsed.rows])
  const requestKey = JSON.stringify(request)
  const [preview, setPreview] = useState(null)
  const [checking, setChecking] = useState(false)
  const seq = useRef(0)
  const canCheck = DATE_RE.test(date || '') && parsed.rows.length > 0
  useEffect(() => {
    if (!canCheck) { setPreview(null); return undefined }
    const my = ++seq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await bulkPreview(KIND, request)
        if (my === seq.current) setPreview({ key: requestKey, data: res.data })
      } catch (err) {
        if (my === seq.current) setPreview({ key: requestKey, error: err?.response?.data?.error || 'Could not check the rows' })
      } finally {
        if (my === seq.current) setChecking(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [requestKey, canCheck]) // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = preview && preview.key === requestKey && !checking
  const pv = preview?.data
  const rows = pv?.rows || []
  const counts = pv?.counts || { total: 0, ok: 0, warning: 0, skipped: 0, error: 0 }
  const groups = pv?.groups || []
  const sendTotal = groups.reduce((n, g) => n + g.applyCount, 0)
  const deltaTotal = rows.filter(r => r.state === 'ok' || r.state === 'warning').reduce((s, r) => s + (r.delta || 0), 0)
  const notFirst = DATE_RE.test(date || '') && date.slice(8, 10) !== '01'
  const [chip, setChip] = useState('all')
  const shown = chip === 'all' ? rows : rows.filter(r => r.state === chip)

  const removeCodes = (codes) => {
    const drop = new Set(codes.map(c => String(c).toLowerCase()))
    const keep = parsed.rows.filter(r => !drop.has(String(r.code).toLowerCase()))
    set({ text: toLines(keep) })
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const got = rowsFromSheet(wb.Sheets[wb.SheetNames[0]])
      set({ text: [text.trim(), toLines(got.rows)].filter(Boolean).join('\n') })
    } catch {
      set({ text })
    }
  }

  // ── Send ──
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  const [result, setResult] = useState(null)
  const send = async () => {
    if (inFlight.current) return
    if (!fresh || !pv || counts.error > 0 || !groups.length) return
    inFlight.current = true
    try { await runSend() } finally { inFlight.current = false; setSending(false) }
  }
  const runSend = async () => {
    const ok = await confirmDialog({
      title: `Send ${sendTotal} salary revision${sendTotal === 1 ? '' : 's'} to finance?`,
      message: `Change per month: ${fmtINR(deltaTotal)} in total, from ${fmtDate(date)} unless a row has its own date.\n` +
        (groups.length > 1 ? `Sent as ${groups.length} batches (${splitLabel(groups)}); finance approves each batch as a whole.\n` : '') +
        (counts.skipped ? `${counts.skipped} already at that gross — left as they are.\n` : '') +
        'Nothing changes until another finance or admin user approves.',
      confirmText: 'Send to finance', variant: 'info',
    })
    if (!ok) return
    setSending(true)
    const byNo = new Map(rows.map(r => [r.rowNo, r]))
    const groupId = `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const out = []
    for (const g of groups) {
      const gRows = g.rowNos.map(n => byNo.get(n))
      try {
        const res = await bulkSubmit(KIND, { common: request.common, rows: gRows.map(r => r.input), planHash: g.planHash,
          groupId, groupIndex: g.index, groupSize: groups.length })
        out.push({ index: g.index, status: 'sent', batchId: res.data.batchId, applyCount: g.applyCount, codes: gRows.map(r => r.code) })
      } catch (err) {
        const d = err?.response?.data || {}
        out.push({ index: g.index, status: 'refused', error: d.error || err.message || 'Not sent', applyCount: g.applyCount,
          codes: gRows.filter(r => r.state !== 'skipped').map(r => r.code) })
      }
    }
    const refused = new Set(out.filter(b => b.status === 'refused').flatMap(b => b.codes.map(c => c.toLowerCase())))
    const keep = parsed.rows.filter(r => refused.has(String(r.code).toLowerCase()))
    if (!keep.length) draft.clear(); else set({ text: toLines(keep) })
    setResult({ batches: out, total: groups.length, deltaTotal })
    onSent?.()
  }

  if (result) {
    const sent = result.batches.filter(b => b.status === 'sent')
    const refused = result.batches.filter(b => b.status === 'refused')
    return (
      <div className="card p-4 space-y-3" data-testid="sr-bulk-result">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Salary revision — sent to finance</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="text-sm text-slate-700" data-testid="sr-bulk-result-summary">
          {sent.length} of {result.total} batch{result.total === 1 ? '' : 'es'} sent
          {refused.length ? ` · ${refused.length} refused — nothing from ${refused.length === 1 ? 'that batch' : 'those batches'} was sent` : ''}.
          {' '}Salaries change only when finance approves (Finance Verification → Bulk batches).
        </div>
        <ul className="space-y-1.5">
          {result.batches.map(b => (
            <li key={b.index} data-batch-result={b.status} className={clsx('rounded border px-3 py-2 text-sm flex flex-wrap items-center gap-2',
              b.status === 'refused' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50')}>
              <span className="font-medium">Batch {b.index + 1} of {result.total}</span>
              {b.status === 'sent' ? <span>sent as #{b.batchId} ({b.applyCount} people) — waiting for finance</span>
                : <span className="text-red-700">refused ({b.applyCount} people): {b.error}</span>}
            </li>
          ))}
        </ul>
        {refused.length > 0 && <Button variant="secondary" size="sm" onClick={() => setResult(null)}>Check the refused rows again</Button>}
      </div>
    )
  }

  const columns = [
    { key: 'rowNo', header: '#', className: 'text-slate-400 w-8', render: r => r.rowNo },
    { key: 'code', header: 'Code', className: 'font-mono', render: r => r.code },
    { key: 'name', header: 'Name', render: r => r.name || '—' },
    { key: 'from', header: 'From', render: r => fmtDate(r.effectiveFrom) },
    { key: 'gross', header: 'Gross now → new', className: 'text-right whitespace-nowrap', render: r => <span>{money(r.oldGross)} → <b>{money(r.newGross)}</b>{r.pct !== null && r.pct !== undefined ? <span className="text-slate-400"> ({r.pct}%)</span> : null}</span> },
    { key: 'delta', header: 'Change / month', className: 'text-right', render: r => (r.delta === null || r.delta === undefined ? '—' : <span className={r.delta < 0 ? 'text-red-700' : 'text-green-700'}>{r.delta > 0 ? '+' : ''}{fmtINR(r.delta)}</span>) },
    ...COMPONENTS.map(([k, label]) => ({
      key: k, header: label, className: 'text-right whitespace-nowrap',
      render: r => (r[`new_${k}`] === undefined ? '—' : (k === 'special_allowance' && !r[`old_${k}`] && !r[`new_${k}`]) ? <span className="text-slate-300">—</span>
        : <span title={`${label}: ${money(r[`old_${k}`])} → ${money(r[`new_${k}`])}`}>{money(r[`old_${k}`])} → {money(r[`new_${k}`])}</span>),
    })),
    { key: 'state', header: 'Check', render: r => <span data-row-state={r.state} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', STATE_CLS[r.state])}>{STATE_LABEL[r.state]}</span> },
    { key: 'messages', header: 'Note', className: 'whitespace-normal max-w-[320px]', render: r => <span className="text-slate-600">{(r.messages || []).join('; ')}</span> },
    { key: 'remove', header: '', render: r => <IconButton label={`Remove ${r.code}`} icon="✕" onClick={() => removeCodes([r.input?.code ?? r.code])} /> },
  ]

  const sendDisabledReason = !DATE_RE.test(date || '') ? 'Pick the effective date first'
    : !parsed.rows.length ? 'Paste or upload rows first'
    : !fresh ? 'Checking...'
    : preview?.error ? preview.error
    : counts.error ? `${counts.error} row${counts.error === 1 ? '' : 's'} with problems — fix or leave them out`
    : !sendTotal ? 'Nothing to send — everyone listed already has that gross'
    : ''

  return (
    <div className="card p-4 space-y-4" data-testid="sr-bulk-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Bulk salary revision</h3>
          <p className="text-xs text-slate-500">New gross or % increase for many people at once. Each person keeps their current split; finance approves the batch.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <DraftRestoredBanner draft={draft} />

      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">1 · Effective date</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="sr-date">Effective from *</label>
            <input id="sr-date" type="date" className="input w-full" value={date} onChange={e => set({ date: e.target.value })} />
            {notFirst && <div className="text-[11px] text-amber-700 mt-0.5" data-testid="sr-date-warning">Not the 1st — salary for a month uses the structure in force on the 1st, so this pays from the next month.</div>}
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="sr-reason">Reason (shown to finance)</label>
            <input id="sr-reason" className="input w-full" maxLength={200} value={reason} placeholder="e.g. annual increment 2026" onChange={e => set({ reason: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">2 · Rows</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">A number means</span>
          <label className="flex items-center gap-1"><input type="radio" name="sr-mode" checked={mode === 'gross'} onChange={() => set({ mode: 'gross' })} data-testid="sr-mode-gross" /> new monthly gross</label>
          <label className="flex items-center gap-1"><input type="radio" name="sr-mode" checked={mode === 'pct'} onChange={() => set({ mode: 'pct' })} data-testid="sr-mode-pct" /> % increase</label>
          <span className="text-xs text-slate-400">(a value ending in % is always a % increase; % mode rounds to ₹1)</span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => fileRef.current?.click()}>Upload Excel</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} data-testid="sr-file" />
        </div>
        <textarea aria-label="Revision rows" data-testid="sr-text" className="input w-full font-mono text-xs h-36" value={text}
          placeholder={'One person per line: code  value  [date]\nT9501  22000\nT9502  7%\nT9503  25000  01-12-2026'}
          onChange={e => set({ text: e.target.value })} />
        <div className="text-xs text-slate-500" data-testid="sr-parse-line">
          {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} read
          {parsed.bad.length ? <span className="text-red-700"> · {parsed.bad.length} line{parsed.bad.length === 1 ? '' : 's'} not understood: {parsed.bad.slice(0, 3).join(' | ')}{parsed.bad.length > 3 ? ' …' : ''}</span> : null}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
          3 · Check {checking && <span className="normal-case font-normal text-slate-400">checking...</span>}
        </div>
        {!canCheck ? <div className="text-xs text-slate-400">Pick a date and add rows to see the check.</div>
          : preview?.error ? <div className="text-sm text-red-700">{preview.error}</div>
          : pv && (
            <>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="sr-chips">
                {CHIPS.map(([id, label]) => {
                  const n = id === 'all' ? counts.total : counts[id]
                  return (
                    <button key={id} type="button" data-chip={id} onClick={() => setChip(id)}
                      className={clsx('text-xs px-2.5 py-1 rounded-full border', chip === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300',
                        id === 'error' && n > 0 && chip !== id && 'text-red-700 border-red-300')}>
                      {label} ({n || 0})
                    </button>
                  )
                })}
                <span className="text-xs text-slate-700 ml-2" data-testid="sr-delta-total">Change per month: <b>{fmtINR(deltaTotal)}</b></span>
                {counts.error > 0 && (
                  <Button variant="secondary" size="sm" className="ml-auto" data-testid="sr-leave-out"
                    onClick={() => removeCodes(rows.filter(r => r.state === 'error').map(r => r.input?.code ?? r.code))}>
                    Leave out {counts.error} row{counts.error === 1 ? '' : 's'} with problems
                  </Button>
                )}
              </div>
              <ScrollTable columns={columns} rows={shown} rowKey="rowNo" maxHeight="max-h-[50vh]" testId="sr-preview"
                rowProps={r => ({ 'data-code': r.code, className: r.state === 'error' ? 'bg-red-50/60' : r.state === 'skipped' ? 'bg-slate-50' : '' })}
                emptyText="No rows in this filter" />
            </>
          )}
      </section>

      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center gap-3 rounded-b-xl" data-testid="sr-sendbar">
        <span className="text-xs text-slate-500">Finance decides each batch; you cannot approve your own.</span>
        <div className="ml-auto flex items-center gap-2">
          {sendDisabledReason && <span className="text-xs text-slate-500" data-testid="sr-send-hint">{sendDisabledReason}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={!!sendDisabledReason} busy={sending} busyLabel="Sending..." data-testid="sr-send">
            {sendTotal ? `Send ${sendTotal} to finance${groups.length > 1 ? ` (${groups.length} batches: ${splitLabel(groups)})` : ''}` : 'Send to finance'}
          </Button>
        </div>
      </div>
    </div>
  )
}
