import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import {
  getSalaryRegister, releaseHeldSalary, getHoldReleases, getHoldReleasesReport
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn } from '../utils/role'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import ReleaseHoldModal from '../components/ui/ReleaseHoldModal'
import { fmtINR } from '../utils/formatters'
import clsx from 'clsx'

/**
 * Held Salaries Register — the canonical page for managing held
 * salaries and reviewing the release audit trail.
 *
 * Three tabs:
 *   1. Currently Held     — live list with per-row Release
 *   2. Released History   — audit trail from salary_hold_releases
 *   3. Release Report     — date-range Excel export
 *
 * Sidebar entry in the Payroll group. Permissions: finance + hr + admin.
 * HR sees Currently Held read-only (no Release button, audit tabs
 * hidden). Finance sees everything. Backend endpoints are gated by
 * requireFinanceOrAdmin so curl attempts by non-finance hit 403.
 *
 * Fully interlinked with Finance Verification → Held Salaries tab
 * and Stage 7 Salary Computation → Held filter banner.
 */
export default function HeldSalariesRegister() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()
  const canFinance = canFinanceFn(user)
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'current')
  const [releaseEmployee, setReleaseEmployee] = useState(null)
  // Report tab state
  const [reportRange, setReportRange] = useState({
    startMonth: month, startYear: year, endMonth: month, endYear: year
  })

  // Tabs shown to the user — HR only gets the live list; the audit
  // trail and report are finance-sensitive (backend also enforces this).
  const tabs = canFinance
    ? [
      { id: 'current', label: 'Currently Held' },
      { id: 'history', label: 'Released History' },
      { id: 'report', label: 'Release Report' },
    ]
    : [{ id: 'current', label: 'Currently Held' }]

  // ── Currently Held ──────────────────────────────────────
  // Read from salary-register and filter client-side to held-but-not-
  // released. Matches the exact logic Finance Verify Held tab uses.
  const { data: srRes } = useQuery({
    queryKey: ['held-register-current', month, year, selectedCompany],
    queryFn: () => getSalaryRegister(month, year, selectedCompany),
    retry: 0,
    enabled: activeTab === 'current'
  })
  const heldSalaries = (srRes?.data?.data || []).filter(r => r.salary_held === 1 && r.hold_released !== 1)

  const releaseMut = useMutation({
    mutationFn: ({ code, notes }) => releaseHeldSalary(code, month, year, notes),
    onSuccess: () => {
      toast.success('Salary released — audit row recorded')
      setReleaseEmployee(null)
      qc.invalidateQueries({ queryKey: ['held-register-current'] })
      qc.invalidateQueries({ queryKey: ['held-register-history'] })
      qc.invalidateQueries({ queryKey: ['fin-held'] })
      qc.invalidateQueries({ queryKey: ['salary-register'] })
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Release failed')
  })

  // ── Released History ────────────────────────────────────
  const { data: historyRes } = useQuery({
    queryKey: ['held-register-history', month, year, selectedCompany],
    queryFn: () => getHoldReleases({ month, year, company: selectedCompany || undefined }),
    retry: 0,
    enabled: activeTab === 'history' && canFinance
  })
  const history = historyRes?.data?.data || []
  const historyTotals = useMemo(() => ({
    count: history.length,
    amount: history.reduce((s, r) => s + (r.hold_amount || 0), 0)
  }), [history])

  // ── Release Report ──────────────────────────────────────
  const { data: reportRes, refetch: refetchReport, isFetching: isFetchingReport } = useQuery({
    queryKey: ['held-register-report', reportRange, selectedCompany],
    queryFn: () => getHoldReleasesReport({ ...reportRange, company: selectedCompany || undefined }),
    retry: 0,
    enabled: false // only fires on explicit Generate click
  })
  const reportData = reportRes?.data?.data || []
  const reportTotals = reportRes?.data?.totals || { count: 0, amount: 0 }

  const downloadReport = () => {
    if (reportData.length === 0) {
      toast.error('No releases in the selected range — click Generate first.')
      return
    }
    const rows = reportData.map(r => ({
      'Released At': r.released_at,
      'Employee Code': r.employee_code,
      'Employee Name': r.employee_name,
      'Department': r.department,
      'Month': r.month,
      'Year': r.year,
      'Company': r.company,
      'Hold Reason': r.hold_reason,
      'Hold Amount': r.hold_amount,
      'Released By': r.released_by,
      'Release Notes': r.release_notes,
    }))
    // Totals row
    rows.push({})
    rows.push({
      'Released At': 'TOTAL',
      'Employee Code': '',
      'Employee Name': '',
      'Department': '',
      'Month': '',
      'Year': '',
      'Company': '',
      'Hold Reason': `${reportTotals.count} releases`,
      'Hold Amount': reportTotals.amount,
      'Released By': '',
      'Release Notes': '',
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Held Salary Releases')
    const label = `held-salary-releases_${reportRange.startYear}-${String(reportRange.startMonth).padStart(2, '0')}_to_${reportRange.endYear}-${String(reportRange.endMonth).padStart(2, '0')}.xlsx`
    XLSX.writeFile(wb, label)
    toast.success('Report downloaded')
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Held Salaries Register</h2>
          <p className="section-subtitle mt-1">Manage held salaries, track releases, and export paper-verification audit reports</p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      {/* Diagnostic banner — mirrors the Extra Duty page so finance can
          always see what the frontend thinks their role is. */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-[11px] text-blue-900 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span><strong>User:</strong> {user?.username || '(unknown)'}</span>
        <span><strong>canFinance:</strong> <code className={clsx('px-1 rounded', canFinance ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>{String(canFinance)}</code></span>
        <Link to="/finance-verification?tab=held" className="ml-auto text-blue-600 hover:underline font-medium">
          ← Back to Finance Verify
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Currently Held tab ─────────────────────────────── */}
      {activeTab === 'current' && (
        <div className="card overflow-x-auto">
          <table className="table-compact w-full text-[11px]">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Dept</th>
                <th>Hold Reason</th>
                <th>Days</th>
                <th>Net Salary</th>
                {canFinance && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {heldSalaries.map(h => (
                <tr key={h.employee_code} className="bg-amber-50">
                  <td className="font-medium">{h.employee_name || h.employee_code}<div className="text-[10px] text-slate-400">{h.employee_code}</div></td>
                  <td className="text-slate-500">{h.department}</td>
                  <td className="text-xs text-slate-600">{h.hold_reason || 'No reason recorded'}</td>
                  <td className="font-mono text-center">{h.payable_days}</td>
                  <td className="font-mono">{fmtINR(h.net_salary)}</td>
                  {canFinance && (
                    <td>
                      <button
                        onClick={() => setReleaseEmployee({
                          code: h.employee_code,
                          name: h.employee_name,
                          department: h.department,
                          hold_reason: h.hold_reason,
                          net_salary: h.net_salary,
                          month, year
                        })}
                        className="text-green-600 hover:bg-green-50 px-2 py-1 rounded text-xs font-medium"
                      >
                        Release
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {heldSalaries.length === 0 && (
                <tr><td colSpan={canFinance ? 6 : 5} className="text-center py-8 text-slate-400">No held salaries for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Released History tab (finance only) ────────────── */}
      {activeTab === 'history' && canFinance && (
        <div className="space-y-3">
          <div className="card p-3 flex flex-wrap items-center gap-4 text-xs">
            <span><strong>Total releases this month:</strong> <code className="bg-slate-100 px-2 py-0.5 rounded">{historyTotals.count}</code></span>
            <span><strong>Total amount released:</strong> <code className="bg-slate-100 px-2 py-0.5 rounded font-mono">{fmtINR(historyTotals.amount)}</code></span>
          </div>
          <div className="card overflow-x-auto">
            <table className="table-compact w-full text-[11px]">
              <thead>
                <tr>
                  <th>Released At</th>
                  <th>Employee</th>
                  <th>Dept</th>
                  <th>Period</th>
                  <th>Hold Reason</th>
                  <th>Amount</th>
                  <th>Released By</th>
                  <th>Release Notes</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-[10px] whitespace-nowrap">{r.released_at?.replace('T', ' ')}</td>
                    <td className="font-medium">{r.employee_name || r.employee_code}<div className="text-[10px] text-slate-400">{r.employee_code}</div></td>
                    <td className="text-slate-500">{r.department}</td>
                    <td className="font-mono text-slate-500">{String(r.month).padStart(2, '0')}/{r.year}</td>
                    <td className="text-xs text-slate-600">{r.hold_reason || '—'}</td>
                    <td className="font-mono">{fmtINR(r.hold_amount)}</td>
                    <td className="text-slate-600">{r.released_by}</td>
                    <td className="text-xs text-slate-600 max-w-[320px]" title={r.release_notes}>{r.release_notes}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No releases in this month</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Release Report tab (finance only) ──────────────── */}
      {activeTab === 'report' && canFinance && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-700">Release Report — Date Range</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="label">Start Month</label>
                <input type="number" min="1" max="12" value={reportRange.startMonth}
                  onChange={e => setReportRange(r => ({ ...r, startMonth: parseInt(e.target.value) || 1 }))}
                  className="input" />
              </div>
              <div>
                <label className="label">Start Year</label>
                <input type="number" min="2020" max="2099" value={reportRange.startYear}
                  onChange={e => setReportRange(r => ({ ...r, startYear: parseInt(e.target.value) || 2026 }))}
                  className="input" />
              </div>
              <div>
                <label className="label">End Month</label>
                <input type="number" min="1" max="12" value={reportRange.endMonth}
                  onChange={e => setReportRange(r => ({ ...r, endMonth: parseInt(e.target.value) || 12 }))}
                  className="input" />
              </div>
              <div>
                <label className="label">End Year</label>
                <input type="number" min="2020" max="2099" value={reportRange.endYear}
                  onChange={e => setReportRange(r => ({ ...r, endYear: parseInt(e.target.value) || 2026 }))}
                  className="input" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => refetchReport()} disabled={isFetchingReport} className="btn-primary text-sm">
                {isFetchingReport ? 'Generating...' : 'Generate Report'}
              </button>
              <button onClick={downloadReport} disabled={reportData.length === 0} className="btn-ghost text-sm">
                📥 Download Excel
              </button>
            </div>
            {reportRes && (
              <div className="text-xs text-slate-500">
                Found <strong>{reportTotals.count}</strong> release(s) · Total amount released: <strong className="font-mono">{fmtINR(reportTotals.amount)}</strong>
              </div>
            )}
          </div>
          {reportData.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="table-compact w-full text-[11px]">
                <thead>
                  <tr>
                    <th>Released At</th><th>Employee</th><th>Dept</th><th>Period</th><th>Reason</th><th>Amount</th><th>Released By</th><th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.map(r => (
                    <tr key={r.id}>
                      <td className="font-mono text-[10px] whitespace-nowrap">{r.released_at?.replace('T', ' ')}</td>
                      <td className="font-medium">{r.employee_name}<div className="text-[10px] text-slate-400">{r.employee_code}</div></td>
                      <td className="text-slate-500">{r.department}</td>
                      <td className="font-mono text-slate-500">{String(r.month).padStart(2, '0')}/{r.year}</td>
                      <td className="text-xs text-slate-600">{r.hold_reason || '—'}</td>
                      <td className="font-mono">{fmtINR(r.hold_amount)}</td>
                      <td className="text-slate-600">{r.released_by}</td>
                      <td className="text-xs text-slate-600 max-w-[280px]" title={r.release_notes}>{r.release_notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Shared release modal */}
      <ReleaseHoldModal
        open={!!releaseEmployee}
        onClose={() => setReleaseEmployee(null)}
        employee={releaseEmployee}
        pending={releaseMut.isPending}
        onSubmit={(notes) => releaseMut.mutate({ code: releaseEmployee.code, notes })}
      />
    </div>
  )
}
