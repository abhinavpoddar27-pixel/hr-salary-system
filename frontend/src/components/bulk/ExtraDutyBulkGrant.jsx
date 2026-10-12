import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import ScrollTable from '../ui/ScrollTable'
import PeoplePicker from './PeoplePicker'
import CopyFromDate from './CopyFromDate'
import { undoBatchWithReason } from './BulkBatchList'
import useDraft, { DraftRestoredBanner } from '../../hooks/useDraft'
import { confirmDialog } from '../../hooks/useConfirm'
import { bulkPreview, bulkApply, getEdEmployeesLite } from '../../utils/bulkApi'
import { fmtDate, isoDayOfWeek } from '../../utils/formatters'

/**
 * Extra Duty bulk grant (P3-01, B1). One inline panel (not a Modal — the confirm / undo
 * dialogs from useConfirm must not open inside a Modal).
 *   1 Set once · 2 Add people (paste / tick / copy an earlier date) · 3 Check · 4 Save.
 * Saving splits the list into batches of ≤ 50 (owner Q2); each batch is all-or-nothing on
 * the server and can be undone on its own. The result screen names every batch that saved
 * and every batch that was refused; a refused batch can be checked again and saved alone.
 */
const KIND = 'extra-duty'
const TYPES = [['OVERNIGHT_STAY', 'Overnight Stay'], ['EXTENDED_SHIFT', 'Extended Shift'], ['OTHER', 'Other']]
const SOURCES = ['Gate Register', 'Production Office', 'Supervisor Confirmed', 'Other']
const DUTY = [0.5, 1, 1.5, 2]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULTS_KEY = 'ed_bulk_defaults_v1'
const STATE_LABEL = { ok: 'Ready', warning: 'Ready — note', skipped: 'Already granted', error: 'Problem' }
const STATE_CLS = {
  ok: 'bg-green-100 text-green-800', warning: 'bg-amber-100 text-amber-800',
  skipped: 'bg-slate-200 text-slate-700', error: 'bg-red-100 text-red-700',
}
const CHIPS = [['all', 'All'], ['ok', 'Ready'], ['warning', 'Ready — note'], ['skipped', 'Already granted'], ['error', 'Problems']]

function loadDefaults() {
  const base = { grant_date: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1, verification_source: 'Gate Register', reference_number: '', remarks: '' }
  try {
    const d = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || 'null')
    if (d && typeof d === 'object') return { ...base, ...d, grant_date: '' }
  } catch { /* blocked storage */ }
  return base
}
function saveDefaults(c) {
  try {
    const { grant_date, ...rest } = c
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(rest))
  } catch { /* blocked storage */ }
}
const dateInWords = (iso) => (iso ? `${fmtDate(iso)}, ${WEEKDAYS[isoDayOfWeek(iso)]}` : '')
const splitLabel = (groups) => groups.map(g => g.applyCount).join(' + ')

export default function ExtraDutyBulkGrant({ onClose, onSaved, pageMonth, pageYear }) {
  const draft = useDraft('ed-bulk-grant', { common: loadDefaults(), codes: [], duty: {} })
  const { common, codes, duty } = draft.value
  const setDraft = (patch) => draft.setValue(v => ({ ...v, ...(typeof patch === 'function' ? patch(v) : patch) }))
  const setCommon = (k, val) => setDraft(v => ({ common: { ...v.common, [k]: val } }))
  const setCodes = (next) => setDraft({ codes: next })

  const { data: empRes } = useQuery({ queryKey: ['ed-bulk-employees'], queryFn: getEdEmployeesLite, staleTime: 60000, retry: 0 })
  const employees = empRes?.data?.data || []
  // null until the list has loaded, so CopyFromDate never drops everyone as "not active".
  const activeCodes = useMemo(() => (employees.length ? new Set(employees.filter(e => /^active$/i.test(String(e.status || '').trim())).map(e => String(e.code))) : null), [employees])

  // ── Check (preview): re-run 400 ms after any change ──
  const request = useMemo(() => ({
    common: { ...common, duty_days: Number(common.duty_days) },
    rows: codes.map(c => (duty[c] !== undefined ? { code: c, duty_days: duty[c] } : { code: c })),
  }), [common, codes, duty])
  const requestKey = JSON.stringify(request)
  const [preview, setPreview] = useState(null)       // { key, data } | { key, error }
  const [checking, setChecking] = useState(false)
  const seq = useRef(0)
  const canCheck = !!common.grant_date && codes.length > 0
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
  const applyTotal = groups.reduce((n, g) => n + g.applyCount, 0)
  const [chip, setChip] = useState('all')
  const shown = chip === 'all' ? rows : rows.filter(r => r.state === chip)

  const removeCodes = (list) => {
    const drop = new Set(list)
    setDraft(v => ({ codes: v.codes.filter(c => !drop.has(c)) }))
  }
  // Rows come back in master spelling; the draft keeps what was typed — match case-insensitively.
  const draftCodeFor = (code) => codes.find(c => c.toLowerCase() === String(code).toLowerCase()) ?? code
  const setRowDuty = (code, val) => {
    const key = draftCodeFor(code)
    setDraft(v => {
      const next = { ...v.duty }
      if (Number(val) === Number(v.common.duty_days)) delete next[key]; else next[key] = Number(val)
      return { duty: next }
    })
  }
  const errorCodes = rows.filter(r => r.state === 'error').map(r => draftCodeFor(r.code))

  // ── Save ──
  const [hrApprove, setHrApprove] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null) // { batches: [...] }

  const save = async () => {
    if (!fresh || !pv || counts.error > 0 || !groups.length) return
    const ok = await confirmDialog({
      title: `Save ${applyTotal} grant${applyTotal === 1 ? '' : 's'}?`,
      message: `${dateInWords(common.grant_date)} · ${common.duty_days} day(s) each unless changed per row.\n` +
        (groups.length > 1 ? `Saved as ${groups.length} batches (${splitLabel(groups)}); each batch can be undone on its own.\n` : '') +
        (counts.skipped ? `${counts.skipped} already granted — left as they are.\n` : '') +
        (hrApprove ? 'Also approved as HR — they go straight to finance review.' : 'Left pending in the HR queue.'),
      confirmText: 'Save', variant: 'info',
    })
    if (!ok) return
    setSaving(true)
    saveDefaults(common)
    const byNo = new Map(rows.map(r => [r.rowNo, r]))
    const groupId = `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const out = []
    for (const g of groups) {
      const gRows = g.rowNos.map(n => byNo.get(n))
      const body = {
        common: request.common,
        rows: gRows.map(r => ({ code: r.code, duty_days: r.dutyDays })),
        planHash: g.planHash, groupId, groupIndex: g.index, groupSize: groups.length, options: { hrApprove },
      }
      try {
        const res = await bulkApply(KIND, body)
        out.push({ index: g.index, status: 'saved', batchId: res.data.batchId, counts: res.data.counts, codes: gRows.map(r => r.code), applyCount: g.applyCount })
      } catch (err) {
        const d = err?.response?.data || {}
        out.push({ index: g.index, status: 'refused', error: d.error || err.message || 'Not saved', code: d.code,
          codes: gRows.filter(r => r.state !== 'skipped').map(r => r.code), applyCount: g.applyCount })
      }
    }
    setSaving(false)
    const refusedCodes = out.filter(b => b.status === 'refused').flatMap(b => b.codes)
    const keep = new Set(refusedCodes.map(c => c.toLowerCase()))
    setDraft(v => ({ codes: v.codes.filter(c => keep.has(c.toLowerCase())) }))
    if (!refusedCodes.length) draft.clear() // nothing left to save — start clean next time
    setResult({ batches: out, total: groups.length, date: common.grant_date })
    onSaved?.()
  }

  const recheckRefused = (b) => {
    setDraft(v => ({ codes: b.codes.map(c => v.codes.find(x => x.toLowerCase() === c.toLowerCase()) ?? c) }))
    setResult(null)
    setChip('all')
  }

  const undoOne = async (b) => {
    const done = await undoBatchWithReason({ id: b.batchId, applyCount: b.counts.created + b.counts.updated, summary: dateInWords(result.date) })
    if (done) {
      setResult(r => ({ ...r, batches: r.batches.map(x => x === b ? { ...x, status: 'undone' } : x) }))
      onSaved?.()
    }
  }

  const otherMonth = common.grant_date && (Number(common.grant_date.slice(5, 7)) !== Number(pageMonth) || Number(common.grant_date.slice(0, 4)) !== Number(pageYear))

  // ── Result screen ──
  if (result) {
    const saved = result.batches.filter(b => b.status !== 'refused')
    const refused = result.batches.filter(b => b.status === 'refused')
    return (
      <div className="card p-4 space-y-3" data-testid="ed-bulk-result">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Bulk grant — {dateInWords(result.date)}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="text-sm text-slate-700" data-testid="ed-bulk-result-summary">
          {saved.length} of {result.total} batch{result.total === 1 ? '' : 'es'} saved
          {refused.length ? ` · ${refused.length} refused — nothing from ${refused.length === 1 ? 'that batch' : 'those batches'} was saved` : ''}
        </div>
        <ul className="space-y-1.5">
          {result.batches.map(b => (
            <li key={b.index} data-batch-result={b.status} className={clsx('rounded border px-3 py-2 text-sm flex flex-wrap items-center gap-2',
              b.status === 'refused' ? 'border-red-200 bg-red-50' : b.status === 'undone' ? 'border-slate-200 bg-slate-50' : 'border-green-200 bg-green-50')}>
              <span className="font-medium">Batch {b.index + 1} of {result.total}</span>
              {b.status === 'saved' && <>
                <span>saved as #{b.batchId}: {b.counts.created} created{b.counts.updated ? `, ${b.counts.updated} replaced a system entry` : ''}{b.counts.skipped ? `, ${b.counts.skipped} already granted (left as is)` : ''}{b.counts.approved ? ` · ${b.counts.approved} HR-approved` : ''}</span>
                <Button variant="link" tone="red" className="ml-auto" onClick={() => undoOne(b)}>Undo this batch</Button>
              </>}
              {b.status === 'undone' && <span>#{b.batchId} undone</span>}
              {b.status === 'refused' && <>
                <span className="text-red-700">refused ({b.applyCount} people): {b.error}</span>
                <Button variant="secondary" size="sm" className="ml-auto" onClick={() => recheckRefused(b)}>Check these {b.applyCount} again</Button>
              </>}
            </li>
          ))}
        </ul>
        {otherMonth && <div className="text-xs text-amber-700">These grants are in {fmtDate(result.date).slice(3)} — set the month picker to that month to see them in the list.</div>}
      </div>
    )
  }

  const columns = [
    { key: 'rowNo', header: '#', className: 'text-slate-400 w-8', render: r => r.rowNo },
    { key: 'code', header: 'Code', className: 'font-mono', render: r => r.code },
    { key: 'name', header: 'Name', render: r => r.name || '—' },
    { key: 'department', header: 'Dept', className: 'text-slate-500', render: r => r.department || '—' },
    { key: 'company', header: 'Company', className: 'text-slate-500', render: r => r.company || '—' },
    { key: 'duty', header: 'Days', render: r => (r.state === 'ok' || r.state === 'warning')
      ? <select aria-label={`Duty days for ${r.code}`} className="input py-0.5 px-1 text-[11px] w-16" value={String(r.dutyDays)} onChange={e => setRowDuty(r.code, e.target.value)}>
          {DUTY.map(d => <option key={d} value={String(d)}>{d}</option>)}
        </select>
      : <span className="text-slate-400">{r.dutyDays ?? '—'}</span> },
    { key: 'state', header: 'Check', render: r => <span data-row-state={r.state} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', STATE_CLS[r.state])}>{STATE_LABEL[r.state]}</span> },
    { key: 'messages', header: 'Note', className: 'whitespace-normal max-w-[320px]', render: r => <span className="text-slate-600">{r.messages.join('; ')}</span> },
    { key: 'remove', header: '', render: r => <IconButton label={`Remove ${r.code}`} icon="✕" onClick={() => removeCodes([draftCodeFor(r.code)])} /> },
  ]

  const saveDisabledReason = !common.grant_date ? 'Pick the date first'
    : !codes.length ? 'Add people first'
    : !fresh ? 'Checking...'
    : preview?.error ? preview.error
    : counts.error ? `${counts.error} row${counts.error === 1 ? '' : 's'} with problems — fix or leave them out`
    : !applyTotal ? 'Nothing to save — everyone listed is already granted'
    : ''

  return (
    <div className="card p-4 space-y-4" data-testid="ed-bulk-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Bulk extra duty grant</h3>
          <p className="text-xs text-slate-500">Set the grant once, add people, check, save. Company comes from each person's master record.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <DraftRestoredBanner draft={draft} />

      {/* 1 — set once */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">1 · Set once</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="edb-date">Date *</label>
            <input id="edb-date" type="date" className="input w-full" value={common.grant_date} onChange={e => setCommon('grant_date', e.target.value)} />
            {common.grant_date && <div className="text-[11px] text-slate-500 mt-0.5" data-testid="edb-date-words">{dateInWords(common.grant_date)}</div>}
          </div>
          <div><label className="label" htmlFor="edb-type">Type</label>
            <select id="edb-type" className="input w-full" value={common.grant_type} onChange={e => setCommon('grant_type', e.target.value)}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div><label className="label" htmlFor="edb-duty">Duty days (each)</label>
            <select id="edb-duty" className="input w-full" value={String(common.duty_days)} onChange={e => setCommon('duty_days', Number(e.target.value))}>
              {DUTY.map(d => <option key={d} value={String(d)}>{d}</option>)}
            </select></div>
          <div><label className="label" htmlFor="edb-source">Verification source</label>
            <select id="edb-source" className="input w-full" value={common.verification_source} onChange={e => setCommon('verification_source', e.target.value)}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select></div>
          <div><label className="label" htmlFor="edb-ref">Reference #</label>
            <input id="edb-ref" className="input w-full" maxLength={100} value={common.reference_number} onChange={e => setCommon('reference_number', e.target.value)} /></div>
          <div><label className="label" htmlFor="edb-remarks">Remark</label>
            <input id="edb-remarks" className="input w-full" maxLength={500} value={common.remarks} onChange={e => setCommon('remarks', e.target.value)} /></div>
        </div>
      </section>

      {/* 2 — people */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">2 · Add people</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <PeoplePicker employees={employees} value={codes} onChange={setCodes} maxHeight="18rem" />
          </div>
          <div className="space-y-2">
            <CopyFromDate activeCodes={activeCodes} onAdd={(list) => {
              const have = new Set(codes.map(c => c.toLowerCase()))
              setCodes([...codes, ...list.filter(c => !have.has(c.toLowerCase()))])
            }} />
          </div>
        </div>
      </section>

      {/* 3 — check */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
          3 · Check {checking && <span className="normal-case font-normal text-slate-400">checking...</span>}
        </div>
        {!canCheck ? <div className="text-xs text-slate-400">Pick a date and add people to see the check.</div>
          : preview?.error ? <div className="text-sm text-red-700">{preview.error}</div>
          : pv && (
            <>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="edb-chips">
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
                {counts.error > 0 && (
                  <Button variant="secondary" size="sm" className="ml-auto" onClick={() => removeCodes(errorCodes)} data-testid="edb-leave-out">
                    Leave out {counts.error} row{counts.error === 1 ? '' : 's'} with problems
                  </Button>
                )}
              </div>
              <ScrollTable columns={columns} rows={shown} rowKey="rowNo" maxHeight="max-h-[50vh]" testId="edb-preview"
                rowProps={r => ({ 'data-code': r.code, className: r.state === 'error' ? 'bg-red-50/60' : r.state === 'skipped' ? 'bg-slate-50' : '' })}
                emptyText="No rows in this filter" />
            </>
          )}
      </section>

      {/* 4 — save */}
      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center gap-3 rounded-b-xl" data-testid="edb-savebar">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={hrApprove} onChange={e => setHrApprove(e.target.checked)} data-testid="edb-hr-approve" />
          Also approve as HR — they go straight to finance review
        </label>
        <div className="ml-auto flex items-center gap-2">
          {saveDisabledReason && <span className="text-xs text-slate-500" data-testid="edb-save-hint">{saveDisabledReason}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!!saveDisabledReason} busy={saving} busyLabel="Saving..." data-testid="edb-save">
            {applyTotal ? `Save ${applyTotal} grant${applyTotal === 1 ? '' : 's'}${groups.length > 1 ? ` (${groups.length} batches: ${splitLabel(groups)})` : ''}` : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
