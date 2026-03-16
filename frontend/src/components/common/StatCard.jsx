import React from 'react'
import clsx from 'clsx'
import { fmtNum } from '../../utils/formatters'

export default function StatCard({ label, value, sub, trend, trendPositive, icon, color = 'blue', loading }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-50 text-slate-600',
  }

  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-200 rounded animate-pulse mt-1" />
          ) : (
            <p className="text-2xl font-bold text-slate-800 mt-0.5">{value ?? '—'}</p>
          )}
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        {icon && (
          <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0', colors[color])}>
            {icon}
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div className={clsx('flex items-center gap-1 text-xs', trendPositive ? 'text-green-600' : 'text-red-500')}>
          <span>{trendPositive ? '▲' : '▼'}</span>
          <span>{trend}</span>
        </div>
      )}
    </div>
  )
}
