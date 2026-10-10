import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  attendanceReviewPreview, attendanceReviewRuns, attendanceReviewRun,
  attendanceReviewGenerate, attendanceReviewFinalise,
} from '../../utils/api'
import AttendanceReviewConfig from './AttendanceReviewConfig'

/**
 * Analytics → Attendance Review (admin only).
 * Shows the month's saved run (draft or final) when one exists, otherwise a live preview.
 * The admin confirms release days, adds overrides with a reason, generates / regenerates a draft and finalises it.
 * Read-only on payroll: nothing here deducts salary (write-back is a later, gated PR).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
const CAT_LABEL = { late_regular: 'Regular late', early_regular: 'Regular early exit', double: 'Double defaulter' }
const OV_LABEL = { include: 'Add to list', exclude: 'Remove from list', warning: 'Warning only' }
// Server timestamps are UTC 'YYYY-MM-DD HH:MM:SS'; show them in IST.
const ist = (t) => { if (!t) return ''; const d = new Date(`${String(t).replace(' ', 'T')}Z`); return isNaN(d) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST' }
const fmtDay = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]})` }

function Section({ title, count, defaultOpen = true, children, note }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden" data-section={title}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full card-header flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
        <h4 className="font-semibold text-slate-700 flex items-center gap-2">
          <span className={clsx('text-xs transition-transform', open && 'rotate-90')}>▶</span>
          {title}
          {count != null && <span className="ml-1 bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5 rounded-full font-bold">{count}</span>}
        </h4>
        <span className="text-xs text-slate-400">{open ? 'collapse' : 'expand'}</span>
      </button>
      {open && (
        <div>
          {note && <p className="px-4 pt-3 text-xs text-slate-500">{note}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

function Table({ cols, rows, empty = 'None this month.', rowClass }) {
  if (!rows?.length) return <p className="px-4 py-4 text-sm text-slate-400">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
          {cols.map((c) => <th key={c.k} className={clsx('px-3 py-2 font-medium whitespace-nowrap', c.right ? 'text-right' : 'text-left')}>{c.h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code ? `${r.code}-${i}` : i} className={clsx('border-t border-slate-100', rowClass?.(r))}>
              {cols.map((c) => <td key={c.k} className={clsx('px-3 py-1.5 whitespace-nowrap', c.right && 'text-right tabular-nums')}>{c.v ? c.v(r) : r[c.k]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, sub, tone = 'slate' }) {
  const tones = { slate: 'text-slate-800', red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', blue: 'text-blue-700' }
  return (
    <div className="card p-3">
      <div className={clsx('text-xl font-bold tabular-nums', tones[tone])}>{value}</div>
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function OverridesEditor({ value, onChange, disabled }) {
  const [code, setCode] = useState(''); const [action, setAction] = useState('warning'); const [reason, setReason] = useState('')
  const add = () => {
    const c = code.trim()
    if (!c) return toast.error('Enter an employee code')
    if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
    if (value.some((o) => o.code === c)) return toast.error(`${c} already has an override`)
    onChange([...value, { code: c, action, reason: reason.trim() }]); setCode(''); setReason('')
  }
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((o) => (
            <li key={o.code} className="flex items-center gap-2 text-sm bg-slate-50 rounded px-2 py-1">
              <span className="font-mono">{o.code}</span><span className="text-slate-500">→ {OV_LABEL[o.action]}</span>
              <span className="text-slate-600 truncate flex-1">“{o.reason}”</span>
              {!disabled && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange(value.filter((x) => x.code !== o.code))}>remove</button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Override code" className="input w-28" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <select aria-label="Override action" className="input w-40" value={action} onChange={(e) => setAction(e.target.value)}>
            {Object.entries(OV_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input aria-label="Override reason" className="input flex-1 min-w-[12rem]" placeholder="Reason (shown in the report)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn-secondary" onClick={add}>Add override</button>
        </div>
      )}
    </div>
  )
}

function TrendBlock({ trend, ym, prevYm }) {
  const m = trend?.monthly || {}
  const rows = ['Company', 'Contract', 'All'].map((g) => ({ g, p: m[prevYm]?.[g] || {}, c: m[ym]?.[g] || {} }))
  const weekly = useMemo(() => {
    const by = new Map()
    for (const w of trend?.weekly || []) {
      const r = by.get(w.week_start) || { week: w.week_start.slice(5) }
      r[`${w.group} late %`] = w.late_pct; r[`${w.group} early %`] = w.early_pct
      by.set(w.week_start, r)
    }
    return [...by.values()]
  }, [trend])
  const arrow = (a, b) => (b == null || a == null ? '' : b < a ? '▼' : b > a ? '▲' : '=')
  return (
    <div className="grid lg:grid-cols-2 gap-4 p-4">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-slate-500 uppercase"><th className="text-left py-1">Group</th>
          <th className="text-right">Late % {prevYm.slice(5)}</th><th className="text-right">Late % {ym.slice(5)}</th>
          <th className="text-right">Early % {prevYm.slice(5)}</th><th className="text-right">Early % {ym.slice(5)}</th>
          <th className="text-right">Time lost %</th></tr></thead>
        <tbody>{rows.map(({ g, p, c }) => (
          <tr key={g} className="border-t border-slate-100">
            <td className="py-1 font-medium">{g}</td>
            <td className="text-right tabular-nums">{num(p.late_pct, 1)}</td>
            <td className={clsx('text-right tabular-nums', c.late_pct < p.late_pct ? 'text-emerald-700' : c.late_pct > p.late_pct ? 'text-red-700' : '')}>{num(c.late_pct, 1)} {arrow(p.late_pct, c.late_pct)}</td>
            <td className="text-right tabular-nums">{num(p.early_pct, 1)}</td>
            <td className={clsx('text-right tabular-nums', c.early_pct < p.early_pct ? 'text-emerald-700' : c.early_pct > p.early_pct ? 'text-red-700' : '')}>{num(c.early_pct, 1)} {arrow(p.early_pct, c.early_pct)}</td>
            <td className="text-right tabular-nums">{num(c.time_lost_pct, 1)}</td>
          </tr>))}
        </tbody>
      </table>
      <div className="h-56" aria-label="Weekly late and early-exit percentage">
        {weekly.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekly} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="linear" dataKey="Company late %" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="linear" dataKey="Company early %" stroke="#d97706" strokeWidth={2} dot={false} />
              <Line type="linear" dataKey="Contract late %" stroke="#2563eb" strokeDasharray="4 3" dot={false} />
              <Line type="linear" dataKey="Contract early %" stroke="#d97706" strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-slate-400">No weekly data.</p>}
      </div>
    </div>
  )
}

export default function AttendanceReviewTab({ selectedMonth, selectedYear }) {
  const qc = useQueryClient()
  const month = Number(selectedMonth); const year = Number(selectedYear)
  const ym = `${year}-${String(month).padStart(2, '0')}`
  const [showConfig, setShowConfig] = useState(false)

  const runsQ = useQuery({ queryKey: ['ar-runs'], queryFn: attendanceReviewRuns, retry: 0 })
  const runMeta = (runsQ.data?.data?.data || []).find((r) => r.month === month && r.year === year) || null
  const runQ = useQuery({ queryKey: ['ar-run', runMeta?.id, runMeta?.generated_at, runMeta?.status], queryFn: () => attendanceReviewRun(runMeta.id), enabled: !!runMeta, retry: 0 })
  const run = runQ.data?.data?.data || null

  // Release days + overrides being edited (seeded from the saved run, else from the preview's detection).
  const [releaseDays, setReleaseDays] = useState(null)
  const [overrides, setOverrides] = useState([])
  useEffect(() => { setReleaseDays(null); setOverrides([]) }, [month, year])
  useEffect(() => { if (run) { setReleaseDays(run.release_days || []); setOverrides(run.overrides || []) } }, [run?.id, run?.generated_at])

  const previewDays = releaseDays || []
  const previewQ = useQuery({
    queryKey: ['ar-preview', month, year, previewDays.join(','), JSON.stringify(overrides)],
    queryFn: () => attendanceReviewPreview(month, year, previewDays, overrides),
    // Wait for the runs list so a FINAL month never computes a preview it will not show.
    enabled: !!month && !!year && runsQ.isSuccess && (!runMeta || runMeta.status === 'draft'),
    retry: 0,
  })
  const preview = previewQ.data?.data?.data || null

  // First preview of a month with no run: tick the detected release days so the admin only has to confirm.
  useEffect(() => {
    if (releaseDays === null && !runMeta && preview?.releaseDaysDetected && !runsQ.isLoading) {
      const det = preview.releaseDaysDetected.map((d) => d.date)
      if (det.length) setReleaseDays(det); else setReleaseDays([])
    }
  }, [preview, runMeta, releaseDays, runsQ.isLoading])

  const isFinal = runMeta?.status === 'final'
  const runMatchesEdits = run && JSON.stringify(run.release_days || []) === JSON.stringify(previewDays) && JSON.stringify(run.overrides || []) === JSON.stringify(overrides)
  // What the page shows: a final run as stored; a draft as stored unless the admin has changed release days (then the live preview).
  const data = isFinal ? run?.result : (run && runMatchesEdits ? run.result : preview)
  const showingStored = !!(run && (isFinal || runMatchesEdits))

  const gen = useMutation({
    mutationFn: () => attendanceReviewGenerate({ month, year, releaseDays: previewDays, overrides }),
    onSuccess: (r) => { toast.success(r.status === 201 ? 'Draft created' : 'Draft regenerated'); qc.invalidateQueries({ queryKey: ['ar-runs'] }) },
  })
  const fin = useMutation({
    mutationFn: () => attendanceReviewFinalise(runMeta.id),
    onSuccess: () => { toast.success('Review finalised and locked'); qc.invalidateQueries({ queryKey: ['ar-runs'] }) },
  })

  const detected = preview?.releaseDaysDetected || run?.result?.releaseDaysDetected || []
  const dayOptions = useMemo(() => [...new Set([...detected.map((d) => d.date), ...previewDays])].sort(), [detected, previewDays])
  const toggleDay = (d) => setReleaseDays((cur) => { const s = new Set(cur || []); s.has(d) ? s.delete(d) : s.add(d); return [...s].sort() })

  if (!month || !year) return <div className="card p-6 text-sm text-slate-500">Pick a month above.</div>

  const t = data?.actionTotals || {}
  const ded = (data?.actionList || []).filter((a) => a.action === 'deduction')
  const loading = runsQ.isLoading || (runMeta && runQ.isLoading) || (!showingStored && previewQ.isLoading)

  return (
    <div className="space-y-4" data-testid="attendance-review">
      {/* ── control bar ── */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="font-semibold text-slate-800">Attendance Review — {MONTHS[month - 1]} {year}</div>
            <div className="text-xs text-slate-500">
              {isFinal ? <>Final, locked — by {run?.finalised_by} on {ist(run?.finalised_at)}</>
                : runMeta ? <>Draft saved by {runMeta.generated_by} on {ist(runMeta.generated_at)}{!runMatchesEdits && run ? ' — you have unsaved changes; showing a live preview' : ''}</>
                  : <>No saved review yet — showing a live preview (nothing is saved until you generate a draft)</>}
            </div>
          </div>
          <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', isFinal ? 'bg-emerald-100 text-emerald-700' : runMeta ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')} data-testid="ar-status">
            {isFinal ? 'FINAL' : runMeta ? 'DRAFT' : 'PREVIEW'}
          </span>
          <div className="flex-1" />
          <button type="button" className="btn-secondary" onClick={() => setShowConfig((s) => !s)}>{showConfig ? 'Hide rules & exclusions' : 'Rules & exclusions'}</button>
          {!isFinal && (
            <button type="button" className="btn-primary" disabled={gen.isPending || loading} onClick={() => gen.mutate()}>
              {gen.isPending ? 'Working…' : runMeta ? 'Regenerate draft' : 'Generate draft'}
            </button>
          )}
          {runMeta && !isFinal && (
            <button type="button" className="btn-secondary border-emerald-300 text-emerald-700" disabled={fin.isPending || !runMatchesEdits}
              title={runMatchesEdits ? '' : 'Regenerate the draft first so the saved review matches what you see'}
              onClick={() => { if (window.confirm(`Finalise the ${MONTHS[month - 1]} ${year} review? It cannot be changed afterwards.`)) fin.mutate() }}>
              Finalise
            </button>
          )}
        </div>

        {!isFinal && (
          <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Plant-wide release days (early exits on these days are not counted)</div>
              {dayOptions.length === 0 && <p className="text-xs text-slate-400">None detected (no weekday where more than half the day shift left early).</p>}
              <div className="flex flex-wrap gap-2">
                {dayOptions.map((d) => {
                  const det = detected.find((x) => x.date === d)
                  return (
                    <label key={d} className="flex items-center gap-1.5 text-sm bg-slate-50 rounded px-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={previewDays.includes(d)} onChange={() => toggleDay(d)} />
                      {fmtDay(d)}{det && <span className="text-xs text-slate-400">· {Math.round(det.share * 100)}% left early</span>}
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Overrides for this month (each needs a reason)</div>
              <OverridesEditor value={overrides} onChange={setOverrides} disabled={isFinal} />
            </div>
          </div>
        )}
        {isFinal && (run?.release_days?.length > 0 || run?.overrides?.length > 0) && (
          <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
            Release days: {(run.release_days || []).map(fmtDay).join(', ') || 'none'} · Overrides: {(run.overrides || []).map((o) => `${o.code} ${OV_LABEL[o.action]} (“${o.reason}”)`).join('; ') || 'none'}
          </div>
        )}
      </div>

      {showConfig && <AttendanceReviewConfig month={month} year={year} />}

      {loading && <div className="card p-6 text-sm text-slate-500">Computing the review…</div>}
      {!loading && !data && <div className="card p-6 text-sm text-slate-500">No attendance data for this month.</div>}

      {!loading && data && (
        <>
          {/* ── summary ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Stat label="People assessed" value={num(data.meta?.people_assessed)} sub={`${num(data.meta?.excluded_people)} excluded by config`} />
            <Stat label="Action list" value={num(t.people)} sub={`${num(t.deduction_notes)} deductions · ${num(t.warning_notes)} warnings`} tone="red" />
            <Stat label="Deduction days" value={num(t.deduction_days, 1)} tone="red" />
            <Stat label="Indicative amount" value={inr(t.indicative_amount)} sub="gross ÷ days × days; payroll decides" tone="red" />
            <Stat label="Early-exit warnings" value={num(data.earlyExitWarnings?.length)} tone="amber" />
            <Stat label="Late notice" value={num(data.noticeLate?.length)} sub="names on the board" tone="blue" />
            <Stat label="Early notice" value={num(data.noticeEarly?.length)} sub="names on the board" tone="blue" />
          </div>
          {!showingStored && runMeta && !isFinal && <p className="text-xs text-amber-700">Showing a live preview with your unsaved changes — regenerate the draft to save it.</p>}

          {(data.meta?.missing_shift_hours?.length > 0 || data.meta?.not_in_employee_master?.length > 0) && (
            <div className="card p-3 text-xs text-amber-800 bg-amber-50">
              {data.meta.missing_shift_hours?.length > 0 && <div>Shift hours missing (12 h assumed): {data.meta.missing_shift_hours.join(', ')}</div>}
              {data.meta.not_in_employee_master?.length > 0 && <div>Not in employee master: {data.meta.not_in_employee_master.join(', ')}</div>}
            </div>
          )}

          <Section title="Trend vs last month">
            <TrendBlock trend={data.trend} ym={data.meta?.ym || ym} prevYm={data.meta?.prev_ym || ''} />
          </Section>

          <Section title="Action list" count={data.actionList?.length}
            note="Deduction = workdays lost to nearest ½ day, minimum ½ day. Newcomers get a warning. Indicative ₹ only — payroll computes the final figure.">
            <Table rows={data.actionList} rowClass={(r) => (r.action === 'warning' ? 'bg-amber-50/60' : '')} cols={[
              { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> },
              { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'late_days', h: 'Late days', right: true }, { k: 'early_days', h: 'Early exits', right: true },
              { k: 'mins', h: 'Time lost', right: true, v: (r) => `${num(r.late_min + r.early_min)} min` },
              { k: 'workdays_lost', h: 'Workdays lost', right: true, v: (r) => num(r.workdays_lost, 2) },
              { k: 'last', h: 'Last month L/E', right: true, v: (r) => (r.last_month ? `${r.last_month.late_days} / ${r.last_month.early_days}` : 'new') },
              { k: 'categories', h: 'Why', v: (r) => (r.categories?.length ? r.categories.map((c) => CAT_LABEL[c]).join(', ') : r.override ? 'Override' : '') },
              { k: 'action', h: 'Action', v: (r) => (r.action === 'deduction' ? <span className="text-red-700 font-semibold">Deduction</span> : <span className="text-amber-700 font-semibold">Warning{r.newcomer ? ' (newcomer)' : ''}</span>) },
              { k: 'deduction_days', h: 'Days', right: true, v: (r) => (r.deduction_days ? num(r.deduction_days, 1) : '—') },
              { k: 'indicative_amount', h: 'Indicative ₹', right: true, v: (r) => (r.indicative_amount ? inr(r.indicative_amount) : '—') },
              { k: 'override', h: 'Override', v: (r) => (r.override ? `${OV_LABEL[r.override.action]}: ${r.override.reason}` : '') },
            ]} />
            {ded.length > 0 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Total: {num(t.deduction_days, 1)} days · {inr(t.indicative_amount)} indicative · {ded.length} deduction notes</p>}
          </Section>

          <Section title="Early-exit warnings" count={data.earlyExitWarnings?.length}
            note={data.criteria?.early_exit_rule === 'option_c' ? 'Option C is ON: deduction = ½ day per exit of 1 h or more, plus ½ day per 3 shorter exits.' : 'Warning only. The Option C column shows what the proposed rule would deduct.'}>
            <Table rows={data.earlyExitWarnings} cols={[
              { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'early_exits', h: 'Early exits', right: true }, { k: 'over_1h', h: '1 h or more', right: true },
              { k: 'option_c_days', h: 'Option C days', right: true, v: (r) => num(r.option_c_days, 1) },
              { k: 'action', h: 'Action', v: (r) => (r.action === 'deduction' ? `Deduction ${num(r.deduction_days, 1)} d` : `Warning${r.newcomer ? ' (newcomer)' : ''}`) },
            ]} />
          </Section>

          <div className="grid xl:grid-cols-2 gap-4">
            <Section title="Notice board — late coming" count={data.noticeLate?.length} defaultOpen={false} note="Counted lates only (stayed-late mornings excused). No money or minutes on the notice.">
              <Table rows={data.noticeLate} cols={[{ k: 'code', h: 'Code' }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' }, { k: 'late_days', h: 'Late days', right: true }]} />
            </Section>
            <Section title="Notice board — leaving early" count={data.noticeEarly?.length} defaultOpen={false} note="Release days are not counted.">
              <Table rows={data.noticeEarly} cols={[{ k: 'code', h: 'Code' }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' }, { k: 'early_exits', h: 'Early exits', right: true }]} />
            </Section>
          </div>

          <Section title="Double defaulters (4+ lates and 4+ early exits)" count={data.doubleDefaulters?.length} defaultOpen={false}>
            <Table rows={data.doubleDefaulters} cols={[
              { k: 'code', h: 'Code' }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'late_days', h: 'Late', right: true }, { k: 'early_days', h: 'Early', right: true },
              { k: 'workdays_lost', h: 'Workdays lost', right: true, v: (r) => num(r.workdays_lost, 2) },
              { k: 'selected', h: 'On action list', v: (r) => (r.selected ? 'Yes' : 'No — under the workdays cut-off') },
            ]} />
          </Section>

          <Section title="Regular defaulters (8+ in 10+ worked days)" count={data.regular?.length} defaultOpen={false} note="Improved = this month at or below 60% of last month.">
            <Table rows={data.regular} cols={[
              { k: 'code', h: 'Code' }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'late', h: 'Late (last → this)', right: true, v: (r) => `${r.last_late ?? '—'} → ${r.late_days}` },
              { k: 'early', h: 'Early (last → this)', right: true, v: (r) => `${r.last_early ?? '—'} → ${r.early_days}` },
              { k: 'imp', h: 'Improved', v: (r) => (r.newcomer ? 'Newcomer' : [r.late_improved && 'late', r.early_improved && 'early'].filter(Boolean).join(' + ') || 'No') },
              { k: 'selected', h: 'On action list', v: (r) => (r.selected ? 'Yes' : 'No') },
            ]} />
          </Section>

          <Section title="Time lost by department" count={data.departments?.length} defaultOpen={false}>
            <Table rows={data.departments} cols={[
              { k: 'department', h: 'Department' }, { k: 'people', h: 'People', right: true },
              { k: 'late_days', h: 'Late days', right: true }, { k: 'early_exits', h: 'Early exits', right: true },
              { k: 'lost', h: 'Minutes lost', right: true, v: (r) => num(r.late_min + r.early_min) },
              { k: 'workdays_lost', h: 'Workdays lost', right: true, v: (r) => num(r.workdays_lost, 1) },
              { k: 'time_lost_pct', h: '% of scheduled time', right: true, v: (r) => `${num(r.time_lost_pct, 2)}%` },
            ]} />
          </Section>

          <Section title="Shift set-up issues (fix in the employee master)" count={data.shiftIssues?.length} defaultOpen={false}
            note="Shift used by the system differs from the master, or 80%+ of days read late or early. Check each before acting on its numbers.">
            <Table rows={data.shiftIssues} cols={[
              { k: 'code', h: 'Code' }, { k: 'department', h: 'Department' }, { k: 'master_shift', h: 'Master shift' }, { k: 'used_shift', h: 'Shift used' },
              { k: 'days', h: 'Days', right: true }, { k: 'in', h: 'In range', v: (r) => `${r.min_in || '—'}–${r.max_in || '—'}` },
              { k: 'out', h: 'Out range', v: (r) => `${r.min_out || '—'}–${r.max_out || '—'}` }, { k: 'late', h: 'Late', right: true }, { k: 'early', h: 'Early', right: true },
            ]} />
          </Section>

          <Section title="Last month's late-coming deductions vs payroll" count={data.payrollChecks?.flags?.length} defaultOpen={false}
            note={`${num(data.payrollChecks?.rows)} deduction rows checked for ${MONTHS[(data.payrollChecks?.month || 1) - 1]} ${data.payrollChecks?.year || ''}. For finance to correct.`}>
            <Table rows={data.payrollChecks?.flags} empty="No payroll errors found." cols={[
              { k: 'code', h: 'Code' },
              { k: 'flag', h: 'Problem', v: (r) => ({ two_approved_rows: `Two approved deduction rows (${r.rows})`, rejected_but_daycalc_applied: `Finance rejected, but day calculation still applied ${r.daycalc_days} day(s)`, daycalc_and_salary_deduction: `Day calculation (${r.daycalc_days} d) AND salary deduction (${inr(r.salary_amount)}) for the same lates` }[r.flag] || r.flag) },
            ]} />
          </Section>

          {data.held?.length > 0 && (
            <Section title="Held (no action until a ruling)" count={data.held.length} defaultOpen={false}>
              <Table rows={data.held} cols={[{ k: 'code', h: 'Code' }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' }, { k: 'late_days', h: 'Late', right: true }, { k: 'early_exits', h: 'Early', right: true }]} />
            </Section>
          )}

          {data.overridesApplied?.length > 0 && (
            <Section title="Overrides applied" count={data.overridesApplied.length} defaultOpen={false}>
              <Table rows={data.overridesApplied} cols={[{ k: 'code', h: 'Code' }, { k: 'action', h: 'Override', v: (r) => OV_LABEL[r.action] }, { k: 'reason', h: 'Reason' }, { k: 'effect', h: 'Effect' }]} />
            </Section>
          )}

          <p className="text-xs text-slate-400">
            Gate passes recorded this month: {num(data.gatePassCount)}. Rules: late = {data.criteria?.thresholds?.late_min_minutes}+ min;
            early exit = {data.criteria?.thresholds?.early_min_exclusive}–{data.criteria?.thresholds?.early_max_exclusive} min, Mon–Sat; stayed-late exemption: {data.criteria?.stayed_late_mode};
            early-exit rule: {data.criteria?.early_exit_rule === 'option_c' ? 'Option C' : 'warning only'}. Nothing on this page changes salary.
          </p>
        </>
      )}
    </div>
  )
}
