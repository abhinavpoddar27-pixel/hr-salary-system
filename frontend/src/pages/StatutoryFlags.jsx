// Statutory Flags — admin upload page (statutory flags PR-1, BUILD_PLAN §4.5).
//
// The ONLY way PF / ESI / LWF flags change (ruling R10). Flow:
//   pick scope + effective month → drop the file → Preview (server plans, writes
//   nothing) → Apply (admin, confirm quoting the counts; the server re-plans
//   inside one transaction and refuses a different file or a re-applied one).
// Batch history lists every apply; each has an undo file (the flags in force at
// the effective month before the batch, in the upload layout). Re-uploading it
// restores those flags onto that month, later rows and the master — not a full
// restore: see UNDO_LIMITS below.
//
// The upload file and the undo file hold names and numbers: they are never
// stored by this page and never belong in the repo.

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useAppStore } from '../store/appStore'
import { normalizeRole } from '../utils/role'
import { statutoryFlagsPreview, statutoryFlagsApply, statutoryFlagsBatches, statutoryFlagsUndoFile } from '../utils/api'

// What re-applying an undo file does (and does not) restore — shown at confirm
// time and under the batch history. Keep in step with buildUndoWorkbook.
const UNDO_LIMITS = 'Undo file: Restores the flags that were in force at the effective month onto that month, later rows and the master. A later-dated row that had different flags before this batch is set to the effective-month value. Added ESI numbers / UANs and the extra structure rows stay.'

const FLAGS = [['esi', 'ESI'], ['pf', 'PF'], ['lwf', 'LWF']]

function defaultMonth() {
  return '2026-09'
}

function FlagCell({ before, after }) {
  if (!before) return <span className="text-slate-400">—</span>
  return (
    <div className="flex gap-1.5">
      {FLAGS.map(([k, label]) => {
        const changed = before[k] !== after[k]
        return (
          <span key={k}
            className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${changed ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : after[k] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'}`}
            title={changed ? `${label}: ${before[k] ? 'Y' : 'N'} → ${after[k] ? 'Y' : 'N'}` : `${label}: ${after[k] ? 'Y' : 'N'}`}>
            {label} {changed ? `${before[k] ? 'Y' : 'N'}→${after[k] ? 'Y' : 'N'}` : (after[k] ? 'Y' : 'N')}
          </span>
        )
      })}
    </div>
  )
}

function Totals({ t }) {
  if (!t) return null
  const items = [
    ['Rows', t.rows], ['Matched', t.matched], ['Unmatched', t.unmatched], ['Errors', t.errors],
    ['Changed', t.changed], ['Unchanged', t.unchanged], ['Numbers added', t.numbersAdded], ['Warnings', t.warnings],
    ['ESI = Y', t.after?.esi], ['PF = Y', t.after?.pf], ['LWF = Y', t.after?.lwf],
  ]
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-2">
      {items.map(([label, v]) => (
        <div key={label} className="card px-3 py-2">
          <div className="text-[11px] text-slate-500">{label}</div>
          <div className="text-lg font-semibold text-slate-800" data-testid={`total-${label}`}>{v ?? 0}</div>
        </div>
      ))}
    </div>
  )
}

export default function StatutoryFlags() {
  const user = useAppStore(s => s.user)
  const isAdmin = normalizeRole(user?.role) === 'admin'

  const [scope, setScope] = useState('plant')
  const [month, setMonth] = useState(defaultMonth())
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewErr, setPreviewErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [changedOnly, setChangedOnly] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [batches, setBatches] = useState([])

  const loadBatches = useCallback(async () => {
    try {
      const r = await statutoryFlagsBatches()
      setBatches(r.data.batches || [])
    } catch (e) { /* page still usable */ }
  }, [])
  useEffect(() => { if (isAdmin) loadBatches() }, [isAdmin, loadBatches])

  // Any change to the inputs invalidates the preview (the apply must match it).
  useEffect(() => { setPreview(null); setPreviewErr(null); setConfirming(false) }, [scope, month, file])

  const rows = useMemo(() => {
    const all = preview?.rows || []
    return changedOnly ? all.filter(r => r.changed || r.error || (r.warnings && r.warnings.length)) : all
  }, [preview, changedOnly])

  if (!isAdmin) {
    return <div className="p-4 md:p-6"><div className="card p-6 text-slate-600">Statutory flags can be changed by an admin only.</div></div>
  }

  const doPreview = async () => {
    if (!file) return
    setBusy(true); setPreviewErr(null)
    try {
      const r = await statutoryFlagsPreview(file, scope, month)
      setPreview(r.data)
    } catch (e) {
      const b = e?.response?.data
      setPreviewErr({ error: b?.error || e.message, errors: b?.errors || [] })
      setPreview(null)
    } finally { setBusy(false) }
  }

  const doApply = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await statutoryFlagsApply(file, scope, month, preview.sha256)
      const c = r.data.summary?.counts || {}
      toast.success(`Batch ${r.data.batchId} applied — ${c.employees || 0} employees changed`)
      setConfirming(false); setPreview(null); setFile(null)
      loadBatches()
    } catch (e) {
      const b = e?.response?.data
      toast.error(b?.error || e.message)
      if (b?.blocking?.length) setPreviewErr({ error: b.error, errors: b.blocking })
    } finally { setBusy(false) }
  }

  const downloadUndo = async (b) => {
    try {
      const r = await statutoryFlagsUndoFile(b.id)
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `statutory_flags_undo_${b.scope}_${b.effective_month}_batch${b.id}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.error(e?.response?.status === 409 ? 'Nothing to undo for this batch' : 'Could not download the undo file')
    }
  }

  const t = preview?.totals

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="statutory-flags-page">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Statutory Flags (PF / ESI / LWF)</h1>
        <p className="text-sm text-slate-500 mt-1">
          The only place these flags change. The file applies from the effective month onward; earlier months keep the flags they were computed with.
          Nothing recomputes automatically — run Stage 7 / sales compute afterwards.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="text-slate-500 mb-1">Scope</div>
          <select className="input" value={scope} onChange={e => setScope(e.target.value)} data-testid="scope">
            <option value="plant">Plant</option>
            <option value="sales">Sales</option>
          </select>
        </label>
        <label className="text-sm">
          <div className="text-slate-500 mb-1">Effective month</div>
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} data-testid="month" />
        </label>
        <label className="text-sm flex-1 min-w-[16rem]">
          <div className="text-slate-500 mb-1">File (.xlsx, .xls or .csv, max 2 MB)</div>
          <input type="file" accept=".xlsx,.xls,.csv" className="input w-full" data-testid="file"
            onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        <button className="btn-secondary" onClick={doPreview} disabled={!file || busy} data-testid="preview-btn">
          {busy && !confirming ? 'Working…' : 'Preview'}
        </button>
        <button className="btn-primary" onClick={() => setConfirming(true)} disabled={!preview?.canApply || busy} data-testid="apply-btn">
          Apply
        </button>
      </div>

      <div className="text-xs text-slate-500">
        Plant columns: <span className="font-mono">code, name, type, esi_applicable, pf_applicable, lwf_applicable, esi_number, uan, note</span>.
        Sales columns: <span className="font-mono">code, company, name, esi_applicable, pf_applicable, lwf_applicable, esi_number, uan, note</span>.
        Y / N. A blank number means "leave unchanged".
      </div>

      {previewErr && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800" data-testid="preview-error">
          <div className="font-semibold">{previewErr.error}</div>
          {previewErr.errors?.length > 0 && <ul className="list-disc ml-5 mt-1">{previewErr.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <Totals t={t} />
          {preview.blocking?.length > 0 && (
            <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800" data-testid="blocking">
              <div className="font-semibold">This file cannot be applied — nothing will be written:</div>
              <ul className="list-disc ml-5 mt-1">{preview.blocking.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}
          {preview.alreadyAppliedBatchId && (
            <div className="card p-3 border-amber-200 bg-amber-50 text-sm text-amber-800">
              This exact file was already applied for {preview.scope} {preview.effectiveMonth} (batch {preview.alreadyAppliedBatchId}).
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              {preview.fileName} · effective {preview.effectiveMonth} (rows from <span className="font-mono">{preview.keys?.E}</span>; earlier months frozen at <span className="font-mono">{preview.keys?.S}</span>)
            </div>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} data-testid="changed-only" />
              Changed / warnings / errors only
            </label>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Code</th>
                  {scope === 'sales' && <th className="text-left px-3 py-2">Company</th>}
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Flags (master → file)</th>
                  <th className="text-left px-3 py-2">Numbers</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.line}-${r.code}`} className="border-t border-slate-100 align-top" data-testid="preview-row">
                    <td className="px-3 py-2 font-mono">{r.code}</td>
                    {scope === 'sales' && <td className="px-3 py-2 text-xs">{r.company}</td>}
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-3 py-2"><FlagCell before={r.before} after={r.after} /></td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {r.numbers?.esi_number && <div>ESI → {r.numbers.esi_number}</div>}
                      {r.numbers?.uan && <div>UAN → {r.numbers.uan}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.error
                        ? <span className="text-red-700">{r.error}</span>
                        : r.changed ? <span className="text-amber-700">changes</span> : <span className="text-slate-400">no change</span>}
                      {r.warnings?.map((w, i) => <div key={i} className="text-amber-700">⚠ {w}</div>)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Nothing to show</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirming && preview && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" data-testid="confirm">
          <div className="card bg-white p-5 max-w-lg w-full space-y-3">
            <div className="text-lg font-semibold">Apply statutory flags?</div>
            <div className="text-sm text-slate-700">
              {preview.scope === 'plant' ? 'Plant' : 'Sales'}, effective <b>{preview.effectiveMonth}</b>:
              {' '}<b>{t.changed}</b> employees change ({t.flagChanged} flag, {t.numbersAdded} numbers),
              {' '}{t.unchanged} unchanged, {t.errors} rows skipped with an error.
              After the apply: ESI {t.after.esi} · PF {t.after.pf} · LWF {t.after.lwf}.
            </div>
            <div className="text-xs text-slate-600" data-testid="planned-rows">
              Structure rows: {t.freezeRows} freeze + {t.effectiveRows} effective inserted,
              {' '}{t.rowsUpdatedAtE} updated at {preview.keys?.E}, {t.laterRowsUpdated} later rows updated.
            </div>
            <div className="text-xs text-slate-500">
              Earlier months are frozen and do not change. {UNDO_LIMITS}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={doApply} disabled={busy} data-testid="confirm-apply">{busy ? 'Applying…' : `Apply to ${t.changed} employees`}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-medium text-slate-700">Batch history</div>
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Batch</th><th className="text-left px-3 py-2">Scope</th>
              <th className="text-left px-3 py-2">Month</th><th className="text-left px-3 py-2">File</th>
              <th className="text-right px-3 py-2">Rows</th><th className="text-right px-3 py-2">Changed</th>
              <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">By / at</th><th />
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id} className="border-t border-slate-100" data-testid="batch-row">
                <td className="px-3 py-2 font-mono">{b.id}</td>
                <td className="px-3 py-2">{b.scope}</td>
                <td className="px-3 py-2">{b.effective_month}</td>
                <td className="px-3 py-2 text-xs">{b.file_name}</td>
                <td className="px-3 py-2 text-right">{b.row_count}</td>
                <td className="px-3 py-2 text-right">{b.changed_count}</td>
                <td className="px-3 py-2">{b.status}</td>
                <td className="px-3 py-2 text-xs">{b.applied_by} · {b.applied_at}</td>
                <td className="px-3 py-2 text-right">
                  {b.status === 'applied' && <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => downloadUndo(b)}>Undo file</button>}
                </td>
              </tr>
            ))}
            {batches.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No batches yet</td></tr>}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-500" data-testid="undo-limits">{UNDO_LIMITS}</div>
      </div>
    </div>
  )
}
