// Contractor Report — Daily Wage Register tab. One row per date. Read-only.
import { useMemo } from 'react'
import {
  money, days1, dateLong, isSunday, monthLabel, SUN_MARK, MOON_MARK,
  Chips, EmptyState,
} from './shared'

export default function DailyWageRegisterTab({ report, contractor, onOpenDay }) {
  const rows = useMemo(() => {
    const names = contractor ? [contractor] : report.contractors
    return report.days.map((d) => {
      const cells = report.cells[d.date] || {}
      const R = { bioDay: 0, bioNight: 0, bio: 0, dwHeads: 0, dwCost: 0, manDays: 0 }
      const depts = new Map()
      const both = []
      for (const name of names) {
        const c = cells[name]
        if (!c) continue
        R.bioDay += c.bioDay; R.bioNight += c.bioNight; R.bio += c.bio
        R.dwHeads += c.dwHeads; R.dwCost += c.dwCost; R.manDays += c.manDays
        for (const b of c.deptBreakdown) depts.set(b.dept, (depts.get(b.dept) || 0) + b.heads)
        if (c.bio > 0 && c.dwHeads > 0) both.push(name)
      }
      return {
        ...d,
        ...R,
        depts: [...depts.entries()].sort((a, b) => b[1] - a[1])
          .map(([dept, n]) => ({ key: dept, label: `${dept} ${n}` })),
        both,
      }
    })
  }, [report, contractor])

  const T = rows.reduce((a, r) => ({
    bioDay: a.bioDay + r.bioDay, bioNight: a.bioNight + r.bioNight, bio: a.bio + r.bio,
    dwHeads: a.dwHeads + r.dwHeads, dwCost: a.dwCost + r.dwCost, manDays: a.manDays + r.manDays,
  }), { bioDay: 0, bioNight: 0, bio: 0, dwHeads: 0, dwCost: 0, manDays: 0 })

  const anything = rows.some((r) => r.bio || r.dwHeads)

  return (
    <>
      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-slate-700">
            Daily wage register · {monthLabel(report.month)} {report.year}
            {contractor ? ` · ${contractor}` : ''}
          </span>
          <span className="text-xs text-slate-400">Click a date to open its day report</span>
        </div>
        {!anything ? (
          <EmptyState>
            No contractor attendance or daily-wage entries in {monthLabel(report.month)} {report.year}
            {contractor ? ` for ${contractor}` : ''}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">DW heads</th>
                  <th className="text-right">DW cost</th>
                  <th>DW departments</th>
                  <th className="text-right">{SUN_MARK} Biometric day</th>
                  <th className="text-right">{MOON_MARK} Biometric night</th>
                  <th className="text-right">Total heads</th>
                  <th className="text-right">Man-days</th>
                  <th>Both sources</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="cursor-pointer" onClick={() => onOpenDay(r.date)}>
                    <td className={`font-medium ${isSunday(r.date) ? 'text-slate-400' : ''}`}>
                      {dateLong(r.date)}
                    </td>
                    <td className="text-right tabular-nums">{r.dwHeads || '—'}</td>
                    <td className="text-right tabular-nums">{r.dwCost ? money(r.dwCost) : '—'}</td>
                    <td className="whitespace-normal"><Chips items={r.depts} /></td>
                    <td className="text-right tabular-nums">{r.bioDay || '—'}</td>
                    <td className="text-right tabular-nums">{r.bioNight || '—'}</td>
                    <td className="text-right tabular-nums font-bold text-blue-700">
                      {r.bio + r.dwHeads || '—'}
                    </td>
                    <td className="text-right tabular-nums">{r.manDays ? days1(r.manDays) : '—'}</td>
                    <td className="whitespace-normal space-x-1">
                      {r.both.map((n) => <span key={n} className="badge-red">{n}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{monthLabel(report.month)} total</td>
                  <td className="text-right tabular-nums">{T.dwHeads}</td>
                  <td className="text-right tabular-nums">{money(T.dwCost)}</td>
                  <td></td>
                  <td className="text-right tabular-nums">{T.bioDay}</td>
                  <td className="text-right tabular-nums">{T.bioNight}</td>
                  <td className="text-right tabular-nums text-blue-700">{T.bio + T.dwHeads}</td>
                  <td className="text-right tabular-nums">{days1(T.manDays)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        Daily-wage heads count approved and paid entries only. Man-days are the biometric days
        payroll pays: ½P counts 0.5, and days before the joining date are left out.
      </p>
    </>
  )
}
