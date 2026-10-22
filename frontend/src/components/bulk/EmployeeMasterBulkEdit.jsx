import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import ScrollTable from '../ui/ScrollTable'
import PeoplePicker from './PeoplePicker'
import { undoBatchWithReason } from './BulkBatchList'
import useDraft, { DraftRestoredBanner } from '../../hooks/useDraft'
import { confirmDialog } from '../../hooks/useConfirm'
import { bulkPreview, bulkApply, bulkSubmit, getMasterEditMeta, exportMasterEdit } from '../../utils/bulkApi'
import { buildSheet, readSheet, splitRows } from '../../utils/masterEditSheet'
import { todayIST } from '../../utils/formatters'

/**
 * Employee master bulk edit (P5-02). Inline panel — NOT a Modal (useConfirm dialogs must not open inside a Modal).
 *
 * Two ways in:
 *   "Set one value"   — selected people (from the Employees list or the picker) + one field + one value.
 *   "Sheet"           — download current values → edit in Excel → upload; only changed cells count.
 * Changes are split by where they go:
 *   Saved now          shift, department, designation, contractor group   (kind master-edit)
 *   Sent to finance    bank, PAN, UAN, ESI number, company                (kind master-edit-sensitive, section details)
 *   Sent to finance    leaving the company                                (same kind, section exit — never undoable)
 * Each part is checked on the server; batches of ≤ 50 people; a batch saves (or is approved) whole or not at all.
 */
const SECTIONS = [
  { id: 'direct', kind: 'master-edit', common: {}, title: 'Saved now', hint: 'Applied when you save. Each batch can be undone while nothing has changed since.' },
  { id: 'details', kind: 'master-edit-sensitive', common: { section: 'details' }, title: 'Sent to finance — bank, statutory numbers, company', hint: 'Nothing changes until another finance or admin user approves the batch.' },
  { id: 'exit', kind: 'master-edit-sensitive', common: { section: 'exit' }, title: 'Sent to finance — leaving the company', hint: 'Same as Mark Left once approved (loans are flagged for recovery). A leaving batch cannot be undone.' },
]
const STATE_LABEL = { ok: 'Ready', warning: 'Ready — check', skipped: 'No change', error: 'Problem' }
const STATE_CLS = { ok: 'bg-green-100 text-green-800', warning: 'bg-amber-100 text-amber-800', skipped: 'bg-slate-200 text-slate-700', error: 'bg-red-100 text-red-700' }
// Same list the old Assign Shift window hid (Employees.jsx LEGACY_SHIFT_CODES) — still accepted if typed in a sheet.
const LEGACY_SHIFT_CODES = new Set(['DAY', 'NIGHT', 'GEN', 'DUBLE'])
const splitLabel = (groups) => groups.map(g => g.applyCount).join(' + ')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function useSectionPreview(kind, common, rows) {
  const request = useMemo(() => ({ common: { ...common, fields: [...new Set(rows.flatMap(r => Object.keys(r.changes || {})))] }, rows }), [common, rows])
  const key = JSON.stringify(request)
  const [state, setState] = useState(null)
  const [checking, setChecking] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!rows.length) { setState(null); return undefined }
    const my = ++seq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await bulkPreview(kind, request)
        if (my === seq.current) setState({ key, data: res.data })
      } catch (err) {
        if (my === seq.current) setState({ key, error: err?.response?.data?.error || 'Could not check the rows' })
      } finally {
        if (my === seq.current) setChecking(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = !!state && state.key === key && !checking
  return { request, state, checking, fresh }
}

function ValueInput({ field, meta, value, onChange }) {
  if (!field) return null
  if (field === 'shift') {
    return (
      <select className="select w-full" value={value} onChange={e => onChange(e.target.value)} aria-label="New shift" data-testid="me-value">
        <option value="">— Select shift —</option>
        {(meta?.shifts || []).filter(s => !LEGACY_SHIFT_CODES.has(s.code)).map(s => <option key={s.id} value={s.code}>{s.code} ({s.start_time}–{s.end_time})</option>)}
      </select>
    )
  }
  if (field === 'company') {
    return (
      <select className="select w-full" value={value} onChange={e => onChange(e.target.value)} aria-label="New company" data-testid="me-value">
        <option value="">— Select company —</option>
        {(meta?.companies || []).map(c => <option key={c}>{c}</option>)}
      </select>
    )
  }
  if (field === 'exit') {
    const v = value && typeof value === 'object' ? value : { date: '', reason: '' }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input type="date" className="input w-full" max={todayIST()} value={v.date} aria-label="Leaving date" data-testid="me-exit-date"
          onChange={e => onChange({ ...v, date: e.target.value })} />
        <input className="input w-full" placeholder="Reason (at least 5 characters)" value={v.reason} aria-label="Leaving reason" data-testid="me-exit-reason"
          onChange={e => onChange({ ...v, reason: e.target.value })} />
      </div>
    )
  }
  const list = field === 'department' ? meta?.departments : field === 'designation' ? meta?.designations : field === 'contractor_group' ? meta?.contractorGroups : null
  return (
    <>
      <input className="input w-full" value={value} onChange={e => onChange(e.target.value)} list={list ? `me-list-${field}` : undefined}
        aria-label="New value" data-testid="me-value" placeholder={field === 'designation' || field === 'contractor_group' ? 'Leave empty to clear' : ''} />
      {list && <datalist id={`me-list-${field}`}>{list.map(v => <option key={v} value={v} />)}</datalist>}
    </>
  )
}

export default function EmployeeMasterBulkEdit({ employees = [], listCodes = [], initialCodes = [], initialField = '', onClose, onSaved }) {
  const [meta, setMeta] = useState(null)
  useEffect(() => {
    let live = true
    getMasterEditMeta().then(r => { if (live) setMeta(r.data?.data || null) }).catch(() => { if (live) setMeta({ fields: [], error: true }) })
    return () => { live = false }
  }, [])
  const fieldsAll = meta?.fields || []

  const draft = useDraft('employee-master-bulk', { mode: initialCodes.length ? 'one' : 'sheet', codes: initialCodes, field: initialField, value: '', sheetRows: [], sheetInfo: null, picked: [] })
  const { mode, codes, field, value, sheetRows, sheetInfo, picked } = draft.value
  const set = (patch) => draft.setValue(v => ({ ...v, ...patch }))
  // A selection passed in from the list wins over a restored draft.
  useEffect(() => { if (initialCodes.length) set({ mode: 'one', codes: initialCodes, field: initialField || field }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── rows for each section ──
  const rows = useMemo(() => {
    if (mode === 'one') {
      if (!field || !codes.length) return []
      const v = field === 'exit' ? (value && typeof value === 'object' ? value : { date: '', reason: '' }) : value
      return codes.map(code => ({ code, changes: { [field]: v } }))
    }
    return sheetRows
  }, [mode, codes, field, value, sheetRows])
  const split = useMemo(() => splitRows(rows, meta), [rows, meta])
  const prev = {
    direct: useSectionPreview('master-edit', SECTIONS[0].common, split.direct),
    details: useSectionPreview('master-edit-sensitive', SECTIONS[1].common, split.details),
    exit: useSectionPreview('master-edit-sensitive', SECTIONS[2].common, split.exit),
  }
  const used = SECTIONS.filter(s => split[s.id].length)
  const counts = (id) => prev[id].state?.data?.counts || { total: 0, ok: 0, warning: 0, skipped: 0, error: 0 }
  const groups = (id) => prev[id].state?.data?.groups || []
  const applyN = (id) => groups(id).reduce((n, g) => n + g.applyCount, 0)
  const allFresh = used.every(s => prev[s.id].fresh)
  const anyError = used.some(s => counts(s.id).error > 0 || prev[s.id].state?.error)
  const directN = applyN('direct'); const financeN = applyN('details') + applyN('exit')

  // ── sheet download / upload ──
  const [chosen, setChosen] = useState(['shift'])
  const [busyDl, setBusyDl] = useState(false)
  const download = async () => {
    if (!chosen.length) return
    setBusyDl(true)
    try {
      const fields = fieldsAll.filter(f => chosen.includes(f.key))
      const res = await exportMasterEdit({ fields: chosen.filter(f => f !== 'exit'), codes: (picked.length ? picked : listCodes) })
      const wb = buildSheet(res.data?.data || [], fields, meta?.shifts || [])
      XLSX.writeFile(wb, `Employee_Master_Bulk_Edit_${todayIST()}.xlsx`)
      toast.success(`Sheet downloaded — ${plural((res.data?.data || []).length, 'person', 'people')}`)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not build the sheet')
    } finally { setBusyDl(false) }
  }
  const fileRef = useRef(null)
  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !meta) return
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
      const got = readSheet(wb, meta)
      if (got.error) { toast.error(got.error); return }
      set({ sheetRows: got.rows, sheetInfo: { name: f.name, noMeta: got.noMeta, columns: got.columns, ignored: got.ignored, people: got.rows.length } })
    } catch {
      toast.error('Could not read that file — save it as .xlsx and try again')
    }
  }

  const leaveOut = (codesOut) => {
    const drop = new Set(codesOut.map(c => String(c).toLowerCase()))
    if (mode === 'one') set({ codes: codes.filter(c => !drop.has(String(c).toLowerCase())) })
    else set({ sheetRows: sheetRows.filter(r => !drop.has(String(r.code).toLowerCase())) })
  }

  // ── save ──
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [result, setResult] = useState(null)
  const disabledReason = !rows.length ? (mode === 'one' ? 'Choose people, a field and a value' : 'Upload the edited sheet')
    : !allFresh ? 'Checking...'
    : anyError ? 'Some rows have problems — fix them or leave them out'
    : !(directN + financeN) ? 'Nothing to save — everyone already has these values' : ''
  const save = async () => {
    if (inFlight.current || disabledReason) return
    inFlight.current = true
    try { await runSave() } finally { inFlight.current = false; setSaving(false) }
  }
  const runSave = async () => {
    const lines = []
    if (directN) lines.push(`Save now: ${plural(directN, 'person', 'people')}${groups('direct').length > 1 ? ` (${groups('direct').length} batches: ${splitLabel(groups('direct'))})` : ''}.`)
    if (applyN('details')) lines.push(`Send to finance: ${plural(applyN('details'), 'person', 'people')} with bank / statutory / company changes.`)
    if (applyN('exit')) lines.push(`Send to finance: ${plural(applyN('exit'), 'person', 'people')} leaving the company (cannot be undone in bulk).`)
    const ok = await confirmDialog({ title: 'Save these changes?', message: `${lines.join('\n')}\nEach batch saves whole or not at all.`,
      confirmText: financeN && !directN ? 'Send to finance' : 'Save', variant: 'info' })
    if (!ok) return
    setSaving(true)
    const out = []
    for (const s of used) {
      const p = prev[s.id]; const data = p.state.data
      const byNo = new Map(data.rows.map(r => [r.rowNo, r]))
      const gid = `me-${s.id}-${Date.now().toString(36)}`
      for (const g of data.groups) {
        const gRows = g.rowNos.map(n => byNo.get(n))
        const body = { common: p.request.common, rows: gRows.map(r => r.input), planHash: g.planHash, groupId: gid, groupIndex: g.index, groupSize: data.groups.length }
        try {
          const res = data.requiresApproval ? await bulkSubmit(s.kind, body) : await bulkApply(s.kind, body)
          out.push({ section: s.id, index: g.index, of: data.groups.length, status: data.requiresApproval ? 'sent' : 'saved', batchId: res.data.batchId,
            applyCount: g.applyCount, codes: gRows.map(r => r.code), requiresApproval: !!data.requiresApproval })
        } catch (err) {
          out.push({ section: s.id, index: g.index, of: data.groups.length, status: 'refused', error: err?.response?.data?.error || 'Not saved',
            applyCount: g.applyCount, codes: gRows.filter(r => r.state !== 'skipped').map(r => r.code) })
        }
      }
    }
    const refused = new Set(out.filter(b => b.status === 'refused').flatMap(b => b.codes.map(c => c.toLowerCase())))
    if (!refused.size) draft.clear()
    else if (mode === 'one') set({ codes: codes.filter(c => refused.has(String(c).toLowerCase())) })
    else set({ sheetRows: sheetRows.filter(r => refused.has(String(r.code).toLowerCase())) })
    setResult(out)
    onSaved?.()
  }

  if (result) {
    const saved = result.filter(b => b.status === 'saved'); const sent = result.filter(b => b.status === 'sent'); const refused = result.filter(b => b.status === 'refused')
    return (
      <div className="card p-4 space-y-3" data-testid="me-result">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Employee master — bulk edit done</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="text-sm text-slate-700" data-testid="me-result-summary">
          {saved.length ? `${plural(saved.length, 'batch', 'batches')} saved` : 'Nothing saved directly'}
          {sent.length ? ` · ${plural(sent.length, 'batch', 'batches')} sent to finance (Finance Verification → Bulk batches)` : ''}
          {refused.length ? ` · ${plural(refused.length, 'batch', 'batches')} refused — nothing from ${refused.length === 1 ? 'it' : 'them'} was saved` : ''}.
        </div>
        <ul className="space-y-1.5">
          {result.map(b => (
            <li key={`${b.section}-${b.index}`} data-batch-result={b.status} className={clsx('rounded border px-3 py-2 text-sm flex flex-wrap items-center gap-2',
              b.status === 'refused' ? 'border-red-200 bg-red-50' : b.status === 'sent' ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50')}>
              <span className="font-medium">{SECTIONS.find(s => s.id === b.section).title} · batch {b.index + 1} of {b.of}</span>
              {b.status === 'saved' && <><span>saved as #{b.batchId} ({plural(b.applyCount, 'person', 'people')})</span>
                <Button variant="link" tone="red" onClick={async () => { if (await undoBatchWithReason({ id: b.batchId, applyCount: b.applyCount, summary: 'employee master edit' }, { direct: 'Puts back the values this batch changed. Refused if anything has changed since. Reason (at least 5 characters):' })) setResult(r => r.map(x => (x === b ? { ...x, status: 'undone' } : x))) }}>Undo</Button></>}
              {b.status === 'undone' && <span>#{b.batchId} undone</span>}
              {b.status === 'sent' && <span>sent as #{b.batchId} ({plural(b.applyCount, 'person', 'people')}) — waiting for finance</span>}
              {b.status === 'refused' && <span className="text-red-700">refused ({plural(b.applyCount, 'person', 'people')}): {b.error}</span>}
            </li>
          ))}
        </ul>
        {refused.length > 0 && <Button variant="secondary" size="sm" onClick={() => setResult(null)}>Check the refused rows again</Button>}
      </div>
    )
  }

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono', render: r => r.code },
    { key: 'name', header: 'Name', render: r => r.name || '—' },
    { key: 'change', header: 'Change', className: 'whitespace-normal max-w-[420px]', render: r => (r.changes?.length
      ? r.changes.map(c => <div key={c.field}><span className="text-slate-500">{c.label}:</span> {c.old || <i className="text-slate-400">blank</i>} → <b>{c.new || <i className="text-slate-400">blank</i>}</b></div>)
      : <span className="text-slate-400">{r.changeText || '—'}</span>) },
    { key: 'state', header: 'Check', render: r => <span data-row-state={r.state} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', STATE_CLS[r.state])}>{STATE_LABEL[r.state]}</span> },
    { key: 'messages', header: 'Note', className: 'whitespace-normal max-w-[360px]', render: r => <span className="text-slate-600">{(r.messages || []).join('; ')}</span> },
  ]

  return (
    <div className="card p-4 space-y-4" data-testid="me-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">Bulk edit employee master</h3>
          <p className="text-xs text-slate-500">Shift, department, designation and contractor group are saved at once. Bank, PAN, UAN, ESI number, company and leaving go to finance first.
            Salary changes: Salary → Bulk salary revision. PF / ESI / LWF flags: Statutory flags.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <DraftRestoredBanner draft={draft} />
      {meta?.error && <div className="text-sm text-red-700">Could not load the field list — close and open again.</div>}

      <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 w-fit" role="tablist">
        {[['one', 'Set one value'], ['sheet', 'Download sheet → upload']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} data-testid={`me-mode-${id}`} onClick={() => set({ mode: id })}
            className={clsx('px-3 py-1 text-xs font-medium rounded-md', mode === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>{label}</button>
        ))}
      </div>

      {mode === 'one' ? (
        <section className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="me-field">Field *</label>
              <select id="me-field" className="select w-full" value={field} data-testid="me-field" onChange={e => set({ field: e.target.value, value: e.target.value === 'exit' ? { date: '', reason: '' } : '' })}>
                <option value="">— Choose —</option>
                <optgroup label="Saved now">{fieldsAll.filter(f => f.kind === 'direct').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
                <optgroup label="Sent to finance">{fieldsAll.filter(f => f.kind !== 'direct').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">New value {field === 'exit' ? '(leaving date + reason)' : ''}</label>
              <ValueInput field={field} meta={meta} value={value} onChange={v => set({ value: v })} />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1">People ({codes.length})</div>
            <PeoplePicker employees={employees} value={codes} onChange={c => set({ codes: c })} maxHeight="16rem" />
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase">1 · Choose the columns and download</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="me-fields">
            {['direct', 'sensitive', 'exit'].map(k => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">{k === 'direct' ? 'Saved now:' : k === 'sensitive' ? 'Finance:' : ''}</span>
                {fieldsAll.filter(f => f.kind === k).map(f => (
                  <label key={f.key} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={chosen.includes(f.key)} data-field={f.key}
                      onChange={e => setChosen(c => (e.target.checked ? [...c, f.key] : c.filter(x => x !== f.key)))} /> {f.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button variant="secondary" size="sm" onClick={download} busy={busyDl} busyLabel="Building..." disabled={!chosen.length || !meta} data-testid="me-download">
              Download sheet ({plural((picked.length || listCodes.length), 'person', 'people')})
            </Button>
            <span className="text-xs text-slate-500">{picked.length ? 'people ticked below' : 'everyone in the list on screen (filters apply)'} · only the cells you change are used</span>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600">Choose people instead of the list on screen ({picked.length})</summary>
            <div className="mt-2"><PeoplePicker employees={employees} value={picked} onChange={c => set({ picked: c })} maxHeight="14rem" /></div>
          </details>
          <div className="text-xs font-semibold text-slate-500 uppercase pt-1">2 · Upload the edited sheet</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} disabled={!meta} data-testid="me-upload">Upload edited sheet</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} data-testid="me-file" />
            {sheetInfo && (
              <span className="text-xs text-slate-600" data-testid="me-sheet-line">
                {sheetInfo.name}: {plural(sheetInfo.people, 'person', 'people')} with changes
                {sheetInfo.ignored?.length ? <span className="text-amber-700"> · columns not used: {sheetInfo.ignored.join(', ')}</span> : null}
              </span>
            )}
          </div>
          {sheetInfo?.noMeta && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="me-nometa">
              This sheet was not downloaded from here (or was copied to a new file), so every filled cell is treated as a change and nothing can be checked against the download. Cells that already match the master are left as they are.
            </div>
          )}
        </section>
      )}

      {used.map(s => {
        const p = prev[s.id]; const c = counts(s.id); const data = p.state?.data
        return (
          <section key={s.id} className="space-y-2" data-testid={`me-section-${s.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">{s.title}</span>
              {p.checking && <span className="text-xs text-slate-400">checking...</span>}
              {data && <span className="text-xs text-slate-500" data-testid={`me-counts-${s.id}`}>
                {c.ok + c.warning} ready · {c.skipped} no change · <span className={c.error ? 'text-red-700' : ''}>{c.error} with problems</span></span>}
              {c.error > 0 && <Button variant="secondary" size="sm" className="ml-auto" data-testid={`me-leave-out-${s.id}`}
                onClick={() => leaveOut(data.rows.filter(r => r.state === 'error').map(r => r.code))}>Leave out {c.error} with problems</Button>}
            </div>
            <p className="text-[11px] text-slate-500">{s.hint}</p>
            {p.state?.error ? <div className="text-sm text-red-700">{p.state.error}</div>
              : data && <ScrollTable columns={columns} rows={data.rows} rowKey="rowNo" maxHeight="max-h-[40vh]" testId={`me-preview-${s.id}`}
                rowProps={r => ({ 'data-code': r.code, className: r.state === 'error' ? 'bg-red-50/60' : r.state === 'skipped' ? 'bg-slate-50' : '' })} emptyText="No rows" />}
          </section>
        )
      })}

      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center gap-3 rounded-b-xl" data-testid="me-savebar">
        <span className="text-xs text-slate-500">Finance decides the bank / statutory / company / leaving batches; you cannot approve your own.</span>
        <div className="ml-auto flex items-center gap-2">
          {disabledReason && <span className="text-xs text-slate-500" data-testid="me-save-hint">{disabledReason}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!!disabledReason} busy={saving} busyLabel="Saving..." data-testid="me-save">
            {[directN ? `Save ${directN} now${groups('direct').length > 1 ? ` (${groups('direct').length} batches: ${splitLabel(groups('direct'))})` : ''}` : '',
              financeN ? `Send ${financeN} to finance` : ''].filter(Boolean).join(' · ') || 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
