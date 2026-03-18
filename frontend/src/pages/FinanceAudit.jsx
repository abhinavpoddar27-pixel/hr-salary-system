import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getFinanceReport, submitDayCorrection, getCorrectionHistory, getCorrectionsSummary } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { fmtINR, fmtINR2, monthYearLabel } from '../utils/formatters'
import Modal from '../components/ui/Modal'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import ErrorBoundary from '../components/ui/ErrorBoundary'
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
function ReportTab() {
  const { selectedMonth, selectedYear, selectedCompany } = useAppStore()
  const queryClient = useQueryClient()
  const sort = useSortable('department', 'asc')
  const expand = useExpandableRows()
  const [correctionModal, setCorrectionModal] = useState(null) // { code, name, systemDays }
  const [corrForm, setCorrForm] = useState({ correctedDays: '', reason: '', notes: '' })
  const [filter, setFilter] = useState('all') // all | flagged | new | held

  const { data: res, isLoading } = useQuery({
    queryKey: ['finance-report', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getFinanceReport(selectedMonth, selectedYear, selectedCompany),
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
      month: selectedMonth,
      year: selectedYear,
      correctedDays: parseFloat(corrForm.correctedDays),
      reason: corrForm.reason,
      notes: corrForm.notes
    })
  }

  return (
    <div className="space-y-4">
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
                    onClick={() => expand.toggle(r.code)}
                    className={clsx('cursor-pointer transition-colors',
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
                        {r.salaryHeld && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">HELD</span>}
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
              <div className="text-xs text-slate-400">{monthYearLabel(selectedMonth, selectedYear)}</div>
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
  const { selectedMonth, selectedYear } = useAppStore()
  const { data: res } = useQuery({
    queryKey: ['correction-history', code, selectedMonth, selectedYear],
    queryFn: () => getCorrectionHistory(code, selectedMonth, selectedYear),
    staleTime: 60000
  })
  const data = res?.data?.data || {}

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="lg:w-1/2">
        <EmployeeQuickView employeeCode={code} compact />
      </div>
      <div className="lg:w-1/2 space-y-3">
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
  const { selectedMonth, selectedYear } = useAppStore()
  const { data: res, isLoading } = useQuery({
    queryKey: ['corrections-summary', selectedMonth, selectedYear],
    queryFn: () => getCorrectionsSummary(selectedMonth, selectedYear),
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
// MAIN FINANCE AUDIT COMPONENT
// ═══════════════════════════════════════════════════════════
export default function FinanceAudit() {
  const { user } = useAppStore()
  const [activeTab, setActiveTab] = useState('report')
  const isAdmin = user?.role === 'admin'

  const tabs = [
    { id: 'report', label: 'Finance Report' },
    ...(isAdmin ? [{ id: 'corrections', label: 'Corrections Summary' }] : [])
  ]

  return (
    <ErrorBoundary>
      <div className="p-6 space-y-5 animate-fade-in">
        <div>
          <h2 className="section-title">Finance Audit</h2>
          <p className="section-subtitle mt-1">Verify salary computations, review corrections, and detect anomalies</p>
        </div>

        <div className="border-b border-slate-200 flex gap-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'report' && <ReportTab />}
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
