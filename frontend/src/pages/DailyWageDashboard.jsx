import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getDWDashboard, getDWPendingLiability, getDWAuditLogPaginated } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn } from '../utils/role'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import clsx from 'clsx'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function DailyWageDashboard() {
  const navigate = useNavigate()
  const { user } = useAppStore()
  const canFinance = canFinanceFn(user)

  const { data: dashRes } = useQuery({
    queryKey: ['dw-dashboard'],
    queryFn: getDWDashboard,
    retry: 0
  })
  const dash = dashRes?.data?.data || {}

  const { data: liabRes } = useQuery({
    queryKey: ['dw-pending-liability-chart'],
    queryFn: getDWPendingLiability,
    retry: 0
  })
  const liabilities = liabRes?.data?.data || []

  const { data: auditRes } = useQuery({
    queryKey: ['dw-audit-recent'],
    queryFn: () => getDWAuditLogPaginated({ limit: 10 }),
    retry: 0
  })
  const recentActivity = auditRes?.data?.data || dash.recent_activity || []

  if (!canFinance) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-slate-700">Finance Access Required</h2>
        <p className="text-sm text-slate-500 mt-2">Only finance and admin users can access this page.</p>
      </div>
    )
  }

  const kpis = [
    { label: 'Pending Liability', value: `₹${fmt(dash.pending_liability_total)}`, color: 'blue', icon: '💰' },
    { label: 'Entries Awaiting Review', value: dash.entries_pending_review || 0, color: 'amber', icon: '📋' },
    { label: 'Rate Changes Pending', value: dash.rate_changes_pending || 0, color: 'purple', icon: '📊' },
    { label: 'Flagged Entries', value: dash.flagged_entries || 0, color: 'red', icon: '🚩' }
  ]

  const chartData = liabilities.map(l => ({
    name: l.contractor_name?.length > 15 ? l.contractor_name.slice(0, 15) + '…' : l.contractor_name,
    liability: Math.round((l.total_liability || 0) * 100) / 100
  }))

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Daily Wage Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of daily wage operations</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <div key={kpi.label} className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{kpi.icon}</span>
              <span className="text-[10px] text-slate-400 uppercase font-medium">{kpi.label}</span>
            </div>
            <div className={clsx('text-xl font-bold', `text-${kpi.color}-700`)}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pending Liability Chart */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Pending Liabilities by Contractor</h3>
          {chartData.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No pending liabilities</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(v) => [`₹${fmt(v)}`, 'Liability']} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="liability" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No recent activity</div>
          ) : (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {recentActivity.map((a, i) => (
                <div key={a.id || i} className="flex items-start gap-2 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-slate-700">{a.performed_by}</span>
                    <span className="text-slate-500 ml-1">{a.action} {a.entity_type} #{a.entity_id}</span>
                    <div className="text-xs text-slate-400">{a.performed_at?.slice(0, 16)?.replace('T', ' ')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate('/daily-wage/finance/review')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
            Review Pending ({dash.entries_pending_review || 0})
          </button>
          <button onClick={() => navigate('/daily-wage/finance/payments')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
            Process Payments
          </button>
          <button onClick={() => navigate('/daily-wage/contractors')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100">
            Contractor Master
          </button>
          <button onClick={() => navigate('/daily-wage')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100">
            All Records
          </button>
        </div>
      </div>
    </div>
  )
}
