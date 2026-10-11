import React from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { attendanceReviewPerson } from '../../utils/api'
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

export function PersonHistory({ code, month, year, onClose }) {
  const to = `${year}-${String(month).padStart(2, '0')}`
  const q = useQuery({ queryKey: ['ar-person', code, to], queryFn: () => attendanceReviewPerson(code, to), enabled: !!code, retry: 0, staleTime: 0 })
  const d = q.data?.data?.data
  return (
    <Modal open={!!code} onClose={onClose} title={`History — ${code}${d?.employee?.name ? ` ${d.employee.name}` : ''}`} size="xl">
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
                      <tr key={m.ym} className="border-t border-slate-100" data-testid={`ar-person-${m.ym}`}>
                        <td className="px-2 py-1 whitespace-nowrap">{ymLabel(m.ym)}</td>
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
