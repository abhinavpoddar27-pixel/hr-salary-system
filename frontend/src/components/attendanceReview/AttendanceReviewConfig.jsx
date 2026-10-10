import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { attendanceReviewConfig, attendanceReviewSaveConfig } from '../../utils/api'

/**
 * Rules & exclusions for the Attendance Review (admin only). Saves a NEW dated version
 * (effective from a month); earlier months keep the version that applied to them.
 * Employee codes live only here (database), never in source — the repo is public.
 */

const THRESHOLD_LABELS = {
  late_min_minutes: 'Late from (minutes late)', misread_minutes: 'Ignore readings from (minutes, misread)',
  early_min_exclusive: 'Early exit over (minutes)', early_max_exclusive: 'Early exit under (minutes)',
  early_weekdays_only: 'Early exits Mon–Sat only', release_day_share: 'Release day: share leaving early above',
  regular_count: 'Regular: lates or early exits from', regular_min_worked: 'Regular: with worked days from',
  double_late: 'Double: lates from', double_early: 'Double: early exits from',
  act_workdays: 'Early-regular / double need workdays lost of', improved_ratio: 'Improved if this month ≤ (× last month)',
  newcomer_min_prev_days: 'Newcomer if last month worked days under', notice_late: 'Late notice from (lates)',
  notice_early: 'Early notice from (exits)', early_warning_min: 'Early-exit warning from (exits)',
  rounding_step: 'Deduction rounded to (days)', min_deduction: 'Minimum deduction (days)',
  option_c_long_minutes: 'Option C: long exit from (minutes)', option_c_short_per_half: 'Option C: short exits per ½ day',
  default_shift_hours: 'Shift hours when unknown', stayed_late_lookback_days: 'Stayed-late look-back (days before last month)',
}
const LISTS = [
  ['excluded_codes', 'Left out of everything — employee codes', 'e.g. senior staff; data errors until fixed'],
  ['excluded_departments', 'Left out of everything — departments', 'e.g. piece-rate contractor departments (exact name)'],
  ['early_excluded_codes', 'Early exits not assessed — codes', 'wrong shift in the master; remove once fixed'],
  ['held_codes', 'Held — listed, no action — codes', 'waiting for a ruling'],
  ['loading_designation_patterns', 'Loading staff (no late assessment) — designation contains', 'one pattern per line'],
]
const toList = (s) => [...new Set(String(s).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))]
const ist = (t) => { if (!t) return ''; const d = new Date(`${String(t).replace(' ', 'T')}Z`); return isNaN(d) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST' }
const thisYm = (m, y) => `${y}-${String(m).padStart(2, '0')}`

export default function AttendanceReviewConfig({ month, year }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ar-config', month, year], queryFn: () => attendanceReviewConfig(month, year), retry: 0 })
  const res = q.data?.data?.data
  const [form, setForm] = useState(null)
  const [effectiveFrom, setEffectiveFrom] = useState(thisYm(month, year))

  useEffect(() => {
    if (!res) return
    const c = res.config
    setForm({
      thresholds: { ...c.thresholds },
      stayed_late_mode: c.stayed_late_mode, early_exit_rule: c.early_exit_rule,
      lists: Object.fromEntries(LISTS.map(([k]) => [k, (c[k] || []).join('\n')])),
      remeasure: Object.entries(c.remeasure || {}).map(([code, r]) => ({ code, start: r.start, end: r.end, late_grace: r.late_grace ?? 9, early_grace: r.early_grace ?? 15, left_late: r.left_late || 'system', hours_complete: r.hours_complete === true, hours_grace: r.hours_grace ?? 10 })),
    })
    setEffectiveFrom(thisYm(month, year))
  }, [res, month, year])

  const save = useMutation({
    mutationFn: () => {
      const config = {
        thresholds: form.thresholds, stayed_late_mode: form.stayed_late_mode, early_exit_rule: form.early_exit_rule,
        ...Object.fromEntries(LISTS.map(([k]) => [k, toList(form.lists[k])])),
        remeasure: Object.fromEntries(form.remeasure.filter((r) => r.code.trim()).map((r) => [r.code.trim(), {
          start: r.start, end: r.end, late_grace: Number(r.late_grace), early_grace: Number(r.early_grace), left_late: r.left_late,
          hours_complete: !!r.hours_complete, hours_grace: Number(r.hours_grace) }])),
      }
      return attendanceReviewSaveConfig(effectiveFrom, config)
    },
    onSuccess: () => {
      toast.success(`Rules saved, effective from ${effectiveFrom}`)
      qc.invalidateQueries({ queryKey: ['ar-config'] }); qc.invalidateQueries({ queryKey: ['ar-preview'] })
    },
    onError: (e) => { const d = e.response?.data?.details; if (d?.length) toast.error(d.join('\n'), { duration: 8000 }) },
  })

  if (q.isLoading || !form) return <div className="card p-4 text-sm text-slate-500">Loading rules…</div>
  const setT = (k, v) => setForm((f) => ({ ...f, thresholds: { ...f.thresholds, [k]: v } }))
  const setRm = (i, k, v) => setForm((f) => ({ ...f, remeasure: f.remeasure.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))

  return (
    <div className="card p-4 space-y-4" data-testid="ar-config">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-semibold text-slate-700">Rules & exclusions</h4>
        <span className="text-xs text-slate-500">
          {res.source ? `In force for this month: version ${res.source.id}, effective ${res.source.effective_from}, by ${res.source.updated_by}` : 'In force for this month: built-in defaults (no saved version yet)'}
        </span>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {LISTS.map(([k, label, hint]) => (
          <label key={k} className="block">
            <span className="text-xs font-semibold text-slate-600">{label}</span>
            <textarea aria-label={label} className="input w-full h-24 font-mono text-xs" value={form.lists[k]}
              onChange={(e) => setForm((f) => ({ ...f, lists: { ...f.lists, [k]: e.target.value } }))} />
            <span className="text-[11px] text-slate-400">{hint} — one per line or comma separated</span>
          </label>
        ))}
        <div className="space-y-3">
          <label className="block"><span className="text-xs font-semibold text-slate-600">Stayed-late exemption uses</span>
            <select aria-label="Stayed-late exemption" className="input w-full" value={form.stayed_late_mode} onChange={(e) => setForm((f) => ({ ...f, stayed_late_mode: e.target.value }))}>
              <option value="either">Previous worked day OR previous calendar day</option>
              <option value="worked">Previous worked day only</option>
              <option value="calendar">Previous calendar day only</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-slate-600">Early-exit rule</span>
            <select aria-label="Early-exit rule" className="input w-full" value={form.early_exit_rule} onChange={(e) => setForm((f) => ({ ...f, early_exit_rule: e.target.value }))}>
              <option value="warning">Warning only (current)</option>
              <option value="option_c">Option C deduction (½ day per exit of 1 h+, ½ day per 3 shorter)</option>
            </select></label>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-600 mb-1">Re-measure on a different shift (when the system matched the wrong shift)</div>
        <table className="text-sm">
          <thead><tr className="text-xs text-slate-500"><th className="text-left pr-2">Code</th><th className="text-left pr-2">Start</th><th className="text-left pr-2">End</th>
            <th className="text-left pr-2">Late grace</th><th className="text-left pr-2">Early grace</th><th className="text-left pr-2">Stayed-late exemption</th>
            <th className="text-left pr-2" title="A late or early exit is not counted on a day the person still worked the full shift length (in to out)">Full hours excuse</th>
            <th className="text-left pr-2">Tolerance (min)</th><th /></tr></thead>
          <tbody>
            {form.remeasure.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 py-1"><input aria-label="Re-measure code" className="input w-24" value={r.code} onChange={(e) => setRm(i, 'code', e.target.value)} /></td>
                <td className="pr-2"><input aria-label="Re-measure start" type="time" className="input w-28" value={r.start} onChange={(e) => setRm(i, 'start', e.target.value)} /></td>
                <td className="pr-2"><input aria-label="Re-measure end" type="time" className="input w-28" value={r.end} onChange={(e) => setRm(i, 'end', e.target.value)} /></td>
                <td className="pr-2"><input aria-label="Late grace" type="number" min="0" className="input w-20" value={r.late_grace} onChange={(e) => setRm(i, 'late_grace', e.target.value)} /></td>
                <td className="pr-2"><input aria-label="Early grace" type="number" min="0" className="input w-20" value={r.early_grace} onChange={(e) => setRm(i, 'early_grace', e.target.value)} /></td>
                <td className="pr-2"><select aria-label="Re-measure stayed-late" className="input" value={r.left_late} onChange={(e) => setRm(i, 'left_late', e.target.value)}>
                  <option value="system">System flag</option><option value="shift">Measured on this shift</option><option value="off">No exemption</option></select></td>
                <td className="pr-2 text-center"><input aria-label="Full hours excuse" type="checkbox" checked={!!r.hours_complete} onChange={(e) => setRm(i, 'hours_complete', e.target.checked)} /></td>
                <td className="pr-2"><input aria-label="Full hours tolerance" type="number" min="0" max="120" className="input w-20" disabled={!r.hours_complete} value={r.hours_grace} onChange={(e) => setRm(i, 'hours_grace', e.target.value)} /></td>
                <td><button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setForm((f) => ({ ...f, remeasure: f.remeasure.filter((_, j) => j !== i) }))}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="text-xs text-blue-600 hover:underline mt-1"
          onClick={() => setForm((f) => ({ ...f, remeasure: [...f.remeasure, { code: '', start: '09:00', end: '18:00', late_grace: 9, early_grace: 15, left_late: 'system', hours_complete: false, hours_grace: 10 }] }))}>+ add re-measure</button>
        <div className="text-[11px] text-slate-400 mt-1">Full hours excuse: a late arrival or early exit is not counted on a day the person still worked the whole shift length (half for a half day), less the tolerance.</div>
      </div>

      <details>
        <summary className="text-xs font-semibold text-slate-600 cursor-pointer">Thresholds (change only on a ruling)</summary>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2 mt-2">
          {Object.entries(form.thresholds).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">{THRESHOLD_LABELS[k] || k}{res.defaults?.thresholds?.[k] !== v && <span className="text-amber-600"> *</span>}</span>
              {typeof v === 'boolean'
                ? <input aria-label={k} type="checkbox" checked={v} onChange={(e) => setT(k, e.target.checked)} />
                : <input aria-label={k} type="number" step="any" min="0" className="input w-24 text-right" value={v} onChange={(e) => setT(k, e.target.value === '' ? '' : Number(e.target.value))} />}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">* differs from the built-in default.</p>
      </details>

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
        <label className="text-sm">Effective from{' '}
          <input aria-label="Effective from" type="month" className="input w-40" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
        <button type="button" className="btn-primary" disabled={save.isPending || !/^\d{4}-\d{2}$/.test(effectiveFrom)} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save as new version'}
        </button>
        <span className="text-xs text-slate-500">Drafts are not changed until you regenerate them. Final reviews never change.</span>
      </div>

      {res.history?.length > 0 && (
        <div className="text-xs text-slate-500">History: {res.history.map((h) => `v${h.id} from ${h.effective_from} (${h.updated_by}, ${ist(h.updated_at)})`).join(' · ')}</div>
      )}
    </div>
  )
}
