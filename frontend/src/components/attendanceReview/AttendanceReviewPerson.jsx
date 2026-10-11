import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { attendanceReviewPerson, attendanceReviewPersonDays } from '../../utils/api'
import Modal, { ModalBody } from '../ui/Modal'

/**
 * PR-7 — escalation ladder badge and the person history window (admin).
 * Ladder (D-10): 1st month in the window → warning, 2nd → deduction, 3rd+ → deduction + HR hearing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ymLabel = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '')
const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
const ist = (t) => { if (!t) return ''; const d = new Date(`${String(t).replace(' ', 'T')}Z`); return isNaN(d) ? t : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) }

export function LadderBadge({ ladder }) {
  if (!ladder) return null
  const title = `Months on a list in the window: ${ladder.months.map(ymLabel).join(', ')}`
  if (ladder.hearing) return <span className="text-[11px] rounded bg-red-100 text-red-800 px-1.5 py-0.5 font-semibold" title={title} data-testid="ladder-hearing">{ord(ladder.step)} month · HR hearing</span>
  if (ladder.downgraded_days) return <span className="text-[11px] rounded bg-amber-100 text-amber-800 px-1.5 py-0.5" title={`${title}. The rules gave ${ladder.downgraded_days} day(s); the first month is a warning.`} data-testid="ladder-first">1st month · warning (rules: {ladder.downgraded_days} d)</span>
  return <span className="text-[11px] rounded bg-slate-100 text-slate-700 px-1.5 py-0.5" title={title} data-testid="ladder-step">{ord(ladder.step)} month</span>
}

// G10 — why each day was counted or excused (labels for the engine's reason codes)
const REASON = {
  stayed_late: 'stayed late the evening before', full_hours: 'full shift hours worked', release_day: 'plant release day',
  sunday: 'Sunday', loader: 'loader (lates not assessed)', early_exempt: 'early exits not assessed', contract_loader: 'contract loader',
  shift_fit: 'shift check (full hours)', gate_pass: 'gate pass covered it', missed_out_counted: 'counted as a missed OUT instead',
  plant_late_day: 'plant-wide late day (ticked)',
}
const NOT_ASSESSED = {
  no_master: 'no master shift', night_on_day_master: 'night work on a day master', odd_punch: 'in-punch 3 h+ before the shift',
  half_day: 'half day — not checked', miss_punch: 'miss punch not fixed', not_a_worked_day: 'not a worked day',
  no_attendance_row: 'no attendance', person_left_out: 'person left out of the review', not_assessed: 'not assessed', no_punches: 'no punches',
}
const NOTE = {
  out_not_verified: 'out typed as shift end — not verified', gate_pass_reduced: 'gate pass reduced the minutes', remeasured: 're-measured',
  late_within_grace: 'late within grace', late_misread: 'late reading 10 h+ — dropped', early_within_grace: 'early within grace',
  early_misread: 'early reading 10 h+ — dropped', long_late_counted_despite_full_hours: '2 h+ late — counted despite full hours',
  person_held: 'person held', release_day: 'release day', plant_late_day: 'plant-wide late day',
}
const hm = (m) => (m ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ''}${Math.round(m % 60)}m` : '—')

function Verdict({ v, minutes, kind }) {
  if (v === 'counted') return <span className="font-semibold text-red-700 whitespace-nowrap">{hm(minutes)} · counted</span>
  if (v && v.startsWith('excused:')) {
    const r = v.slice(8)
    return (
      <span className="text-slate-600">{minutes ? `${hm(minutes)} · ` : ''}
        <span className="text-[10px] rounded bg-emerald-50 text-emerald-800 px-1 py-0.5 whitespace-nowrap" data-testid={`ar-day-${kind}-excuse`} data-reason={r}>excused: {REASON[r] || r}</span>
      </span>
    )
  }
  return <span className="text-slate-400">{minutes ? hm(minutes) : '—'}</span>
}

function shiftText(d) {
  if (!d.shift) return '—'
  const s = d.shift
  const t = s.start && s.end ? `${s.start}–${s.end}` : ''
  return `${s.mode === 'remeasure' ? 'Re-measure ' : s.name ? `${s.name} ` : ''}${t}${s.mode === 'night' ? ' (night)' : ''}`.trim()
}

/** G10: every day of one month for one person. `expect` = the month row's counts (late days / early exits). */
export function PersonMonthDays({ code, ym, expect }) {
  const month = Number(ym.slice(5, 7)); const year = Number(ym.slice(0, 4))
  const q = useQuery({ queryKey: ['ar-person-days', code, ym], queryFn: () => attendanceReviewPersonDays(code, month, year), enabled: !!code, retry: 0, staleTime: 0 })
  const d = q.data?.data?.data
  if (q.isLoading) return <p className="text-xs text-slate-500 p-2">Loading days…</p>
  if (q.isError) return <p className="text-xs text-red-600 p-2" data-testid="ar-days-error">{q.error?.response?.data?.error || "Couldn't load the days."}</p>
  if (!d) return null
  const mismatch = expect && (expect.late_days !== d.totals.late_days || expect.early_exits !== d.totals.early_days)
  const p = d.person
  return (
    <div className="space-y-2" data-testid={`ar-days-${ym}`}>
      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
        <span>Measured on: {d.basis === 'master' ? 'current master shift' : 'shift matched at import'}</span>
        <span>Rules: {d.rule_version.source === 'live' ? 'in force now' : `${d.rule_version.source} review`}{d.rule_version.config_id ? ` (v${d.rule_version.config_id})` : ''}</span>
        {d.release_days.length > 0 && <span>Release days: {d.release_days.map((x) => Number(x.slice(8))).join(', ')}</span>}
        {d.late_free_days?.length > 0 && <span>Plant-wide late days: {d.late_free_days.map((x) => Number(x.slice(8))).join(', ')}</span>}
        {p.left_out && <span className="text-amber-700">Left out of the review</span>}
        {p.held && <span className="text-amber-700">Held</span>}
        {p.loader && <span>Loader — lates not assessed</span>}
        {p.early_exempt && <span>Early exits not assessed</span>}
        {p.remeasured && <span>Re-measured on a set shift</span>}
      </div>
      <div className="overflow-x-auto max-w-full border border-slate-200 rounded" data-testid="ar-days-scroll">
        <table className="min-w-[820px] w-full text-[11px]">
          <thead><tr className="text-left text-slate-500 bg-slate-50">
            <th className="px-2 py-1">Date</th><th className="px-2 py-1">Day</th><th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">In</th><th className="px-2 py-1">Out</th><th className="px-2 py-1">Shift used</th>
            <th className="px-2 py-1">Late</th><th className="px-2 py-1">Early</th><th className="px-2 py-1">Notes</th>
          </tr></thead>
          <tbody>
            {d.days.map((x) => {
              const counted = x.late === 'counted' || x.early === 'counted'
              const notes = [
                !x.assessed && x.not_assessed_reason && x.status ? (NOT_ASSESSED[x.not_assessed_reason] || x.not_assessed_reason) : null,
                x.times_from === 'gate_register' ? 'times from gate register' : null,
                x.missed_out ? 'missed OUT counted as an early exit' : null,
                x.missed_punch && x.missed_punch.bulk_day ? 'system failure day' : null,
                x.gate_pass ? `gate pass ${x.gate_pass.hours} h` : null,
                ...(x.notes || []).filter((n) => (n !== 'release_day' || x.early === 'none') && (n !== 'plant_late_day' || x.late === 'none')).map((n) => NOTE[n] || n),
              ].filter(Boolean)
              const early = x.missed_out ? x.early_minutes : (x.early_minutes_after_gate_pass ?? x.early_minutes)
              return (
                <tr key={x.date} data-testid={`ar-day-${x.date}`} data-late={x.late} data-early={x.early}
                  className={clsx('border-t border-slate-100', counted ? 'bg-red-50' : x.weekday === 'Sun' && 'bg-slate-50')}>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{x.date.slice(8)}</td>
                  <td className="px-2 py-1">{x.weekday}</td>
                  <td className="px-2 py-1">{x.status || '—'}</td>
                  <td className="px-2 py-1 tabular-nums">{x.in || '—'}</td>
                  <td className="px-2 py-1 tabular-nums">{x.out || '—'}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{x.shift ? shiftText(x) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-2 py-1"><Verdict v={x.late} minutes={x.late_minutes} kind="late" /></td>
                  <td className="px-2 py-1"><Verdict v={x.early} minutes={early} kind="early" /></td>
                  <td className="px-2 py-1 text-slate-500">{notes.join(' · ')}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold" data-testid="ar-days-total">
            <td className="px-2 py-1" colSpan={6}>Counted</td>
            <td className="px-2 py-1 tabular-nums" data-testid="ar-days-total-late" data-days={d.totals.late_days}>{d.totals.late_days} day(s) · {hm(d.totals.late_min)}</td>
            <td className="px-2 py-1 tabular-nums" data-testid="ar-days-total-early" data-days={d.totals.early_days}>{d.totals.early_days} day(s) · {hm(d.totals.early_min)}</td>
            <td className="px-2 py-1 font-normal text-slate-500">{d.totals.missed_out_days ? `incl. ${d.totals.missed_out_days} missed OUT` : ''}</td>
          </tr></tfoot>
        </table>
      </div>
      {mismatch && <p className="text-[11px] text-amber-700" data-testid="ar-days-mismatch">The saved review for this month shows {expect.late_days} late / {expect.early_exits} early — attendance or rules changed after it was saved. The days above are as of now.</p>}
    </div>
  )
}

export function PersonHistory({ code, month, year, onClose }) {
  const [open, setOpen] = useState({})
  const to = `${year}-${String(month).padStart(2, '0')}`
  const q = useQuery({ queryKey: ['ar-person', code, to], queryFn: () => attendanceReviewPerson(code, to), enabled: !!code, retry: 0, staleTime: 0 })
  const d = q.data?.data?.data
  return (
    <Modal open={!!code} onClose={onClose} title={`History — ${code}${d?.employee?.name ? ` ${d.employee.name}` : ''}`} size="full">
      <ModalBody>
        <div className="space-y-4 text-sm" data-testid="ar-person">
          {q.isLoading && <p className="text-slate-500">Loading…</p>}
          {q.isError && <p className="text-red-600">Couldn't load the history.</p>}
          {d && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500 bg-slate-50">
                    <th className="px-2 py-1">Month</th><th className="px-2 py-1">From</th><th className="px-2 py-1 text-right">Late days</th>
                    <th className="px-2 py-1 text-right">Early exits</th><th className="px-2 py-1">List</th><th className="px-2 py-1">Action</th>
                    <th className="px-2 py-1 text-right">Days</th><th className="px-2 py-1">Ladder</th><th className="px-2 py-1">Notice</th>
                  </tr></thead>
                  <tbody>
                    {d.months.map((m) => (
                      <React.Fragment key={m.ym}>
                      <tr className="border-t border-slate-100" data-testid={`ar-person-${m.ym}`}>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {m.source !== 'no attendance' ? (
                            <button type="button" className="text-blue-700 hover:underline inline-flex items-center gap-1" data-testid={`ar-person-expand-${m.ym}`}
                              aria-expanded={!!open[m.ym]} title="Show every day of the month"
                              onClick={() => setOpen((o) => ({ ...o, [m.ym]: !o[m.ym] }))}>
                              <span aria-hidden>{open[m.ym] ? '▾' : '▸'}</span>{ymLabel(m.ym)}
                            </button>) : ymLabel(m.ym)}
                        </td>
                        <td className="px-2 py-1 text-slate-500">{m.source === 'live' ? 'computed now' : m.source}</td>
                        {m.source === 'no attendance' ? <td colSpan={7} className="px-2 py-1 text-slate-400">No attendance</td> : (
                          <>
                            <td className="px-2 py-1 text-right tabular-nums">{m.late_days}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{m.early_exits}</td>
                            <td className="px-2 py-1">{m.list || '—'}</td>
                            <td className={clsx('px-2 py-1 font-semibold', m.action === 'deduction' ? 'text-red-700' : m.action === 'warning' ? 'text-amber-700' : 'text-slate-400')}>
                              {m.action ? (m.action === 'deduction' ? 'Deduction' : 'Warning') : '—'}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{m.deduction_days || '—'}</td>
                            <td className="px-2 py-1">{m.ladder ? <LadderBadge ladder={m.ladder} /> : m.strike_step ? <span className="text-[11px] text-slate-500" title="That month's rules had the ladder off">{ord(m.strike_step)} month (ladder off then)</span> : '—'}</td>
                            <td className="px-2 py-1">{[m.notice_late && 'late', m.notice_early && 'early'].filter(Boolean).join(', ') || '—'}</td>
                          </>
                        )}
                      </tr>
                      {open[m.ym] && (
                        <tr><td colSpan={9} className="px-1 py-2 max-w-0"><PersonMonthDays code={code} ym={m.ym} expect={m} /></td></tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="font-semibold text-slate-700 mb-1">Notice board</div>
                {d.boards.length ? (
                  <ul className="list-disc pl-5 text-xs" data-testid="ar-person-boards">
                    {d.boards.map((b) => <li key={b.print_id}>{ymLabel(b.ym)}, up to {b.to} — {b.as === 'named' ? `named (${b.lates} late, ${b.early} early, ${b.missed} missed)` : 'on time every day'} · printed {ist(b.printed_at)}</li>)}
                  </ul>) : <p className="text-xs text-slate-400">Not on any printed board.</p>}
              </div>
              <div>
                <div className="font-semibold text-slate-700 mb-1">Sent to finance by the review</div>
                {d.finance.length ? (
                  <ul className="list-disc pl-5 text-xs" data-testid="ar-person-finance">
                    {d.finance.map((f) => <li key={f.id}>{ymLabel(f.ym)} — {f.deduction_days} day(s), {f.finance_status}{f.applied ? ', in salary' : ''}{f.run_id ? ` (review run ${f.run_id})` : ''}</li>)}
                  </ul>) : <p className="text-xs text-slate-400">Nothing sent.</p>}
              </div>
            </>
          )}
        </div>
      </ModalBody>
    </Modal>
  )
}
