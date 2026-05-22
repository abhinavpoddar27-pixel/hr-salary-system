// TEMPORARY DEV HARNESS — replaced by piece #5's lookup entry point.
// <TimelineCardList> is the durable artifact and stays.
//
// This page only exists to give piece #4 a testable surface before piece #5
// ships the real record-lookup entry point. When #5 lands, delete this file,
// drop the /admin/record-history-dev route from App.jsx, and remove the
// sidebar entry. Piece #5 will import <TimelineCardList> directly.

import React, { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import TimelineCardList from '../../components/recordHistory/TimelineCardList'

const QUICK_FIXTURES = [
  { label: 'sales_employees #198 (masked PAN/Aadhaar)',           table: 'sales_employees',             id: 198 },
  { label: 'attendance_processed #122270 (multi-card, masked)',   table: 'attendance_processed',        id: 122270 },
  { label: 'sales_ta_da_monthly_inputs #514 (singleton stack)',   table: 'sales_ta_da_monthly_inputs',  id: 514 },
  { label: 'employees #22195 (clean human card)',                 table: 'employees',                   id: 22195 },
]

export default function RecordHistoryHarness() {
  const user = useAppStore(s => s.user)
  const isAdmin = normalizeRole(user?.role) === 'admin'

  const [tableInput, setTableInput] = useState('')
  const [idInput, setIdInput] = useState('')
  // Submitted (loaded) values — only flip when the user clicks Load or picks a
  // fixture. This keeps the network silent while they're still typing.
  const [submittedTable, setSubmittedTable] = useState('')
  const [submittedId, setSubmittedId] = useState(null)

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm">
          Admin access required.
        </div>
      </div>
    )
  }

  const load = () => {
    const t = tableInput.trim()
    const n = Number.parseInt(idInput, 10)
    if (!t || !Number.isFinite(n) || n <= 0) {
      setSubmittedTable('')
      setSubmittedId(null)
      return
    }
    setSubmittedTable(t)
    setSubmittedId(n)
  }

  const pickFixture = (table, id) => {
    setTableInput(table)
    setIdInput(String(id))
    setSubmittedTable(table)
    setSubmittedId(id)
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      {/* Permanent banner — temporary surface notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        <span className="font-semibold">TEMPORARY DEV HARNESS</span> — replaced by
        piece #5's lookup entry point.{' '}
        <code className="font-mono">&lt;TimelineCardList&gt;</code> is the durable
        artifact and stays.
      </div>

      <h1 className="text-2xl font-bold text-slate-800">Record History (dev)</h1>

      {/* Input row */}
      <div className="bg-white rounded-lg shadow-glass-sm border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Table name</label>
          <input
            type="text"
            value={tableInput}
            onChange={e => setTableInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load() }}
            placeholder="e.g. attendance_processed"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="w-40">
          <label className="block text-xs font-medium text-slate-600 mb-1">Record ID</label>
          <input
            type="number"
            value={idInput}
            onChange={e => setIdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load() }}
            placeholder="e.g. 122270"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm"
        >
          Load
        </button>
      </div>

      {/* Quick fixtures */}
      <div className="text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide">Quick fixtures (§10):</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {QUICK_FIXTURES.map(f => (
            <button
              key={`${f.table}#${f.id}`}
              type="button"
              onClick={() => pickFixture(f.table, f.id)}
              className="text-[11px] px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-200"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      <TimelineCardList tableName={submittedTable} recordId={submittedId} />
    </div>
  )
}
