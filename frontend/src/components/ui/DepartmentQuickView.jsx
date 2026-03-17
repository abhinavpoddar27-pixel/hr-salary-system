import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDepartmentDeepDive } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { fmtINR, fmtPct } from '../../utils/formatters'
import Skeleton from './Skeleton'

/**
 * DepartmentQuickView — Shows department-level drill-down inside a DrillDownRow.
 *
 * Props:
 *   department     — Required. Department name.
 *   month/year     — Optional. Defaults to global selectedMonth/selectedYear.
 *   contextContent — Optional JSX for additional page-specific detail.
 */
export default function DepartmentQuickView({
  department,
  month: propMonth,
  year: propYear,
  contextContent,
}) {
  const { selectedMonth, selectedYear } = useAppStore()
  const month = propMonth || selectedMonth
  const year = propYear || selectedYear

  const { data: res, isLoading } = useQuery({
    queryKey: ['dept-drilldown', department, month, year],
    queryFn: () => getDepartmentDeepDive(department, month, year),
    enabled: !!department,
    staleTime: 120000,
  })

  if (isLoading) return <Skeleton variant="card" />

  const dept = res?.data?.data || res?.data || {}
  const employees = dept.employees || []
  const stats = dept.stats || dept

  return (
    <div>
      {/* Department Header */}
      <div className="flex items-center gap-4 mb-3">
        <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-bold shrink-0">
          {(department || '?')[0]?.toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-sm text-slate-800">{department}</div>
          <div className="text-xs text-slate-500">
            {employees.length || stats.headcount || 0} employees
          </div>
        </div>
        {/* Quick Stats */}
        <div className="flex gap-3 ml-auto">
          {stats.attendance_rate != null && (
            <MiniStat label="Attendance" value={fmtPct(stats.attendance_rate)} />
          )}
          {stats.avg_hours != null && (
            <MiniStat label="Avg Hours" value={`${Number(stats.avg_hours).toFixed(1)}h`} />
          )}
          {stats.total_ot_hours != null && (
            <MiniStat label="OT Hours" value={Number(stats.total_ot_hours).toFixed(0)} />
          )}
        </div>
      </div>

      {/* Employee List */}
      {employees.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-64 overflow-y-auto">
          <table className="w-full table-compact text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Designation</th>
                <th className="text-right">Present</th>
                <th className="text-right">Absent</th>
                <th className="text-right">Late</th>
                <th className="text-right">Avg Hrs</th>
                <th className="text-right">OT Hrs</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.employee_code || e.code}>
                  <td className="font-mono text-blue-600">{e.employee_code || e.code}</td>
                  <td className="font-medium">{e.employee_name || e.name}</td>
                  <td className="text-slate-500">{e.designation || '—'}</td>
                  <td className="text-right text-green-600">{e.days_present ?? e.present ?? '—'}</td>
                  <td className="text-right text-red-600">{e.days_absent ?? e.absent ?? '—'}</td>
                  <td className="text-right text-orange-600">{e.late_count ?? e.late ?? '—'}</td>
                  <td className="text-right">{e.avg_hours != null ? Number(e.avg_hours).toFixed(1) : '—'}</td>
                  <td className="text-right text-purple-600">{e.ot_hours != null ? Number(e.ot_hours).toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {employees.length === 0 && !isLoading && (
        <div className="text-xs text-slate-400 py-2">No detailed employee data available for this department.</div>
      )}

      {/* Optional Context Content */}
      {contextContent && <div className="mt-3">{contextContent}</div>}
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
      <div className="text-xs font-bold text-slate-700">{value}</div>
    </div>
  )
}
