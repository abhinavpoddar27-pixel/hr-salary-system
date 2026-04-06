import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getFinanceReport, submitDayCorrection, getCorrectionHistory, getCorrectionsSummary, getManualAttendanceFlags, verifyManualFlag,
  getSalaryManualFlags, approveManualFlag, bulkApproveFlags, getReadinessCheck, getVarianceReport, getStatutoryCrosscheck } from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import { fmtINR, fmtINR2, monthYearLabel } from '../utils/formatters'
import Modal from '../components/ui/Modal'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import CompanyFilter from '../components/shared/CompanyFilter'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const CORRECTION_REASONS = [
  'Gate register mismatch', 'Production record mismatch',
  'Leave not recorded in biometric', 'Biometric system error',
  'Night shift pairing error', 'Overtime day not counted', 'Other'
]

function useSortable(defaultKey = '', defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState(defaultDir)
  const toggle = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const indicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const sortFn = (a, b) => {
    if (!sortKey) return 0
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? ''
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    return va < vb ? (sortDir === 'asc' ? -1 : 1) : va > vb ? (sortDir === 'asc' ? 1 : -1) : 0
  }
  return { toggle, indicator, sortFn }
}

function SortTh({ sort, k, children, className = '' }) {
  return <th onClick={() => sort.toggle(k)} className={clsx('cursor-pointer select-none hover:text-blue-600', className)}>{children}{sort.indicator(k)}</th>
}

// ═══════════════════════════════════════════════════════════
// FINANCE REPORT TAB
// ═══════════════════════════════════════════════════════════
function ReportTab({ highlightEmployee, onClearHighlight }) {
  const { selectedCompany } = useAppStore()
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const highlightRef = useRef(null)
  const queryClient = useQueryClient()
  const sort = useSortable('department', 'asc')
  const expand = useExpandableRows()
  const [correctionModal, setCorrectionModal] = useState(null) // { code, name, systemDays }
  const [corrForm, setCorrForm] = useState({ correctedDays: '', reason: '', notes: '' })
  const [filter, setFilter] = useState('all') // all | flagged | new | held

  const { data: res, isLoading } = useQuery({
    queryKey: ['finance-report', month, year, selectedCompany],
    queryFn: () => getFinanceReport(month, year, selectedCompany),
    retry: 0
  })

  const report = res?.data?.data || []
  const summary = res?.data?.summary || {}

  const filtered = useMemo(() => {
    let rows = [...report]
    if (filter === 'flagged') rows = rows.filter(r => r.hasCorrection || r.grossChanged || r.salaryHeld)
    else if (filter === 'new') rows = rows.filter(r => r.salaryStatus === 'NEW')
    else if (filter === 'held') rows = rows.filter(r => r.salaryHeld)
    return rows.sort(sort.sortFn)
  }, [report, filter, sort.sortFn])

  const corrMutation = useMutation({
    mutationFn: (data) => submitDayCorrection(data),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Correction saved')
      setCorrectionModal(null)
      setCorrForm({ correctedDays: '', reason: '', notes: '' })
      queryClient.invalidateQueries({ queryKey: ['finance-report'] })
    },
    onError: () => toast.error('Failed to save correction')
  })

  function handleSubmitCorrection() {
    if (!corrForm.correctedDays || !corrForm.reason) {
      toast.error('Please fill corrected days and reason')
      return
    }
    corrMutation.mutate({
      employeeCode: correctionModal.code,
      month: month,
      year: year,
      correctedDays: parseFloat(corrForm.correctedDays),
      reason: corrForm.reason,
      notes: corrForm.notes
    })
  }

  // Auto-scroll to highlighted employee
  useEffect(() => {
    if (highlightEmployee && report?.length > 0) {
      expand.setExpanded?.(new Set([highlightEmployee]));
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
  }, [highlightEmployee, report]);

  return (
    <div className="space-y-4">
      {/* Deep link banner */}
      {highlightEmployee && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800 flex items-center justify-between">
          <span>Navigated from Finance Verify — showing employee <strong>{highlightEmployee}</strong></span>
          <button onClick={onClearHighlight} className="text-amber-600 hover:text-amber-800 text-xs font-medium">× Dismiss</button>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KPI label="Employees" value={summary.totalEmployees || 0} color="blue" />
        <KPI label="With Corrections" value={summary.withCorrections || 0} color="amber" />
        <KPI label="New Employees" value={summary.newEmployees || 0} color="cyan" />
        <KPI label="Gross Changed" value={summary.grossChanged || 0} color="purple" />
        <KPI label="Salary Held" value={summary.salaryHeld || 0} color="red" />
        <KPI label="Total Net" value={fmtINR(summary.totalNetSalary || 0)} color="green" />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">Show:</span>
        {['all', 'flagged', 'new', 'held'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('px-3 py-1 text-xs rounded-full font-medium transition-colors',
              filter === f ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
            {f === 'all' ? `All (${report.length})` : f === 'flagged' ? `Flagged (${report.filter(r => r.hasCorrection || r.grossChanged || r.salaryHeld).length})`
              : f === 'new' ? `New (${report.filter(r => r.salaryStatus === 'NEW').length})`
              : `Held (${report.filter(r => r.salaryHeld).length})`}
          </button>
        ))}
      </div>

      {/* Main report table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th className="w-6"></th>
                <SortTh sort={sort} k="name">Employee</SortTh>
                <SortTh sort={sort} k="department">Dept</SortTh>
                <SortTh sort={sort} k="systemDays" className="text-center">Sys Days</SortTh>
                <SortTh sort={sort} k="correctionDelta" className="text-center">Corr.</SortTh>
                <SortTh sort={sort} k="finalDays" className="text-center">Final Days</SortTh>
                <SortTh sort={sort} k="grossSalary" className="text-right">Gross</SortTh>
                <SortTh sort={sort} k="netSalary" className="text-right">Net</SortTh>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">Loading finance report...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">No salary data for this month. Run salary computation first.</td></tr>
              ) : filtered.map((r, i) => (
                <React.Fragment key={r.code || i}>
                  <tr
                    ref={r.code === highlightEmployee ? highlightRef : null}
                    onClick={() => expand.toggle(r.code)}
                    className={clsx('cursor-pointer transition-colors',
                      r.code === highlightEmployee && 'ring-2 ring-amber-400 ring-inset bg-amber-50',
                      r.hasCorrection && 'border-l-3 border-l-amber-400',
                      r.salaryHeld && 'bg-red-50/50',
                      expand.isExpanded(r.code) && 'bg-blue-50'
                    )}>
                    <td><DrillDownChevron isExpanded={expand.isExpanded(r.code)} /></td>
                    <td>
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <div className="text-[10px] text-slate-400 font-mono">{r.code}</div>
                    </td>
                    <td className="text-xs">{r.department}</td>
                    <td className="text-center">{r.systemDays ?? '—'}</td>
                    <td className="text-center">
                      {r.correctionDelta !== 0 ? (
                        <span className={clsx('px-1.5 py-0.5 rounded text-xs font-bold',
                          'bg-amber-100 text-amber-700')}>
                          {r.correctionDelta > 0 ? '+' : ''}{r.correctionDelta}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="text-center font-bold">{r.finalDays ?? '—'}</td>
                    <td className="text-right">{fmtINR(r.grossEarned)}</td>
                    <td className="text-right font-semibold text-green-700">{fmtINR(r.netSalary)}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {r.salaryStatus === 'UNCHANGED' && <span className="text-green-600 text-sm" title="Gross unchanged">&#10003;</span>}
                        {r.salaryStatus === 'NEW' && <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">NEW</span>}
                        {r.salaryStatus === 'CHANGED' && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">CHANGED</span>}
                        {r.salaryHeld && (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">HELD</span>
                            {r.holdReason && <span className="text-[9px] text-red-500 max-w-[120px] truncate" title={r.holdReason}>{r.holdReason}</span>}
                          </div>
                        )}
                        {r.hasCorrection && <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">EDITED</span>}
                      </div>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setCorrectionModal({ code: r.code, name: r.name, systemDays: r.systemDays })
                          setCorrForm({
                            correctedDays: r.hasDayCorrection ? String(r.correctedPayableDays || r.finalDays) : '',
                            reason: r.correctionReason || '',
                            notes: r.correctionNotes || ''
                          })
                        }}
                        className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                      >
                        Correct
                      </button>
                    </td>
                  </tr>
                  {expand.isExpanded(r.code) && (
                    <DrillDownRow colSpan={10}>
                      <CorrectionDetail code={r.code} row={r} />
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Day Correction Modal */}
      {correctionModal && (
        <Modal open onClose={() => setCorrectionModal(null)} title={`Day Correction: ${correctionModal.name}`} size="md">
          <div className="p-4 space-y-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500">System-computed payable days</div>
              <div className="text-2xl font-bold text-slate-800">{correctionModal.systemDays ?? '—'}</div>
              <div className="text-xs text-slate-400">{monthYearLabel(month, year)}</div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Corrected Days</label>
              <input type="number" step="0.5" min="0" max="31"
                value={corrForm.correctedDays}
                onChange={e => setCorrForm(f => ({ ...f, correctedDays: e.target.value }))}
                className="input w-full" placeholder="e.g. 22" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Reason</label>
              <select value={corrForm.reason} onChange={e => setCorrForm(f => ({ ...f, reason: e.target.value }))}
                className="select w-full">
                <option value="">Select reason...</option>
                {CORRECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {corrForm.reason === 'Other' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Notes (required for Other)</label>
                <textarea value={corrForm.notes} onChange={e => setCorrForm(f => ({ ...f, notes: e.target.value }))}
                  className="input w-full h-20 resize-none" placeholder="Explain the correction..." />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setCorrectionModal(null)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleSubmitCorrection} disabled={corrMutation.isPending}
                className="btn-primary px-4 py-2 text-sm">
                {corrMutation.isPending ? 'Saving...' : 'Save Correction'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Correction Detail (inline drill-down) ──────────────
function CorrectionDetail({ code, row }) {
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { data: res } = useQuery({
    queryKey: ['correction-history', code, month, year],
    queryFn: () => getCorrectionHistory(code, month, year),
    staleTime: 60000
  })
  const data = res?.data?.data || {}

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="lg:w-1/2">
        <EmployeeQuickView employeeCode={code} compact />
      </div>
      <div className="lg:w-1/2 space-y-3">
        {/* Hold reason */}
        {row.salaryHeld && row.holdReason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 col-span-full">
            <div className="text-[10px] font-bold text-red-600 uppercase mb-1 flex items-center gap-1">
              <span>⚠</span> Salary Held — Reason
            </div>
            <div className="text-xs text-red-800 font-medium">{row.holdReason}</div>
          </div>
        )}

        {/* Salary breakdown */}
        <div className="bg-white border border-slate-100 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Salary Breakdown</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-400">Gross Earned:</span> <span className="font-semibold">{fmtINR(row.grossEarned)}</span></div>
            <div><span className="text-slate-400">Net Salary:</span> <span className="font-semibold text-green-700">{fmtINR(row.netSalary)}</span></div>
            <div><span className="text-slate-400">PF:</span> <span className="font-semibold text-red-600">-{fmtINR(row.pfEmployee)}</span></div>
            <div><span className="text-slate-400">ESI:</span> <span className="font-semibold text-red-600">-{fmtINR(row.esiEmployee)}</span></div>
            {row.prevNet && <div><span className="text-slate-400">Prev Net:</span> <span className="font-semibold">{fmtINR(row.prevNet)}</span></div>}
          </div>
        </div>

        {/* Correction history */}
        {(data.dayCorrections?.length > 0 || data.punchCorrections?.length > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="text-[10px] font-bold text-amber-600 uppercase mb-2">Correction History</div>
            {data.dayCorrections?.map((dc, i) => (
              <div key={i} className="text-xs mb-1">
                <span className="text-slate-500">Days:</span> {dc.original_system_days} → <span className="font-bold">{dc.corrected_days}</span>
                <span className="text-slate-400 ml-2">({dc.correction_reason})</span>
                <span className="text-slate-300 ml-2">by {dc.corrected_by}</span>
              </div>
            ))}
            {data.punchCorrections?.map((pc, i) => (
              <div key={i} className="text-xs mb-1">
                <span className="text-slate-500">{pc.date}:</span> {pc.punch_type}
                <span className="text-slate-400 ml-2">({pc.reason})</span>
                <span className="text-slate-300 ml-2">by {pc.added_by}</span>
              </div>
            ))}
          </div>
        )}

        {/* Audit trail */}
        {data.auditTrail?.length > 0 && (
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Audit Trail</div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {data.auditTrail.slice(0, 10).map((a, i) => (
                <div key={i} className="text-[10px] text-slate-500">
                  <span className="text-slate-400">{a.changed_at?.slice(0, 16)}</span>
                  <span className="ml-1 font-medium">{a.action_type || a.field_name}</span>
                  <span className="ml-1">{a.remark}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// CORRECTIONS SUMMARY TAB (admin only)
// ═══════════════════════════════════════════════════════════
function CorrectionsSummaryTab() {
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { data: res, isLoading } = useQuery({
    queryKey: ['corrections-summary', month, year],
    queryFn: () => getCorrectionsSummary(month, year),
    retry: 0
  })
  const summary = res?.data?.data || []

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <p className="text-xs text-slate-600">
          This view shows which users have made manual corrections and detects potential bias patterns.
          Users whose corrections are predominantly upward for the same employees are flagged.
        </p>
      </div>

      {isLoading && <div className="text-center py-8 text-slate-400">Loading corrections summary...</div>}

      {summary.length === 0 && !isLoading && (
        <div className="text-center py-8 text-slate-400">No corrections have been made yet.</div>
      )}

      {summary.map((u, i) => (
        <div key={i} className={clsx('card p-4', u.biasFlag && 'border-2 border-red-300 bg-red-50/30')}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-slate-800">{u.username}</div>
              <div className="text-xs text-slate-500">{u.totalCorrections} total corrections ({u.dayCorrections} day, {u.punchCorrections} punch)</div>
            </div>
            {u.biasFlag && (
              <span className="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full font-bold">BIAS FLAG</span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3 mb-3">
            <MiniStat label="Upward" value={u.upwardCorrections} sub={`${u.upwardPct}%`} color={u.upwardPct > 70 ? 'red' : 'slate'} />
            <MiniStat label="Downward" value={u.downwardCorrections} color="slate" />
            <MiniStat label="Unique Employees" value={u.uniqueEmployees} color="blue" />
            <MiniStat label="Payroll Impact" value={fmtINR(u.estimatedPayrollImpact)} color={u.estimatedPayrollImpact > 0 ? 'amber' : 'green'} />
          </div>

          {u.topEmployees?.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Most Corrected Employees</div>
              <div className="flex flex-wrap gap-1">
                {u.topEmployees.map((e, j) => (
                  <span key={j} className={clsx('text-xs px-2 py-0.5 rounded-full',
                    e.count >= 3 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600')}>
                    {e.name} ({e.count}x)
                  </span>
                ))}
              </div>
            </div>
          )}

          {u.biasFlag && (
            <div className="mt-3 bg-red-100 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {u.biasReason}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MANUAL ATTENDANCE FLAGS TAB
// ═══════════════════════════════════════════════════════════
function ManualFlagsTab() {
  const { selectedCompany } = useAppStore()
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const queryClient = useQueryClient()
  const [verifyingId, setVerifyingId] = useState(null)
  const [financeRemarks, setFinanceRemarks] = useState('')

  const { data: res, isLoading } = useQuery({
    queryKey: ['manual-flags', month, year, selectedCompany],
    queryFn: () => getManualAttendanceFlags({ month, year, company: selectedCompany }),
    retry: 0
  })
  const flags = res?.data?.data || res?.data || []

  const verifyMutation = useMutation({
    mutationFn: ({ id, finance_remarks }) => verifyManualFlag(id, { finance_remarks }),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Flag verified')
      setVerifyingId(null)
      setFinanceRemarks('')
      queryClient.invalidateQueries({ queryKey: ['manual-flags'] })
    },
    onError: () => toast.error('Failed to verify flag')
  })

  const unverifiedCount = flags.filter(f => !f.verified && !f.verified_by).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <KPI label="Total Flags" value={flags.length} color="blue" />
        <KPI label="Unverified" value={unverifiedCount} color="amber" />
        <KPI label="Verified" value={flags.length - unverifiedCount} color="green" />
      </div>

      {isLoading && <div className="text-center py-8 text-slate-400">Loading manual flags...</div>}

      {!isLoading && flags.length === 0 && (
        <div className="text-center py-8 text-slate-400">No manual attendance flags for this period.</div>
      )}

      {flags.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Date</th>
                  <th>Evidence Type</th>
                  <th>Reason</th>
                  <th>Marked By</th>
                  <th>When</th>
                  <th className="text-center">Verified</th>
                  <th>Finance Remarks</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => {
                  const isVerified = f.verified || !!f.verified_by
                  return (
                    <tr key={f.id} className={clsx(isVerified && 'bg-green-50/40')}>
                      <td className="font-mono text-xs">{f.employee_code}</td>
                      <td className="text-sm font-medium">{f.employee_name || f.employee_code}</td>
                      <td className="text-xs">{f.date}</td>
                      <td>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {f.evidence_type || f.type || '—'}
                        </span>
                      </td>
                      <td className="text-xs text-slate-600 max-w-[200px] truncate">{f.reason || '—'}</td>
                      <td className="text-xs text-slate-500">{f.marked_by || f.added_by || '—'}</td>
                      <td className="text-xs text-slate-400">{f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}</td>
                      <td className="text-center">
                        {isVerified ? (
                          <div>
                            <span className="text-green-600 text-sm">&#10003;</span>
                            <div className="text-[10px] text-slate-400">{f.verified_by}</div>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-sm">&#x2014;</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-500 max-w-[180px] truncate">{f.finance_remarks || '—'}</td>
                      <td className="text-center">
                        {!isVerified && (
                          <>
                            {verifyingId === f.id ? (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={financeRemarks}
                                  onChange={e => setFinanceRemarks(e.target.value)}
                                  className="input text-xs w-32"
                                  placeholder="Remarks..."
                                  autoFocus
                                />
                                <button
                                  onClick={() => verifyMutation.mutate({ id: f.id, finance_remarks: financeRemarks })}
                                  disabled={verifyMutation.isPending}
                                  className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                                >
                                  {verifyMutation.isPending ? '...' : 'OK'}
                                </button>
                                <button
                                  onClick={() => { setVerifyingId(null); setFinanceRemarks('') }}
                                  className="text-xs px-1.5 py-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                                >
                                  X
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setVerifyingId(f.id); setFinanceRemarks(f.finance_remarks || '') }}
                                className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                              >
                                Verify
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// FLAG TYPE CONFIG
// ═══════════════════════════════════════════════════════════
const FLAG_TYPE_CONFIG = {
  MANUAL_TDS: { label: 'Manual TDS', icon: '💰', color: 'amber' },
  MANUAL_OTHER_DEDUCTION: { label: 'Other Deduction', icon: '📝', color: 'amber' },
  GROSS_STRUCTURE_CHANGE: { label: 'Gross Changed', icon: '📊', color: 'purple' },
  SALARY_HELD: { label: 'Salary Held', icon: '⏸️', color: 'red' },
  DAY_CORRECTION: { label: 'Day Correction', icon: '📅', color: 'blue' },
  PUNCH_CORRECTION: { label: 'Punch Correction', icon: '🔧', color: 'cyan' },
  SALARY_INPUT_CHANGE: { label: 'Salary Input', icon: '✏️', color: 'amber' },
  HOLD_OVERRIDE: { label: 'Hold Override', icon: '🔓', color: 'green' },
}

// ═══════════════════════════════════════════════════════════
// READINESS DASHBOARD TAB
// ═══════════════════════════════════════════════════════════
function ReadinessTab() {
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { data: res } = useQuery({ queryKey: ['readiness', month, year], queryFn: () => getReadinessCheck(month, year), retry: 0 })
  const check = res?.data?.data

  if (!check) return <div className="text-center py-12 text-slate-400">Loading readiness check...</div>

  const scoreColor = check.score >= 85 ? 'text-green-600' : check.score >= 60 ? 'text-amber-600' : 'text-red-600'
  const scoreBg = check.score >= 85 ? 'border-green-400' : check.score >= 60 ? 'border-amber-400' : 'border-red-400'

  return (
    <div className="space-y-5">
      {/* Score */}
      <div className="flex items-center gap-6">
        <div className={clsx('w-24 h-24 rounded-full border-4 flex items-center justify-center', scoreBg)}>
          <span className={clsx('text-3xl font-bold', scoreColor)}>{check.score}</span>
        </div>
        <div>
          <h3 className="text-lg font-semibold">{check.ready ? 'Ready to Finalize' : 'Not Ready'}</h3>
          <p className="text-sm text-slate-500">{check.blockers.length} blocker(s), {check.warnings.length} warning(s), {check.passed.length} passed</p>
        </div>
      </div>

      {/* Blockers */}
      {check.blockers.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-red-700 mb-2">Blockers</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {check.blockers.map((b, i) => {
              const action = b.type === 'UNAPPROVED_MANUAL_FLAGS' ? () => setActiveTab('interventions')
                : b.type.includes('HELD') ? () => navigate(`/finance-verify?tab=redflags&filter=salary_held`)
                : b.type.includes('SALARY') ? () => navigate('/pipeline/salary')
                : null;
              return (
              <div key={i} className={clsx('bg-red-50 border border-red-200 rounded-lg p-3', action && 'cursor-pointer hover:bg-red-100 transition-colors')} onClick={action}>
                <div className="font-semibold text-red-800 text-sm">{b.type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-red-600 mt-1">{b.detail}</div>
                {b.count > 0 && <div className="mt-1 text-lg font-bold text-red-700">{b.count}</div>}
                {action && <div className="text-[10px] text-red-500 mt-1 font-medium">Click to review →</div>}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {check.warnings.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-amber-700 mb-2">Warnings</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {check.warnings.map((w, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="font-semibold text-amber-800 text-sm">{w.type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-amber-600 mt-1">{w.detail}</div>
                {w.count > 0 && <div className="mt-1 text-lg font-bold text-amber-700">{w.count}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Passed */}
      <div>
        <h4 className="text-sm font-semibold text-green-700 mb-2">Passed Checks</h4>
        <div className="flex flex-wrap gap-2">
          {check.passed.map((p, i) => (
            <span key={i} className="bg-green-50 text-green-700 text-xs px-3 py-1.5 rounded-full border border-green-200">
              {p.type.replace(/_/g, ' ')} {p.detail ? `(${p.detail})` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MANUAL INTERVENTIONS TAB (salary_manual_flags)
// ═══════════════════════════════════════════════════════════
function ManualInterventionsTab() {
  const qc = useQueryClient()
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [commentModal, setCommentModal] = useState(null)
  const [comment, setComment] = useState('')

  const { data: res } = useQuery({
    queryKey: ['salary-manual-flags', month, year, selectedCompany],
    queryFn: () => getSalaryManualFlags(month, year, selectedCompany), retry: 0
  })
  const flags = res?.data?.data || []
  const summary = res?.data?.summary || {}

  const filtered = useMemo(() => {
    let f = flags
    if (filterType) f = f.filter(x => x.flag_type === filterType)
    if (filterStatus === 'pending') f = f.filter(x => x.finance_approved === 0)
    if (filterStatus === 'approved') f = f.filter(x => x.finance_approved === 1)
    if (filterStatus === 'rejected') f = f.filter(x => x.finance_approved === -1)
    return f
  }, [flags, filterType, filterStatus])

  const approveMut = useMutation({
    mutationFn: ({ id, status, comments }) => approveManualFlag(id, { status, comments }),
    onSuccess: () => { qc.invalidateQueries(['salary-manual-flags']); qc.invalidateQueries(['readiness']); toast.success('Flag updated') }
  })

  const bulkMut = useMutation({
    mutationFn: (data) => bulkApproveFlags(data),
    onSuccess: () => { qc.invalidateQueries(['salary-manual-flags']); qc.invalidateQueries(['readiness']); setSelected(new Set()); toast.success('Bulk action complete') }
  })

  const handleApprove = (id, status) => {
    if (status === 'REJECTED' || status === 'QUERIED') {
      setCommentModal({ id, status })
    } else {
      approveMut.mutate({ id, status, comments: '' })
    }
  }

  const toggleSelect = (id) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(f => f.id)))
  }

  const statusBadge = (val) => {
    if (val === 1) return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Approved</span>
    if (val === -1) return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Rejected</span>
    return <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <KPI label="Total Flags" value={summary.totalFlags || 0} color="blue" />
        <KPI label="Pending" value={summary.pendingCount || 0} color="amber" />
        <KPI label="Approved" value={summary.approvedCount || 0} color="green" />
        <KPI label="Rejected" value={summary.rejectedCount || 0} color="red" />
      </div>

      {/* Filters + bulk */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input text-xs w-48">
          <option value="">All Flag Types</option>
          {Object.entries(FLAG_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input text-xs w-36">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-500">{selected.size} selected</span>
            <button onClick={() => bulkMut.mutate({ flagIds: [...selected], status: 'APPROVED' })} className="btn-primary text-xs">Approve All</button>
            <button onClick={() => bulkMut.mutate({ flagIds: [...selected], status: 'REJECTED' })} className="btn-secondary text-xs">Reject All</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="table-compact w-full">
          <thead>
            <tr>
              <th><input type="checkbox" onChange={selectAll} checked={selected.size === filtered.length && filtered.length > 0} /></th>
              <th>Employee</th>
              <th>Dept</th>
              <th>Flag Type</th>
              <th className="text-right">System</th>
              <th className="text-right">Manual</th>
              <th className="text-right">Delta</th>
              <th>Notes</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => {
              const cfg = FLAG_TYPE_CONFIG[f.flag_type] || { label: f.flag_type, icon: '?', color: 'slate' }
              const isPending = f.finance_approved === 0
              return (
                <tr key={f.id} className={isPending ? 'bg-amber-50/60' : ''}>
                  <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>
                  <td className="font-medium text-sm">{f.employee_name}<div className="text-[10px] text-slate-400">{f.employee_code}</div></td>
                  <td className="text-xs">{f.department}</td>
                  <td><span className={`text-xs px-2 py-0.5 rounded-full bg-${cfg.color}-100 text-${cfg.color}-700`}>{cfg.icon} {cfg.label}</span></td>
                  <td className="text-right text-xs font-mono">{f.system_value ? fmtINR2(f.system_value) : '—'}</td>
                  <td className="text-right text-xs font-mono">{f.manual_value ? fmtINR2(f.manual_value) : '—'}</td>
                  <td className="text-right text-xs font-mono font-bold">{f.delta > 0 ? '+' : ''}{f.delta ? fmtINR2(f.delta) : '—'}</td>
                  <td className="text-xs text-slate-500 max-w-[200px] truncate">{f.notes}</td>
                  <td>{statusBadge(f.finance_approved)}</td>
                  <td>
                    {isPending && (
                      <div className="flex gap-1">
                        <button onClick={() => handleApprove(f.id, 'APPROVED')} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-xs font-medium">Approve</button>
                        <button onClick={() => handleApprove(f.id, 'REJECTED')} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-xs font-medium">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-slate-400">No manual flags found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Comment modal */}
      {commentModal && (
        <Modal onClose={() => setCommentModal(null)} title={`${commentModal.status === 'REJECTED' ? 'Reject' : 'Query'} Flag`}>
          <textarea value={comment} onChange={e => setComment(e.target.value)} className="input w-full h-24" placeholder="Add comments..." />
          <div className="flex gap-2 mt-3">
            <button onClick={() => { approveMut.mutate({ id: commentModal.id, status: commentModal.status, comments: comment }); setCommentModal(null); setComment('') }} className="btn-primary text-sm">Submit</button>
            <button onClick={() => setCommentModal(null)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// VARIANCE ALERTS TAB
// ═══════════════════════════════════════════════════════════
function VarianceTab() {
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { data: res } = useQuery({ queryKey: ['variance', month, year], queryFn: () => getVarianceReport(month, year), retry: 0 })
  const variances = res?.data?.data || []

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{variances.length} employee(s) with &gt;10% net salary variance from previous month</p>
      {variances.length === 0 && <div className="text-center py-12 text-slate-400">No significant variances detected</div>}
      <div className="card overflow-x-auto">
        <table className="table-compact w-full">
          <thead>
            <tr><th>Employee</th><th>Dept</th><th className="text-right">Prev Net</th><th className="text-right">Current Net</th><th className="text-right">Delta</th><th className="text-right">%</th><th>Explanation</th></tr>
          </thead>
          <tbody>
            {variances.map(v => (
              <tr key={v.employee_code} className={v.pct_change < -15 ? 'bg-red-50' : v.pct_change > 15 ? 'bg-green-50' : ''}>
                <td className="font-medium text-sm">{v.employee_name}<div className="text-[10px] text-slate-400">{v.employee_code}</div></td>
                <td className="text-xs">{v.department}</td>
                <td className="text-right text-xs font-mono">{fmtINR(v.prev_net)}</td>
                <td className="text-right text-xs font-mono">{fmtINR(v.current_net)}</td>
                <td className={clsx('text-right text-xs font-mono font-bold', v.delta > 0 ? 'text-green-700' : 'text-red-700')}>{v.delta > 0 ? '+' : ''}{fmtINR(v.delta)}</td>
                <td className={clsx('text-right text-xs font-bold', v.pct_change > 0 ? 'text-green-700' : 'text-red-700')}>{v.pct_change > 0 ? '+' : ''}{v.pct_change}%</td>
                <td className="text-xs text-slate-500 max-w-[300px]">{v.auto_explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// STATUTORY CROSS-CHECK TAB
// ═══════════════════════════════════════════════════════════
function StatutoryTab() {
  const { month, year } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const { data: res } = useQuery({ queryKey: ['statutory', month, year, selectedCompany], queryFn: () => getStatutoryCrosscheck(month, year, selectedCompany), retry: 0 })
  const data = res?.data?.data

  if (!data) return <div className="text-center py-12 text-slate-400">Loading statutory cross-check...</div>

  const Card = ({ title, items }) => (
    <div className="card p-4 space-y-3">
      <h4 className="font-semibold text-sm">{title}</h4>
      {items.map((item, i) => (
        <div key={i} className="flex justify-between text-sm">
          <span className="text-slate-600">{item.label}</span>
          <span className="font-mono font-medium">{fmtINR(item.value)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card title={`PF (${data.pf.count} employees)`} items={[
        { label: 'Employee PF', value: data.pf.employeeTotal },
        { label: 'Employer PF', value: data.pf.employerTotal },
        { label: 'PF Wages', value: data.pf.wagesTotal },
      ]} />
      <Card title={`ESI (${data.esi.count} employees)`} items={[
        { label: 'Employee ESI', value: data.esi.employeeTotal },
        { label: 'Employer ESI', value: data.esi.employerTotal },
        { label: 'ESI Wages', value: data.esi.wagesTotal },
      ]} />
      <Card title={`Professional Tax (${data.pt.count} employees)`} items={[
        { label: 'Total PT', value: data.pt.total },
      ]} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN FINANCE AUDIT COMPONENT
// ═══════════════════════════════════════════════════════════
export default function FinanceAudit() {
  const { user, selectedCompany } = useAppStore()
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const deepTab = searchParams.get('tab')
  const deepEmployee = searchParams.get('employee')
  const [activeTab, setActiveTab] = useState(deepTab || 'readiness')
  const [highlightEmployee, setHighlightEmployee] = useState(deepEmployee || null)
  const isAdmin = user?.role === 'admin'

  // Fetch manual flags count for badge
  const { data: flagsRes } = useQuery({
    queryKey: ['salary-manual-flags', month, year, selectedCompany],
    queryFn: () => getSalaryManualFlags(month, year, selectedCompany),
    retry: 0,
    staleTime: 60000
  })
  const flagsSummary = flagsRes?.data?.summary || {}
  const pendingFlagCount = flagsSummary.pendingCount || 0

  // Legacy manual attendance flags
  const { data: attFlagsRes } = useQuery({
    queryKey: ['manual-flags', month, year, selectedCompany],
    queryFn: () => getManualAttendanceFlags({ month, year, company: selectedCompany }),
    retry: 0, staleTime: 60000
  })
  const attFlagsData = attFlagsRes?.data?.data || attFlagsRes?.data || []
  const unverifiedFlagCount = attFlagsData.filter(f => !f.verified && !f.verified_by).length

  const tabs = [
    { id: 'readiness', label: 'Readiness' },
    { id: 'interventions', label: 'Manual Interventions', badge: pendingFlagCount },
    { id: 'variance', label: 'Variance Alerts' },
    { id: 'statutory', label: 'Statutory Check' },
    { id: 'report', label: 'Finance Report' },
    { id: 'manual-flags', label: `Attendance Flags`, badge: unverifiedFlagCount },
    ...(isAdmin ? [{ id: 'corrections', label: 'Corrections Summary' }] : [])
  ]

  return (
    <ErrorBoundary>
      <div className="p-6 space-y-5 animate-fade-in">
        <div>
          <h2 className="section-title">Finance Audit</h2>
          <p className="section-subtitle mt-1">Pre-finalization verification, manual intervention tracking, and anomaly detection</p>
        </div>

        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>

        <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1.5 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'readiness' && <ReadinessTab />}
        {activeTab === 'interventions' && <ManualInterventionsTab />}
        {activeTab === 'variance' && <VarianceTab />}
        {activeTab === 'statutory' && <StatutoryTab />}
        {activeTab === 'report' && <ReportTab highlightEmployee={highlightEmployee} onClearHighlight={() => setHighlightEmployee(null)} />}
        {activeTab === 'manual-flags' && <ManualFlagsTab />}
        {activeTab === 'corrections' && isAdmin && <CorrectionsSummaryTab />}
      </div>
    </ErrorBoundary>
  )
}

// ── Shared UI helpers ──────────────────────────────────

function KPI({ label, value, color = 'blue' }) {
  const colors = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700', cyan: 'text-cyan-700' }
  return (
    <div className="card p-3">
      <div className={clsx('text-xl font-bold', colors[color])}>{value}</div>
      <div className="text-[10px] text-slate-400 uppercase font-medium">{label}</div>
    </div>
  )
}

function MiniStat({ label, value, sub, color = 'slate' }) {
  const bg = { red: 'bg-red-50', amber: 'bg-amber-50', green: 'bg-green-50', blue: 'bg-blue-50', slate: 'bg-slate-50' }
  const text = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-green-700', blue: 'text-blue-700', slate: 'text-slate-700' }
  return (
    <div className={clsx('rounded-lg p-2', bg[color])}>
      <div className={clsx('text-sm font-bold', text[color])}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
      {sub && <div className="text-[10px] text-slate-500 font-medium">{sub}</div>}
    </div>
  )
}
