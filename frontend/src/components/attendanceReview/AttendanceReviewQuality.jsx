import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { attendanceReviewQuality, attendanceReviewFinalise } from '../../utils/api'
import Modal, { ModalBody, ModalFooter } from '../ui/Modal'

/**
 * PR-4 — "Before you finalise": the data-quality check of the SAVED draft (server: qualityGate).
 *  stop  → Finalise refused (rules changed since the draft — regenerate)
 *  check → Finalise needs a typed reason, recorded with the run
 *  note  → shown only
 * Exports the panel and the finalise window; the tab owns the Finalise button.
 */

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const ist = (t) => { if (!t) return ''; const d = new Date(`${String(t).replace(' ', 'T')}Z`); return isNaN(d) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST' }
const LEVEL = {
  stop: { label: 'Must fix', box: 'border-red-200 bg-red-50', chip: 'bg-red-100 text-red-700' },
  check: { label: 'Check', box: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-800' },
  note: { label: 'Note', box: 'border-slate-200 bg-slate-50', chip: 'bg-slate-200 text-slate-700' },
}

export function useQualityGate(runId, generatedAt) {
  return useQuery({ queryKey: ['ar-quality', runId, generatedAt], queryFn: () => attendanceReviewQuality(runId), enabled: !!runId, retry: 0 })
}

function People({ item }) {
  const ps = item.people || []
  if (!ps.length) return null
  const money = ps.some((p) => p.deduction_days != null)
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs bg-white rounded">
        <thead><tr className="text-left text-slate-500">
          <th className="px-2 py-1">Code</th><th className="px-2 py-1">Name</th>
          {money && <><th className="px-2 py-1 text-right">Days</th><th className="px-2 py-1 text-right">Indicative</th></>}
          <th className="px-2 py-1">Why / detail</th>
        </tr></thead>
        <tbody>
          {ps.map((p) => (
            <tr key={p.code} className="border-t border-slate-100 align-top" data-testid={`ar-q-${item.key}-${p.code}`}>
              <td className="px-2 py-1 font-mono">{p.code}</td>
              <td className="px-2 py-1">{p.name || ''}</td>
              {money && <><td className="px-2 py-1 text-right">{p.deduction_days}</td><td className="px-2 py-1 text-right">{inr(p.indicative_amount)}</td></>}
              <td className="px-2 py-1 text-slate-600">
                {p.why ? <ul className="list-disc pl-4">{p.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  : p.evidence ? p.evidence
                    : p.days != null ? <>{p.days} day(s){p.reasons ? ` — ${p.reasons.join(', ').replace(/_/g, ' ')}` : ''}{p.listed ? ' · on the list' : ''}</> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Item({ item }) {
  const lv = LEVEL[item.level]
  const [open, setOpen] = useState(item.level !== 'note')
  return (
    <div className={clsx('rounded border p-3', lv.box)} data-testid={`ar-q-item-${item.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx('text-[11px] font-semibold px-2 py-0.5 rounded-full', lv.chip)}>{lv.label}</span>
        <span className="font-medium text-sm text-slate-800">{item.title}</span>
        {(item.people || []).length > 0 && (
          <button type="button" className="text-xs text-blue-700 underline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide people' : `Show ${item.people.length}`}</button>
        )}
      </div>
      <p className="text-xs text-slate-600 mt-1">{item.detail}</p>
      {open && <People item={item} />}
    </div>
  )
}

/** The panel shown under the control bar for a saved run. */
export function QualityPanel({ q, isFinal }) {
  const g = q.data?.data?.data
  if (q.isLoading) return <div className="card p-4 text-sm text-slate-500">Checking the saved draft…</div>
  if (q.isError || !g) return <div className="card p-4 text-sm text-red-600">Couldn't check the saved draft. Reload to try again.</div>
  const ack = g.acknowledged
  if (isFinal) {
    if (!ack) return null
    return (
      <div className="card p-4 text-sm" data-testid="ar-quality-ack">
        <div className="font-semibold text-slate-800">Finalised past {ack.checks.length} check(s)</div>
        <div className="text-xs text-slate-600 mt-1">{ack.checks.map((c) => c.title).join(' · ')}</div>
        <div className="text-xs text-slate-700 mt-1">Reason: “{ack.reason}” — {ack.by}, {ist(ack.at)}</div>
      </div>
    )
  }
  return (
    <div className="card p-4 space-y-2" data-testid="ar-quality">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold text-slate-800">Before you finalise</div>
        <span className="text-xs text-slate-500">— checks of the saved draft</span>
        <div className="flex-1" />
        {g.ok && !g.notes.length && <span className="text-xs font-semibold text-emerald-700" data-testid="ar-quality-ok">Nothing to check</span>}
        {g.stops.length > 0 && <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', LEVEL.stop.chip)}>{g.stops.length} must fix</span>}
        {g.checks.length > 0 && <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', LEVEL.check.chip)}>{g.checks.length} to check</span>}
        {g.notes.length > 0 && <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', LEVEL.note.chip)}>{g.notes.length} note(s)</span>}
      </div>
      {g.items.map((it) => <Item key={it.key} item={it} />)}
    </div>
  )
}

/** The finalise window: lists the checks and asks for a reason when there are any. */
export function FinaliseDialog({ open, onClose, runId, label, q }) {
  const qc = useQueryClient()
  const g = q.data?.data?.data
  const min = g?.reason_min || 10
  const [reason, setReason] = useState('')
  const busy = useRef(false)
  useEffect(() => { if (open) setReason('') }, [open])
  const fin = useMutation({
    mutationFn: () => attendanceReviewFinalise(runId, g && g.checks.length ? reason.trim() : undefined),
    onSuccess: () => {
      toast.success('Review finalised and locked')
      qc.invalidateQueries({ queryKey: ['ar-runs'] }); qc.invalidateQueries({ queryKey: ['ar-finance'] }); qc.invalidateQueries({ queryKey: ['ar-quality'] })
      onClose()
    },
    onError: () => { qc.invalidateQueries({ queryKey: ['ar-quality'] }) },
    onSettled: () => { busy.current = false },
  })
  if (!open) return null
  const stops = g?.stops || []; const checks = g?.checks || []
  const ok = !!g && !stops.length && (!checks.length || reason.trim().length >= min)
  const submit = () => { if (!ok || busy.current) return; busy.current = true; fin.mutate() }
  return (
    <Modal open={open} onClose={fin.isPending ? undefined : onClose} title={`Finalise the ${label} review?`} size="lg">
      <ModalBody>
        <div className="space-y-3 text-sm" data-testid="ar-finalise-dialog">
          {!g && <p className="text-slate-500">Checking the saved draft…</p>}
          {stops.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <div className="font-semibold text-red-700">This draft can't be finalised yet</div>
              <ul className="list-disc pl-5 text-red-700 mt-1">{stops.map((s) => <li key={s.key}>{s.title} — {s.detail}</li>)}</ul>
            </div>
          )}
          {!stops.length && checks.length > 0 && (
            <>
              <p className="text-slate-700">Look at these first. Fix them and regenerate, or give the reason the review stands as it is. The reason is kept with the run.</p>
              <ul className="list-disc pl-5 text-amber-800">
                {checks.map((c) => <li key={c.key}>{c.title}{c.people ? ` (${c.people.map((p) => p.code).join(', ')})` : ''}</li>)}
              </ul>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Reason (at least {min} characters)</span>
                <textarea className="input w-full mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={fin.isPending}
                  aria-label="Reason to finalise" placeholder="e.g. Night master fixed from October; September checked person by person" />
                <span className={clsx('text-xs', reason.trim().length >= min ? 'text-emerald-700' : 'text-slate-500')}>{reason.trim().length} / {min}</span>
              </label>
            </>
          )}
          {g && !stops.length && !checks.length && <p className="text-slate-700">Nothing to check. Once finalised the review is locked and can't be changed.</p>}
          {g && !stops.length && <p className="text-xs text-slate-500">Finalising locks the review. Deductions go to finance only when you press "Send to finance".</p>}
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={fin.isPending}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!ok || fin.isPending} data-testid="ar-finalise-confirm">
          {fin.isPending ? 'Finalising…' : checks.length && !stops.length ? 'Finalise anyway' : 'Finalise'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
