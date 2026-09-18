// Contractor Report — Grid View tab. Read-only, interactive.
//
// Two performance rules this file exists to honour (owner rulings, 19 Sep 2026):
//
//  R-14  The sticky employee-name column must be OPAQUE white. A translucent
//        sticky background made names paint blank in Chrome during scroll.
//        The background is set with an inline style so the zebra rule in
//        index.css (`.table-compact tbody tr:nth-child(even) td`) cannot win.
//
//  R-15  Hover and selection must NOT re-render the grid (~2,800 cells).
//        <GridBody> is memoised on the data alone — selection is not a prop.
//        Highlighting is applied imperatively to DOM nodes via a table ref,
//        so moving the mouse across the grid triggers zero React renders.
//        Keyboard handling is bound to the scroll container (tabIndex=0);
//        there is no global keydown listener.
import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react'
import {
  money, days1, dateLong, dateShort, isSunday, monthLabel,
  SUN_MARK, MOON_MARK, RoleBadge, Loading, ErrorState,
} from './shared'

const ROLE_ORDER = ['Supervisor', 'Loading', 'Helper', 'Guard', 'Sweeper']
const roleRank = (r) => {
  const i = ROLE_ORDER.indexOf(r)
  return i >= 0 ? i : r === 'No designation' ? ROLE_ORDER.length + 1 : ROLE_ORDER.length
}

const PRESENT = { P: 1, WOP: 1, '½P': 0.5, 'WO½P': 0.5 }
const weightOf = (s) => PRESENT[s] || 0

const CELL_LETTER = { P: 'P', WOP: 'W', '½P': '½', 'WO½P': '½', A: 'A', WO: 'WO' }

// Night is purple to match AttendanceRegister's convention.
function cellClass(cell) {
  if (!cell) return 'bg-slate-50 text-slate-300'
  const { status, night } = cell
  if (weightOf(status) > 0) {
    if (night) return 'bg-purple-50 text-purple-700'
    if (status === 'WOP') return 'bg-teal-50 text-teal-700'
    if (status === 'P') return 'bg-emerald-50 text-emerald-700'
    return 'bg-amber-50 text-amber-700'
  }
  if (status === 'A') return 'bg-red-50 text-red-700'
  if (status === 'WO') return 'bg-slate-50 text-slate-400'
  return 'bg-slate-50 text-slate-300'
}

const PRE_JOINING_RING = { boxShadow: 'inset 0 0 0 1.5px #ef4444' }
const STICKY_NAME = { position: 'sticky', left: 0, backgroundColor: '#ffffff', zIndex: 1 }

// ─── the grid body — memoised, selection-independent (R-15) ───────────────
const GridBody = memo(function GridBody({ rows, days, footer, grouped }) {
  let lastRole = null
  const colCount = days.length + 6
  return (
    <table className="border-separate border-spacing-[2px]" data-grid="1">
      <thead>
        <tr>
          <th className="text-left text-xs px-2 min-w-[190px] max-w-[190px]" style={STICKY_NAME}>Employee</th>
          {days.map((d) => (
            <th
              key={d.date} data-col={d.date} scope="col" title={dateLong(d.date)}
              className={`min-w-[26px] text-[10px] font-semibold cursor-pointer ${isSunday(d.date) ? 'text-red-600' : 'text-slate-400'}`}
            >
              {d.day}
              <div className="font-normal">{dateLong(d.date)[0]}</div>
            </th>
          ))}
          <th className="px-1 text-xs">{SUN_MARK}</th>
          <th className="px-1 text-xs">{MOON_MARK}</th>
          <th className="px-1 text-xs text-slate-400">Days</th>
          <th className="px-1 text-xs text-slate-400">Payroll</th>
          <th className="px-1 text-xs"></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td className="text-sm text-slate-400 px-2" style={STICKY_NAME}>No one matches these filters</td>
            <td colSpan={colCount - 1}></td>
          </tr>
        )}
        {rows.map((emp) => {
          const header = grouped && emp.role !== lastRole
          if (header) lastRole = emp.role
          const s = emp.stats
          return [
            header && (
              <tr key={emp.code + '-g'}>
                <td className="text-xs font-semibold text-slate-500 px-2 pt-2" style={STICKY_NAME}>
                  {emp.role} · {rows.filter((r) => r.role === emp.role).length}
                </td>
                <td colSpan={colCount - 1}></td>
              </tr>
            ),
            <tr key={emp.code} data-row={emp.code}>
              <td
                className="text-xs px-2 truncate cursor-pointer min-w-[190px] max-w-[190px]"
                style={STICKY_NAME} data-name={emp.code}
                title={`${emp.code} ${emp.name}${emp.doj ? ', joined ' + emp.doj : ', no joining date'}`}
              >
                <span className="font-mono text-slate-400">{emp.code}</span> {emp.name}
              </td>
              {days.map((d) => {
                const cell = emp.cells[d.date]
                return (
                  <td
                    key={d.date}
                    data-r={emp.code} data-i={d.date}
                    style={cell?.preJoining ? PRE_JOINING_RING : undefined}
                    className={`h-6 min-w-[26px] text-center text-[11px] font-semibold rounded cursor-pointer ${cellClass(cell)}`}
                  >
                    {cell ? CELL_LETTER[cell.status] ?? '' : ''}
                  </td>
                )
              })}
              <td className="px-1.5 text-center text-xs font-bold tabular-nums text-slate-600">{s.dayShifts}</td>
              <td className="px-1.5 text-center text-xs font-bold tabular-nums text-slate-600">{s.nightShifts}</td>
              <td className="px-1.5 text-center text-xs font-bold tabular-nums text-slate-600">{days1(s.manDays)}</td>
              <td className="px-1.5 text-center text-xs font-bold tabular-nums text-slate-600">
                {s.payrollDays == null ? '—' : days1(s.payrollDays)}
              </td>
              <td className="px-1.5 text-center text-xs">
                {s.tie == null
                  ? <span className="text-slate-300">—</span>
                  : s.tie
                    ? <span className="text-emerald-700" title="Ties to payroll">✓</span>
                    : <span className="badge-red" title="Payroll days differ">≠</span>}
              </td>
            </tr>,
          ]
        })}

        {[
          { key: 'day', label: <>{SUN_MARK} Day heads</>, pick: (f) => f.bioDay, warn: false },
          { key: 'night', label: <>{MOON_MARK} Night heads</>, pick: (f) => f.bioNight, warn: false },
          { key: 'dw', label: 'Daily-wage heads', pick: (f) => f.dwHeads, warn: true },
        ].map((row) => (
          <tr key={row.key}>
            <td className="text-xs font-semibold px-2 pt-2" style={STICKY_NAME}>{row.label}</td>
            {days.map((d) => {
              const f = footer[d.date] || {}
              const v = row.pick(f) || 0
              const red = row.warn && f.bothSource
              return (
                <td
                  key={d.date} data-col={d.date}
                  className={`text-center text-[11px] font-semibold tabular-nums cursor-pointer rounded ${red ? 'bg-red-50 text-red-700' : 'text-slate-500'}`}
                >
                  {v || ''}
                </td>
              )
            })}
            <td colSpan={5}></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
})

// ─── selection panel ──────────────────────────────────────────────────────
function Panel({ sel, byCode, report, onOpenDay, onSelectRow }) {
  if (!sel) {
    return (
      <span className="text-sm text-slate-400">
        Click a cell to see that person on that day, a name for their month, or a date for the whole gang that day.
      </span>
    )
  }
  const c = report.contractor
  const f = sel.date ? report.footer[sel.date] : null
  const gangLine = f
    ? <>{c} that day: ☀ {f.bioDay} day and ☾ {f.bioNight} night on biometric, {f.dwHeads} daily-wage heads.{f.bothSource ? ' ' : ''}{f.bothSource && <span className="badge-red">Both sources</span>}</>
    : <>{c} had no biometric punches or daily-wage entries.</>

  const openBtn = sel.date && (
    <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => onOpenDay(sel.date)}>
      Open day report
    </button>
  )

  if (sel.type === 'col') {
    return (
      <div className="flex flex-col gap-2">
        <div><strong>{dateLong(sel.date)}</strong> · {c}</div>
        <div className="text-slate-500">{gangLine}</div>
        <div>{openBtn}</div>
      </div>
    )
  }

  const emp = byCode.get(sel.code)
  if (!emp) return <span className="text-sm text-slate-400">That person is no longer in view.</span>
  const s = emp.stats

  if (sel.type === 'row') {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <span className="font-mono text-slate-400">{emp.code}</span> <strong>{emp.name}</strong> · {c} ·{' '}
          <RoleBadge role={emp.role} /> · joined {emp.doj || '—'}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="badge-yellow">☀ {s.dayShifts} day shifts</span>
          <span className="badge-purple">☾ {s.nightShifts} night shifts</span>
          {s.halfDays > 0 && <span className="badge-yellow">{s.halfDays} half days</span>}
          {s.wop > 0 && <span className="badge-blue">{s.wop} worked weekly off</span>}
          <span className="badge-red">{s.absent} absent</span>
          <span className="badge-gray">{s.weeklyOff} weekly off</span>
          {s.preJoining > 0 && <span className="badge-red">{s.preJoining} days before joining</span>}
        </div>
        <div className="text-slate-500">
          {monthLabel(report.month)}: first punch {s.firstPunch ? dateShort(s.firstPunch) : '—'}, last punch{' '}
          {s.lastPunch ? dateShort(s.lastPunch) : '—'}. Biometric man-days {days1(s.manDays)}, payroll days{' '}
          {s.payrollDays == null ? 'not computed' : days1(s.payrollDays)}
          {s.tie === false && <> <span className="badge-red">does not tie</span></>}
          {s.tie === true && <> <span className="badge-green">ties</span></>}.
        </div>
      </div>
    )
  }

  // a single cell
  const cell = emp.cells[sel.date]
  const present = cell && weightOf(cell.status) > 0
  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="font-mono text-slate-400">{emp.code}</span> <strong>{emp.name}</strong> · {c} ·{' '}
        <RoleBadge role={emp.role} /> · {dateLong(sel.date)}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {present
          ? <><span className="badge-green">{cell.status}</span>{cell.night ? <span className="badge-purple">☾ Night</span> : <span className="badge-yellow">☀ Day</span>}</>
          : cell?.status === 'A' ? <span className="badge-red">Absent</span>
            : cell?.status === 'WO' ? <span className="badge-gray">Weekly off</span>
              : <span className="badge-gray">No attendance row</span>}
        {present && cell.preJoining && (
          <span className="badge-red">Before joining {emp.doj} — not paid by payroll</span>
        )}
        {!emp.doj && <span className="badge-gray">No joining date</span>}
      </div>
      <div className="text-slate-500">{gangLine}</div>
      <div className="flex gap-2">
        {openBtn}
        <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={() => onSelectRow(emp.code)}>
          Whole month for this person
        </button>
      </div>
    </div>
  )
}

// ─── tab ──────────────────────────────────────────────────────────────────
export default function GridViewTab({ report, isLoading, error, contractor, contractors, setContractor, onOpenDay }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('role')
  const [shift, setShift] = useState('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sel, setSel] = useState(null)

  const tableRef = useRef(null)
  const hoverColRef = useRef(null)

  const rows = useMemo(() => {
    if (!report) return []
    let list = report.employees
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((e) => e.name.toLowerCase().includes(needle) || String(e.code).includes(needle))
    }
    if (shift === 'night') list = list.filter((e) => e.stats.nightShifts > 0)
    else if (shift === 'day') list = list.filter((e) => e.stats.nightShifts === 0)
    if (flaggedOnly) {
      list = list.filter((e) => e.stats.preJoining > 0 || e.stats.tie === false || !e.doj)
    }
    const by = {
      role: (a, b) => roleRank(a.role) - roleRank(b.role) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      code: (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }),
      days: (a, b) => b.stats.manDays - a.stats.manDays,
      night: (a, b) => b.stats.nightShifts - a.stats.nightShifts || a.name.localeCompare(b.name),
      joined: (a, b) => String(a.doj || '9999').localeCompare(String(b.doj || '9999')),
    }
    return [...list].sort(by[sort] || by.role)
  }, [report, q, sort, shift, flaggedOnly])

  const byCode = useMemo(() => new Map(rows.map((e) => [e.code, e])), [rows])

  // Drop a selection whose row has been filtered away.
  useEffect(() => {
    if (sel?.code && !byCode.has(sel.code)) setSel(null)
  }, [byCode, sel])

  // R-15: paint the selection straight onto the DOM. No grid re-render.
  useEffect(() => {
    const table = tableRef.current
    if (!table) return
    const clear = (nodes) => nodes.forEach((n) => {
      n.style.outline = ''
      n.style.outlineOffset = ''
      n.style.background = ''
    })
    clear(table.querySelectorAll('[data-sel]'))
    table.querySelectorAll('[data-sel]').forEach((n) => n.removeAttribute('data-sel'))
    if (!sel) return
    let nodes = []
    if (sel.type === 'cell') nodes = table.querySelectorAll(`td[data-r="${CSS.escape(sel.code)}"][data-i="${sel.date}"]`)
    else if (sel.type === 'row') nodes = table.querySelectorAll(`tr[data-row="${CSS.escape(sel.code)}"] td`)
    else if (sel.type === 'col') nodes = table.querySelectorAll(`[data-col="${sel.date}"], td[data-i="${sel.date}"]`)
    nodes.forEach((n) => {
      n.setAttribute('data-sel', '1')
      n.style.outline = '2px solid #2563eb'
      n.style.outlineOffset = '-2px'
    })
    if (nodes[0]?.scrollIntoView) nodes[0].scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sel, rows])

  // R-15: column hover is pure DOM too — no state, so no render per mouse move.
  const onMouseOver = useCallback((ev) => {
    const table = tableRef.current
    if (!table) return
    const el = ev.target.closest('[data-i], [data-col]')
    const col = el ? (el.getAttribute('data-i') || el.getAttribute('data-col')) : null
    if (col === hoverColRef.current) return
    if (hoverColRef.current) {
      table.querySelectorAll(`[data-col="${hoverColRef.current}"], td[data-i="${hoverColRef.current}"]`)
        .forEach((n) => { n.style.filter = '' })
    }
    hoverColRef.current = col
    if (col) {
      table.querySelectorAll(`[data-col="${col}"], td[data-i="${col}"]`)
        .forEach((n) => { n.style.filter = 'brightness(0.94)' })
    }
  }, [])

  const onMouseLeave = useCallback(() => {
    const table = tableRef.current
    if (table && hoverColRef.current) {
      table.querySelectorAll(`[data-col="${hoverColRef.current}"], td[data-i="${hoverColRef.current}"]`)
        .forEach((n) => { n.style.filter = '' })
    }
    hoverColRef.current = null
  }, [])

  const onClick = useCallback((ev) => {
    const cell = ev.target.closest('td[data-r][data-i]')
    if (cell) { setSel({ type: 'cell', code: cell.getAttribute('data-r'), date: cell.getAttribute('data-i') }); return }
    const name = ev.target.closest('[data-name]')
    if (name) { setSel({ type: 'row', code: name.getAttribute('data-name') }); return }
    const col = ev.target.closest('[data-col]')
    if (col) setSel({ type: 'col', date: col.getAttribute('data-col') })
  }, [])

  // R-15: bound to the scroll container only — no window listener.
  const onKeyDown = useCallback((ev) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(ev.key)) return
    if (!report || !rows.length) return
    const dates = report.days.map((d) => d.date)
    const codes = rows.map((r) => r.code)
    if (ev.key === 'Enter') {
      if (sel?.date) onOpenDay(sel.date)
      ev.preventDefault()
      return
    }
    ev.preventDefault()
    let next
    if (!sel || sel.type !== 'cell') {
      next = { type: 'cell', code: codes[0], date: dates[0] }
    } else {
      let r = codes.indexOf(sel.code)
      let c = dates.indexOf(sel.date)
      if (r < 0) r = 0
      if (c < 0) c = 0
      if (ev.key === 'ArrowUp') r = Math.max(0, r - 1)
      if (ev.key === 'ArrowDown') r = Math.min(codes.length - 1, r + 1)
      if (ev.key === 'ArrowLeft') c = Math.max(0, c - 1)
      if (ev.key === 'ArrowRight') c = Math.min(dates.length - 1, c + 1)
      next = { type: 'cell', code: codes[r], date: dates[c] }
    }
    setSel(next)
  }, [report, rows, sel, onOpenDay])

  return (
    <>
      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-slate-700">
            Grid view · {contractor} · {report ? `${monthLabel(report.month)} ${report.year} · ` : ''}
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </span>
          <div className="flex gap-3 flex-wrap text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-emerald-200" />Present (day)</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-purple-200" />Night</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-teal-200" />WOP</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-amber-200" />Half day</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-red-200" />Absent</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block bg-slate-200" />Week off</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block" style={PRE_JOINING_RING} />Before joining</span>
          </div>
        </div>

        <div className="flex gap-2.5 items-center flex-wrap px-6 py-3 border-b border-slate-100">
          <select
            className="select w-48 py-1.5 text-sm" aria-label="Contractor"
            value={contractor} onChange={(e) => { setContractor(e.target.value); setSel(null) }}
          >
            {contractors.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="input w-56 py-1.5 text-sm" type="search" aria-label="Search employees"
            placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)}
          />
          <label className="text-xs text-slate-500" htmlFor="cr-sort">Sort</label>
          <select id="cr-sort" className="select w-44 py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="role">Department / role</option>
            <option value="name">Name</option>
            <option value="code">Code</option>
            <option value="days">Days worked</option>
            <option value="night">Night shifts</option>
            <option value="joined">Joining date</option>
          </select>
          <label className="text-xs text-slate-500" htmlFor="cr-shift">Shift</label>
          <select id="cr-shift" className="select w-44 py-1.5 text-sm" value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="all">All shifts</option>
            <option value="night">Worked any night</option>
            <option value="day">Day shift only</option>
          </select>
          <label className="text-xs text-slate-600 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Only flagged
          </label>
        </div>

        <div className="mx-6 mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 min-h-[48px]" aria-live="polite">
          {report && <Panel sel={sel} byCode={byCode} report={report} onOpenDay={onOpenDay} onSelectRow={(code) => setSel({ type: 'row', code })} />}
        </div>

        {isLoading && <Loading label="Loading the grid…" />}
        {error && <ErrorState error={error} />}
        {!isLoading && !error && report && (
          <div
            ref={tableRef}
            className="overflow-x-auto p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-xl"
            tabIndex={0}
            aria-label="Attendance grid. Arrow keys move the selection, Enter opens the day report."
            onKeyDown={onKeyDown}
            onClick={onClick}
            onMouseOver={onMouseOver}
            onMouseLeave={onMouseLeave}
          >
            <GridBody rows={rows} days={report.days} footer={report.footer} grouped={sort === 'role'} />
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        Click any cell, name, date or footer count. Arrow keys move the selected cell; Enter opens that day’s report.
      </p>
    </>
  )
}
