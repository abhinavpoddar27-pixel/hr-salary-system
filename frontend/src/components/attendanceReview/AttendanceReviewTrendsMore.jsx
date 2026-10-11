import React, { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import clsx from 'clsx'
import { PersonHistory } from './AttendanceReviewPerson'

/**
 * Attendance Review → Trends, T4 sections: how measured lates / early exits became counted ones, ₹ value of the time
 * lost against ₹ actually deducted, the enforcement funnel, bands and weekdays, miss punches, data quality, top people
 * (click a code for the history) and the effect of notes and notice boards. Same engine and rows as the charts above.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const C = { s1: '#2a78d6', s2: '#eb6834', g1: '#a8a29e', g2: '#d6d3d1', g3: '#78716c', grid: '#e7e5e4', axis: '#78716c' }
const label = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`
const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
const inr = (n) => { const v = Math.round(Number(n) || 0); return v >= 100000 ? `₹${num(v / 100000, 2)} lakh` : `₹${v.toLocaleString('en-IN')}` }
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`)
const band = (b) => `${b.from}${b.to ? `–${b.to - 1}` : '+'} min`

function Card({ title, sub, children, testid }) {
  return (
    <div className="card overflow-hidden" data-testid={testid}>
      <div className="px-4 pt-3"><h3 className="text-sm font-semibold text-slate-800">{title}</h3>{sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function T({ head, rows, right = 1, testid, onRow }) {
  return (
    <div className="overflow-x-auto" data-testid={testid}>
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 text-xs text-slate-500 uppercase">
          {head.map((h, i) => <th key={h} className={clsx('px-3 py-2 font-medium whitespace-nowrap', i >= right ? 'text-right' : 'text-left')}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, k) => (
          <tr key={k} className={clsx('border-t border-slate-100', onRow && 'cursor-pointer hover:bg-slate-50')} onClick={onRow ? () => onRow(k) : undefined}>
            {r.map((v, i) => <td key={i} className={clsx('px-3 py-1.5 whitespace-nowrap', i >= right && 'text-right tabular-nums')}>{v}</td>)}
          </tr>))}
        </tbody>
      </table>
    </div>
  )
}

const Chart = ({ children, h = 'h-56' }) => <div className={h}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
const axes = (unit) => [
  <CartesianGrid key="g" vertical={false} stroke={C.grid} />,
  <XAxis key="x" dataKey="x" interval={0} tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />,
  <YAxis key="y" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} allowDecimals={false} unit={unit} />,
  <Tooltip key="t" wrapperStyle={{ fontSize: 12 }} />, <Legend key="l" wrapperStyle={{ fontSize: 12 }} />,
]

export default function TrendsMore({ d, tables, open }) {
  const months = d.months || []
  const [person, setPerson] = useState(null)
  const last = months[months.length - 1]
  const wf = months.filter((m) => m.waterfall).map((m) => ({ x: label(m.ym), ym: m.ym, ...m.waterfall.lates, e_measured: m.waterfall.early.measured,
    e_full: m.waterfall.early.full_hours, e_exempt: m.waterfall.early.exempt, e_mo: m.waterfall.early.missed_out, e_counted: m.waterfall.early.counted,
    value: m.waterfall.value_lost_inr, in_salary: m.funnel ? m.funnel.inr_in_salary : 0, indicative: m.action.indicative_amount }))
  const dist = useMemo(() => {
    const has = months.filter((m) => m.distribution)
    if (!has.length) return null
    const sum = (k) => has[0].distribution[k].map((b, i) => ({ ...b, count: has.reduce((a, m) => a + (m.distribution[k][i]?.count || 0), 0) }))
    const wd = (k) => WD.map((w, i) => ({ x: w, n: has.reduce((a, m) => a + (m.distribution[k][i] || 0), 0) })).filter((r, i) => i !== 0 || r.n > 0)
    return { late: sum('late_bands').map((b) => ({ x: band(b), n: b.count })), early: sum('early_bands').map((b) => ({ x: band(b), n: b.count })),
      lateWd: wd('late_weekday'), earlyWd: wd('early_weekday'), months: has.length }
  }, [months])
  const ef = d.effects || { notes: [], boards: [] }

  return (
    <div className="space-y-4" data-testid="ar-trends-more">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="From measured to counted — late arrivals" sub="Each month: lates the punches show, the ones excused by each rule, and the ones counted." testid="ar-trends-waterfall-late">
          {wf.length === 0 ? <p className="text-sm text-slate-400">Not available for these months (reviews saved before this view).</p> : tables ? (
            <T head={['Month', 'Measured', 'Stayed late', 'Full hours', 'Loaders', 'Plant-wide late days', 'Counted']} rows={wf.map((r) => [r.x, num(r.measured), num(r.stayed_late), num(r.full_hours), num(r.loaders), num(r.plant_late_days || 0), num(r.counted)])} />
          ) : (
            <Chart><BarChart data={wf} margin={{ top: 12, right: 12, bottom: 0, left: -12 }} onClick={(e) => open(e?.activePayload?.[0]?.payload?.ym)} style={{ cursor: 'pointer' }}>
              {axes('')}
              <Bar dataKey="counted" name="Counted" stackId="a" fill={C.s1} isAnimationActive={false} />
              <Bar dataKey="stayed_late" name="Excused: stayed late" stackId="a" fill={C.g3} isAnimationActive={false} />
              <Bar dataKey="full_hours" name="Excused: full hours" stackId="a" fill={C.g1} isAnimationActive={false} />
              <Bar dataKey="loaders" name="Loaders" stackId="a" fill={C.g2} isAnimationActive={false} />
              {wf.some((r) => r.plant_late_days > 0) && <Bar dataKey="plant_late_days" name="Excused: plant-wide late day" stackId="a" fill="#44403c" isAnimationActive={false} />}
            </BarChart></Chart>)}
        </Card>
        <Card title="From measured to counted — early exits" sub="Release days are left out before measuring. Missed OUTs counted under the missed-OUT rule are added." testid="ar-trends-waterfall-early">
          {wf.length === 0 ? <p className="text-sm text-slate-400">Not available for these months.</p> : tables ? (
            <T head={['Month', 'Measured', 'Full hours', 'Not assessed', '+ Missed OUT', 'Counted']} rows={wf.map((r) => [r.x, num(r.e_measured), num(r.e_full), num(r.e_exempt), num(r.e_mo), num(r.e_counted)])} />
          ) : (
            <Chart><BarChart data={wf} margin={{ top: 12, right: 12, bottom: 0, left: -12 }} onClick={(e) => open(e?.activePayload?.[0]?.payload?.ym)} style={{ cursor: 'pointer' }}>
              {axes('')}
              <Bar dataKey="e_counted" name="Counted" stackId="a" fill={C.s2} isAnimationActive={false} />
              <Bar dataKey="e_full" name="Excused: full hours" stackId="a" fill={C.g1} isAnimationActive={false} />
              <Bar dataKey="e_exempt" name="Not assessed (exempt)" stackId="a" fill={C.g2} isAnimationActive={false} />
            </BarChart></Chart>)}
        </Card>

        <Card title="₹ value of time lost vs ₹ deducted" sub="Value = counted minutes ÷ shift minutes × gross ÷ days in month. Deducted = late + early deductions in the salary register." testid="ar-trends-money">
          {wf.length === 0 ? <p className="text-sm text-slate-400">Not available for these months.</p> : tables ? (
            <T head={['Month', 'Value of time lost', 'Indicative (review)', 'In salary']} rows={wf.map((r) => [r.x, inr(r.value), inr(r.indicative), inr(r.in_salary)])} />
          ) : (
            <Chart><LineChart data={wf} margin={{ top: 12, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="x" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 100000 ? `${num(v / 100000, 1)}L` : num(v))} />
              <Tooltip formatter={(v) => inr(v)} wrapperStyle={{ fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="value" name="Value of time lost" stroke={C.s1} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="in_salary" name="Deducted in salary" stroke={C.s2} strokeWidth={2} isAnimationActive={false} />
            </LineChart></Chart>)}
        </Card>

        <Card title="Enforcement funnel" sub="Decided in the review → sent to finance → finance → in salary. Rows entered outside the review shown separately." testid="ar-trends-funnel">
          <T head={['Month', 'Listed', 'Deductions', 'Days', 'Sent', 'Approved', 'Rejected', 'Pending', 'In salary', 'Other rows']}
            rows={months.map((m) => { const f = m.funnel || {}; return [label(m.ym), num(f.listed), num(f.decided), num(f.decided_days, 1), num(f.sent), num(f.approved), num(f.rejected), num(f.pending), num(f.in_salary), num(f.other_rows)] })}
            onRow={(k) => open(months[k].ym)} />
        </Card>
      </div>

      {dist && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="How late, and how early" sub={`Counted lates and early exits by length, ${dist.months} month(s) together.`} testid="ar-trends-bands">
            {tables ? (
              <T head={['Length', 'Lates', '', 'Length', 'Early exits']} right={9}
                rows={Array.from({ length: Math.max(dist.late.length, dist.early.length) }, (_, i) => [dist.late[i]?.x || '', dist.late[i] ? num(dist.late[i].n) : '', '', dist.early[i]?.x || '', dist.early[i] ? num(dist.early[i].n) : ''])} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Chart h="h-48"><BarChart data={dist.late} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>{axes('')}<Bar dataKey="n" name="Lates" fill={C.s1} isAnimationActive={false} /></BarChart></Chart>
                <Chart h="h-48"><BarChart data={dist.early} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>{axes('')}<Bar dataKey="n" name="Early exits" fill={C.s2} isAnimationActive={false} /></BarChart></Chart>
              </div>)}
          </Card>
          <Card title="By weekday" sub="Counted lates and early exits by day of the week." testid="ar-trends-weekday">
            {tables ? (
              <T head={['Day', 'Lates', 'Early exits']} rows={dist.lateWd.map((r, i) => [r.x, num(r.n), num((dist.earlyWd.find((e) => e.x === r.x) || {}).n)])} />
            ) : (
              <Chart h="h-48"><BarChart data={dist.lateWd.map((r) => ({ ...r, e: (dist.earlyWd.find((e) => e.x === r.x) || {}).n || 0 }))} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                {axes('')}<Bar dataKey="n" name="Lates" fill={C.s1} isAnimationActive={false} /><Bar dataKey="e" name="Early exits" fill={C.s2} isAnimationActive={false} />
              </BarChart></Chart>)}
          </Card>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Miss punches" sub="Own missed punches vs plant-wide failure days (not counted against anyone); fixed from the gate register vs still open." testid="ar-trends-misspunch">
          <T head={['Month', 'Total', 'Own', 'Failure days', 'On those days', 'Fixed', 'Open', 'Counted as early exit']}
            rows={months.map((m) => { const p = m.miss_punch || {}; return [label(m.ym), num(p.total), num(p.own), num(p.bulk_days), num(p.on_bulk_days), num(p.fixed), num(p.open), num(p.counted_as_early)] })} />
        </Card>
        <Card title="Data quality" sub="Days the review could not measure, or measured with less certainty. Master-shift basis only." testid="ar-trends-quality">
          <T head={['Month', 'Not assessed', 'No master', 'Night on day master', 'Odd punch', 'Half days', 'Gate register', 'Out not verified']}
            rows={months.map((m) => { const q = m.quality; return q ? [label(m.ym), num(q.unassessable_days), num(q.no_master), num(q.night_on_day_master), num(q.odd_punch), num(q.half_days), num(q.gate_register), num(q.out_not_verified)]
              : [label(m.ym), 'import basis', '', '', '', '', '', ''] })} />
        </Card>
      </div>

      <Card title={`Top people in the range (${(d.top_people || []).length})`} sub="By workdays lost. Pattern labels point at the likely cause; click a code for the person's history." testid="ar-trends-top">
        {(d.top_people || []).length === 0 ? <p className="text-sm text-slate-400">No one lost time in this range.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                {['Code', 'Name', 'Department', 'Worked', 'Late days', 'Early exits', 'Workdays lost', 'Months on a list', 'Pattern'].map((h, i) =>
                  <th key={h} className={clsx('px-3 py-2 font-medium whitespace-nowrap', i >= 3 && i <= 7 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>{d.top_people.slice(0, 30).map((p) => (
                <tr key={p.code} className="border-t border-slate-100 align-top" data-testid={`ar-top-${p.code}`}>
                  <td className="px-3 py-1.5"><button type="button" className="font-mono text-blue-700 underline decoration-dotted" onClick={() => setPerson(p.code)}>{p.code}</button></td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{p.name}</td><td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{p.department}</td>
                  {[num(p.worked_days), num(p.late_days), num(p.early_days), num(p.workdays_lost, 1), num(p.listed_months)].map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums">{v}</td>)}
                  <td className="px-3 py-1.5 text-xs text-slate-700">{p.labels.join(' · ')}</td>
                </tr>))}
              </tbody>
            </table>
          </div>)}
      </Card>

      <Card title="Did it work?" sub="Notes: people with a note in a month — their lates + early exits that month and the next (counts, not rates). Board: people named on a print — per person per working day, before and after the print." testid="ar-trends-effect">
        {ef.notes.length === 0 && ef.boards.length === 0 ? <p className="text-sm text-slate-400">Needs two months in the range, or a printed notice board.</p> : (
          <T head={['Measure', 'When', 'People', 'Before', 'After', 'Change', 'Note']} right={2}
            rows={[...ef.notes.map((n) => ['Notes', `${label(n.ym)} → ${label(n.next_ym)}`, num(n.people), num(n.before), num(n.after), pct(n.change_pct), `${n.listed_again} on a list again`]),
              ...ef.boards.map((b) => ['Notice board', `${label(b.ym)}, up to ${b.to.slice(8)}`, num(b.named), num(b.per_person_day_before, 2), b.per_person_day_after == null ? '—' : num(b.per_person_day_after, 2), pct(b.change_pct), `${b.days_after} working days after`])]} />
        )}
      </Card>

      {person && last && <PersonHistory code={person} month={Number(last.ym.slice(5))} year={Number(last.ym.slice(0, 4))} onClose={() => setPerson(null)} />}
    </div>
  )
}
