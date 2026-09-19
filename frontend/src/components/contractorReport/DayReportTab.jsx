// Contractor Report — Day Report tab. Read-only.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getContractorDayReport } from '../../utils/api'
import {
  money, int, dateLong, SUN_MARK, MOON_MARK, ShiftBadge, StatusBadge, DwStatusBadge,
  RoleBadge, ContractorName, Chips, Segmented, EmptyState, Loading, ErrorState,
} from './shared'

// ─── the expanded detail under a contractor row ───────────────────────────
function ContractorDetail({ c }) {
  return (
    <>
      {c.employees.length > 0 && (
        <>
          <div className="flex items-center gap-2.5 flex-wrap mb-2">
            <span className="font-semibold text-slate-700">Employees present</span>
            <span className="badge-yellow">☀ {c.bioDay} day</span>
            <span className="badge-purple">☾ {c.bioNight} night</span>
            <span className="text-xs text-slate-400">
              Work department isn’t recorded for biometric contract workers; grouped by designation.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Role</th><th>Shift</th>
                  <th>Status</th><th>Joined</th><th></th>
                </tr>
              </thead>
              <tbody>
                {c.employees.map((e) => (
                  <tr key={e.code}>
                    <td className="font-mono text-slate-500">{e.code}</td>
                    <td className="font-medium">{e.name}</td>
                    <td><RoleBadge role={e.role} /></td>
                    <td><ShiftBadge night={e.night} /></td>
                    <td><StatusBadge status={e.status} /></td>
                    <td className="text-slate-400">{e.doj || '—'}</td>
                    <td className="space-x-1">
                      {e.preJoining && <span className="badge-red">Before joining</span>}
                      {e.noDoj && <span className="badge-gray">No joining date</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {c.dwEntries.length > 0 && (
        <>
          <div className={`font-semibold text-slate-700 ${c.employees.length ? 'mt-4' : ''} mb-2`}>
            Daily-wage entries
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Record</th><th>Department</th>
                  <th className="text-right">Heads</th><th className="text-right">Rate</th>
                  <th className="text-right">Amount</th><th>Status</th><th>Gate ref</th>
                </tr>
              </thead>
              <tbody>
                {c.dwEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.rawName}</td>
                    <td className="whitespace-normal">
                      {e.allocations.map((a, i) => (
                        <div key={i} className={i ? 'mt-1' : ''}>
                          <span className="font-medium">{a.dept}</span>
                          {a.heads !== e.heads && <span className="text-slate-400"> · {a.heads}</span>}
                          {a.typed && a.typed.toUpperCase() !== a.dept.toUpperCase() && (
                            <div className="text-xs text-slate-400">as typed: {a.typed}</div>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="text-right tabular-nums">{e.heads}</td>
                    <td className="text-right tabular-nums">{money(e.rate)}</td>
                    <td className="text-right tabular-nums">{money(e.amount)}</td>
                    <td><DwStatusBadge status={e.status} /></td>
                    <td className="font-mono text-slate-500">{e.gateRef || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Daily-wage entries hold a head count and a typed department only — no names and no
            shift — so they can’t be matched to the employee list.
          </p>
        </>
      )}
    </>
  )
}

// ─── by contractor ────────────────────────────────────────────────────────
function ContractorTable({ data, open, setOpen }) {
  const rows = data.contractors
  if (!rows.length) {
    return <EmptyState>No contractor attendance or daily-wage entries on {dateLong(data.date)}</EmptyState>
  }
  const T = rows.reduce((a, c) => ({
    bioDay: a.bioDay + c.bioDay, bioNight: a.bioNight + c.bioNight,
    bio: a.bio + c.bio, dwHeads: a.dwHeads + c.dwHeads, dwCost: a.dwCost + c.dwCost,
  }), { bioDay: 0, bioNight: 0, bio: 0, dwHeads: 0, dwCost: 0 })

  return (
    <div className="overflow-x-auto">
      <table className="table-compact w-full">
        <thead>
          <tr>
            <th className="w-6"></th><th>Contractor</th>
            <th className="text-right">{SUN_MARK} Day</th>
            <th className="text-right">{MOON_MARK} Night</th>
            <th className="text-right">Biometric</th>
            <th className="text-right">Daily wage</th>
            <th className="text-right">Total</th>
            <th className="text-right">DW cost</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const isOpen = open === c.name
            const preJoin = c.employees.filter((e) => e.preJoining).length
            return [
              <tr
                key={c.name}
                className="cursor-pointer"
                onClick={() => setOpen(isOpen ? null : c.name)}
              >
                <td className="text-slate-400">{isOpen ? '▼' : '▶'}</td>
                <td><ContractorName name={c.name} unmapped={c.unmapped} /></td>
                <td className="text-right tabular-nums">{c.bioDay || '—'}</td>
                <td className="text-right tabular-nums">{c.bioNight || '—'}</td>
                <td className="text-right tabular-nums font-semibold">{c.bio || '—'}</td>
                <td className="text-right tabular-nums">{c.dwHeads || '—'}</td>
                <td className="text-right tabular-nums font-bold text-blue-700">{c.bio + c.dwHeads}</td>
                <td className="text-right tabular-nums">{c.dwCost ? money(c.dwCost) : '—'}</td>
                <td className="whitespace-normal space-x-1">
                  {c.bio > 0 && c.dwHeads > 0 && <span className="badge-red">Both sources</span>}
                  {c.dwRecords > 1 && <span className="badge-red">{c.dwRecords} DW records</span>}
                  {c.dwPending > 0 && <span className="badge-yellow">{c.dwPending} not approved</span>}
                  {preJoin > 0 && <span className="badge-red">{preJoin} before joining</span>}
                </td>
              </tr>,
              isOpen && (
                <tr key={c.name + '-d'}>
                  <td colSpan={9} className="bg-slate-50 p-4 whitespace-normal">
                    <ContractorDetail c={c} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
        <tfoot>
          <tr>
            <td></td><td>All contractors</td>
            <td className="text-right tabular-nums">{T.bioDay}</td>
            <td className="text-right tabular-nums">{T.bioNight}</td>
            <td className="text-right tabular-nums">{T.bio}</td>
            <td className="text-right tabular-nums">{T.dwHeads}</td>
            <td className="text-right tabular-nums text-blue-700">{T.bio + T.dwHeads}</td>
            <td className="text-right tabular-nums">{money(T.dwCost)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── by department ────────────────────────────────────────────────────────
// Daily-wage rows use their normalised department. Biometric contract workers
// have no work department in the data at all, so they bucket by role under
// "Area not recorded · <role>".
function buildDepartments(data) {
  const map = new Map()
  const get = (key, notRecorded) => {
    if (!map.has(key)) {
      map.set(key, { key, notRecorded, bioDay: 0, bioNight: 0, dwHeads: 0, dwCost: 0, byContractor: new Map(), items: [] })
    }
    return map.get(key)
  }
  for (const c of data.contractors) {
    for (const e of c.employees) {
      const r = get(`Area not recorded · ${e.role}`, true)
      if (e.night) r.bioNight += 1; else r.bioDay += 1
      r.byContractor.set(c.name, (r.byContractor.get(c.name) || 0) + 1)
      r.items.push({ kind: 'bio', contractor: c.name, e })
    }
    for (const entry of c.dwEntries) {
      if (!(entry.status === 'approved' || entry.status === 'paid')) continue
      for (const a of entry.allocations) {
        const r = get(a.dept, false)
        r.dwHeads += a.heads
        r.dwCost += a.cost
        r.byContractor.set(c.name, (r.byContractor.get(c.name) || 0) + a.heads)
        r.items.push({ kind: 'dw', contractor: c.name, entry, a })
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => Number(a.notRecorded) - Number(b.notRecorded) ||
      (b.bioDay + b.bioNight + b.dwHeads) - (a.bioDay + a.bioNight + a.dwHeads)
  )
}

function DepartmentTable({ data, open, setOpen }) {
  const rows = buildDepartments(data)
  if (!rows.length) {
    return <EmptyState>No contractor attendance or daily-wage entries on {dateLong(data.date)}</EmptyState>
  }
  const T = rows.reduce((a, r) => ({
    bioDay: a.bioDay + r.bioDay, bioNight: a.bioNight + r.bioNight,
    dwHeads: a.dwHeads + r.dwHeads, dwCost: a.dwCost + r.dwCost,
  }), { bioDay: 0, bioNight: 0, dwHeads: 0, dwCost: 0 })

  return (
    <div className="overflow-x-auto">
      <table className="table-compact w-full">
        <thead>
          <tr>
            <th className="w-6"></th><th>Department</th>
            <th className="text-right">{SUN_MARK} Day</th>
            <th className="text-right">{MOON_MARK} Night</th>
            <th className="text-right">Daily wage</th>
            <th className="text-right">Total</th>
            <th className="text-right">DW cost</th>
            <th>Contractors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.key
            const chips = [...r.byContractor.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => ({ key: name, label: `${name} ${n}` }))
            return [
              <tr key={r.key} className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.key)}>
                <td className="text-slate-400">{isOpen ? '▼' : '▶'}</td>
                <td className={r.notRecorded ? 'text-slate-500' : 'font-semibold text-slate-800'}>{r.key}</td>
                <td className="text-right tabular-nums">{r.bioDay || '—'}</td>
                <td className="text-right tabular-nums">{r.bioNight || '—'}</td>
                <td className="text-right tabular-nums">{r.dwHeads || '—'}</td>
                <td className="text-right tabular-nums font-bold text-blue-700">{r.bioDay + r.bioNight + r.dwHeads}</td>
                <td className="text-right tabular-nums">{r.dwCost ? money(r.dwCost) : '—'}</td>
                <td className="whitespace-normal"><Chips items={chips} /></td>
              </tr>,
              isOpen && (
                <tr key={r.key + '-d'}>
                  <td colSpan={8} className="bg-slate-50 p-4 whitespace-normal">
                    <div className="overflow-x-auto">
                      <table className="table-compact w-full">
                        <thead>
                          <tr>
                            <th>Contractor</th><th>Source</th><th>Who / what</th>
                            <th>Shift</th><th className="text-right">Heads</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.map((it, i) => it.kind === 'bio' ? (
                            <tr key={i}>
                              <td>{it.contractor}</td>
                              <td><span className="badge-green">Biometric</span></td>
                              <td><span className="font-mono text-slate-500">{it.e.code}</span> {it.e.name}</td>
                              <td><ShiftBadge night={it.e.night} /></td>
                              <td className="text-right tabular-nums">1</td>
                            </tr>
                          ) : (
                            <tr key={i}>
                              <td>{it.contractor}</td>
                              <td><span className="badge-yellow">Daily wage</span></td>
                              <td className="whitespace-normal">{it.entry.rawName}: {it.a.typed || it.a.dept}</td>
                              <td className="text-slate-400">not recorded</td>
                              <td className="text-right tabular-nums">{it.a.heads}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
        <tfoot>
          <tr>
            <td></td><td>All departments</td>
            <td className="text-right tabular-nums">{T.bioDay}</td>
            <td className="text-right tabular-nums">{T.bioNight}</td>
            <td className="text-right tabular-nums">{T.dwHeads}</td>
            <td className="text-right tabular-nums text-blue-700">{T.bioDay + T.bioNight + T.dwHeads}</td>
            <td className="text-right tabular-nums">{money(T.dwCost)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── tab ──────────────────────────────────────────────────────────────────
export default function DayReportTab({ date, setDate, days, company, openContractor, setOpenContractor }) {
  const [group, setGroup] = useState('contractor')
  const [openDept, setOpenDept] = useState(null)

  const { data: res, isLoading, error } = useQuery({
    queryKey: ['contractor-report-day', date, company],
    queryFn: () => getContractorDayReport({ date, company: company || undefined }),
    enabled: !!date,
  })
  const data = res?.data?.data

  const idx = days.findIndex((d) => d.date === date)
  const step = (delta) => {
    const next = days[idx + delta]
    if (next) { setDate(next.date); setOpenContractor(null); setOpenDept(null) }
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-slate-700">
            {group === 'dept' ? 'Department-wise headcount' : 'Contractor-wise headcount'}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              size="sm"
              value={group}
              onChange={(v) => { setGroup(v); setOpenContractor(null); setOpenDept(null) }}
              options={[
                { value: 'contractor', label: 'By contractor' },
                { value: 'dept', label: 'By department' },
              ]}
            />
            <div className="flex items-center gap-1 flex-nowrap">
              <button
                type="button" className="btn-ghost px-2" aria-label="Previous day"
                disabled={idx <= 0} onClick={() => step(-1)}
              >‹</button>
              <select
                className="select w-52 py-1.5" aria-label="Date" value={date}
                onChange={(e) => { setDate(e.target.value); setOpenContractor(null); setOpenDept(null) }}
              >
                {days.map((d) => <option key={d.date} value={d.date}>{dateLong(d.date)}</option>)}
              </select>
              <button
                type="button" className="btn-ghost px-2" aria-label="Next day"
                disabled={idx < 0 || idx >= days.length - 1} onClick={() => step(1)}
              >›</button>
            </div>
          </div>
        </div>

        {isLoading && <Loading label="Loading the day…" />}
        {error && <ErrorState error={error} />}
        {!isLoading && !error && data && (
          group === 'dept'
            ? <DepartmentTable data={data} open={openDept} setOpen={setOpenDept} />
            : <ContractorTable data={data} open={openContractor} setOpen={setOpenContractor} />
        )}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        {group === 'dept'
          ? 'Daily-wage departments come from the department typed on each gate entry, cleaned up (PRODUTION and prodution both count as Production). Biometric contract workers have no work department in the system, so they sit under “Area not recorded”, split by designation.'
          : 'Night shift is counted on the date the person punched in. Click a contractor to see who came, on which shift, and in what role.'}
      </p>
    </>
  )
}
