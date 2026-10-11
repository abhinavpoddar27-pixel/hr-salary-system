import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { attendanceReviewBoard, attendanceReviewBoardPrint } from '../../utils/api'
import { noticeBoardHtml } from '../../utils/noticeBoardHtml'

/**
 * Attendance Review → Notice board (PR-5, admin only). A printable A4 for the 1st of the month up to a chosen day
 * (default the 15th), from the same engine as the review. Names + codes + counts only. Every print is recorded.
 * The preview below is the exact document that prints.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n) => String(n).padStart(2, '0')
const lastDay = (m, y) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const nice = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` }
const ist = (t) => { if (!t) return ''; const d = new Date(`${String(t).replace(' ', 'T')}Z`); return isNaN(d) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }

/** Prints an HTML document through a hidden iframe (not blocked like a pop-up). The frame stays until the next print. */
function printHtml(html, holder) {
  if (holder.current) holder.current.remove()
  const f = document.createElement('iframe')
  f.setAttribute('data-testid', 'ar-board-print-frame')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print() } catch { toast.error('The browser blocked printing — use Ctrl+P on the preview') } }
  f.srcdoc = html
  document.body.appendChild(f)
  holder.current = f
}

export default function AttendanceReviewBoard({ month, year }) {
  const qc = useQueryClient()
  const ym = `${year}-${pad(month)}`
  const maxDay = lastDay(month, year)
  const [to, setTo] = useState(`${ym}-15`)
  const [company, setCompany] = useState('')
  const [extraSkip, setExtraSkip] = useState([])
  const [skipInput, setSkipInput] = useState('')
  const frameHolder = useRef(null)
  useEffect(() => { setTo(`${ym}-15`); setExtraSkip([]); setSkipInput('') }, [ym])
  useEffect(() => () => { if (frameHolder.current) frameHolder.current.remove() }, [])

  const validTo = to && to.slice(0, 7) === ym
  const q = useQuery({
    queryKey: ['ar-board', ym, to, company, extraSkip.join(',')],
    queryFn: () => attendanceReviewBoard(month, year, to, company, extraSkip),
    enabled: !!validTo, retry: 0,
  })
  const b = q.data?.data?.data || null
  const html = useMemo(() => (b ? noticeBoardHtml(b, null) : ''), [b])

  const print = useMutation({
    mutationFn: () => attendanceReviewBoardPrint({ month, year, to, company: company || undefined, skipDays: extraSkip }),
    onSuccess: (r) => {
      const d = r.data.data
      printHtml(noticeBoardHtml(d.board, { number: d.number, printed_at: d.printed_at, printed_by: d.printed_by }), frameHolder)
      toast.success(`Notice No. ${d.number} recorded — choose the printer in the print window`)
      qc.invalidateQueries({ queryKey: ['ar-board', ym] })
    },
  })

  const addSkip = () => {
    if (!skipInput || skipInput.slice(0, 7) !== ym) { toast.error(`Pick a date in ${MONTHS[month - 1]} ${year}`); return }
    setExtraSkip((s) => [...new Set([...s, skipInput])].sort()); setSkipInput('')
  }
  const m = b?.meta
  const bulkDays = (m?.bulk_miss_punch_days || []).map((x) => x.date)
  const short = m && m.last_data_date && m.last_data_date < to

  return (
    <div className="space-y-4" data-testid="ar-board">
      <div className="card p-4 space-y-3">
        <div>
          <div className="font-semibold text-slate-800">Notice board — {MONTHS[month - 1]} {year}</div>
          <div className="text-xs text-slate-500">For the plant notice board, from the 1st up to the day you choose. Same rules as the review; names, codes and counts only — no money or minutes.</div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">From</span>
            <span className="inline-block px-2 py-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600">{nice(`${ym}-01`)}</span>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">Up to</span>
            <input type="date" data-testid="ar-board-to" className="input py-1.5" value={to} min={`${ym}-01`} max={`${ym}-${pad(maxDay)}`} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">Company</span>
            <select data-testid="ar-board-company" className="input py-1.5" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">All companies</option>
              {(m?.companies || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" data-testid="ar-board-print" className="btn-primary ml-auto"
            disabled={!b || !m?.last_data_date || print.isPending || q.isFetching}
            onClick={() => print.mutate()}>{print.isPending ? 'Recording…' : 'Print notice'}</button>
        </div>
        {!validTo && <p className="text-sm text-red-600">Pick a day in {MONTHS[month - 1]} {year}.</p>}

        <div className="text-sm">
          <div className="text-xs text-slate-500 mb-1">Missed punches are not counted on these days (system failure):</div>
          <div className="flex flex-wrap items-center gap-2" data-testid="ar-board-skip">
            {bulkDays.map((d) => <span key={d} title="Many missed punches plant-wide that day — counted as a system failure" className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">{nice(d)} · auto</span>)}
            {extraSkip.map((d) => (
              <span key={d} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs inline-flex items-center gap-1">{nice(d)}
                <button type="button" aria-label={`Count missed punches on ${nice(d)} again`} className="font-bold" onClick={() => setExtraSkip((s) => s.filter((x) => x !== d))}>×</button></span>
            ))}
            {!bulkDays.length && !extraSkip.length && <span className="text-xs text-slate-400">none</span>}
            <input type="date" data-testid="ar-board-skip-input" className="input py-1 text-xs w-36" value={skipInput} min={`${ym}-01`} max={`${ym}-${pad(maxDay)}`} onChange={(e) => setSkipInput(e.target.value)} />
            <button type="button" data-testid="ar-board-skip-add" className="btn-secondary text-xs py-1" onClick={addSkip}>Skip this day too</button>
          </div>
        </div>
      </div>

      {q.isLoading && <div className="card p-6 text-sm text-slate-500">Building the notice…</div>}
      {q.isError && <div className="card p-6 text-sm text-red-600">Could not build the notice.</div>}
      {b && (
        <>
          <div className="card p-4 text-sm flex flex-wrap gap-x-6 gap-y-1" data-testid="ar-board-summary">
            <span><b data-testid="ar-board-named">{b.counts.listed}</b> named — {b.counts.late} for lates, {b.counts.early} for early exits, {b.counts.missed} for missed punches</span>
            <span><b data-testid="ar-board-spotless">{b.counts.spotless}</b> on time every day</span>
            <span className="text-slate-500">{m.people_assessed} people assessed · {m.basis === 'master' ? 'measured on each person\'s master shift' : 'measured on the shift the import used'}</span>
            {!m.last_data_date && <span className="text-red-600" data-testid="ar-board-nodata">No attendance for this period yet.</span>}
            {short && <span className="text-amber-700" data-testid="ar-board-short">Attendance is in up to {nice(m.last_data_date)} only — the notice covers up to that day.</span>}
            {m.miss_punches_counted_to && m.miss_punches_counted_to < (m.covered_to || to) && <span className="text-slate-500">Missed punches counted up to {nice(m.miss_punches_counted_to)} (today's shifts are still open).</span>}
          </div>

          <div className="card p-2 bg-slate-100">
            <iframe title="Notice preview" data-testid="ar-board-preview" srcDoc={html} className="w-full bg-white mx-auto block shadow" style={{ maxWidth: 820, height: 1100, border: 0 }} />
          </div>

          <div className="card p-4">
            <div className="font-semibold text-slate-800 text-sm mb-2">Printed this month</div>
            {(b.prints || []).length === 0 ? <p className="text-sm text-slate-400">Nothing printed yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="ar-board-history">
                  <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="py-1 pr-3">No.</th><th className="pr-3">Printed</th><th className="pr-3">By</th><th className="pr-3">Covers</th><th className="pr-3">Company</th><th className="pr-3 text-right">Named</th><th className="text-right">On time</th></tr></thead>
                  <tbody>
                    {b.prints.map((p, i) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">{b.prints.length - i}</td><td className="pr-3">{ist(p.printed_at)}</td><td className="pr-3">{p.printed_by}</td>
                        <td className="pr-3">1 – {nice(p.covered_to || p.to)}</td><td className="pr-3">{p.company || 'All'}</td>
                        <td className="pr-3 text-right">{p.listed}</td><td className="text-right">{p.spotless}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
