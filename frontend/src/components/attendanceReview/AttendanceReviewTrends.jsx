import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts'
import clsx from 'clsx'
import { attendanceReviewTrends } from '../../utils/api'

/**
 * Attendance Review → Trends (T2/T3). Month by month for the chosen range, from each month's final review, else its draft,
 * else a live computation with the current rules — every month says which. Click any month (a point, a bar, a heat-map cell)
 * to open that month's review. Colours: two categorical slots (blue, orange) validated for colour-blind separation; heat map
 * is one hue, light → dark. Legends + direct labels so nothing relies on colour alone; every chart has a table view.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const C = { s1: '#2a78d6', s2: '#eb6834', grid: '#e7e5e4', axis: '#78716c', ink: '#0b0b0b', ink2: '#52514e' }
// sequential blue, step 100 → 700
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']
const SOURCE = { final: 'Final', draft: 'Draft', live: 'Not reviewed — computed now' }
const GROUPS = [['all', 'All workers'], ['company', 'Company'], ['contract', 'Contract']]
const RANGES = [3, 6, 12]

const pad = (n) => String(n).padStart(2, '0')
/** Direct label on the latest month only (selective labels; the tooltip carries the rest). */
const lastLabel = (len) => function LastLabel({ x, y, value, index }) {
  if (index !== len - 1 || x == null || y == null) return null
  return <text x={x} y={y - 9} textAnchor="end" fontSize={11} fill={C.ink2}>{num(value, 1)}%</text>
}
const label = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`
const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
/** ₹ in Indian notation; lakh above 1,00,000. */
const inr = (n) => { const v = Math.round(Number(n) || 0); return v >= 100000 ? `₹${num(v / 100000, 2)} lakh` : `₹${v.toLocaleString('en-IN')}` }
function rangeEnding(month, year, n) {
  let m = month - (n - 1); let y = year
  while (m < 1) { m += 12; y -= 1 }
  return { from: `${y}-${pad(m)}`, to: `${year}-${pad(month)}` }
}

function Card({ title, sub, children, testid }) {
  return (
    <div className="card overflow-hidden" data-testid={testid}>
      <div className="px-4 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function TipBox({ ym, source, rows, foot }) {
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs min-w-[11rem]">
      <div className="font-semibold text-slate-800">{label(ym)} <span className="font-normal text-slate-500">· {SOURCE[source] || source}</span></div>
      {rows.map(([name, value, color]) => (
        <div key={name} className="flex items-center justify-between gap-4 mt-1">
          <span className="flex items-center gap-1.5 text-slate-600">{color && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />}{name}</span>
          <span className="tabular-nums font-medium text-slate-900">{value}</span>
        </div>
      ))}
      {foot && <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-slate-500">{foot}</div>}
    </div>
  )
}

/** Final months: solid dot; draft / live: hollow — the month's figures may still change. */
function SourceDot({ cx, cy, payload, stroke }) {
  if (cx == null || cy == null) return null
  const solid = payload.source === 'final'
  return <circle cx={cx} cy={cy} r={4.5} fill={solid ? stroke : '#fff'} stroke={stroke} strokeWidth={2} />
}

function Delta({ a, b, unit = '', better = 'down', d = 1 }) {
  if (a == null || b == null) return null
  const diff = b - a
  if (Math.abs(diff) < 0.05) return <span className="text-slate-500">no change</span>
  const good = better === 'down' ? diff < 0 : diff > 0
  return <span className={good ? 'text-emerald-700' : 'text-red-700'}>{diff > 0 ? '▲' : '▼'} {num(Math.abs(diff), d)}{unit}</span>
}

function Stat({ label: l, value, sub }) {
  return (
    <div className="card p-3">
      <div className="text-xl font-bold tabular-nums text-slate-800">{value}</div>
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{l}</div>
      {sub && <div className="text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function Heatmap({ months, onOpen }) {
  const [hover, setHover] = useState(null)
  const rows = useMemo(() => {
    const by = new Map()
    for (const m of months) for (const d of m.departments) {
      const r = by.get(d.department) || { department: d.department, total: 0, cells: {} }
      r.cells[m.ym] = d; r.total += d.workdays_lost; by.set(d.department, r)
    }
    return [...by.values()].sort((a, b) => b.total - a.total).slice(0, 12)
  }, [months])
  const max = Math.max(0.1, ...rows.flatMap((r) => Object.values(r.cells).map((c) => c.time_lost_pct)))
  const shade = (v) => SEQ[Math.min(SEQ.length - 1, Math.round((v / max) * (SEQ.length - 1)))]
  if (!rows.length) return <p className="text-sm text-slate-400 px-1">No department figures in this range.</p>
  return (
    <div className="overflow-x-auto" data-testid="ar-trends-heatmap">
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr>
          <th className="text-left font-medium text-slate-500 pr-2 sticky left-0 bg-white">Department</th>
          {months.map((m) => <th key={m.ym} className="font-medium text-slate-500 px-1 whitespace-nowrap">{label(m.ym)}</th>)}
          <th className="font-medium text-slate-500 pl-2 text-right whitespace-nowrap">Workdays lost</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.department}>
            <td className="pr-2 text-slate-700 whitespace-nowrap sticky left-0 bg-white max-w-[12rem] truncate" title={r.department}>{r.department}</td>
            {months.map((m) => {
              const c = r.cells[m.ym]
              if (!c) return <td key={m.ym} className="w-14 h-8 rounded bg-slate-50 text-center text-slate-300">—</td>
              const bg = shade(c.time_lost_pct); const dark = SEQ.indexOf(bg) >= 7
              const on = hover && hover.d === r.department && hover.ym === m.ym
              return (
                <td key={m.ym} className={clsx('w-14 h-8 rounded text-center tabular-nums cursor-pointer', on && 'ring-2 ring-slate-800')}
                  style={{ background: bg, color: dark ? '#fff' : C.ink }}
                  onMouseEnter={() => setHover({ d: r.department, ym: m.ym, c })} onMouseLeave={() => setHover(null)}
                  onClick={() => onOpen(m.ym)} aria-label={`${r.department} ${label(m.ym)}: ${num(c.time_lost_pct, 2)}% time lost`}>
                  {num(c.time_lost_pct, 1)}
                </td>
              )
            })}
            <td className="pl-2 text-right tabular-nums text-slate-700">{num(r.total, 1)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">0%<span className="inline-flex">{SEQ.filter((_, i) => i % 2 === 0).map((s) => <span key={s} className="w-4 h-2.5" style={{ background: s }} />)}</span>{num(max, 1)}% of scheduled time lost</span>
        <span data-testid="ar-trends-heat-hover" className="text-slate-700">
          {hover ? `${hover.d}, ${label(hover.ym)}: ${num(hover.c.time_lost_pct, 2)}% time lost · ${num(hover.c.workdays_lost, 1)} workdays · ${hover.c.late_days} lates · ${hover.c.early_exits} early exits · ${hover.c.people} people`
            : 'Point at a cell for the detail; click it to open that month.'}
        </span>
      </div>
    </div>
  )
}

export default function AttendanceReviewTrends({ month, year, onOpenMonth, range: n = 6, onRange: setN }) {
  const [group, setGroup] = useState('all')
  const [tables, setTables] = useState(false)
  const { from, to } = rangeEnding(month, year, n)
  const q = useQuery({ queryKey: ['ar-trends', from, to], queryFn: () => attendanceReviewTrends(from, to), retry: 0, staleTime: 60_000 })
  const d = q.data?.data?.data
  const months = d?.months || []
  const data = useMemo(() => months.map((m) => ({
    ym: m.ym, x: label(m.ym), source: m.source,
    late: m[group].late_pct, early: m[group].early_pct, lost: m[group].time_lost_pct,
    late_days: m[group].late_days, early_exits: m[group].early_exits, people: m[group].people, worked: m[group].worked_days,
    deductions: m.action.deductions, warnings: m.action.warnings, deduction_days: m.action.deduction_days, amount: m.action.indicative_amount, on_list: m.action.people,
  })), [months, group])
  const first = data[0]; const last = data[data.length - 1]
  const open = (ym) => { if (ym) onOpenMonth(Number(ym.slice(5)), Number(ym.slice(0, 4))) }
  const clickChart = (e) => open(e?.activePayload?.[0]?.payload?.ym)

  return (
    <div className="space-y-4" data-testid="ar-trends">
      {/* filters: one row, above every chart */}
      <div className="card p-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600">Range</span>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={n === r} onClick={() => setN(r)}
              className={clsx('px-3 py-1', n === r ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>{r} months</button>
          ))}
        </div>
        <span className="text-slate-600 ml-2">Workers</span>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden" role="group" aria-label="Workers">
          {GROUPS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)}
              className={clsx('px-3 py-1', group === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 ml-auto text-slate-600"><input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> Show as tables</label>
      </div>

      {q.isLoading && <div className="card p-6 text-sm text-slate-500">Working out {n} months… months without a final review are computed now, which takes a few seconds.</div>}
      {q.isError && <div className="card p-6 text-sm text-red-700">{q.error?.response?.data?.error || 'Could not load trends.'}</div>}
      {d && months.length === 0 && <div className="card p-6 text-sm text-slate-500">No attendance in {label(from)} – {label(to)}.</div>}

      {d && months.length > 0 && (
        <>
          <p className="text-xs text-slate-600" data-testid="ar-trends-sources">
            {months.map((m) => `${label(m.ym)}: ${SOURCE[m.source]}`).join(' · ')}
            {d.skipped?.length > 0 && <> · left out: {d.skipped.map((s) => `${label(s.ym)} (${s.reason})`).join(', ')}</>}
            . Solid points are final reviews; hollow points can still change.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="ar-trends-stats">
            <Stat label={`Late days, ${label(last.ym)}`} value={`${num(last.late, 1)}%`} sub={data.length > 1 && <>vs {label(first.ym)}: <Delta a={first.late} b={last.late} unit=" pts" /></>} />
            <Stat label={`Early exits, ${label(last.ym)}`} value={`${num(last.early, 1)}%`} sub={data.length > 1 && <>vs {label(first.ym)}: <Delta a={first.early} b={last.early} unit=" pts" /></>} />
            <Stat label={`Time lost, ${label(last.ym)}`} value={`${num(last.lost, 1)}%`} sub={data.length > 1 && <>vs {label(first.ym)}: <Delta a={first.lost} b={last.lost} unit=" pts" /></>} />
            <Stat label={`Deductions, ${label(last.ym)}`} value={num(last.deductions)} sub={data.length > 1 && <>vs {label(first.ym)}: <Delta a={first.deductions} b={last.deductions} d={0} /></>} />
          </div>

          {tables ? (
            <Card title="Figures by month" testid="ar-trends-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                    {['Month', 'Source', 'People', 'Late %', 'Early exit %', 'Time lost %', 'On the list', 'Deductions', 'Warnings', 'Deduction days', 'Indicative ₹'].map((h, i) =>
                      <th key={h} className={clsx('px-3 py-2 font-medium whitespace-nowrap', i > 1 ? 'text-right' : 'text-left')}>{h}</th>)}
                  </tr></thead>
                  <tbody>{data.map((r) => (
                    <tr key={r.ym} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => open(r.ym)}>
                      <td className="px-3 py-1.5 font-medium">{r.x}</td><td className="px-3 py-1.5 text-slate-600">{SOURCE[r.source]}</td>
                      {[num(r.people), num(r.late, 1), num(r.early, 1), num(r.lost, 1), num(r.on_list), num(r.deductions), num(r.warnings), num(r.deduction_days, 1), inr(r.amount)]
                        .map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums">{v}</td>)}
                    </tr>))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card title="Late arrivals and early exits" sub="Share of worked days with a counted late / early exit. Click a month to open it." testid="ar-trends-rates">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: -12 }} onClick={clickChart} style={{ cursor: 'pointer' }}>
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="x" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis tick={{ fontSize: 11, fill: C.axis }} unit="%" tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ stroke: C.axis, strokeDasharray: '3 3' }} content={({ active, payload }) => active && payload?.length ? (
                        <TipBox ym={payload[0].payload.ym} source={payload[0].payload.source}
                          rows={[['Late', `${num(payload[0].payload.late, 1)}% (${num(payload[0].payload.late_days)} days)`, C.s1],
                            ['Early exit', `${num(payload[0].payload.early, 1)}% (${num(payload[0].payload.early_exits)})`, C.s2]]}
                          foot={`${num(payload[0].payload.people)} people · ${num(payload[0].payload.worked)} worked days`} />) : null} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="linear" dataKey="late" name="Late %" stroke={C.s1} strokeWidth={2} dot={<SourceDot />} activeDot={{ r: 6 }} isAnimationActive={false}>
                        <LabelList dataKey="late" content={lastLabel(data.length)} />
                      </Line>
                      <Line type="linear" dataKey="early" name="Early exit %" stroke={C.s2} strokeWidth={2} dot={<SourceDot />} activeDot={{ r: 6 }} isAnimationActive={false}>
                        <LabelList dataKey="early" content={lastLabel(data.length)} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Action list" sub="People on the list each month — deductions and warnings. Tooltip shows days and the indicative amount." testid="ar-trends-actions">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: -12 }} onClick={clickChart} style={{ cursor: 'pointer' }} barCategoryGap="30%">
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="x" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: '#f5f5f4' }} content={({ active, payload }) => active && payload?.length ? (
                        <TipBox ym={payload[0].payload.ym} source={payload[0].payload.source}
                          rows={[['Deductions', num(payload[0].payload.deductions), C.s1], ['Warnings', num(payload[0].payload.warnings), C.s2],
                            ['Deduction days', num(payload[0].payload.deduction_days, 1)], ['Indicative amount', inr(payload[0].payload.amount)]]}
                          foot="Indicative only — payroll computes the final figure." />) : null} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="deductions" name="Deductions" stackId="a" fill={C.s1} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
                      <Bar dataKey="warnings" name="Warnings" stackId="a" fill={C.s2} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        <LabelList dataKey="on_list" position="top" style={{ fontSize: 10, fill: C.ink2 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Time lost" sub="Late + early minutes as a share of scheduled time." testid="ar-trends-lost">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: -12 }} onClick={clickChart} style={{ cursor: 'pointer' }}>
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="x" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis tick={{ fontSize: 11, fill: C.axis }} unit="%" tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ stroke: C.axis, strokeDasharray: '3 3' }} content={({ active, payload }) => active && payload?.length ? (
                        <TipBox ym={payload[0].payload.ym} source={payload[0].payload.source} rows={[['Time lost', `${num(payload[0].payload.lost, 2)}%`, C.s1]]} />) : null} />
                      <Line type="linear" dataKey="lost" name="Time lost %" stroke={C.s1} strokeWidth={2} dot={<SourceDot />} activeDot={{ r: 6 }} isAnimationActive={false}>
                        <LabelList dataKey="lost" content={lastLabel(data.length)} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Where time is lost, by department" sub="Time lost % per month, top 12 departments by workdays lost in the range. All workers." testid="ar-trends-departments">
                <Heatmap months={months} onOpen={open} />
              </Card>
            </div>
          )}

          <Card title={`On the list again (${d.repeaters.length})`} sub="People on the action list in two or more months of this range." testid="ar-trends-repeaters">
            {d.repeaters.length === 0 ? <p className="text-sm text-slate-500 px-1">No one was on the list more than once in this range.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <th className="px-3 py-2 text-left font-medium">Code</th><th className="px-3 py-2 text-left font-medium">Name</th><th className="px-3 py-2 text-left font-medium">Department</th>
                    {months.map((m) => <th key={m.ym} className="px-2 py-2 text-center font-medium whitespace-nowrap">{label(m.ym)}</th>)}
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Deduction days</th><th className="px-3 py-2 text-right font-medium whitespace-nowrap">Workdays lost</th>
                  </tr></thead>
                  <tbody>{d.repeaters.map((p) => {
                    const at = new Map(p.months.map((x) => [x.ym, x]))
                    return (
                      <tr key={p.code} className="border-t border-slate-100" data-code={p.code}>
                        <td className="px-3 py-1.5 font-mono">{p.code}</td><td className="px-3 py-1.5">{p.name}</td><td className="px-3 py-1.5 text-slate-600">{p.department}</td>
                        {months.map((m) => {
                          const x = at.get(m.ym)
                          return (
                            <td key={m.ym} className="px-2 py-1.5 text-center" title={x ? `${label(m.ym)}: ${x.action === 'deduction' ? `deduction ${x.deduction_days} d` : 'warning'}` : `${label(m.ym)}: not on the list`}>
                              {x ? (x.action === 'deduction'
                                ? <span className="inline-block w-3 h-3 rounded-full" style={{ background: C.s1 }} aria-label="deduction" />
                                : <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: C.s2 }} aria-label="warning" />)
                                : <span className="text-slate-300">·</span>}
                            </td>
                          )
                        })}
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(p.deduction_days, 1)}</td><td className="px-3 py-1.5 text-right tabular-nums">{num(p.workdays_lost, 1)}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: C.s1 }} /> deduction</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: C.s2 }} /> warning</span>
                  <span>· not on the list</span>
                </p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
