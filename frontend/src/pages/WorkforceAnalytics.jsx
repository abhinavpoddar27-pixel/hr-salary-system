import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import {
  getHeadcountTrend, getAttritionData, getOrgOverview,
  detectInactiveEmployees, getInactiveEmployees, reactivateEmployee,
  getSalaryTrend
} from '../utils/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import toast from 'react-hot-toast'
import CompanyFilter from '../components/shared/CompanyFilter'
import { useAppStore } from '../store/appStore'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import DepartmentQuickView from '../components/ui/DepartmentQuickView'

const COLORS_PIE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

function KPI({ label, value, sub, color = 'blue', icon }) {
  const colors = {
    blue: 'from-blue-500 to-blue-600', green: 'from-emerald-500 to-emerald-600',
    red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-amber-600',
    purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-cyan-600',
  }
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={clsx('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-lg shrink-0', colors[color] || colors.blue)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

const TABS = [
  { id: 'headcount', label: 'Headcount & Composition', path: '/workforce/headcount' },
  { id: 'attrition', label: 'Hiring & Attrition', path: '/workforce/attrition' },
  { id: 'contractors', label: 'Contractor Management', path: '/workforce/contractors' },
  { id: 'payroll-trend', label: 'Payroll Cost Trend', path: '/workforce/payroll-trend' },
]

// ═══════════════════════════════════════════════════════════
// HEADCOUNT TAB — enhanced with detailed drill-down
// ═══════════════════════════════════════════════════════════
function HeadcountTab({ selectedMonth, selectedYear, selectedCompany }) {
  const [expandedMonth, setExpandedMonth] = useState(null)

  const { data: trendRes } = useQuery({
    queryKey: ['headcount-trend', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getHeadcountTrend(selectedMonth, selectedYear, 12, selectedCompany),
    retry: 0
  })
  const trend = trendRes?.data?.data || []

  const { data: overviewRes } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  // For attrition data to get join/exit details when a month row is expanded
  const expandedM = expandedMonth ? trend.find(t => t.monthLabel === expandedMonth) : null
  const { data: expandedAttritionRes } = useQuery({
    queryKey: ['attrition-detail', expandedM?.month, expandedM?.year, selectedCompany],
    queryFn: () => getAttritionData(expandedM?.month, expandedM?.year, selectedCompany),
    enabled: !!expandedM,
    retry: 0
  })
  const expandedAttrition = expandedAttritionRes?.data?.data || {}

  const permCount = overview.permanentCount || 0
  const contractCount = overview.contractorCount || 0

  // Departments data
  const departments = useMemo(() => {
    return (overview.departments || []).sort((a, b) => b.headcount - a.headcount)
  }, [overview.departments])

  const deptData = departments.map(d => ({
    name: d.department?.split(' ').slice(0, 2).join(' ') || 'N/A',
    full: d.department,
    headcount: d.headcount || d.totalEmployees || 0
  }))

  const latestMonth = trend[trend.length - 1] || {}
  const prevMonth = trend[trend.length - 2] || {}
  const delta = (latestMonth.totalEmployees || 0) - (prevMonth.totalEmployees || 0)

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="👥" label="Total Headcount" value={overview.totalEmployees || overview.totalHeadcount || 0}
          sub={delta > 0 ? `+${delta} vs prev month` : delta < 0 ? `${delta} vs prev month` : 'No change'} color="blue" />
        <KPI icon="🏢" label="Permanent" value={permCount} sub={`${permCount + contractCount > 0 ? Math.round(permCount / (permCount + contractCount) * 100) : 0}% of total`} color="green" />
        <KPI icon="📋" label="Contractors" value={contractCount} sub={`${permCount + contractCount > 0 ? Math.round(contractCount / (permCount + contractCount) * 100) : 0}% of total`} color="amber" />
        <KPI icon="📊" label="Departments" value={departments.length} color="purple" />
      </div>

      {/* Trend Chart */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Headcount Over Time (Last 12 Months)</h3></div>
        <div className="p-4">
          {trend.length === 0 ? (
            <div className="text-center py-8 text-slate-400">Process multiple months to see trend data</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="permGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="totalEmployees" name="Total" stroke="#3b82f6" fill="url(#totalGrad)" strokeWidth={2} dot={{ r: 3 }} />
                <Area type="monotone" dataKey="permanentCount" name="Permanent" stroke="#22c55e" fill="url(#permGrad)" strokeWidth={2} dot={{ r: 3 }} />
                <Area type="monotone" dataKey="contractorCount" name="Contractor" stroke="#f59e0b" fill="none" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Month-over-month table with drill-down */}
      {trend.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Month-over-Month Changes</h3>
            <p className="text-xs text-slate-400 mt-0.5">Click any row to see detailed joins/exits</p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-center">Total</th>
                  <th className="text-center">Permanent</th>
                  <th className="text-center">Contractor</th>
                  <th className="text-center">New Joins</th>
                  <th className="text-center">Exits</th>
                  <th className="text-center">Net Change</th>
                </tr>
              </thead>
              <tbody>
                {[...trend].reverse().map((t, i) => (
                  <React.Fragment key={i}>
                    <tr className={clsx('cursor-pointer hover:bg-slate-50 transition-colors',
                      expandedMonth === t.monthLabel && 'bg-blue-50')}
                      onClick={() => setExpandedMonth(expandedMonth === t.monthLabel ? null : t.monthLabel)}
                    >
                      <td className="font-medium">
                        <DrillDownChevron isExpanded={expandedMonth === t.monthLabel} /> {t.monthLabel}
                      </td>
                      <td className="text-center font-bold text-brand-600">{t.totalEmployees}</td>
                      <td className="text-center text-green-700">{t.permanentCount}</td>
                      <td className="text-center text-amber-600">{t.contractorCount}</td>
                      <td className="text-center text-green-700">{t.newJoins > 0 ? `+${t.newJoins}` : '—'}</td>
                      <td className="text-center text-red-600">{t.exits > 0 ? `-${t.exits}` : '—'}</td>
                      <td className="text-center">
                        {t.netChange > 0 ? (
                          <span className="text-green-600 font-semibold">+{t.netChange}</span>
                        ) : t.netChange < 0 ? (
                          <span className="text-red-600 font-semibold">{t.netChange}</span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                    {expandedMonth === t.monthLabel && (
                      <DrillDownRow colSpan={7}>
                          <div className="space-y-4">
                            {/* Department breakdown for this month */}
                            {t.byCompany && t.byCompany.length > 0 && (
                              <div>
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Company Breakdown</h4>
                                <div className="flex gap-3">
                                  {t.byCompany.map((c, ci) => (
                                    <div key={ci} className="bg-white rounded-lg p-2.5 border text-center min-w-[100px]">
                                      <div className="text-lg font-bold text-slate-800">{c.count}</div>
                                      <div className="text-xs text-slate-500">{c.company || 'Unknown'}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Joins and Exits details */}
                            {expandedM?.monthLabel === t.monthLabel && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* New Joins */}
                                <div>
                                  <h4 className="text-xs font-bold text-green-600 uppercase mb-2">
                                    New Joins ({expandedAttrition.newJoins || t.newJoins || 0})
                                  </h4>
                                  {(expandedAttrition.newJoinDetails || []).length > 0 ? (
                                    <div className="bg-white rounded-lg border overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead><tr className="border-b bg-green-50">
                                          <th className="py-1.5 px-2 text-left text-green-700">Name</th>
                                          <th className="py-1.5 px-2 text-left text-green-700">Code</th>
                                          <th className="py-1.5 px-2 text-left text-green-700">Department</th>
                                        </tr></thead>
                                        <tbody>
                                          {expandedAttrition.newJoinDetails.map((e, ei) => (
                                            <tr key={ei} className="border-b border-slate-100">
                                              <td className="py-1 px-2 font-medium">{e.name}</td>
                                              <td className="py-1 px-2 font-mono text-slate-500">{e.code}</td>
                                              <td className="py-1 px-2">{e.department}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-400 py-2">No new joins this month</div>
                                  )}
                                </div>

                                {/* Exits */}
                                <div>
                                  <h4 className="text-xs font-bold text-red-600 uppercase mb-2">
                                    Exits ({expandedAttrition.exits || t.exits || 0})
                                  </h4>
                                  {(expandedAttrition.exitDetails || []).length > 0 ? (
                                    <div className="bg-white rounded-lg border overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead><tr className="border-b bg-red-50">
                                          <th className="py-1.5 px-2 text-left text-red-700">Name</th>
                                          <th className="py-1.5 px-2 text-left text-red-700">Code</th>
                                          <th className="py-1.5 px-2 text-left text-red-700">Department</th>
                                        </tr></thead>
                                        <tbody>
                                          {expandedAttrition.exitDetails.map((e, ei) => (
                                            <tr key={ei} className="border-b border-slate-100">
                                              <td className="py-1 px-2 font-medium">{e.name}</td>
                                              <td className="py-1 px-2 font-mono text-slate-500">{e.code}</td>
                                              <td className="py-1 px-2">{e.department}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-400 py-2">No exits this month</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Department Headcount Bar */}
      {deptData.length > 0 && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Headcount by Department</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deptData} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="headcount" name="Employees" radius={[4, 4, 0, 0]}>
                  {deptData.map((_, i) => <Cell key={i} fill={COLORS_PIE[i % COLORS_PIE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ATTRITION TAB — detailed view with permanent vs contractor
// ═══════════════════════════════════════════════════════════
function AttritionTab({ selectedMonth, selectedYear, selectedCompany }) {
  const qc = useQueryClient()
  const inactiveExpand = useExpandableRows()
  const joinExpand = useExpandableRows()
  const exitExpand = useExpandableRows()

  const { data: attritionRes } = useQuery({
    queryKey: ['attrition', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getAttritionData(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const attrition = attritionRes?.data?.data || {}

  const { data: inactiveRes, refetch: refetchInactive } = useQuery({
    queryKey: ['inactive-employees', selectedCompany],
    queryFn: () => getInactiveEmployees(selectedCompany),
    retry: 0
  })
  const inactive = inactiveRes?.data?.data || []

  const detectMutation = useMutation({
    mutationFn: () => detectInactiveEmployees(selectedMonth, selectedYear, 14),
    onSuccess: (res) => {
      const count = res?.data?.markedInactive || 0
      toast.success(`Detected ${count} inactive employees`)
      refetchInactive()
      qc.invalidateQueries(['org-overview'])
      qc.invalidateQueries(['headcount-trend'])
    }
  })

  const reactivateMutation = useMutation({
    mutationFn: (code) => reactivateEmployee(code),
    onSuccess: () => { toast.success('Employee reactivated'); refetchInactive() }
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI icon="📊" label="Opening HC" value={attrition.openingHeadcount || 0} sub="prev month" color="blue" />
        <KPI icon="✅" label="New Joins" value={attrition.newJoins || 0} color="green" />
        <KPI icon="🚪" label="Exits" value={attrition.exits || 0} color="red" />
        <KPI icon="📉" label="Attrition Rate" value={`${attrition.attritionRate?.toFixed(1) || 0}%`}
          sub={`Annual: ${attrition.annualisedAttritionRate?.toFixed(1) || 0}%`}
          color={parseFloat(attrition.attritionRate || 0) > 5 ? 'red' : 'green'} />
        <KPI icon="📈" label="Net Change" value={attrition.netChange > 0 ? `+${attrition.netChange}` : attrition.netChange || 0}
          color={attrition.netChange >= 0 ? 'green' : 'red'} />
      </div>

      <div className="card p-4 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-800">
          <strong>Note:</strong> Contractor attrition is typically higher than permanent workforce.
          Exits are detected by comparing attendance across months. Use &quot;Detect Inactive&quot; to auto-mark employees absent 14+ days.
        </p>
      </div>

      {/* Inactive Detection */}
      <div className="card overflow-hidden">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-700">Inactive Employee Detection</h3>
            <p className="text-xs text-slate-400 mt-0.5">Employees absent 14+ consecutive days — auto-marked as Inactive</p>
          </div>
          <button onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}
            className="btn-primary text-sm">
            {detectMutation.isPending ? 'Scanning...' : 'Detect Inactive'}
          </button>
        </div>
        {inactive.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Department</th><th>Type</th>
                  <th>Inactive Since</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {inactive.map((e, i) => (
                  <React.Fragment key={i}>
                    <tr onClick={() => inactiveExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', inactiveExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                      <td className="font-mono text-sm"><DrillDownChevron isExpanded={inactiveExpand.isExpanded(e.code || i)} /> {e.code}</td>
                      <td className="font-medium">{e.name}</td>
                      <td>{e.department}</td>
                      <td><span className={clsx('text-xs px-2 py-0.5 rounded-full',
                        e.employment_type === 'Permanent' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      )}>{e.employment_type}</span></td>
                      <td className="text-slate-500">{e.inactive_since || '—'}</td>
                      <td><span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">{e.status}</span></td>
                      <td>
                        <button onClick={(ev) => { ev.stopPropagation(); reactivateMutation.mutate(e.code) }}
                          disabled={reactivateMutation.isPending}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          Reactivate
                        </button>
                      </td>
                    </tr>
                    {inactiveExpand.isExpanded(e.code || i) && (
                      <DrillDownRow colSpan={7}>
                        <EmployeeQuickView employeeCode={e.code} compact
                          contextContent={
                            <div className="text-xs space-y-1">
                              <div className="font-semibold text-slate-500 mb-2">Inactive Details</div>
                              <div>Status: <span className="font-medium text-red-600">{e.status}</span></div>
                              <div>Inactive Since: <span className="font-medium">{e.inactive_since || '—'}</span></div>
                              <div>Type: <span className="font-medium">{e.employment_type}</span></div>
                            </div>
                          }
                        />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inactive.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-sm">No inactive employees detected. Run detection to scan.</div>
        )}
      </div>

      {/* New Joins Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(attrition.newJoinDetails || []).length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header"><h3 className="font-semibold text-green-700">New Joins — {attrition.newJoins}</h3></div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Company</th></tr></thead>
                <tbody>
                  {attrition.newJoinDetails.map((e, i) => (
                    <React.Fragment key={i}>
                      <tr onClick={() => joinExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', joinExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                        <td className="font-medium"><DrillDownChevron isExpanded={joinExpand.isExpanded(e.code || i)} /> {e.name}</td>
                        <td className="text-slate-500 font-mono text-xs">{e.code}</td>
                        <td>{e.department}</td>
                        <td>{e.company}</td>
                      </tr>
                      {joinExpand.isExpanded(e.code || i) && (
                        <DrillDownRow colSpan={4}>
                          <EmployeeQuickView employeeCode={e.code} compact />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(attrition.exitDetails || []).length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header"><h3 className="font-semibold text-red-700">Exits — {attrition.exits}</h3></div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Company</th></tr></thead>
                <tbody>
                  {attrition.exitDetails.map((e, i) => (
                    <React.Fragment key={i}>
                      <tr onClick={() => exitExpand.toggle(e.code || i)} className={clsx('cursor-pointer transition-colors', exitExpand.isExpanded(e.code || i) && 'bg-blue-50')}>
                        <td className="font-medium"><DrillDownChevron isExpanded={exitExpand.isExpanded(e.code || i)} /> {e.name}</td>
                        <td className="text-slate-500 font-mono text-xs">{e.code}</td>
                        <td>{e.department}</td>
                        <td>{e.company}</td>
                      </tr>
                      {exitExpand.isExpanded(e.code || i) && (
                        <DrillDownRow colSpan={4}>
                          <EmployeeQuickView employeeCode={e.code} compact />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// CONTRACTOR MANAGEMENT TAB
// ═══════════════════════════════════════════════════════════
function ContractorTab({ selectedMonth, selectedYear, selectedCompany }) {
  const contractorExpand = useExpandableRows()
  const permanentExpand = useExpandableRows()

  const { data: overviewRes } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear, selectedCompany),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  const permCount = overview.permanentCount || 0
  const contractCount = overview.contractorCount || 0
  const total = permCount + contractCount

  const pieData = [
    { name: 'Permanent', value: permCount },
    { name: 'Contractor', value: contractCount }
  ]

  const departments = useMemo(() => {
    return (overview.departments || []).sort((a, b) => b.headcount - a.headcount)
  }, [overview.departments])

  const contractorDepts = departments.filter(d => d.isContractor)
  const permanentDepts = departments.filter(d => !d.isContractor)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon="🏢" label="Permanent HC" value={permCount} sub={`${total > 0 ? Math.round(permCount / total * 100) : 0}%`} color="green" />
        <KPI icon="📋" label="Contractor HC" value={contractCount} sub={`${total > 0 ? Math.round(contractCount / total * 100) : 0}%`} color="amber" />
        <KPI icon="🏭" label="Contractor Groups" value={contractorDepts.length} color="purple" />
        <KPI icon="📊" label="Perm Depts" value={permanentDepts.length} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Workforce Composition</h3></div>
          <div className="p-4 flex items-center justify-center gap-8">
            <PieChart width={220} height={220}>
              <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={3}>
                {pieData.map((_, i) => <Cell key={i} fill={['#22c55e', '#f59e0b'][i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
            <div className="space-y-3">
              {pieData.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={`w-3 h-3 rounded-full inline-block ${i === 0 ? 'bg-green-500' : 'bg-amber-500'}`} />
                  <span className="text-slate-700">{d.name}</span>
                  <span className="font-bold ml-1">{d.value}</span>
                  <span className="text-slate-400">({total > 0 ? Math.round(d.value / total * 100) : 0}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Department headcount bar */}
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Department Distribution</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={departments.slice(0, 12).map(d => ({
                name: d.department?.split(' ').slice(0, 2).join(' '),
                value: d.headcount,
                isContractor: d.isContractor
              }))} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="value" name="Employees" radius={[4, 4, 0, 0]}>
                  {departments.slice(0, 12).map((d, i) => (
                    <Cell key={i} fill={d.isContractor ? '#f59e0b' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Contractor Groups Table */}
      {contractorDepts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-amber-700">Contractor Groups — {contractorDepts.length}</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Contractor Group</th>
                  <th className="text-center">Headcount</th>
                  <th className="text-center">Attendance %</th>
                  <th className="text-center">Present Days</th>
                  <th className="text-center">Absent Days</th>
                  <th className="text-center">Avg Hours</th>
                  <th className="text-center">Late</th>
                </tr>
              </thead>
              <tbody>
                {contractorDepts.map((d, i) => (
                  <React.Fragment key={i}>
                    <tr onClick={() => contractorExpand.toggle(d.department)} className={clsx('cursor-pointer transition-colors', contractorExpand.isExpanded(d.department) && 'bg-blue-50')}>
                      <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={contractorExpand.isExpanded(d.department)} /> {d.department}</td>
                      <td className="text-center font-bold">{d.headcount}</td>
                      <td className="text-center">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold',
                          d.attendanceRate >= 85 ? 'bg-green-100 text-green-700' : d.attendanceRate >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        )}>{d.attendanceRate}%</span>
                      </td>
                      <td className="text-center text-green-700">{d.presentDays}</td>
                      <td className="text-center text-red-600">{d.absentDays}</td>
                      <td className="text-center">{d.avgActualHours || '—'}</td>
                      <td className="text-center text-amber-600">{d.punctualityIssues || 0}</td>
                    </tr>
                    {contractorExpand.isExpanded(d.department) && (
                      <DrillDownRow colSpan={7}>
                        <DepartmentQuickView department={d.department} />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Permanent Departments Table */}
      {permanentDepts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-blue-700">Permanent Departments — {permanentDepts.length}</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="text-center">Headcount</th>
                  <th className="text-center">Attendance %</th>
                  <th className="text-center">Present Days</th>
                  <th className="text-center">Absent Days</th>
                  <th className="text-center">Avg Hours</th>
                  <th className="text-center">Late</th>
                </tr>
              </thead>
              <tbody>
                {permanentDepts.map((d, i) => (
                  <React.Fragment key={i}>
                    <tr onClick={() => permanentExpand.toggle(d.department)} className={clsx('cursor-pointer transition-colors', permanentExpand.isExpanded(d.department) && 'bg-blue-50')}>
                      <td className="font-medium text-slate-800"><DrillDownChevron isExpanded={permanentExpand.isExpanded(d.department)} /> {d.department}</td>
                      <td className="text-center font-bold">{d.headcount}</td>
                      <td className="text-center">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold',
                          d.attendanceRate >= 85 ? 'bg-green-100 text-green-700' : d.attendanceRate >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        )}>{d.attendanceRate}%</span>
                      </td>
                      <td className="text-center text-green-700">{d.presentDays}</td>
                      <td className="text-center text-red-600">{d.absentDays}</td>
                      <td className="text-center">{d.avgActualHours || '—'}</td>
                      <td className="text-center text-amber-600">{d.punctualityIssues || 0}</td>
                    </tr>
                    {permanentExpand.isExpanded(d.department) && (
                      <DrillDownRow colSpan={7}>
                        <DepartmentQuickView department={d.department} />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// PAYROLL COST TREND TAB
// ═══════════════════════════════════════════════════════════
function PayrollTrendTab({ selectedMonth, selectedYear, selectedCompany }) {
  const [trendYears, setTrendYears] = useState(3)

  const { data: trendRes, isLoading } = useQuery({
    queryKey: ['salary-trend', selectedMonth, selectedYear, selectedCompany, trendYears],
    queryFn: () => getSalaryTrend(selectedMonth, selectedYear, trendYears, selectedCompany),
    retry: 0
  })
  const trendData = trendRes?.data?.data || {}
  const months = trendData.months || []
  const yearSummaries = trendData.yearSummaries || []

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">Payroll Cost Trend</h3>
            <select
              value={trendYears}
              onChange={(e) => setTrendYears(parseInt(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={1}>1 Year</option>
              <option value={2}>2 Years</option>
              <option value={3}>3 Years</option>
              <option value={5}>5 Years</option>
            </select>
          </div>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : months.length > 0 ? (
            <>
              {/* Year-over-Year Summary Cards */}
              {yearSummaries.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {yearSummaries.map(y => (
                    <div key={y.year} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <div className="text-xs text-slate-500 font-medium">{y.year}</div>
                      <div className="text-lg font-bold text-slate-800 mt-0.5">
                        ₹{(y.avgMonthlyCost / 100000).toFixed(1)}L<span className="text-xs font-normal text-slate-400">/mo</span>
                      </div>
                      <div className="text-xs text-slate-500">{y.avgHeadcount} avg employees</div>
                      {y.yoyChange !== null && (
                        <div className={`text-xs font-semibold mt-1 ${y.yoyChange > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {y.yoyChange > 0 ? '↑' : '↓'} {Math.abs(y.yoyChange)}% YoY
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Line Chart */}
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={months} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis
                    yAxisId="cost"
                    tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`}
                    tick={{ fontSize: 11 }}
                    width={60}
                  />
                  <YAxis
                    yAxisId="headcount"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Headcount') return [value, name]
                      return [`₹${Math.round(value).toLocaleString('en-IN')}`, name]
                    }}
                  />
                  <Legend />
                  <Line yAxisId="cost" type="monotone" dataKey="totalNetSalary" name="Net Salary" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line yAxisId="cost" type="monotone" dataKey="totalCTC" name="Total CTC" stroke="#dc2626" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                  <Line yAxisId="headcount" type="monotone" dataKey="headcount" name="Headcount" stroke="#16a34a" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="text-center py-8 text-slate-400">No salary data found for the selected period. Run Stage 7 first.</div>
          )}
        </div>
      </div>

      {/* Month detail table */}
      {months.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Monthly Breakdown</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full text-xs">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-center">HC</th>
                  <th className="text-right">Gross Earned</th>
                  <th className="text-right">Net Salary</th>
                  <th className="text-right">Total CTC</th>
                  <th className="text-right">OT + ED</th>
                  <th className="text-right">PF (ER)</th>
                  <th className="text-right">ESI (ER)</th>
                  <th className="text-right">Per Employee</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m, i) => (
                  <tr key={i}>
                    <td className="font-medium whitespace-nowrap">{m.label}</td>
                    <td className="text-center">{m.headcount}</td>
                    <td className="text-right">₹{m.totalGrossEarned.toLocaleString('en-IN')}</td>
                    <td className="text-right text-blue-700">₹{m.totalNetSalary.toLocaleString('en-IN')}</td>
                    <td className="text-right font-semibold">₹{m.totalCTC.toLocaleString('en-IN')}</td>
                    <td className="text-right text-amber-600">₹{(m.totalOT + m.totalED).toLocaleString('en-IN')}</td>
                    <td className="text-right">₹{m.totalPFEmployer.toLocaleString('en-IN')}</td>
                    <td className="text-right">₹{m.totalESIEmployer.toLocaleString('en-IN')}</td>
                    <td className="text-right text-slate-500">₹{m.perEmployeeCost.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN WORKFORCE COMPONENT WITH ROUTES
// ═══════════════════════════════════════════════════════════
export default function WorkforceAnalytics() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const dp = { selectedMonth: month, selectedYear: year, selectedCompany }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <h2 className="section-title">Workforce Analytics</h2>
        <p className="section-subtitle mt-1">Headcount trends, attrition analysis, and contractor management</p>
      </div>
      <div className="flex items-center gap-3">
        <CompanyFilter />
        <DateSelector {...dateProps} />
      </div>
      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {TABS.map(t => (
          <NavLink key={t.id} to={t.path}
            className={({ isActive }) => clsx('px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>{t.label}</NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Navigate to="headcount" replace />} />
        <Route path="headcount" element={<HeadcountTab {...dp} />} />
        <Route path="attrition" element={<AttritionTab {...dp} />} />
        <Route path="contractors" element={<ContractorTab {...dp} />} />
        <Route path="payroll-trend" element={<PayrollTrendTab {...dp} />} />
      </Routes>
    </div>
  )
}
