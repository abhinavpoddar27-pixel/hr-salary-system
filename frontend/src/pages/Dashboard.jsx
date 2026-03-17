import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useAppStore } from '../store/appStore'
import { getOrgOverview, getHeadcountTrend, getAlerts, generateAlerts } from '../utils/api'
import StatCard from '../components/common/StatCard'
import { fmtINR, fmtPct, monthYearLabel, attendanceRateColor, severityIcon, severityColor, fmtDate } from '../utils/formatters'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import DepartmentQuickView from '../components/ui/DepartmentQuickView'

export default function Dashboard() {
  const { selectedMonth, selectedYear } = useAppStore()

  const { data: overviewRes, isLoading: ovLoading } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear),
    retry: 0
  })

  const { data: trendRes } = useQuery({
    queryKey: ['headcount-trend', selectedMonth, selectedYear],
    queryFn: () => getHeadcountTrend(selectedMonth, selectedYear, 6),
    retry: 0
  })

  const { data: alertsRes } = useQuery({
    queryKey: ['alerts', selectedMonth, selectedYear],
    queryFn: () => getAlerts(selectedMonth, selectedYear, true),
    retry: 0
  })

  const overview = overviewRes?.data?.data
  const trend = trendRes?.data?.data || []
  const alerts = alertsRes?.data?.data || []
  const alertCounts = alertsRes?.data?.counts || {}

  const depts = overview?.departments || []
  const { toggle, isExpanded } = useExpandableRows()

  function heatmapColor(rate) {
    if (!rate) return 'bg-slate-100 text-slate-400'
    if (rate >= 85) return 'bg-green-100 text-green-700'
    if (rate >= 70) return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Organisation Overview</h2>
          <p className="text-sm text-slate-500">{monthYearLabel(selectedMonth, selectedYear)}</p>
        </div>
        <Link to="/pipeline/import" className="btn-primary">
          <span>📥</span> Process {monthYearLabel(selectedMonth, selectedYear)}
        </Link>
      </div>

      {/* No data state */}
      {!ovLoading && !overview && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📂</div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">No data for {monthYearLabel(selectedMonth, selectedYear)}</h3>
          <p className="text-slate-500 mb-4">Upload EESL attendance files to get started.</p>
          <Link to="/pipeline/import" className="btn-primary mx-auto">Upload Attendance Files</Link>
        </div>
      )}

      {/* Stats Row */}
      {overview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard label="Total Headcount" value={overview.totalHeadcount} icon="👥" color="blue" />
            <StatCard label="Attendance Rate" value={fmtPct(overview.attendanceRate)} icon="📊" color={overview.attendanceRate >= 85 ? 'green' : overview.attendanceRate >= 70 ? 'yellow' : 'red'} sub={overview.attendanceRate >= 85 ? '✓ On target' : '⚠ Below 85% target'} />
            <StatCard label="Permanent Staff" value={overview.permanentCount} icon="🏢" color="blue" />
            <StatCard label="Contractors" value={overview.contractorCount} icon="🔧" color="yellow" />
            <StatCard label="Net Salary Outflow" value={overview.salaryOutflow > 0 ? fmtINR(overview.salaryOutflow) : 'Pending'} icon="₹" color="green" />
            <StatCard label="Departments" value={depts.length} icon="🏭" color="slate" />
          </div>

          {/* Company split */}
          {overview.companyBreakdown?.length > 1 && (
            <div className="flex gap-3">
              {overview.companyBreakdown.map(c => (
                <div key={c.company} className="badge-blue text-sm px-3 py-1">
                  {c.company}: <strong>{c.count}</strong> employees
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Headcount Trend Chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Headcount Trend</h3>
            <span className="text-xs text-slate-400">Last 6 months</span>
          </div>
          <div className="card-body">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val) => [val, 'Employees']} />
                  <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-slate-400 text-sm">Import data to see headcount trend</div>
            )}
          </div>
        </div>

        {/* Alerts Panel */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Active Alerts</h3>
            <div className="flex gap-1.5">
              {alertCounts.critical > 0 && <span className="badge-red">{alertCounts.critical} critical</span>}
              {alertCounts.warning > 0 && <span className="badge-yellow">{alertCounts.warning} warnings</span>}
            </div>
          </div>
          <div className="overflow-y-auto max-h-64">
            {alerts.length === 0 ? (
              <div className="p-4 text-sm text-slate-400 text-center">
                {overview ? '✅ No active alerts' : 'Import data to generate alerts'}
              </div>
            ) : (
              alerts.slice(0, 10).map(alert => (
                <div key={alert.id} className={clsx('px-4 py-2.5 border-b border-slate-50 text-xs', severityColor(alert.severity))}>
                  <div className="flex items-start gap-1.5">
                    <span>{severityIcon(alert.severity)}</span>
                    <div>
                      <p className="font-medium">{alert.title}</p>
                      <p className="text-slate-500 mt-0.5 line-clamp-1">{alert.description}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {alerts.length > 0 && (
            <div className="card-body pt-2">
              <Link to="/alerts" className="text-xs text-blue-600 hover:underline">View all alerts →</Link>
            </div>
          )}
        </div>
      </div>

      {/* Department Health Table */}
      {depts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Department Health — {monthYearLabel(selectedMonth, selectedYear)}</h3>
            <div className="flex gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-200 inline-block" /> ≥ 85%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-200 inline-block" /> 70–85%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-200 inline-block" /> &lt; 70%</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-compact">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Headcount</th>
                  <th>Attendance</th>
                  <th>Type</th>
                  <th>Late Issues</th>
                  <th>OT Hours</th>
                </tr>
              </thead>
              <tbody>
                {depts.map(dept => (
                  <React.Fragment key={dept.department}>
                    <tr onClick={() => toggle(dept.department)} className={clsx('cursor-pointer transition-colors hover:bg-blue-50/50', isExpanded(dept.department) && 'bg-blue-50')}>
                      <td className="font-medium"><DrillDownChevron isExpanded={isExpanded(dept.department)} /> {dept.department || '(Unclassified)'}</td>
                      <td>{dept.headcount}</td>
                      <td>
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', heatmapColor(dept.attendanceRate))}>
                          {fmtPct(dept.attendanceRate)}
                        </span>
                      </td>
                      <td>
                        {dept.isContractor
                          ? <span className="badge-yellow">Contractor</span>
                          : <span className="badge-blue">Permanent</span>
                        }
                      </td>
                      <td className={dept.punctualityIssues > 5 ? 'text-red-600 font-medium' : ''}>{dept.punctualityIssues}</td>
                      <td>{dept.overtimeHours}h</td>
                    </tr>
                    {isExpanded(dept.department) && (
                      <DrillDownRow colSpan={6}>
                        <DepartmentQuickView department={dept.department} />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Upload Files', desc: 'Import EESL attendance', to: '/pipeline/import', icon: '📥', color: 'bg-blue-600' },
          { label: 'Miss Punches', desc: 'Review & correct', to: '/pipeline/miss-punch', icon: '🔍', color: 'bg-yellow-500' },
          { label: 'Generate Salary', desc: 'Compute & export', to: '/pipeline/salary', icon: '₹', color: 'bg-green-600' },
          { label: 'View Reports', desc: 'All reports & exports', to: '/reports', icon: '📋', color: 'bg-purple-600' },
        ].map(action => (
          <Link key={action.to} to={action.to} className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow group">
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center text-white text-xl shrink-0', action.color)}>
              {action.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">{action.label}</p>
              <p className="text-xs text-slate-400">{action.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
