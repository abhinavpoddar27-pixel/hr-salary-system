import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import { getBugReports } from '../../api/bugReports'

const STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate']
const STATUS_COLORS = {
  new:         'bg-blue-100 text-blue-700',
  triaged:     'bg-amber-100 text-amber-700',
  in_progress: 'bg-purple-100 text-purple-700',
  resolved:    'bg-emerald-100 text-emerald-700',
  wont_fix:    'bg-slate-200 text-slate-700',
  duplicate:   'bg-slate-200 text-slate-700',
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s.replace(' ', 'T') + 'Z').toLocaleString() } catch { return s }
}

function safeParseJson(s) {
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

export default function BugReportsInbox() {
  const user = useAppStore((s) => s.user)
  const role = normalizeRole(user?.role)
  const nav  = useNavigate()

  const [status, setStatus] = useState('new')
  const [rows, setRows]     = useState([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const limit = 25

  useEffect(() => {
    if (role !== 'admin') return
    let cancelled = false
    setLoading(true)
    getBugReports({ status, limit, offset })
      .then((res) => {
        if (cancelled) return
        setRows(res.data?.data || [])
        setTotal(res.data?.total || 0)
      })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [status, offset, role])

  const counts = useMemo(() => ({ current: total }), [total])

  if (role !== 'admin') {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          This page is only available to admins.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Bug Reports</h1>
          <p className="text-sm text-slate-500">Reports from all HR users. Click a row to view details.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setOffset(0) }}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              status === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 tracking-wider">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Reporter</th>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400 italic">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400 italic">No reports with status "{status}"</td></tr>
              ) : rows.map((r) => {
                const ex = safeParseJson(r.claude_extraction_json) || {}
                const summary = ex.structured_summary || r.user_typed_comment || r.transcript_english || ''
                const pageLabel = ex.page_identified || r.page_name || '—'
                return (
                  <tr
                    key={r.id}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => nav(`/admin/bug-reports/${r.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{r.reporter_username}</div>
                      <div className="text-xs text-slate-400">{r.reporter_role}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate">{pageLabel}</td>
                    <td className="px-3 py-2 text-sm text-slate-700 max-w-md truncate">{summary || <span className="italic text-slate-400">pending…</span>}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {r.input_method}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[r.admin_status] || 'bg-slate-100 text-slate-700'}`}>
                        {r.admin_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {counts.current > limit && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500 bg-slate-50">
            <span>Showing {offset + 1}–{Math.min(offset + limit, counts.current)} of {counts.current}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-2 py-1 rounded border border-slate-300 bg-white disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= counts.current}
                className="px-2 py-1 rounded border border-slate-300 bg-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
