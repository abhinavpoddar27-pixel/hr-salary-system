import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line
} from 'recharts'
import { getHeadcountTrend, getAttritionData, getOrgOverview } from '../utils/api'
import { useAppStore } from '../store/appStore'
import StatCard from '../components/common/StatCard'

const COLORS_PIE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

export default function WorkforceAnalytics() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [activeTab, setActiveTab] = useState('headcount')

  const { data: trendRes } = useQuery({
    queryKey: ['headcount-trend', selectedMonth, selectedYear],
    queryFn: () => getHeadcountTrend(selectedMonth, selectedYear, 12),
    retry: 0
  })
  const trend = trendRes?.data?.data || []

  const { data: attritionRes } = useQuery({
    queryKey: ['attrition', selectedMonth, selectedYear],
    queryFn: () => getAttritionData(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'attrition'
  })
  const attrition = attritionRes?.data?.data || {}

  const { data: overviewRes } = useQuery({
    queryKey: ['org-overview', selectedMonth, selectedYear],
    queryFn: () => getOrgOverview(selectedMonth, selectedYear),
    retry: 0
  })
  const overview = overviewRes?.data?.data || {}

  // Contractor vs Permanent ratio
  const permCount = overview.permanentCount || 0
  const contractCount = overview.contractorCount || 0
  const pieData = [
    { name: 'Permanent', value: permCount },
    { name: 'Contractor', value: contractCount }
  ]

  // Department headcount pie
  const deptPie = Object.values(overview.departments || {}).map(d => ({
    name: d.department?.split(' ').slice(0, 2).join(' '),
    value: d.totalEmployees
  }))

  const TABS = [
    { id: 'headcount', label: 'Headcount Trend' },
    { id: 'attrition', label: 'Attrition' },
    { id: 'workforce', label: 'Workforce Mix' },
  ]

  const latestMonth = trend[trend.length - 1] || {}
  const prevMonth = trend[trend.length - 2] || {}
  const delta = (latestMonth.totalEmployees || 0) - (prevMonth.totalEmployees || 0)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Workforce Analytics</h2>
        <p className="text-sm text-slate-500">Headcount trends, attrition, and workforce composition</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Headcount"
          value={overview.totalEmployees || 0}
          trend={delta !== 0 ? delta : null}
          trendLabel={delta > 0 ? `+${delta} this month` : `${delta} this month`}
          color="blue"
        />
        <StatCard label="Permanent" value={permCount} color="green" />
        <StatCard label="Contractors" value={contractCount} color="amber" />
        <StatCard
          label="Attrition Rate"
          value={`${attrition.attritionRate?.toFixed(1) || 0}%`}
          color={parseFloat(attrition.attritionRate || 0) > 5 ? 'red' : 'green'}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Headcount Trend */}
      {activeTab === 'headcount' && (
        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Headcount Over Time (Last 12 Months)</h3>
            </div>
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

          {/* Month-over-month table */}
          {trend.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-slate-700">Month-over-Month Changes</h3>
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
                      <tr key={i}>
                        <td className="font-medium">{t.monthLabel}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attrition Tab */}
      {activeTab === 'attrition' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{attrition.newJoins || 0}</div>
              <div className="text-sm text-slate-500 mt-1">New Joins This Month</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-3xl font-bold text-red-500">{attrition.exits || 0}</div>
              <div className="text-sm text-slate-500 mt-1">Exits This Month</div>
            </div>
            <div className="card p-4 text-center">
              <div className={`text-3xl font-bold ${parseFloat(attrition.attritionRate || 0) > 5 ? 'text-red-500' : 'text-green-600'}`}>
                {attrition.attritionRate?.toFixed(2) || 0}%
              </div>
              <div className="text-sm text-slate-500 mt-1">Attrition Rate</div>
            </div>
          </div>

          {/* New Joins */}
          {(attrition.newJoinDetails || []).length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-green-700">New Joins</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="table-compact w-full">
                  <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Company</th></tr></thead>
                  <tbody>
                    {attrition.newJoinDetails.map((e, i) => (
                      <tr key={i}>
                        <td className="font-medium">{e.name}</td>
                        <td className="text-slate-500">{e.code}</td>
                        <td>{e.department}</td>
                        <td>{e.company}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Exits */}
          {(attrition.exitDetails || []).length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-red-700">Exits</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="table-compact w-full">
                  <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Company</th></tr></thead>
                  <tbody>
                    {attrition.exitDetails.map((e, i) => (
                      <tr key={i}>
                        <td className="font-medium">{e.name}</td>
                        <td className="text-slate-500">{e.code}</td>
                        <td>{e.department}</td>
                        <td>{e.company}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workforce Mix Tab */}
      {activeTab === 'workforce' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Permanent vs Contractor */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Permanent vs Contractor</h3>
            </div>
            <div className="p-4 flex items-center justify-center gap-8">
              <PieChart width={220} height={220}>
                <Pie data={pieData} cx={110} cy={110} innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={3}>
                  {pieData.map((_, i) => <Cell key={i} fill={['#3b82f6', '#f59e0b'][i]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
              <div className="space-y-2">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`w-3 h-3 rounded-full inline-block ${i === 0 ? 'bg-blue-500' : 'bg-amber-500'}`} />
                    <span className="text-slate-700">{d.name}</span>
                    <span className="font-bold ml-1">{d.value}</span>
                    <span className="text-slate-400">({((d.value / (permCount + contractCount)) * 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Department Distribution */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Headcount by Department</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={deptPie} margin={{ bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Employees" radius={[4, 4, 0, 0]}>
                    {deptPie.map((_, i) => <Cell key={i} fill={COLORS_PIE[i % COLORS_PIE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
