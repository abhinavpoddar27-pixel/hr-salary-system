import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getEmployeeBehavioralProfile } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import clsx from 'clsx'
import Skeleton from './Skeleton'

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const PATTERN_ICONS = {
  CHRONIC_LATE: '⏰',
  MONDAY_SYNDROME: '📅',
  EARLY_FRIDAY: '🏃',
  OT_WARRIOR: '💪',
  SHORT_HOURS: '⚠️',
  TREND_IMPROVING: '📈',
  TREND_DECLINING: '📉',
}

const SEVERITY_COLORS = {
  High: 'bg-red-100 text-red-700 border-red-200',
  Medium: 'bg-amber-100 text-amber-700 border-amber-200',
  Low: 'bg-blue-100 text-blue-700 border-blue-200',
}

/**
 * BehavioralProfile — Shows patterns, regularity score, narrative, and trend chart.
 * Designed to be used inside EmployeeQuickView's contextContent or standalone.
 */
export default function BehavioralProfile({ employeeCode, month: propMonth, year: propYear }) {
  const { selectedMonth, selectedYear } = useAppStore()
  const month = propMonth || selectedMonth
  const year = propYear || selectedYear

  const { data: res, isLoading } = useQuery({
    queryKey: ['behavioral-profile', employeeCode, month, year],
    queryFn: () => getEmployeeBehavioralProfile(employeeCode, month, year),
    enabled: !!employeeCode,
    staleTime: 120000,
  })

  const profile = res?.data?.data || null

  if (isLoading) return <Skeleton variant="card" />
  if (!profile) return <div className="text-xs text-slate-400 py-2">No behavioral data available</div>

  const { patterns, stats, narrative, history, departmentAvg, arrivalTimes } = profile

  // Trend chart data
  const trendData = (history || []).map(h => ({
    label: `${MONTH_NAMES[h.month]} ${String(h.year).slice(2)}`,
    attendance: h.total_days > 0 ? Math.round(h.present_days / h.total_days * 100) : 0,
    lateRate: h.present_days > 0 ? Math.round(h.late_count / h.present_days * 100) : 0,
    avgHours: h.avg_hours ? Math.round(h.avg_hours * 10) / 10 : 0,
  }))

  // Arrival time histogram (group into 30-min buckets)
  const arrivalBuckets = {}
  for (const a of (arrivalTimes || [])) {
    if (!a.time) continue
    const [h, m] = a.time.split(':').map(Number)
    const bucket = `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`
    arrivalBuckets[bucket] = (arrivalBuckets[bucket] || 0) + 1
  }
  const arrivalData = Object.entries(arrivalBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, count]) => ({ time, count }))

  return (
    <div className="space-y-4">
      {/* Narrative Assessment */}
      {narrative && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">HR Assessment</div>
          <p className="text-xs text-slate-700 leading-relaxed">{narrative}</p>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Regularity" value={`${stats.regularityScore || 0}/100`}
          color={stats.regularityScore >= 80 ? 'green' : stats.regularityScore >= 60 ? 'amber' : 'red'} />
        <MiniStat label="Late Rate" value={`${stats.lateRate || 0}%`}
          color={stats.lateRate <= 10 ? 'green' : stats.lateRate <= 30 ? 'amber' : 'red'} />
        <MiniStat label="Avg Hours" value={stats.avgHours ? `${stats.avgHours}h` : '—'}
          color={stats.avgHours >= 10 ? 'green' : stats.avgHours >= 8 ? 'blue' : 'amber'} />
        <MiniStat label="Trend" value={stats.trend === 'improving' ? 'Up' : stats.trend === 'declining' ? 'Down' : 'Stable'}
          color={stats.trend === 'improving' ? 'green' : stats.trend === 'declining' ? 'red' : 'slate'} />
      </div>

      {/* Department Comparison */}
      {departmentAvg && departmentAvg.attendanceRate !== null && (
        <div className="bg-white border border-slate-100 rounded-lg px-3 py-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">vs Department Average</div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <CompareBar
              label="Attendance"
              empVal={stats.totalWorkDays > 0 ? Math.round(stats.presentDays / stats.totalWorkDays * 1000) / 10 : 0}
              deptVal={departmentAvg.attendanceRate}
              suffix="%" />
            <CompareBar
              label="Late Rate"
              empVal={stats.lateRate || 0}
              deptVal={departmentAvg.lateRate}
              suffix="%"
              inverted />
            <CompareBar
              label="Avg Hours"
              empVal={stats.avgHours || 0}
              deptVal={departmentAvg.avgHours}
              suffix="h" />
          </div>
        </div>
      )}

      {/* Pattern Badges */}
      {patterns.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Detected Patterns</div>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p, i) => (
              <span key={i} className={clsx('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border', SEVERITY_COLORS[p.severity] || SEVERITY_COLORS.Low)}
                title={p.detail}>
                {PATTERN_ICONS[p.type] || '🔍'} {p.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 6-Month Trend Chart */}
      {trendData.length >= 2 && (
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Attendance Trend (6 months)</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="attendance" name="Attendance %" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="lateRate" name="Late %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Arrival Time Distribution */}
      {arrivalData.length >= 3 && (
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Arrival Time Distribution
            {stats.avgArrivalTime && <span className="ml-2 font-normal text-slate-500">(avg: {stats.avgArrivalTime})</span>}
          </div>
          <div className="flex items-end gap-0.5 h-12">
            {arrivalData.map((d, i) => {
              const maxCount = Math.max(...arrivalData.map(x => x.count))
              const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.time}: ${d.count} days`}>
                  <div className="w-full bg-blue-400 rounded-t" style={{ height: `${height}%`, minHeight: d.count > 0 ? 4 : 0 }} />
                  <span className="text-[8px] text-slate-400">{d.time}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color = 'blue' }) {
  const colors = {
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-50 text-slate-600',
  }
  return (
    <div className={clsx('rounded-lg px-2 py-1.5 text-center', colors[color] || colors.blue)}>
      <div className="text-xs font-bold">{value}</div>
      <div className="text-[9px] text-slate-400 uppercase">{label}</div>
    </div>
  )
}

function CompareBar({ label, empVal, deptVal, suffix = '', inverted = false }) {
  const better = inverted ? empVal <= deptVal : empVal >= deptVal
  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={clsx('text-xs font-bold', better ? 'text-green-600' : 'text-red-600')}>
          {empVal}{suffix}
        </span>
        <span className="text-[10px] text-slate-400">vs {deptVal}{suffix}</span>
      </div>
    </div>
  )
}
