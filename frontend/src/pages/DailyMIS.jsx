import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fmtPct } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import clsx from 'clsx'
import api, { getDailyShiftBreakdown, getDailyWorkerBreakdown } from '../utils/api'

// ── Helpers ──────────────────────────────────────────────────

function rateColor(rate) {
  if (rate >= 85) return 'text-green-600'
  if (rate >= 70) return 'text-amber-600'
  return 'text-red-600'
}

function rateBg(rate) {
  if (rate >= 85) return 'bg-emerald-500'
  if (rate >= 70) return 'bg-amber-500'
  return 'bg-red-500'
}

function RateBar({ rate }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', rateBg(rate))} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={clsx('font-mono text-xs', rateColor(rate))}>{fmtPct(rate)}</span>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────

export default function DailyMIS() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState('punched-in')
  const [shiftExpanded, setShiftExpanded] = useState({ day: false, night: false })

  // Drill-down state for tables
  const punchedInRows = useExpandableRows()
  const absenteeRows = useExpandableRows()
  const nightDetailRows = useExpandableRows()

  // ── Data Fetching ──────────────────────────────────────────

  const { data: summaryRes, isLoading } = useQuery({
    queryKey: ['daily-mis-summary', selectedDate],
    queryFn: () => api.get('/daily-mis/summary', { params: { date: selectedDate } }),
  })

  const { data: nightRes } = useQuery({
    queryKey: ['daily-mis-night', selectedDate],
    queryFn: () => api.get('/daily-mis/night-shift', { params: { date: selectedDate } }),
  })

  const { data: shiftRes } = useQuery({
    queryKey: ['daily-mis-shift', selectedDate],
    queryFn: () => getDailyShiftBreakdown(selectedDate),
  })

  const { data: workerRes } = useQuery({
    queryKey: ['daily-mis-worker', selectedDate],
    queryFn: () => getDailyWorkerBreakdown(selectedDate),
  })

  const { data: punchedInRes } = useQuery({
    queryKey: ['daily-mis-punched', selectedDate],
    queryFn: () => api.get('/daily-mis/punched-in', { params: { date: selectedDate } }),
    enabled: activeTab === 'punched-in',
  })

  const { data: absentRes } = useQuery({
    queryKey: ['daily-mis-absent', selectedDate],
    queryFn: () => api.get('/daily-mis/absentees', { params: { date: selectedDate } }),
    enabled: activeTab === 'absentees',
  })

  // ── Derived Data ───────────────────────────────────────────

  const summary = summaryRes?.data?.data || {}
  const nightShift = nightRes?.data?.data || {}
  const shiftData = shiftRes?.data?.data || {}
  const workerData = workerRes?.data?.data || {}
  const punchedIn = punchedInRes?.data?.data || []
  const absentees = absentRes?.data?.data || []
  const departments = summary.departments || []
  const deptType = summary.deptTypeBreakdown || {}

  const adminDepts = useMemo(() => (deptType.admin?.departments || []).sort((a, b) => b.total - a.total), [deptType])
  const mfgDepts = useMemo(() => (deptType.manufacturing?.departments || []).sort((a, b) => b.total - a.total), [deptType])

  const dateDisplay = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">

        {/* Header with date picker */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Daily <Abbr code="MIS">MIS</Abbr> Report</h2>
            <p className="section-subtitle mt-1">Real-time attendance dashboard</p>
          </div>
          <div>
            <label className="label">Select Date</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="input" />
          </div>
        </div>

        <p className="text-sm font-medium text-slate-600">{dateDisplay}</p>

        {/* ── KPI Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="Headcount" value={summary.totalEmployees || 0} border="blue" />
          <KpiCard label="Present" value={summary.present || 0} border="emerald" valueColor="text-emerald-700" />
          <KpiCard label="Absent" value={summary.absent || 0} border="red" valueColor="text-red-600" />
          <KpiCard label="Late" value={summary.lateArrivals || 0} border="amber" valueColor="text-amber-600" />
          <KpiCard
            label="Att. Rate"
            value={fmtPct(summary.attendanceRate)}
            border="purple"
            valueColor={clsx(summary.attendanceRate >= 85 ? 'text-green-600' : summary.attendanceRate >= 70 ? 'text-amber-600' : 'text-red-600')}
            abbr="Att"
          />
          <KpiCard label="Night Shift" value={summary.nightShiftCount || 0} border="indigo" valueColor="text-indigo-600" />
        </div>

        {/* ── SHIFT-WISE BREAKDOWN ──────────────────────────── */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">Shift-Wise Breakdown</span>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Day Shift Card */}
              <ShiftCard
                title="Day Shift"
                icon={<span className="text-amber-500 mr-1.5">&#9728;</span>}
                data={shiftData.dayShift}
                expanded={shiftExpanded.day}
                onToggle={() => setShiftExpanded(p => ({ ...p, day: !p.day }))}
                borderColor="border-amber-300"
                bgColor="bg-amber-50"
              />
              {/* Night Shift Card */}
              <ShiftCard
                title="Night Shift"
                icon={<span className="text-indigo-400 mr-1.5">&#9790;</span>}
                data={shiftData.nightShift}
                expanded={shiftExpanded.night}
                onToggle={() => setShiftExpanded(p => ({ ...p, night: !p.night }))}
                borderColor="border-indigo-300"
                bgColor="bg-indigo-50"
              />
            </div>
          </div>
        </div>

        {/* ── DEPARTMENT-WISE BREAKDOWN ─────────────────────── */}
        {departments.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="font-semibold text-slate-700">Department-Wise Breakdown</span>
            </div>
            <div className="card-body space-y-4">
              {/* Admin Departments */}
              <DeptGroupTable
                title="Admin Departments"
                depts={adminDepts}
                badge="badge-blue"
                totals={deptType.admin}
              />
              {/* Manufacturing Departments */}
              <DeptGroupTable
                title="Manufacturing Departments"
                depts={mfgDepts}
                badge="badge-amber"
                totals={deptType.manufacturing}
              />
            </div>
          </div>
        )}

        {/* ── WORKER TYPE BREAKDOWN ─────────────────────────── */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">Worker Type Breakdown</span>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WorkerTypeCard
                title="Permanent"
                data={workerData.permanent}
                borderColor="border-emerald-300"
                accentColor="emerald"
              />
              <WorkerTypeCard
                title="Contractual"
                data={workerData.contractor}
                borderColor="border-orange-300"
                accentColor="orange"
              />
            </div>
          </div>
        </div>

        {/* ── TABS: Punched In / Absentees / Night Detail ──── */}
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {[
            { key: 'punched-in', label: `Currently Punched In (${summary.punchedIn || 0})` },
            { key: 'absentees', label: `Absentees (${absentRes?.data?.count ?? '...'})` },
            { key: 'night-detail', label: `Night Shift Detail (${nightShift.count || 0})` },
          ].map(t => (
            <button key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={clsx('px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px whitespace-nowrap',
                activeTab === t.key
                  ? 'bg-white text-blue-700 border border-slate-200 border-b-white'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Punched In Tab */}
        {activeTab === 'punched-in' && (
          <PunchedInTable data={punchedIn} rows={punchedInRows} />
        )}

        {/* Absentees Tab */}
        {activeTab === 'absentees' && (
          <AbsenteesTable data={absentees} rows={absenteeRows} />
        )}

        {/* Night Shift Detail Tab */}
        {activeTab === 'night-detail' && (
          <NightShiftDetailTable data={nightShift} rows={nightDetailRows} />
        )}

        <AbbreviationLegend keys={['MIS', 'Att', 'Dept', 'Hrs', 'Emp', 'Perm', 'Cont']} />
      </div>
    </div>
  )
}

// ── Sub-Components ───────────────────────────────────────────

function KpiCard({ label, value, border, valueColor = 'text-slate-800', abbr }) {
  return (
    <div className={`stat-card border-l-4 border-l-${border}-400`}>
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        {abbr ? <Abbr code={abbr}>{label}</Abbr> : label}
      </span>
      <span className={clsx('text-2xl font-bold', valueColor)}>{value}</span>
    </div>
  )
}

// ── Shift Card ───────────────────────────────────────────────

function ShiftCard({ title, icon, data, expanded, onToggle, borderColor, bgColor }) {
  if (!data) return (
    <div className={clsx('rounded-lg border p-4', borderColor, bgColor)}>
      <div className="text-sm font-semibold text-slate-600">{icon}{title}</div>
      <p className="text-xs text-slate-400 mt-2">No data available</p>
    </div>
  )

  return (
    <div className={clsx('rounded-lg border p-4', borderColor, bgColor)}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700">{icon}{title} ({data.total})</div>
        <button onClick={onToggle} className="text-xs text-blue-600 hover:underline">
          {expanded ? 'Hide employees' : 'Show employees'}
        </button>
      </div>

      {/* Summary stats grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white/80 rounded px-2 py-1.5">
          <span className="text-slate-400">Admin:</span>{' '}
          <span className="font-semibold text-slate-700">{data.admin}</span>
        </div>
        <div className="bg-white/80 rounded px-2 py-1.5">
          <span className="text-slate-400">Mfg:</span>{' '}
          <span className="font-semibold text-slate-700">{data.manufacturing}</span>
        </div>
        <div className="bg-white/80 rounded px-2 py-1.5">
          <span className="text-slate-400"><Abbr code="Perm">Perm</Abbr>:</span>{' '}
          <span className="font-semibold text-emerald-700">{data.permanent}</span>
        </div>
        <div className="bg-white/80 rounded px-2 py-1.5">
          <span className="text-slate-400"><Abbr code="Cont">Cont</Abbr>:</span>{' '}
          <span className="font-semibold text-orange-700">{data.contractor}</span>
        </div>
      </div>

      {/* Expanded employee table */}
      {expanded && data.employees?.length > 0 && (
        <div className="mt-3 overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full table-compact text-xs bg-white rounded">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th><Abbr code="Emp">Employee</Abbr></th>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th>IN</th>
                <th>OUT</th>
                <th><Abbr code="Hrs">Hrs</Abbr></th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map(e => (
                <tr key={e.employee_code}>
                  <td>
                    <div className="font-medium">{e.employee_name || e.employee_code}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{e.employee_code}</div>
                  </td>
                  <td className="text-xs">{e.department}</td>
                  <td className="font-mono">{e.in_time || '\u2014'}</td>
                  <td className="font-mono">{e.out_time || '\u2014'}</td>
                  <td className="font-mono">{e.actual_hours ? `${e.actual_hours.toFixed(1)}h` : '\u2014'}</td>
                  <td>
                    {e.is_contractor
                      ? <span className="badge-amber text-[10px]">Cont</span>
                      : <span className="badge-blue text-[10px]">Perm</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Department Group Table ───────────────────────────────────

function DeptGroupTable({ title, depts, badge, totals }) {
  if (!depts || depts.length === 0) return null

  const totalEmployees = totals?.totalEmployees || depts.reduce((s, d) => s + (d.total || 0), 0)
  const totalPresent = totals?.present || depts.reduce((s, d) => s + (d.present || 0), 0)
  const totalRate = totals?.rate ?? (totalEmployees > 0 ? Math.round(totalPresent / totalEmployees * 100 * 10) / 10 : 0)

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{title}</h4>
        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', badge)}>
          {totalPresent}/{totalEmployees} &middot; {fmtPct(totalRate)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-compact text-xs">
          <thead>
            <tr>
              <th><Abbr code="Dept">Department</Abbr></th>
              <th>Total</th>
              <th><Abbr code="Perm">Perm</Abbr></th>
              <th><Abbr code="Cont">Cont</Abbr></th>
              <th>Present</th>
              <th>Absent</th>
              <th>Late</th>
              <th><Abbr code="Att">Att.</Abbr> Rate</th>
            </tr>
          </thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.department || 'Unknown'}>
                <td className="font-medium">{d.department || 'Unknown'}</td>
                <td className="font-mono">{d.total}</td>
                <td className="font-mono text-emerald-600">{d.permanent || 0}</td>
                <td className="font-mono text-orange-600">{d.contractor || 0}</td>
                <td className="font-mono text-emerald-600">{d.present}</td>
                <td className="font-mono text-red-600">{d.absent}</td>
                <td className="font-mono text-amber-600">{d.late}</td>
                <td><RateBar rate={d.rate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Worker Type Card ─────────────────────────────────────────

function WorkerTypeCard({ title, data, borderColor, accentColor }) {
  if (!data) return (
    <div className={clsx('rounded-lg border p-4', borderColor)}>
      <div className="text-sm font-semibold text-slate-600">{title}</div>
      <p className="text-xs text-slate-400 mt-2">No data available</p>
    </div>
  )

  const rate = data.attendanceRate || 0

  return (
    <div className={clsx('rounded-lg border p-4', borderColor)}>
      <div className="text-sm font-semibold text-slate-700 mb-3">{title}</div>

      {/* Top-level stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-50 rounded px-2 py-1.5 text-center">
          <div className="text-[10px] text-slate-400 uppercase">Total</div>
          <div className="text-lg font-bold text-slate-700">{data.totalCount}</div>
        </div>
        <div className="bg-slate-50 rounded px-2 py-1.5 text-center">
          <div className="text-[10px] text-slate-400 uppercase">Present</div>
          <div className={`text-lg font-bold text-${accentColor}-600`}>{data.presentCount}</div>
        </div>
        <div className="bg-slate-50 rounded px-2 py-1.5 text-center">
          <div className="text-[10px] text-slate-400 uppercase"><Abbr code="Att">Att.</Abbr> Rate</div>
          <div className={clsx('text-lg font-bold', rateColor(rate))}>{fmtPct(rate)}</div>
        </div>
      </div>

      {/* Department breakdown table */}
      {data.departments?.length > 0 && (
        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          <table className="w-full table-compact text-xs">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th>Total</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map(d => (
                <tr key={d.department}>
                  <td className="font-medium">
                    {d.department}
                    {d.is_admin && <span className="ml-1 text-[9px] text-blue-400">(Admin)</span>}
                  </td>
                  <td className="font-mono">{d.total}</td>
                  <td className="font-mono text-emerald-600">{d.present}</td>
                  <td className="font-mono text-red-600">{d.absent}</td>
                  <td><RateBar rate={d.rate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Punched In Table ─────────────────────────────────────────

function PunchedInTable({ data, rows }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-400">
        No employees currently punched in for this date.
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full table-compact text-xs">
          <thead>
            <tr>
              <th className="w-6"></th>
              <th><Abbr code="Emp">Employee</Abbr></th>
              <th><Abbr code="Dept">Dept</Abbr></th>
              <th>IN Time</th>
              <th><Abbr code="Hrs">Hours</Abbr> So Far</th>
              <th>Shift</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <React.Fragment key={r.employee_code}>
                <tr
                  onClick={() => rows.toggle(r.employee_code)}
                  className={clsx('cursor-pointer transition-colors', rows.isExpanded(r.employee_code) ? 'bg-blue-50' : 'hover:bg-slate-50')}
                >
                  <td><DrillDownChevron isExpanded={rows.isExpanded(r.employee_code)} /></td>
                  <td>
                    <div className="font-medium">{r.employee_name || r.employee_code}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{r.employee_code}</div>
                  </td>
                  <td className="text-xs">{r.department}</td>
                  <td className="font-mono">{r.in_time}</td>
                  <td className="font-mono">{r.hours_so_far ? `${r.hours_so_far}h` : '\u2014'}</td>
                  <td><span className="badge-blue text-xs">{r.shift_detected || 'DAY'}</span></td>
                </tr>
                {rows.isExpanded(r.employee_code) && (
                  <DrillDownRow colSpan={6}>
                    <EmployeeQuickView employeeCode={r.employee_code} compact />
                  </DrillDownRow>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Absentees Table ──────────────────────────────────────────

function AbsenteesTable({ data, rows }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-400">
        No absentees for this date.
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full table-compact text-xs">
          <thead>
            <tr>
              <th className="w-6"></th>
              <th><Abbr code="Emp">Employee</Abbr></th>
              <th><Abbr code="Dept">Dept</Abbr></th>
              <th>Designation</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <React.Fragment key={r.code}>
                <tr
                  onClick={() => rows.toggle(r.code)}
                  className={clsx('cursor-pointer transition-colors', rows.isExpanded(r.code) ? 'bg-blue-50' : 'hover:bg-slate-50')}
                >
                  <td><DrillDownChevron isExpanded={rows.isExpanded(r.code)} /></td>
                  <td>
                    <div className="font-medium">{r.name || r.code}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{r.code}</div>
                  </td>
                  <td className="text-xs">{r.department}</td>
                  <td className="text-xs">{r.designation}</td>
                  <td>
                    <span className={clsx('text-xs px-2 py-0.5 rounded',
                      r.reason === 'Absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                    )}>{r.reason}</span>
                  </td>
                </tr>
                {rows.isExpanded(r.code) && (
                  <DrillDownRow colSpan={5}>
                    <EmployeeQuickView employeeCode={r.code} compact />
                  </DrillDownRow>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Night Shift Detail Table ─────────────────────────────────

function NightShiftDetailTable({ data, rows }) {
  if (!data || !data.workers || data.workers.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-400">
        No night shift data for the previous day.
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex items-center justify-between">
        <span className="font-semibold text-slate-700">
          Night Shift Report ({data.date}) &mdash; {data.count} workers
        </span>
        <div className="flex gap-3 text-xs text-slate-500">
          <span>Admin: <strong>{data.adminCount || 0}</strong></span>
          <span>Mfg: <strong>{data.mfgCount || 0}</strong></span>
          <span className="text-emerald-600"><Abbr code="Perm">Perm</Abbr>: <strong>{data.permanentCount || 0}</strong></span>
          <span className="text-orange-600"><Abbr code="Cont">Cont</Abbr>: <strong>{data.contractorCount || 0}</strong></span>
          <span>Total <Abbr code="Hrs">Hrs</Abbr>: <strong>{data.totalHours?.toFixed(1)}h</strong></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-compact text-xs">
          <thead>
            <tr>
              <th className="w-6"></th>
              <th><Abbr code="Emp">Employee</Abbr></th>
              <th><Abbr code="Dept">Dept</Abbr></th>
              <th>IN Time</th>
              <th>OUT Time</th>
              <th><Abbr code="Hrs">Hours</Abbr></th>
              <th>Type</th>
              <th>Late</th>
            </tr>
          </thead>
          <tbody>
            {data.workers.map(w => (
              <React.Fragment key={w.employee_code}>
                <tr
                  onClick={() => rows.toggle(w.employee_code)}
                  className={clsx('cursor-pointer transition-colors', rows.isExpanded(w.employee_code) ? 'bg-blue-50' : 'hover:bg-slate-50')}
                >
                  <td><DrillDownChevron isExpanded={rows.isExpanded(w.employee_code)} /></td>
                  <td>
                    <div className="font-medium">{w.employee_name || w.employee_code}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{w.employee_code}</div>
                  </td>
                  <td className="text-xs">{w.department}</td>
                  <td className="font-mono">{w.in_time || '\u2014'}</td>
                  <td className="font-mono">{w.out_time || '\u2014'}</td>
                  <td className="font-mono">{w.actual_hours ? `${w.actual_hours.toFixed(1)}h` : '\u2014'}</td>
                  <td>
                    {w.is_contractor
                      ? <span className="badge-amber text-[10px]">Cont</span>
                      : <span className="badge-blue text-[10px]">Perm</span>}
                  </td>
                  <td>
                    {w.is_late_arrival
                      ? <span className="badge-red text-xs">+{w.late_by_minutes}m</span>
                      : <span className="text-slate-300">{'\u2014'}</span>}
                  </td>
                </tr>
                {rows.isExpanded(w.employee_code) && (
                  <DrillDownRow colSpan={8}>
                    <EmployeeQuickView employeeCode={w.employee_code} compact />
                  </DrillDownRow>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
