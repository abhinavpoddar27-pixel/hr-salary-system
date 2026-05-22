// Record History — admin diagnostic lookup (piece #5 of 5).
//
// Two entry paths to a single timeline mount (last-action-wins):
//
//   Section A — Look up by employee code → resolver returns candidate
//     {table_name, record_id} pairs. Clicking a candidate auto-fills Section B's
//     inputs and loads the timeline.
//
//   Section B — Direct table + record_id entry. This is the ONLY way to reach
//     an attendance_processed row, because the resolver never returns attendance
//     candidates (audit_log rows for attendance_processed have NULL employee_code
//     by design — §2.1).
//
// Result region: single <TimelineCardList /> mount with a contextual header that
// reads "Attendance row #N" for attendance_processed and "Record #N in <table>"
// for everything else (sentence-case "row" — the §2.1 protection is structural,
// not typographic, so the label doesn't need to shout).
//
// Empty-resolver (candidate_count:0) is informational, NEVER a 404 — the
// endpoint returns 200 with cards:[].
//
// Admin-only (role === 'admin'), same gate as the timeline + resolver endpoints.

import React, { useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import api from '../../utils/api'
import TimelineCardList from '../../components/recordHistory/TimelineCardList'

function ContextHeader({ table, id }) {
  if (!table || !id) return null
  // §2.1(c) — attendance results are labelled "row" explicitly. Sentence-case.
  const headline = table === 'attendance_processed'
    ? <>Attendance row <span className="font-mono">#{id}</span></>
    : <>Record <span className="font-mono">#{id}</span> in <span className="font-mono">{table}</span></>
  return (
    <div className="text-sm text-slate-700 font-medium mb-2">
      {headline}
    </div>
  )
}

export default function RecordHistoryLookup() {
  const user = useAppStore(s => s.user)
  const isAdmin = normalizeRole(user?.role) === 'admin'

  // ── Section A: resolver lookup ─────
  const [empCodeInput, setEmpCodeInput] = useState('')
  const [resolverLoading, setResolverLoading] = useState(false)
  const [resolverError, setResolverError] = useState(null)
  const [resolverData, setResolverData] = useState(null)

  // ── Section B: direct entry ─────
  const [tableInput, setTableInput] = useState('')
  const [idInput, setIdInput] = useState('')
  const [directError, setDirectError] = useState(null)

  // ── Active selection (single source of truth for the timeline mount) ─────
  const [activeTable, setActiveTable] = useState('')
  const [activeId, setActiveId] = useState(null)

  const submitLookup = useCallback(async () => {
    const code = empCodeInput.trim()
    if (!code) {
      setResolverData(null)
      setResolverError(null)
      return
    }
    setResolverLoading(true)
    setResolverError(null)
    try {
      const res = await api.get('/admin/record-history/resolve', { params: { employee_code: code } })
      setResolverData(res.data)
    } catch (err) {
      const body = err.response?.data
      setResolverError({
        status: err.response?.status || 0,
        message: body?.error || err.message || 'Failed to look up employee code',
      })
      setResolverData(null)
    } finally {
      setResolverLoading(false)
    }
  }, [empCodeInput])

  // Resolver-returned candidates are valid by construction — no guard needed here.
  const pickCandidate = useCallback((c) => {
    setTableInput(c.table_name)
    setIdInput(String(c.record_id))
    setDirectError(null)
    setActiveTable(c.table_name)
    setActiveId(c.record_id)
  }, [])

  // §Adjustment 2 — validate BEFORE setting active state. Reject NaN, empty,
  // decimals, zero, negative. Mirrors the backend's record_id>0 guard so the
  // two layers stay consistent, and avoids a guaranteed-400 round-trip.
  const loadDirect = useCallback(() => {
    const t = tableInput.trim()
    const raw = idInput.trim()
    if (!t) {
      setDirectError('Enter a table name (e.g. attendance_processed).')
      return
    }
    if (!raw) {
      setDirectError('Enter a record ID.')
      return
    }
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n <= 0 || String(n) !== raw) {
      setDirectError('Record ID must be a positive integer (no decimals, no negatives).')
      return
    }
    setDirectError(null)
    setActiveTable(t)
    setActiveId(n)
  }, [tableInput, idInput])

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm">
          Admin access required.
        </div>
      </div>
    )
  }

  const candidates = resolverData?.candidates || []
  const candidateCount = resolverData?.candidate_count ?? null
  const resolvedFor = resolverData?.employee_code || empCodeInput.trim()

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Record History</h1>
        <p className="text-sm text-slate-500 mt-1">
          Admin-only diagnostic — view audit_log activity for any record. Look up
          by employee code, or enter a table + record ID directly.
        </p>
      </div>

      {/* ── Section A: employee code lookup ───── */}
      <section className="bg-white rounded-lg shadow-glass-sm border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Look up by employee code</h2>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Employee code</label>
            <input
              type="text"
              value={empCodeInput}
              onChange={e => setEmpCodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitLookup() }}
              placeholder="e.g. S178"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={submitLookup}
            disabled={resolverLoading || !empCodeInput.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded shadow-sm"
          >
            {resolverLoading ? 'Looking up…' : 'Look up'}
          </button>
        </div>

        <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <span aria-hidden="true">ℹ</span>
          <span>
            Attendance records are stored per-day, not per-employee, and won't
            appear in this list. Use the direct lookup below to view a specific
            attendance row.
          </span>
        </div>

        {resolverError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            HTTP {resolverError.status}: {resolverError.message}
          </div>
        )}

        {!resolverError && candidateCount !== null && (
          candidateCount === 0 ? (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-3">
              No records linked to <span className="font-mono">{resolvedFor}</span>.
              Try a direct lookup below.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">
                {candidateCount} record{candidateCount === 1 ? '' : 's'} linked to{' '}
                <span className="font-mono text-slate-700">{resolvedFor}</span>:
              </div>
              <ul className="space-y-1">
                {candidates.map(c => (
                  <li key={`${c.table_name}#${c.record_id}`}>
                    <button
                      type="button"
                      onClick={() => pickCandidate(c)}
                      className="w-full flex items-center gap-3 px-3 py-2 bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded text-sm text-left transition-colors"
                    >
                      <span className="font-mono text-slate-700 flex-1">{c.table_name}</span>
                      <span className="font-mono text-slate-500">#{c.record_id}</span>
                      <span className="text-xs text-blue-600">View →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </section>

      {/* ── Section B: direct entry ───── */}
      <section className="bg-white rounded-lg shadow-glass-sm border border-slate-200 p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Direct lookup by table + record ID</h2>
          <p className="text-xs text-slate-500 mt-1">
            Use this to view an attendance row, or any audit_log record you already know the ID of.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Table name</label>
            <input
              type="text"
              value={tableInput}
              onChange={e => { setTableInput(e.target.value); setDirectError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') loadDirect() }}
              placeholder="e.g. attendance_processed"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs font-medium text-slate-600 mb-1">Record ID</label>
            <input
              type="text"
              inputMode="numeric"
              value={idInput}
              onChange={e => { setIdInput(e.target.value); setDirectError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') loadDirect() }}
              placeholder="e.g. 122270"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={loadDirect}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm"
          >
            Load
          </button>
        </div>
        {directError && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            {directError}
          </div>
        )}
      </section>

      {/* ── Timeline mount (single, last-action-wins) ───── */}
      {activeTable && activeId && (
        <section className="pt-2">
          <ContextHeader table={activeTable} id={activeId} />
          <TimelineCardList tableName={activeTable} recordId={activeId} />
        </section>
      )}
    </div>
  )
}
