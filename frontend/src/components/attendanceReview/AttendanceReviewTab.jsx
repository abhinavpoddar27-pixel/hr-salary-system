import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  attendanceReviewPreview, attendanceReviewRuns, attendanceReviewRun,
  attendanceReviewGenerate, attendanceReviewExport, attendanceReviewApplySuggestions,
  attendanceReviewFinance, attendanceReviewSendToFinance,
} from '../../utils/api'
import AttendanceReviewConfig from './AttendanceReviewConfig'
import AttendanceReviewTrends from './AttendanceReviewTrends'
import AttendanceReviewBoard from './AttendanceReviewBoard'
import { QualityPanel, FinaliseDialog, useQualityGate } from './AttendanceReviewQuality'
import { LadderBadge, PersonHistory } from './AttendanceReviewPerson'
import { useAppStore } from '../../store/appStore'

/**
 * Analytics → Attendance Review (admin only).
 * Shows the month's saved run (draft or final) when one exists, otherwise a live preview.
 * The admin confirms release days, adds overrides with a reason, generates / regenerates a draft and finalises it.
 * Read-only on payroll: nothing here deducts salary (write-back is a later, gated PR).
 */

const ord2 = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
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

const QUALITY_ROWS = [
  ['no_master', 'No master shift — not assessed', 'Set the shift in the employee master.'],
  ['night_on_day_master', 'Night work on a 9 / 10-hour master — not assessed', 'Only 12-hour or night masters are measured at night.'],
  ['odd_punch', 'In-punch hours before the shift — not assessed', 'Usually a wrong master or a stray punch.'],
  ['half_day', 'Half days — not checked for late / early', 'Already paid as half a day.'],
  ['gate_register', 'Miss-punch days fixed from the gate register — assessed with those times', ''],
  ['out_not_verified', 'Of those, out written as exactly the shift end — "out not verified"', 'No early exit measured; excuses nothing. Gate must write the real time.'],
  ['gate_pass', 'Early exits reduced by a gate pass', ''],
  ['miss_punch_open', 'Miss-punch days not yet fixed — skipped', ''],
]

function QualitySection({ q }) {
  const rows = QUALITY_ROWS.map(([k, label, hint]) => ({ key: k, label, hint, days: q[k]?.days || 0, people: q[k]?.people?.length || 0,
    codes: (q[k]?.people || []).slice(0, 12).map((p) => `${p.code} (${p.days})`).join(', ') + ((q[k]?.people?.length || 0) > 12 ? ' …' : '') }))
  return (
    <Section title="What the master-shift basis left out" count={q.unassessable_days} defaultOpen={false}
      note="Count = worked days that could not be assessed (no master, night on a day master, odd punch). Other rows are for information.">
      <Table rows={rows} cols={[{ k: 'label', h: 'What' }, { k: 'days', h: 'Days', right: true }, { k: 'people', h: 'People', right: true },
        { k: 'codes', h: 'Codes (days)' }, { k: 'hint', h: 'Note' }]} />
    </Section>
  )
}

const SUG_KIND = {
  senior_hint: 'Senior staff?', master_fit: 'Master shift', loader_outside_crew: 'Crew loader elsewhere', loader_crew: 'Piece-rate crew?',
  no_master: 'No master shift', redundant_remeasure: 'Re-measure no longer needed', stale_person: 'Rule no longer needed', stale_department: 'Rule no longer needed',
}

/** Suggested leave-outs and data fixes: tick Accept or Dismiss, then Apply → one new rules version for this month. */
function SuggestionsSection({ list, month, year, releaseDays, lateFreeDays = [], onApplied, readOnly }) {
  const [pick, setPick] = useState({})   // key → 'accept' | 'dismiss'
  useEffect(() => { setPick({}) }, [month, year, list])
  const set = (k, v) => setPick((p) => { const n = { ...p }; if (n[k] === v) delete n[k]; else n[k] = v; return n })
  const accept = Object.keys(pick).filter((k) => pick[k] === 'accept'); const dismiss = Object.keys(pick).filter((k) => pick[k] === 'dismiss')
  const apply = useMutation({
    mutationFn: () => attendanceReviewApplySuggestions({ month, year, accept, dismiss, releaseDays, lateFreeDays }),
    onSuccess: (r) => { toast.success(`Saved as rules version ${r.data.data.id}, effective ${r.data.data.effective_from}`); setPick({}); onApplied() },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not apply', { duration: 8000 }),
  })
  return (
    <Section title="Suggestions — leave out or fix" count={list.length} defaultOpen={list.length > 0}
      note="Found from this month's punches and the masters. Nothing changes until you tick and Apply; accepted rules stay for later months until removed, dismissed ones are not shown again.">
      {list.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">Nothing to suggest this month.</p> : (
        <div className="divide-y divide-slate-100" data-testid="ar-suggestions">
          {list.map((s) => (
            <div key={s.key} className="px-4 py-3 flex flex-col md:flex-row md:items-start gap-2" data-key={s.key}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-500 uppercase">{SUG_KIND[s.kind] || s.kind}</div>
                <div className="text-sm font-medium text-slate-800">{s.title}{s.name ? <span className="text-slate-500 font-normal"> · {s.name}</span> : null}</div>
                <div className="text-xs text-slate-600 mt-0.5">{s.evidence}</div>
              </div>
              {!readOnly && (
                <div className="flex gap-3 shrink-0 text-sm">
                  {s.can_apply && (
                    <label className="flex items-center gap-1"><input type="checkbox" aria-label={`Accept ${s.key}`} checked={pick[s.key] === 'accept'} onChange={() => set(s.key, 'accept')} />
                      <span>{s.action}</span></label>
                  )}
                  {!s.can_apply && <span className="text-xs text-slate-500 self-center">{s.action}</span>}
                  <label className="flex items-center gap-1"><input type="checkbox" aria-label={`Dismiss ${s.key}`} checked={pick[s.key] === 'dismiss'} onChange={() => set(s.key, 'dismiss')} />
                    <span className="text-slate-500">Dismiss</span></label>
                </div>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="px-4 py-3 flex items-center gap-3">
              <button type="button" className="btn-primary text-sm" disabled={!(accept.length + dismiss.length) || apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending ? 'Applying…' : `Apply ${accept.length + dismiss.length || ''} ${accept.length + dismiss.length === 1 ? 'change' : 'changes'}`}
              </button>
              <span className="text-xs text-slate-500">{accept.length} accepted · {dismiss.length} dismissed — saved as one new rules version effective {year}-{String(month).padStart(2, '0')}.</span>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

const FIN_STATUS = { pending: 'Waiting for finance', approved: 'Approved', rejected: 'Rejected' }

// PR-2 — the review is the only place a late / early-exit deduction is decided. A final review's deductions go to the
// finance queue as pending rows; finance approves there and Stage 7 applies approved rows. Nothing is ever overwritten.
function FinanceSection({ runId, isFinal }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ar-finance', runId], queryFn: () => attendanceReviewFinance(runId), enabled: !!runId, retry: 0 })
  const d = q.data?.data?.data
  const send = useMutation({
    mutationFn: () => attendanceReviewSendToFinance(runId),
    onSuccess: (r) => {
      const { created, skipped } = r.data.data
      toast.success(`${created.length} sent to finance${skipped.length ? ` · ${skipped.length} skipped` : ''}`, { duration: 6000 })
      qc.invalidateQueries({ queryKey: ['ar-finance', runId] })
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send to finance', { duration: 8000 }),
  })
  if (!runId) return null
  const sm = d?.summary || {}
  const toSend = d?.preview?.create || []
  const blocked = (d?.preview?.skipped || []).filter((x) => x.reason !== 'already sent')
  const status = (r) => (r.applied ? 'In salary' : FIN_STATUS[r.finance_status] || r.finance_status)
  return (
    <Section title="Finance" count={sm.sent || undefined}
      note="Deductions on a final review — the action list and the early-exit section — go to the finance queue (Late Coming → Pending Deductions), one row per person. Finance approves; the salary run applies approved rows. Warnings are not sent.">
      <div className="px-4 py-3 space-y-3" data-testid="ar-finance">
        {!isFinal && <p className="text-sm text-slate-500">Finalise the review to send its deductions to finance.</p>}
        {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {isFinal && d && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary text-sm" data-testid="ar-send-finance" disabled={!toSend.length || send.isPending}
              onClick={() => { if (window.confirm(`Send ${toSend.length} deduction${toSend.length === 1 ? '' : 's'} to finance for approval?`)) send.mutate() }}>
              {send.isPending ? 'Sending…' : toSend.length ? `Send ${toSend.length} to finance` : 'Nothing left to send'}
            </button>
            <span className="text-xs text-slate-600" data-testid="ar-finance-summary">
              {sm.sent} sent · {sm.pending} waiting · {sm.approved} approved · {sm.rejected} rejected · {sm.applied} in salary
            </span>
            {toSend.some((c) => c.source === 'early') && (
              <span className="text-xs text-slate-600" data-testid="ar-finance-early">incl. {toSend.filter((c) => c.source === 'early').length} from the early-exit section</span>
            )}
            {toSend.some((c) => c.contractor) && (
              <span className="text-xs text-amber-700">Contractor deductions reach their pay too, at their own day rate, once finance approves (from September 2026 payroll).</span>
            )}
          </div>
        )}
        {blocked.length > 0 && (
          <div className="text-xs text-amber-800 bg-amber-50 rounded px-3 py-2" data-testid="ar-finance-blocked">
            Not sent — a deduction row already exists for this month: {blocked.map((b) => `${b.code} (${b.existing.map((x) => `${x.days} d ${FIN_STATUS[x.status] || x.status}`).join(', ')})`).join('; ')}.
            Ask finance to reject the old row if the review's figure should replace it, then send again.
          </div>
        )}
        {d?.sent?.length > 0 && (
          <Table rows={d.sent} cols={[
            { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' },
            { k: 'deduction_days', h: 'Days', right: true }, { k: 'st', h: 'Status', v: status },
            { k: 'finance_remark', h: 'Finance note', v: (r) => r.finance_remark || '—' },
          ]} />
        )}
        {d?.outside?.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Entered outside this review for the month ({d.outside.length})</div>
            <Table rows={d.outside} cols={[
              { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' },
              { k: 'deduction_days', h: 'Days', right: true }, { k: 'st', h: 'Status', v: status }, { k: 'applied_by', h: 'By' },
            ]} />
          </div>
        )}
      </div>
    </Section>
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

export default function AttendanceReviewTab({ selectedMonth, selectedYear, onSelectMonth }) {
  const qc = useQueryClient()
  const month = Number(selectedMonth); const year = Number(selectedYear)
  const ym = `${year}-${String(month).padStart(2, '0')}`
  const [showConfig, setShowConfig] = useState(false)
  const [view, setView] = useState('month')   // 'month' | 'trends' | 'board'
  const [trendRange, setTrendRange] = useState(6)   // kept while switching views
  const setMonthYear = useAppStore((st) => st.setMonthYear)

  const runsQ = useQuery({ queryKey: ['ar-runs'], queryFn: attendanceReviewRuns, retry: 0 })
  const runMeta = (runsQ.data?.data?.data || []).find((r) => r.month === month && r.year === year) || null
  const runQ = useQuery({ queryKey: ['ar-run', runMeta?.id, runMeta?.generated_at, runMeta?.status], queryFn: () => attendanceReviewRun(runMeta.id), enabled: !!runMeta, retry: 0 })
  const run = runQ.data?.data?.data || null

  // Release days + overrides being edited (seeded from the saved run, else from the preview's detection).
  const [releaseDays, setReleaseDays] = useState(null)
  const [overrides, setOverrides] = useState([])
  // PR-8: ticked plant-wide late days — never pre-ticked (owner ruling 11–12 Oct); seeded only from the saved run
  const [lateFreeDays, setLateFreeDays] = useState([])
  useEffect(() => { setReleaseDays(null); setOverrides([]); setLateFreeDays([]) }, [month, year])
  useEffect(() => { if (run) { setReleaseDays(run.release_days || []); setOverrides(run.overrides || []); setLateFreeDays(run.late_free_days || []) } }, [run?.id, run?.generated_at])

  const previewDays = releaseDays || []
  const previewQ = useQuery({
    queryKey: ['ar-preview', month, year, previewDays.join(','), JSON.stringify(overrides), lateFreeDays.join(',')],
    queryFn: () => attendanceReviewPreview(month, year, previewDays, overrides, lateFreeDays),
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
    && JSON.stringify(run.late_free_days || []) === JSON.stringify(lateFreeDays)
  // What the page shows: a final run as stored; a draft as stored unless the admin has changed release days (then the live preview).
  const data = isFinal ? run?.result : (run && runMatchesEdits ? run.result : preview)
  const showingStored = !!(run && (isFinal || runMatchesEdits))

  const gen = useMutation({
    mutationFn: () => attendanceReviewGenerate({ month, year, releaseDays: previewDays, overrides, lateFreeDays }),
    onSuccess: (r) => { toast.success(r.status === 201 ? 'Draft created' : 'Draft regenerated'); qc.invalidateQueries({ queryKey: ['ar-runs'] }) },
  })
  // PR-4: data-quality check of the saved draft; Finalise goes through a window that lists the checks
  const qualityQ = useQualityGate(runMeta?.id, `${runMeta?.generated_at}|${runMeta?.status}`)
  const gate = qualityQ.data?.data?.data
  const [finOpen, setFinOpen] = useState(false)
  const [personCode, setPersonCode] = useState(null)   // PR-7 history window

  const [downloading, setDownloading] = useState(null)
  const download = async (kind) => {
    setDownloading(kind)
    try {
      const res = await attendanceReviewExport(runMeta.id, kind)
      const name = /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] || '')?.[1] || `attendance-review.${kind}`
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { /* the API layer already showed the error */ } finally { setDownloading(null) }
  }

  const detected = preview?.releaseDaysDetected || run?.result?.releaseDaysDetected || []
  const dayOptions = useMemo(() => [...new Set([...detected.map((d) => d.date), ...previewDays])].sort(), [detected, previewDays])
  const toggleDay = (d) => setReleaseDays((cur) => { const s = new Set(cur || []); s.has(d) ? s.delete(d) : s.add(d); return [...s].sort() })
  // PR-8: plant-wide late days (detected on the preview / stored result; a ticked day stays listed even if no longer detected)
  const lateDetected = preview?.plantLateDays?.detected || run?.result?.plantLateDays?.detected || []
  const lateOptions = useMemo(() => [...new Set([...lateDetected.map((d) => d.date), ...lateFreeDays])].sort(), [lateDetected, lateFreeDays])
  const toggleLateDay = (d) => setLateFreeDays((cur) => { const s = new Set(cur || []); s.has(d) ? s.delete(d) : s.add(d); return [...s].sort() })

  if (!month || !year) return <div className="card p-6 text-sm text-slate-500">Pick a month above.</div>

  const t = data?.actionTotals || {}
  const ded = (data?.actionList || []).filter((a) => a.action === 'deduction')
  const d4On = data?.criteria?.early_exit_rule === 'd4'
  const mpOn = data?.criteria?.missed_out_rule === true && !!data?.missedOut
  const ladderOn = data?.ladder?.rule === true
  const codeCell = (r) => <button type="button" className="font-mono text-blue-700 underline decoration-dotted" title="Open this person's history"
    data-testid={`ar-code-${r.code}`} onClick={() => setPersonCode(String(r.code))}>{r.code}</button>
  const loading = runsQ.isLoading || (runMeta && runQ.isLoading) || (!showingStored && previewQ.isLoading)

  const viewSwitch = (
    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-sm bg-white" role="tablist" aria-label="Attendance Review view">
      {[['month', `${MONTHS[month - 1]} ${year}`], ['trends', 'Trends'], ['board', 'Notice board']].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`ar-view-${k}`} onClick={() => setView(k)}
          className={clsx('px-4 py-1.5', view === k ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-50')}>{l}</button>
      ))}
    </div>
  )
  if (view === 'board') {
    return (
      <div className="space-y-4">
        {viewSwitch}
        <AttendanceReviewBoard month={month} year={year} />
      </div>
    )
  }
  if (view === 'trends') {
    return (
      <div className="space-y-4">
        {viewSwitch}
        <AttendanceReviewTrends month={month} year={year} range={trendRange} onRange={setTrendRange} onOpenMonth={(m, y) => { onSelectMonth?.(m, y); setMonthYear(m, y); setView('month') }} />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="attendance-review">
      {viewSwitch}
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
          {runMeta && showingStored && (
            <>
              <button type="button" className="btn-secondary" disabled={!!downloading} onClick={() => download('xlsx')}
                title="Workbook of the saved review (all lists, departments, payroll checks, rules used)">
                {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
              </button>
              <button type="button" className="btn-secondary" disabled={!!downloading} onClick={() => download('docx')}
                title="Action list, notice-board lists and one note per person, ready to print">
                {downloading === 'docx' ? 'Preparing…' : `Download Word notes${isFinal ? '' : ' (draft)'}`}
              </button>
            </>
          )}
          {runMeta && !isFinal && (
            <button type="button" className="btn-secondary border-emerald-300 text-emerald-700" disabled={!runMatchesEdits || !gate || gate.stops.length > 0}
              title={!runMatchesEdits ? 'Regenerate the draft first so the saved review matches what you see'
                : gate && gate.stops.length ? gate.stops.map((x) => x.title).join('; ') : ''}
              onClick={() => setFinOpen(true)}>
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
            <div className="md:col-span-2" data-testid="ar-plant-late">
              <div className="text-xs font-semibold text-slate-600 mb-1">Plant-wide late days (tick a day to stop counting its lates for everyone — early exits still count)</div>
              {lateOptions.length === 0 && <p className="text-xs text-slate-400" data-testid="ar-plant-late-none">
                None detected (no weekday with {data?.criteria?.thresholds?.plant_late_min_people ?? 15}+ people late and at least {Math.round((data?.criteria?.thresholds?.plant_late_min_share ?? 0.25) * 100)}% of those at work).</p>}
              <div className="flex flex-wrap gap-2">
                {lateOptions.map((d) => {
                  const det = lateDetected.find((x) => x.date === d)
                  return (
                    <label key={d} className="flex items-center gap-1.5 text-sm bg-slate-50 rounded px-2 py-1 cursor-pointer" data-testid={`ar-plant-late-${d}`}>
                      <input type="checkbox" checked={lateFreeDays.includes(d)} onChange={() => toggleLateDay(d)} data-testid={`ar-plant-late-tick-${d}`} />
                      {fmtDay(d)}{det
                        ? <span className="text-xs text-slate-500" data-testid={`ar-plant-late-info-${d}`}>· {det.late_people} of {det.assessed} late ({Math.round(det.share * 100)}%), median {det.median_late_minutes} min</span>
                        : <span className="text-xs text-slate-400">· no longer detected</span>}
                      {previewDays.includes(d) && <span className="text-[11px] text-slate-400">· also a release day</span>}
                    </label>
                  )
                })}
              </div>
              {lateFreeDays.length > 0 && <p className="text-xs text-slate-600 mt-1" data-testid="ar-plant-late-excused">
                {num(data?.plantLateDays?.lates_excused ?? 0)} late arrival(s) not counted because of the ticked day(s).</p>}
            </div>
          </div>
        )}
        {isFinal && (run?.release_days?.length > 0 || run?.overrides?.length > 0 || run?.late_free_days?.length > 0) && (
          <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
            Release days: {(run.release_days || []).map(fmtDay).join(', ') || 'none'} · Plant-wide late days: {(run.late_free_days || []).map(fmtDay).join(', ') || 'none'} · Overrides: {(run.overrides || []).map((o) => `${o.code} ${OV_LABEL[o.action]} (“${o.reason}”)`).join('; ') || 'none'}
          </div>
        )}
      </div>

      {runMeta && <QualityPanel q={qualityQ} isFinal={isFinal} />}
      {personCode && <PersonHistory code={personCode} month={month} year={year} onClose={() => setPersonCode(null)} />}
      <FinaliseDialog open={finOpen} onClose={() => setFinOpen(false)} runId={runMeta?.id} label={`${MONTHS[month - 1]} ${year}`} q={qualityQ} />

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
          <p className="text-xs text-slate-600" data-testid="ar-basis">
            {data.criteria?.assessment_basis === 'master'
              ? <>Measured on each person's <strong>current master shift</strong>{data.criteria?.assess_fixed_miss_punch === false ? '' : '; miss-punch days fixed from the gate register are included'}.</>
              : <>Measured on the shift the import matched each day (import basis).</>}
          </p>

          {(data.meta?.missing_shift_hours?.length > 0 || data.meta?.not_in_employee_master?.length > 0) && (
            <div className="card p-3 text-xs text-amber-800 bg-amber-50">
              {data.meta.missing_shift_hours?.length > 0 && <div>Shift hours missing (12 h assumed): {data.meta.missing_shift_hours.join(', ')}</div>}
              {data.meta.not_in_employee_master?.length > 0 && <div>Not in employee master: {data.meta.not_in_employee_master.join(', ')}</div>}
            </div>
          )}

          {!isFinal && preview?.suggestions && (
            <SuggestionsSection list={preview.suggestions} month={month} year={year} releaseDays={previewDays} lateFreeDays={lateFreeDays} readOnly={false}
              onApplied={() => { qc.invalidateQueries({ queryKey: ['ar-preview'] }); qc.invalidateQueries({ queryKey: ['ar-config'] }); qc.invalidateQueries({ queryKey: ['ar-quality'] }) }} />
          )}
          {data.assessment?.quality && <QualitySection q={data.assessment.quality} />}

          <Section title="Trend vs last month">
            <TrendBlock trend={data.trend} ym={data.meta?.ym || ym} prevYm={data.meta?.prev_ym || ''} />
          </Section>

          <Section title="Action list" count={data.actionList?.length}
            note={`Deduction = workdays lost to nearest ½ day, minimum ½ day.${d4On ? ' 2 h rule ON: the early-exit part is the larger of the minutes lost and ½ day per exit of 2 h or more.' : ''}${mpOn ? ' Missed OUTs from the person\'s ' + (data.criteria?.thresholds?.missed_out_from ?? 5) + 'th own missed punch are counted as 2 h early exits.' : ''} Newcomers get a warning.${ladderOn ? ` Ladder ON: the first month in ${data.ladder.window_months} on a list is a warning, the ${ord2(data.ladder.deduction_from)} a deduction, from the ${ord2(data.ladder.hearing_from)} a deduction + HR hearing (counted from ${data.ladder.from}). ${t.ladder_warnings || 0} turned into warnings, ${t.hearings || 0} hearing(s).` : ''} Click a code for the person's history. Indicative ₹ only — payroll computes the final figure.`}>
            <Table rows={data.actionList} rowClass={(r) => (r.action === 'warning' ? 'bg-amber-50/60' : '')} cols={[
              { k: 'code', h: 'Code', v: codeCell },
              { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'late_days', h: 'Late days', right: true, v: (r) => (<>{r.late_days}{r.long_lates > 0 && <span className="ml-1 text-[11px] text-slate-500" title="Late 2 h or more">({r.long_lates} ≥ 2 h)</span>}</>) },
              { k: 'early_days', h: 'Early exits', right: true, v: (r) => (<>{r.early_days}{(d4On && r.over_2h > 0) && <span className="ml-1 text-[11px] text-slate-500">({r.over_2h} ≥ 2 h)</span>}{r.missed_out_days > 0 && <span className="ml-1 text-[11px] text-slate-500">incl. {r.missed_out_days} missed OUT</span>}</>) },
              { k: 'mins', h: 'Time lost', right: true, v: (r) => `${num(r.late_min + r.early_min)} min` },
              { k: 'workdays_lost', h: 'Workdays lost', right: true, v: (r) => num(r.workdays_lost, 2) },
              { k: 'last', h: 'Last month L/E', right: true, v: (r) => (r.last_month ? `${r.last_month.late_days} / ${r.last_month.early_days}` : 'new') },
              { k: 'categories', h: 'Why', v: (r) => (r.categories?.length ? r.categories.map((c) => CAT_LABEL[c]).join(', ') : r.override ? 'Override' : '') },
              { k: 'action', h: 'Action', v: (r) => (<>
                {r.action === 'deduction' ? <span className="text-red-700 font-semibold">Deduction</span> : <span className="text-amber-700 font-semibold">Warning{r.newcomer ? ' (newcomer)' : ''}</span>}
                {r.check_master_shift && <span className="ml-1 text-[11px] rounded bg-amber-100 text-amber-800 px-1" title="Leaves early almost every day and short of the master shift. Confirm the shift; use an override if the master is wrong.">check master shift</span>}
              </>) },
              ...(ladderOn ? [{ k: 'ladder', h: 'Ladder', v: (r) => <LadderBadge ladder={r.ladder} /> }] : []),
              { k: 'deduction_days', h: 'Days', right: true, v: (r) => (r.deduction_days ? num(r.deduction_days, 1) : '—') },
              { k: 'indicative_amount', h: 'Indicative ₹', right: true, v: (r) => (r.indicative_amount ? inr(r.indicative_amount) : '—') },
              { k: 'override', h: 'Override', v: (r) => (r.override ? `${OV_LABEL[r.override.action]}: ${r.override.reason}` : '') },
            ]} />
            {ded.length > 0 && <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">Total: {num(t.deduction_days, 1)} days · {inr(t.indicative_amount)} indicative · {ded.length} deduction notes</p>}
          </Section>

          {runMeta && showingStored && <FinanceSection runId={runMeta.id} isFinal={isFinal} />}

          <Section title="Early-exit warnings" count={data.earlyExitWarnings?.length}
            note={d4On ? `2 h rule is ON: from the ${data.criteria?.thresholds?.d4_half_day_min_count ?? 1}${(data.criteria?.thresholds?.d4_half_day_min_count ?? 1) === 1 ? 'st' : (data.criteria?.thresholds?.d4_half_day_min_count === 2 ? 'nd' : 'th')} exit of 2 h or more in the month, each costs ½ day (fewer = warning); when there are ${data.criteria?.thresholds?.d4_long_count ?? 3}+ exits of 1 h or more, the minutes of those not charged as ½ days are deducted too. One exit of 2 h is enough to be listed here. Shorter exits stay warning-only.`
              : data.criteria?.early_exit_rule === 'option_c' ? 'Option C is ON: deduction = ½ day per exit of 1 h or more, plus ½ day per 3 shorter exits.' : 'Warning only. The Option C column shows what the proposed rule would deduct.'}>
            <Table rows={data.earlyExitWarnings} cols={[
              { k: 'code', h: 'Code', v: codeCell }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'early_exits', h: 'Early exits', right: true, v: (r) => (<>{r.early_exits}{r.missed_out_days > 0 && <span className="ml-1 text-[11px] text-slate-500">incl. {r.missed_out_days} missed OUT</span>}</>) },
              { k: 'over_1h', h: '1 h or more', right: true },
              ...(d4On ? [{ k: 'over_2h', h: '2 h or more', right: true }, { k: 'd4_days', h: '2 h rule days', right: true, v: (r) => num(r.d4_days, 1) }]
                : [{ k: 'option_c_days', h: 'Option C days', right: true, v: (r) => num(r.option_c_days, 1) }]),
              { k: 'action', h: 'Action', v: (r) => `${r.action === 'deduction' ? `Deduction ${num(r.deduction_days, 1)} d` : `Warning${r.newcomer ? ' (newcomer)' : ''}`}${r.check_master_shift ? ' · check master shift' : ''}` },
              ...(ladderOn ? [{ k: 'ladder', h: 'Ladder', v: (r) => <LadderBadge ladder={r.ladder} /> }] : []),
            ]} />
          </Section>

          <Section title="Late 2 h or more — check the shift" count={data.longLates?.length} defaultOpen={false}
            note={`A late of ${data.criteria?.thresholds?.long_late_minutes ?? 120} minutes or more is usually a shift question (wrong master, or a different shift that day), not a habit. ${data.criteria?.late_long_always_counted ? 'These lates are counted even when the hours were made up.' : 'Today such a late is still forgiven when the full shift was worked — tick "always counted" in Rules to change that.'}`}>
            <Table rows={data.longLates || []} cols={[
              { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'shift_h', h: 'Shift h', right: true },
              { k: 'long_lates', h: 'Counted 2 h+ lates', right: true }, { k: 'avg_minutes', h: 'Average late', right: true, v: (r) => (r.avg_minutes ? `${r.avg_minutes} min` : '—') },
              { k: 'full_hours_kept', h: 'Counted though hours made up', right: true },
              { k: 'full_hours_forgiven', h: 'Forgiven (hours made up)', right: true },
              { k: 'late_days', h: 'All counted lates', right: true },
            ]} />
          </Section>

          {mpOn && (
            <Section title="Missed OUT counted as an early exit" count={data.missedOut?.people?.length} defaultOpen={false}
              note={`From the person's ${data.missedOut.from}th own missed punch in the month, each missed OUT counts as an early exit of ${data.missedOut.minutes} min. ${data.missedOut.bulk_days?.length ? `System-failure days not counted: ${data.missedOut.bulk_days.join(', ')}.` : 'No system-failure days this month.'} Loaders and people whose early exits are not assessed are shown but not charged.`}>
              <Table rows={data.missedOut.people || []} cols={[
                { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
                { k: 'personal_missed_punches', h: 'Own missed punches', right: true },
                { k: 'counted_as_early', h: 'Counted as early exits', right: true, v: (r) => (r.exempt ? 'not assessed' : r.counted_as_early) },
                { k: 'dates', h: 'Days counted', v: (r) => (r.dates || []).map((d) => d.slice(8)).join(', ') },
              ]} />
            </Section>
          )}

          <Section title="Shift check — early exits (automatic)" count={data.shiftCheck?.length} defaultOpen={false}
            note={data.criteria?.shift_fit === 'off' ? 'Shift check is OFF — every early exit is counted.'
              : `${data.criteria?.shift_fit === 'everyone' ? 'Everyone with an early exit excused because they still worked the full shift, plus anyone' : 'People'} who leaves "early" on most days (often a wrong shift in the master): an early exit counts only on a day they worked less than their shift length. "Check master shift" = short almost every day — a wrong master shift and a habitual early leaver look the same in the punches, so confirm the shift and use an override if it is wrong.`}>
            <Table rows={data.shiftCheck} empty="Nobody needed the shift check this month." cols={[
              { k: 'code', h: 'Code', v: (r) => <span className="font-mono">{r.code}</span> }, { k: 'name', h: 'Name' }, { k: 'department', h: 'Department' },
              { k: 'shift_h', h: 'Shift h', right: true }, { k: 'ms_days', h: 'Worked (Mon–Sat)', right: true },
              { k: 'system_early', h: 'System early exits', right: true }, { k: 'excused', h: 'Full hours — not counted', right: true },
              { k: 'counted', h: 'Counted', right: true }, { k: 'avg_hours', h: 'Avg hours those days', right: true, v: (r) => (r.avg_hours == null ? '—' : num(r.avg_hours, 1)) },
              { k: 'result', h: 'Result', v: (r) => (r.check_master ? <span className="text-amber-700 font-semibold">Check master shift</span>
                : { hidden: 'Not shown — full hours worked', shown: 'Shown — short of shift hours', below_threshold: 'Below warning threshold' }[r.result]) },
            ]} />
          </Section>

          <div className="grid xl:grid-cols-2 gap-4">
            <Section title="Notice board — late coming" count={data.noticeLate?.length} defaultOpen={false} note="Counted lates only (mornings after a stayed-late evening, and full-hours days, excused). No money or minutes on the notice.">
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

          {data.criteria?.assessment_basis !== 'master' && <Section title="Shift set-up issues (fix in the employee master)" count={data.shiftIssues?.length} defaultOpen={false}
            note="Shift used by the system differs from the master, or 80%+ of days read late or early. Check each before acting on its numbers.">
            <Table rows={data.shiftIssues} cols={[
              { k: 'code', h: 'Code' }, { k: 'department', h: 'Department' }, { k: 'master_shift', h: 'Master shift' }, { k: 'used_shift', h: 'Shift used' },
              { k: 'days', h: 'Days', right: true }, { k: 'in', h: 'In range', v: (r) => `${r.min_in || '—'}–${r.max_in || '—'}` },
              { k: 'out', h: 'Out range', v: (r) => `${r.min_out || '—'}–${r.max_out || '—'}` }, { k: 'late', h: 'Late', right: true }, { k: 'early', h: 'Early', right: true },
            ]} />
          </Section>}

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
            Gate passes recorded this month: {num(data.gatePassCount)} (early exits they excused: {num(data.gatePassExcused ?? 0)}). Rules: late = {data.criteria?.thresholds?.late_min_minutes}+ min;
            early exit = {data.criteria?.thresholds?.early_min_exclusive}–{data.criteria?.thresholds?.early_max_exclusive} min, Mon–Sat; stayed-late exemption: {data.criteria?.stayed_late_mode};
            full-hours days: lates {data.criteria?.late_full_hours === false ? 'counted' : 'not counted'}, early exits {data.criteria?.shift_fit === 'everyone' ? 'not counted' : data.criteria?.shift_fit === 'habitual' ? 'not counted for habitual early leavers' : 'counted'};
            early-exit rule: {d4On ? '2 h rule' : data.criteria?.early_exit_rule === 'option_c' ? 'Option C' : 'warning only'}{data.criteria?.late_long_always_counted ? '; lates of 2 h+ always counted' : ''}{mpOn ? '; missed OUT counted as early exit' : ''}{ladderOn ? '; escalation ladder on' : ''}. Nothing on this page changes salary.
          </p>
        </>
      )}
    </div>
  )
}
