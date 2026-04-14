import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAlerts } from '../utils/api'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import { fmtDate } from '../utils/formatters'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', bg: 'bg-red-50', border: 'border-red-300', badge: 'bg-red-100 text-red-800', icon: '🔴', text: 'text-red-700' },
  high: { label: 'High', bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-800', icon: '🟠', text: 'text-orange-700' },
  medium: { label: 'Medium', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800', icon: '🟡', text: 'text-amber-700' },
  low: { label: 'Low', bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: '🔵', text: 'text-blue-700' },
  info: { label: 'Info', bg: 'bg-slate-50', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-600', icon: 'ℹ️', text: 'text-slate-600' }
}

const ALERT_TYPES = {
  MISS_PUNCH_UNRESOLVED: { title: 'Unresolved Miss Punch', icon: '⏰' },
  CHRONIC_ABSENTEE: { title: 'Chronic Absentee', icon: '👤' },
  HABITUAL_LATECOMER: { title: 'Habitual Latecomer', icon: '🕐' },
  COMPLIANCE_DUE: { title: 'Compliance Due', icon: '📋' },
  COMPLIANCE_OVERDUE: { title: 'Compliance Overdue', icon: '⚠️' },
  HIGH_ATTRITION: { title: 'High Attrition', icon: '📉' },
  LOW_ATTENDANCE: { title: 'Low Dept Attendance', icon: '📊' },
  SALARY_NOT_COMPUTED: { title: 'Salary Not Computed', icon: '💰' },
  NIGHT_UNPAIRED: { title: 'Night Shift Unpaired', icon: '🌙' }
}

function AlertCard({ alert, isExpanded, onToggle }) {
  const severity = SEVERITY_CONFIG[alert.severity?.toLowerCase()] || SEVERITY_CONFIG.info
  const alertType = ALERT_TYPES[alert.alert_type] || { title: alert.alert_type, icon: '⚡' }

  return (
    <div className={`rounded-lg border p-4 ${severity.bg} ${severity.border} ${alert.employee_code ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={() => alert.employee_code && onToggle && onToggle()}>

      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">{alertType.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 text-sm">{alertType.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severity.badge}`}>
              {severity.icon} {severity.label}
            </span>
            {alert.department && (
              <span className="text-xs text-slate-500 bg-white/60 px-1.5 py-0.5 rounded">
                {alert.department}
              </span>
            )}
          </div>
          <p className={`text-sm mt-1 ${severity.text}`}>{alert.message}</p>
          {alert.employee_name && (
            <div className="text-xs text-slate-500 mt-1">
              Employee: <span className="font-medium">{alert.employee_name}</span>
              {alert.employee_code && <span className="ml-1 text-slate-400">({alert.employee_code})</span>}
            </div>
          )}
        </div>
        <div className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
          {alert.created_at ? new Date(alert.created_at).toLocaleDateString('en-IN') : ''}
        </div>
      </div>
      {isExpanded && alert.employee_code && (
        <div className="mt-3 pt-3 border-t border-slate-200/60" onClick={e => e.stopPropagation()}>
          <EmployeeQuickView employeeCode={alert.employee_code} />
        </div>
      )}
    </div>
  )
}

export default function Alerts() {
  const { selectedMonth, selectedYear, selectedCompany } = useAppStore()
  const [severityFilter, setSeverityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedAlert, setExpandedAlert] = useState(null)

  const { data: alertsRes, isLoading, refetch } = useQuery({
    queryKey: ['alerts', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getAlerts(selectedMonth, selectedYear, undefined, { company: selectedCompany }),
    retry: 0
  })
  const alerts = alertsRes?.data?.data || []

  const filtered = alerts.filter(a => {
    if (severityFilter !== 'all' && a.severity?.toLowerCase() !== severityFilter) return false
    if (typeFilter !== 'all' && a.alert_type !== typeFilter) return false
    if (search && !a.message?.toLowerCase().includes(search.toLowerCase()) &&
        !a.employee_name?.toLowerCase().includes(search.toLowerCase()) &&
        !a.department?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Group by severity
  const criticalAlerts = filtered.filter(a => a.severity?.toLowerCase() === 'critical')
  const highAlerts = filtered.filter(a => a.severity?.toLowerCase() === 'high')
  const otherAlerts = filtered.filter(a => !['critical', 'high'].includes(a.severity?.toLowerCase()))

  // Counts
  const countBySeverity = alerts.reduce((acc, a) => {
    const s = a.severity?.toLowerCase() || 'info'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  const uniqueTypes = [...new Set(alerts.map(a => a.alert_type))].filter(Boolean)

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Alerts & Notifications</h2>
          <p className="text-sm text-slate-500">
            System-generated alerts for {['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][selectedMonth]} {selectedYear}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CompanyFilter />
          <button onClick={refetch} className="btn-secondary text-sm">↻ Refresh</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {[
          { key: 'critical', label: 'Critical', icon: '🔴', bg: 'bg-red-50 border-red-200' },
          { key: 'high', label: 'High', icon: '🟠', bg: 'bg-orange-50 border-orange-200' },
          { key: 'medium', label: 'Medium', icon: '🟡', bg: 'bg-amber-50 border-amber-200' },
          { key: 'low', label: 'Low', icon: '🔵', bg: 'bg-blue-50 border-blue-200' },
          { key: 'total', label: 'Total', icon: '⚡', bg: 'bg-slate-50 border-slate-200' }
        ].map(({ key, label, icon, bg }) => (
          <button
            key={key}
            onClick={() => setSeverityFilter(key === 'total' ? 'all' : key)}
            className={`card p-3 text-center border transition-all ${bg} ${severityFilter === key || (key === 'total' && severityFilter === 'all') ? 'ring-2 ring-brand-400' : ''}`}
          >
            <div className="text-lg">{icon}</div>
            <div className="text-xl font-bold mt-1">
              {key === 'total' ? alerts.length : countBySeverity[key] || 0}
            </div>
            <div className="text-xs text-slate-500">{label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="search"
          placeholder="Search alerts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input flex-1 max-w-xs"
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="select max-w-[220px]">
          <option value="all">All Types</option>
          {uniqueTypes.map(t => (
            <option key={t} value={t}>{ALERT_TYPES[t]?.title || t}</option>
          ))}
        </select>
        {(severityFilter !== 'all' || typeFilter !== 'all' || search) && (
          <button onClick={() => { setSeverityFilter('all'); setTypeFilter('all'); setSearch('') }} className="btn-secondary text-sm">
            Clear Filters
          </button>
        )}
        <div className="text-sm text-slate-400 self-center">{filtered.length} alerts</div>
      </div>

      {/* Alert List */}
      {isLoading ? (
        <div className="card p-8 text-center text-slate-400">Loading alerts...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <div className="text-5xl mb-3">🎉</div>
          <p className="font-medium">No alerts{severityFilter !== 'all' || search ? ' matching your filters' : ' for this month'}</p>
          {alerts.length === 0 && <p className="text-sm mt-1">Run the analytics pipeline to generate alerts</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Critical first */}
          {criticalAlerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-red-700 uppercase tracking-wide">
                🔴 Critical ({criticalAlerts.length})
              </h3>
              {criticalAlerts.map((a, i) => <AlertCard key={`critical-${i}`} alert={a} isExpanded={expandedAlert === `critical-${i}`} onToggle={() => setExpandedAlert(expandedAlert === `critical-${i}` ? null : `critical-${i}`)} />)}
            </div>
          )}

          {/* High */}
          {highAlerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-orange-700 uppercase tracking-wide">
                🟠 High ({highAlerts.length})
              </h3>
              {highAlerts.map((a, i) => <AlertCard key={`high-${i}`} alert={a} isExpanded={expandedAlert === `high-${i}`} onToggle={() => setExpandedAlert(expandedAlert === `high-${i}` ? null : `high-${i}`)} />)}
            </div>
          )}

          {/* Others */}
          {otherAlerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide">
                Other ({otherAlerts.length})
              </h3>
              {otherAlerts.map((a, i) => <AlertCard key={`other-${i}`} alert={a} isExpanded={expandedAlert === `other-${i}`} onToggle={() => setExpandedAlert(expandedAlert === `other-${i}` ? null : `other-${i}`)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
