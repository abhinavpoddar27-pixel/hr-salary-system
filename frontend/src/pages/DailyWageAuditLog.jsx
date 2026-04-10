import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDWAuditLogPaginated } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'

export default function DailyWageAuditLog() {
  const { user } = useAppStore()
  const canFinance = canFinanceFn(user)

  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const { data: res, isLoading } = useQuery({
    queryKey: ['dw-audit-log', page, entityType, dateFrom, dateTo, performedBy],
    queryFn: () => getDWAuditLogPaginated({
      page, limit: 50,
      entity_type: entityType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      performed_by: performedBy || undefined
    }),
    retry: 0
  })
  const entries = res?.data?.data || []
  const pagination = res?.data?.pagination || {}

  if (!canFinance) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-slate-700">Finance Access Required</h2>
        <p className="text-sm text-slate-500 mt-2">Only finance and admin users can access this page.</p>
      </div>
    )
  }

  const formatJson = (str) => {
    if (!str) return '—'
    try { return JSON.stringify(JSON.parse(str), null, 2) }
    catch { return String(str) }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Complete history of all daily wage module actions</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">All Entities</option>
          <option value="entry">Entry</option>
          <option value="contractor">Contractor</option>
          <option value="rate_change">Rate Change</option>
          <option value="payment">Payment</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          placeholder="From" className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          placeholder="To" className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="text" value={performedBy} onChange={e => { setPerformedBy(e.target.value); setPage(1) }}
          placeholder="Performed by..." className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        {(entityType || dateFrom || dateTo || performedBy) && (
          <button onClick={() => { setEntityType(''); setDateFrom(''); setDateTo(''); setPerformedBy(''); setPage(1) }}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Clear</button>
        )}
      </div>

      {/* Table */}
      {isLoading ? <div className="text-center py-8 text-slate-400">Loading...</div>
      : entries.length === 0 ? <div className="text-center py-12 text-slate-400">No audit log entries found</div>
      : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map(e => (
                <React.Fragment key={e.id}>
                  <tr className={clsx('hover:bg-slate-50 cursor-pointer', expandedId === e.id && 'bg-blue-50/50')}
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                    <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{e.performed_at?.replace('T', ' ')?.slice(0, 19)}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{e.performed_by}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
                        {e.entity_type} #{e.entity_id}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{e.action}</td>
                    <td className="px-4 py-2.5 text-slate-400">{expandedId === e.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandedId === e.id && (
                    <tr><td colSpan={5} className="px-4 py-3 bg-slate-50/70">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Old Values</h4>
                          <pre className="text-xs font-mono bg-white rounded border border-slate-200 p-2 overflow-x-auto max-h-40 text-slate-600">
                            {formatJson(e.old_values)}
                          </pre>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">New Values</h4>
                          <pre className="text-xs font-mono bg-white rounded border border-slate-200 p-2 overflow-x-auto max-h-40 text-slate-600">
                            {formatJson(e.new_values)}
                          </pre>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
