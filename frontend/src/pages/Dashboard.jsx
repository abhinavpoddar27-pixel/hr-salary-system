import React, { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getOrgOverview, getHeadcountTrend, getAlerts, generateAlerts, getSalaryRegister, getReadinessCheck, getSalaryManualFlags, getLateComingDeductions, getMissPunches, getDepartmentPayroll } from '../utils/api'
import StatCard from '../components/common/StatCard'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import { useAppStore } from '../store/appStore'
import { fmtINR, fmtPct, monthYearLabel, attendanceRateColor, severityIcon, severityColor, fmtDate } from '../utils/formatters'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import DepartmentQuickView from '../components/ui/DepartmentQuickView'

export default function Dashboard() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()
  const selectedMonth = month, selectedYear = year

  const userRole = user?.role || 'viewer'
  const isAdmin = userRole === 'admin'
  const isFinance = userRole === 'finance'
  const showFinanceView = isAdmin || isFinance
  const [dashView, setDashView] = useState(showFinanceView ? 'finance' : 'hr')

  // Finance dashboard data
  const [financeData, setFinanceData] = useState(null)
  const [financeLoading, setFinanceLoading] = useState(false)

  const { data: overviewRes, isLoading: ovLoading } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear, { company: selectedCompany }),
    retry: 0
  })

  const { data: trendRes } = useQuery({
    queryKey: ['headcount-trend', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getHeadcountTrend(selectedMonth, selectedYear, 6, { company: selectedCompany }),
    retry: 0
  })

  const { data: alertsRes } = useQuery({
    queryKey: ['alerts', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getAlerts(selectedMonth, selectedYear, true, { company: selectedCompany }),
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

  // ── Finance dashboard data fetch ──
  const fetchFinanceDashboard = useCallback(async () => {
    if (!selectedMonth || !selectedYear) return
    setFinanceLoading(true)
    try {
      let prevMonth = parseInt(selectedMonth) - 1
      let prevYear = parseInt(selectedYear)
      if (prevMonth === 0) { prevMonth = 12; prevYear-- }

      const [
        registerRes,
        readinessRes,
        manualFlagsRes,
        lateDeductionsRes,
        missPunchRes,
        deptPayrollRes,
        prevRegisterRes
      ] = await Promise.all([
        getSalaryRegister(selectedMonth, selectedYear, selectedCompany).then(r => r.data).catch(() => ({ success: false })),
        getReadinessCheck(selectedMonth, selectedYear).then(r => r.data).catch(() => ({ success: false })),
        getSalaryManualFlags(selectedMonth, selectedYear, selectedCompany).then(r => r.data).catch(() => ({ success: false })),
        getLateComingDeductions(selectedMonth, selectedYear, { status: 'pending', company: selectedCompany }).then(r => r.data).catch(() => ({ success: false })),
        getMissPunches({ month: selectedMonth, year: selectedYear, company: selectedCompany }).then(r => r.data).catch(() => ({ success: false })),
        isAdmin ? getDepartmentPayroll(selectedMonth, selectedYear, selectedCompany).then(r => r.data).catch(() => ({ success: false })) : Promise.resolve({ success: false }),
        isAdmin ? getSalaryRegister(prevMonth, prevYear, selectedCompany).then(r => r.data).catch(() => ({ success: false })) : Promise.resolve({ success: false })
      ])

      setFinanceData({
        totals: registerRes.success ? (registerRes.totals || {}) : {},
        prevTotals: prevRegisterRes.success ? (prevRegisterRes.totals || null) : null,
        recordCount: registerRes.success ? (registerRes.data?.length || 0) : 0,
        readiness: readinessRes.success ? (readinessRes.data || { ready: false, score: 0, blockers: [], warnings: [], passed: [] }) : { ready: false, score: 0, blockers: [], warnings: [], passed: [] },
        actions: {
          heldSalaries: registerRes.success ? (registerRes.totals?.heldCount || 0) : 0,
          manualFlags: manualFlagsRes.success ? (manualFlagsRes.data || []).filter(f => f.finance_approved === 0).length : 0,
          lateDeductions: lateDeductionsRes.success ? (lateDeductionsRes.data || []).length : 0,
          missPunchFinance: missPunchRes.success ? (missPunchRes.summary?.financePending || 0) : 0,
        },
        departments: deptPayrollRes.success ? (deptPayrollRes.data?.departments || []).slice(0, 8) : [],
      })
    } catch (err) {
      console.error('Finance dashboard fetch failed:', err)
    } finally {
      setFinanceLoading(false)
    }
  }, [selectedMonth, selectedYear, selectedCompany, isAdmin])

  useEffect(() => {
    if (dashView === 'finance' && showFinanceView) {
      fetchFinanceDashboard()
    }
  }, [selectedMonth, selectedYear, selectedCompany, dashView, showFinanceView, fetchFinanceDashboard])

  // ── Admin Financial Dashboard ──
  const renderAdminDashboard = () => {
    if (financeLoading) return <div className="text-center py-12 text-slate-500">Loading financial overview...</div>
    if (!financeData) return <div className="text-center py-12 text-slate-400">Select a month to view payroll data</div>

    const { totals, prevTotals, readiness, actions, departments, recordCount } = financeData
    const currentNet = totals?.totalNet || 0
    const prevNet = prevTotals?.totalNet || 0
    const momChange = prevNet > 0 ? Math.round((currentNet - prevNet) / prevNet * 1000) / 10 : null

    return (
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
            <div className="text-sm text-slate-500">Net Payroll</div>
            <div className="text-2xl font-bold text-slate-800">{currentNet > 0 ? `₹${(currentNet / 100000).toFixed(1)}L` : 'Pending'}</div>
            <div className="text-xs text-slate-400">{recordCount} employees</div>
            {momChange !== null && (
              <div className={`text-xs font-medium mt-1 ${momChange > 0 ? 'text-red-500' : momChange < 0 ? 'text-green-500' : 'text-slate-400'}`}>
                {momChange > 0 ? '↑' : momChange < 0 ? '↓' : '–'} {Math.abs(momChange)}% vs last month
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-500">
            <div className="text-sm text-slate-500">PF (EE + ER)</div>
            <div className="text-2xl font-bold text-slate-800">₹{((totals?.totalPFLiability || 0) / 100000).toFixed(1)}L</div>
            <div className="text-xs text-slate-400">Employee + Employer</div>
          </div>

          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-teal-500">
            <div className="text-sm text-slate-500">ESI (EE + ER)</div>
            <div className="text-2xl font-bold text-slate-800">₹{((totals?.totalESI || 0) / 100000).toFixed(1)}L</div>
            <div className="text-xs text-slate-400">Employee + Employer</div>
          </div>

          <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${readiness.ready ? 'border-green-500' : 'border-red-500'}`}>
            <div className="text-sm text-slate-500">Readiness</div>
            <div className="text-2xl font-bold text-slate-800">{readiness.score}/100</div>
            <div className="text-xs text-slate-400">
              {readiness.blockers?.length || 0} blockers · {readiness.warnings?.length || 0} warnings
            </div>
          </div>
        </div>

        {/* Action Queue */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-3 border-b font-semibold text-slate-700">Pending Actions</div>
          <div className="divide-y">
            {[
              { count: actions.heldSalaries, label: 'Held Salaries need review', to: '/pipeline/salary', severity: 'blocker' },
              { count: actions.manualFlags, label: 'Manual flags pending approval', to: '/finance-audit', severity: 'blocker' },
              { count: actions.lateDeductions, label: 'Late deductions pending review', to: '/finance-audit', severity: 'warning' },
              { count: actions.missPunchFinance, label: 'Miss punches awaiting finance review', to: '/pipeline/miss-punch', severity: 'warning' },
            ].map((item, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${
                    item.count === 0 ? 'bg-green-400' : item.severity === 'blocker' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                  <span className={item.count > 0 ? 'font-medium text-slate-700' : 'text-slate-400'}>
                    {item.count > 0 ? `${item.count} ${item.label}` : `${item.label}: All clear`}
                  </span>
                </div>
                {item.count > 0 && (
                  <Link to={item.to} className="text-sm text-blue-600 hover:underline">Review →</Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Department Cost (admin only) */}
        {departments.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <span className="font-semibold text-slate-700">Department Cost Breakdown</span>
              <Link to="/reports" className="text-sm text-blue-600 hover:underline">Full Report →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Department</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">HC</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Gross Earned</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Total CTC</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Cost %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {departments.map(d => (
                    <tr key={d.department} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-700">{d.department}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{d.headcount}</td>
                      <td className="px-4 py-2 text-right text-slate-600">₹{(d.grossEarned || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-700">₹{((d.totalCTC || 0) / 100000).toFixed(1)}L</td>
                      <td className="px-4 py-2 text-right text-slate-600">{d.costShare}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Readiness Checklist */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="font-semibold text-slate-700">Month-End Readiness</span>
            <Link to="/finance-audit" className="text-sm text-blue-600 hover:underline">Finance Audit →</Link>
          </div>
          <div className="p-4 space-y-2">
            {(readiness.passed || []).map((item, i) => (
              <div key={`p-${i}`} className="flex items-center gap-2 text-sm text-green-700">
                <span className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-xs">✓</span>
                <span>{item.type.replace(/_/g, ' ').toLowerCase()}{item.detail ? ` (${item.detail})` : ''}</span>
              </div>
            ))}
            {(readiness.blockers || []).map((item, i) => (
              <div key={`b-${i}`} className="flex items-center gap-2 text-sm text-red-700 font-medium">
                <span className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center text-xs">!</span>
                <span>BLOCKER: {item.detail}</span>
              </div>
            ))}
            {(readiness.warnings || []).map((item, i) => (
              <div key={`w-${i}`} className="flex items-center gap-2 text-sm text-amber-700">
                <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-xs">!</span>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Finance Workbench (finance role — no KPIs, no dept cost) ──
  const renderFinanceWorkbench = () => {
    if (financeLoading) return <div className="text-center py-12 text-slate-500">Loading...</div>
    if (!financeData) return <div className="text-center py-12 text-slate-400">Select a month to view</div>

    const { readiness, actions } = financeData
    const totalPending = actions.heldSalaries + actions.manualFlags + actions.lateDeductions + actions.missPunchFinance

    return (
      <div className="space-y-6">
        {/* Action count cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { count: actions.heldSalaries, label: 'Held Salaries', to: '/pipeline/salary', borderActive: 'border-red-500', textActive: 'text-red-600' },
            { count: actions.manualFlags, label: 'Manual Flags', to: '/finance-audit', borderActive: 'border-orange-500', textActive: 'text-orange-600' },
            { count: actions.lateDeductions, label: 'Late Deductions', to: '/finance-audit', borderActive: 'border-amber-500', textActive: 'text-amber-600' },
            { count: actions.missPunchFinance, label: 'Miss Punch Review', to: '/pipeline/miss-punch', borderActive: 'border-yellow-500', textActive: 'text-yellow-600' },
          ].map((item, i) => (
            <Link key={i} to={item.to} className={`bg-white rounded-lg shadow p-4 border-l-4 hover:bg-slate-50 transition ${
              item.count > 0 ? item.borderActive : 'border-green-500'
            }`}>
              <div className={`text-3xl font-bold ${item.count > 0 ? item.textActive : 'text-green-600'}`}>
                {item.count}
              </div>
              <div className="text-sm text-slate-500 mt-1">{item.label}</div>
              {item.count > 0 && <div className="text-xs text-blue-600 mt-2">Review →</div>}
            </Link>
          ))}
        </div>

        {/* Status banner */}
        <div className={`rounded-lg p-4 ${totalPending > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
          <div className={`font-semibold ${totalPending > 0 ? 'text-amber-800' : 'text-green-800'}`}>
            {totalPending > 0 ? `${totalPending} item(s) need your attention` : 'All caught up — nothing pending'}
          </div>
          {readiness.ready ? (
            <div className="text-sm text-green-700 mt-1">Month is ready for sign-off</div>
          ) : (
            <div className="text-sm text-amber-700 mt-1">
              {readiness.blockers?.length || 0} blocker(s) remaining before sign-off
            </div>
          )}
        </div>

        {/* Readiness checklist */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="font-semibold text-slate-700">Month-End Checklist</span>
            <span className={`text-sm font-medium px-2 py-1 rounded ${
              readiness.ready ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {readiness.ready ? 'Ready' : 'Not Ready'} · {readiness.score}/100
            </span>
          </div>
          <div className="p-4 space-y-2">
            {(readiness.passed || []).map((item, i) => (
              <div key={`p-${i}`} className="flex items-center gap-2 text-sm text-green-700">
                <span className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-xs">✓</span>
                <span>{item.type.replace(/_/g, ' ').toLowerCase()}{item.detail ? ` (${item.detail})` : ''}</span>
              </div>
            ))}
            {(readiness.blockers || []).map((item, i) => (
              <div key={`b-${i}`} className="flex items-center gap-2 text-sm text-red-700 font-medium">
                <span className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center text-xs">!</span>
                <span>BLOCKER: {item.detail}</span>
              </div>
            ))}
            {(readiness.warnings || []).map((item, i) => (
              <div key={`w-${i}`} className="flex items-center gap-2 text-sm text-amber-700">
                <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-xs">!</span>
                <span>{item.detail}</span>
              </div>
            ))}
            <div className="pt-3 mt-3 border-t">
              <Link to="/finance-audit" className="text-sm text-blue-600 hover:underline font-medium">
                Go to Finance Audit →
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Original HR Dashboard (unchanged) ──
  const renderHRDashboard = () => (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Organisation Overview</h2>
          <p className="text-sm text-slate-500">{monthYearLabel(selectedMonth, selectedYear)}</p>
        </div>
        <Link to="/pipeline/import" className="btn-primary">
          <span>📥</span> Process {monthYearLabel(selectedMonth, selectedYear)}
        </Link>
      </div>

      {!ovLoading && !overview && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📂</div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">No data for {monthYearLabel(selectedMonth, selectedYear)}</h3>
          <p className="text-slate-500 mb-4">Upload EESL attendance files to get started.</p>
          <Link to="/pipeline/import" className="btn-primary mx-auto">Upload Attendance Files</Link>
        </div>
      )}

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
    </>
  )

  // ── Main return ──
  const showingFinance = dashView === 'finance' && showFinanceView

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl">
      {/* Date selector + Header */}
      <div className="flex items-center gap-3">
        <DateSelector {...dateProps} />
        <CompanyFilter />
      </div>

      {/* Finance view header (admin/finance only) — HR view uses renderHRDashboard's own header */}
      {showingFinance && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {isAdmin ? 'Admin Dashboard' : 'Finance Workbench'}
            </h2>
            <p className="text-sm text-slate-500">{monthYearLabel(selectedMonth, selectedYear)}</p>
          </div>
          {isAdmin && (
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setDashView('finance')}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  dashView === 'finance' ? 'bg-white shadow font-medium text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Financial Overview
              </button>
              <button
                onClick={() => setDashView('hr')}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  dashView === 'hr' ? 'bg-white shadow font-medium text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                HR View
              </button>
            </div>
          )}
        </div>
      )}

      {/* Admin toggle when on HR view — placed between date selector and HR content */}
      {isAdmin && !showingFinance && (
        <div className="flex items-center justify-end">
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setDashView('finance')}
              className="px-3 py-1.5 text-sm rounded-md transition text-slate-500 hover:text-slate-700"
            >
              Financial Overview
            </button>
            <button
              onClick={() => setDashView('hr')}
              className="px-3 py-1.5 text-sm rounded-md transition bg-white shadow font-medium text-slate-800"
            >
              HR View
            </button>
          </div>
        </div>
      )}

      {dashView === 'finance' && isAdmin && renderAdminDashboard()}
      {dashView === 'finance' && isFinance && !isAdmin && renderFinanceWorkbench()}
      {dashView === 'hr' && renderHRDashboard()}
      {!showFinanceView && renderHRDashboard()}
    </div>
  )
}
