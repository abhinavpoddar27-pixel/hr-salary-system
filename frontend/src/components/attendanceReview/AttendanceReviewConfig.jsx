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
  shift_fit_share: 'Shift check: habitual if early on share of days ≥', shift_fit_min_days: 'Shift check: needs worked days of at least',
  shift_fit_grace: 'Full-hours tolerance (minutes; for lates kept below the late threshold)', shift_fit_confirm_share: 'Shift check: flag "check master shift" if short on share ≥',
  odd_punch_minutes: 'Master basis: not assessed if in-punch earlier than start by (minutes)', night_start_minutes: 'Master basis: night on a 12-hour master starts at (minutes after midnight; 1200 = 20:00)',
  stayed_late_minutes: 'Master basis: stayed late if out after shift end by (minutes)',
}
const LISTS = [
  ['loading_designation_patterns', 'Loading staff (no late assessment) — designation contains', 'one pattern per line'],
]
const PERSON_RULE = { exclude: 'Not assessed', early_exempt: 'Early exits not assessed', held: 'Held (no action until a ruling)' }
const blankPerson = () => ({ code: '', rule: 'exclude', reason: '' })
const blankDept = () => ({ department: '', reason: '' })
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
      stayed_late_mode: c.stayed_late_mode, early_exit_rule: c.early_exit_rule, shift_fit: c.shift_fit || 'everyone', late_full_hours: c.late_full_hours !== false,
      assessment_basis: c.assessment_basis || 'import', assess_fixed_miss_punch: c.assess_fixed_miss_punch !== false,
      contract_loaders_early_exempt: c.contract_loaders_early_exempt !== false,
      people: Object.entries(c.standing_people || {}).map(([code, v]) => ({ ...v, code })),
      depts: Object.entries(c.standing_departments || {}).map(([department, v]) => ({ ...v, department })),
      dismissed: c.dismissed_suggestions || {},
      lists: Object.fromEntries(LISTS.map(([k]) => [k, (c[k] || []).join('\n')])),
      remeasure: Object.entries(c.remeasure || {}).map(([code, r]) => ({ code, start: r.start, end: r.end, late_grace: r.late_grace ?? 9, early_grace: r.early_grace ?? 15, left_late: r.left_late || 'system', hours_complete: r.hours_complete === true, hours_grace: r.hours_grace ?? 10 })),
    })
    setEffectiveFrom(thisYm(month, year))
  }, [res, month, year])

  const save = useMutation({
    mutationFn: () => {
      const config = {
        thresholds: form.thresholds, stayed_late_mode: form.stayed_late_mode, early_exit_rule: form.early_exit_rule, shift_fit: form.shift_fit, late_full_hours: !!form.late_full_hours,
        assessment_basis: form.assessment_basis, assess_fixed_miss_punch: !!form.assess_fixed_miss_punch,
        contract_loaders_early_exempt: !!form.contract_loaders_early_exempt,
        // standing rules keep who set them and why; a row edited here keeps its origin fields
        standing_people: Object.fromEntries(form.people.filter((r) => r.code.trim()).map(({ code, ...v }) => [code.trim(), { ...v, reason: String(v.reason || '').trim() }])),
        standing_departments: Object.fromEntries(form.depts.filter((r) => r.department.trim()).map(({ department, ...v }) => [department.trim(), { ...v, rule: 'exclude', reason: String(v.reason || '').trim() }])),
        dismissed_suggestions: form.dismissed,
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
  const setP = (i, k, v) => setForm((f) => ({ ...f, people: f.people.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
  const setD = (i, k, v) => setForm((f) => ({ ...f, depts: f.depts.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))

  return (
    <div className="card p-4 space-y-4" data-testid="ar-config">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-semibold text-slate-700">Rules & exclusions</h4>
        <span className="text-xs text-slate-500">
          {res.source ? `In force for this month: version ${res.source.id}, effective ${res.source.effective_from}, by ${res.source.updated_by}` : 'In force for this month: built-in defaults (no saved version yet)'}
        </span>
      </div>

      <div className="grid xl:grid-cols-2 gap-4" data-testid="ar-standing">
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">People left out — set once, stays until removed</div>
          <table className="text-sm w-full">
            <thead><tr className="text-xs text-slate-500"><th className="text-left pr-2">Code</th><th className="text-left pr-2">Rule</th><th className="text-left pr-2">Reason</th><th /></tr></thead>
            <tbody>
              {form.people.map((r, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1"><input aria-label="Standing person code" className="input w-24 font-mono text-xs" value={r.code} onChange={(e) => setP(i, 'code', e.target.value)} /></td>
                  <td className="pr-2 py-1"><select aria-label="Standing person rule" className="input text-xs" value={r.rule} onChange={(e) => setP(i, 'rule', e.target.value)}>
                    {Object.entries(PERSON_RULE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td className="pr-2 py-1 w-full"><input aria-label="Standing person reason" className="input w-full text-xs" placeholder="e.g. Senior staff" value={r.reason} onChange={(e) => setP(i, 'reason', e.target.value)} /></td>
                  <td><button type="button" className="text-xs text-red-600" onClick={() => setForm((f) => ({ ...f, people: f.people.filter((_, j) => j !== i) }))}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-xs text-blue-600 mt-1" onClick={() => setForm((f) => ({ ...f, people: [...f.people, blankPerson()] }))}>+ add a person</button>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">Crews (departments) left out — e.g. piece-rate loading contractors</div>
          <table className="text-sm w-full">
            <thead><tr className="text-xs text-slate-500"><th className="text-left pr-2">Department (exact name)</th><th className="text-left pr-2">Reason</th><th /></tr></thead>
            <tbody>
              {form.depts.map((r, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1"><input aria-label="Standing department" className="input w-40 text-xs" value={r.department} onChange={(e) => setD(i, 'department', e.target.value)} /></td>
                  <td className="pr-2 py-1 w-full"><input aria-label="Standing department reason" className="input w-full text-xs" placeholder="e.g. Piece-rate loading crew" value={r.reason} onChange={(e) => setD(i, 'reason', e.target.value)} /></td>
                  <td><button type="button" className="text-xs text-red-600" onClick={() => setForm((f) => ({ ...f, depts: f.depts.filter((_, j) => j !== i) }))}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-xs text-blue-600 mt-1" onClick={() => setForm((f) => ({ ...f, depts: [...f.depts, blankDept()] }))}>+ add a crew</button>
          <label className="flex items-start gap-2 text-sm mt-3">
            <input aria-label="Contract loaders early exits not counted" type="checkbox" className="mt-1" checked={!!form.contract_loaders_early_exempt}
              onChange={(e) => setForm((f) => ({ ...f, contract_loaders_early_exempt: e.target.checked }))} />
            <span><span className="text-xs font-semibold text-slate-600">Contractor loaders may leave once dispatch is done</span><br />
              <span className="text-[11px] text-slate-400">Contract workers with a loading designation: early exits not counted (lates never are). Permanent loaders are still assessed.</span></span></label>
        </div>
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
          <label className="block"><span className="text-xs font-semibold text-slate-600">Measure every day against</span>
            <select aria-label="Assessment basis" className="input w-full" value={form.assessment_basis} onChange={(e) => setForm((f) => ({ ...f, assessment_basis: e.target.value }))}>
              <option value="master">Each person's current master shift (recommended)</option>
              <option value="import">The shift the import matched that day (old basis)</option>
            </select>
            <span className="text-[11px] text-slate-400">Master: a wrong master shift is wrong for every month — keep the masters right. People with no master are listed, not assessed.</span></label>
          {form.assessment_basis === 'master' && (
            <label className="flex items-start gap-2 text-sm">
              <input aria-label="Assess fixed miss-punch days" type="checkbox" className="mt-1" checked={!!form.assess_fixed_miss_punch}
                onChange={(e) => setForm((f) => ({ ...f, assess_fixed_miss_punch: e.target.checked }))} />
              <span><span className="text-xs font-semibold text-slate-600">Assess miss-punch days fixed from the gate register</span><br />
                <span className="text-[11px] text-slate-400">Uses the gate-register times. An out written as exactly the shift end is "not verified" and excuses nothing.</span></span></label>
          )}
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
          <label className="flex items-start gap-2 text-sm">
            <input aria-label="Late not counted on a full-hours day" type="checkbox" className="mt-1" checked={!!form.late_full_hours}
              onChange={(e) => setForm((f) => ({ ...f, late_full_hours: e.target.checked }))} />
            <span><span className="text-xs font-semibold text-slate-600">Late not counted on a full-hours day</span><br />
              <span className="text-[11px] text-slate-400">Came late but stayed back and still worked the full shift length → not counted (recommended).</span></span></label>
          <label className="block"><span className="text-xs font-semibold text-slate-600">Early exit not counted on a full-hours day</span>
            <select aria-label="Early-exit shift check" className="input w-full" value={form.shift_fit} onChange={(e) => setForm((f) => ({ ...f, shift_fit: e.target.value }))}>
              <option value="everyone">For everyone (recommended)</option>
              <option value="habitual">Only for people who leave early on most days</option>
              <option value="off">Off — count every early exit</option>
            </select>
            <span className="text-[11px] text-slate-400">Came early and still worked the full shift length → the early exit is not counted.</span></label>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-600 mb-1">Re-measure on a different shift (when the system matched the wrong shift)</div>
        <table className="text-sm">
          <thead><tr className="text-xs text-slate-500"><th className="text-left pr-2">Code</th><th className="text-left pr-2">Start</th><th className="text-left pr-2">End</th>
            <th className="text-left pr-2">Late grace</th><th className="text-left pr-2">Early grace</th><th className="text-left pr-2">Stayed-late exemption</th>
            <th className="text-left pr-2" title="This row's own full-hours rule with its own tolerance. The plant-wide full-hours rules above apply to re-measured people too.">Own full-hours tolerance</th>
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
