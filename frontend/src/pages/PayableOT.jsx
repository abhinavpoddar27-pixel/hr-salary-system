import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import { fmtINR, monthYearLabel } from '../utils/formatters'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import { getPayableOT } from '../utils/api'

export default function PayableOT() {
  const { selectedCompany } = useAppStore()
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const [showNoOT, setShowNoOT] = useState(false)

  const { data: otRes, isLoading } = useQuery({
    queryKey: ['payable-ot', month, year, selectedCompany],
    queryFn: () => getPayableOT(month, year, selectedCompany),
    retry: 0
  })
  const allRecords = otRes?.data?.data || []
  const otRecords = otRes?.data?.otRecords || []
  const summary = otRes?.data?.summary || {}
  // No-OT bucket is anything that has neither punch OT nor finance ED.
  const noOTRecords = useMemo(
    () => allRecords.filter(r => (r.ot_pay || 0) === 0 && (r.ed_pay || 0) === 0),
    [allRecords]
  )

  const exportCSV = () => {
    const header = ['Code', 'Name', 'Department', 'Type', 'Days Present', 'Std Working',
      'Punch OT Days', 'Finance ED Days', 'Total OT+ED Days', 'Rate/Day',
      'OT Pay', 'ED Pay', 'Total Due']
    const rows = otRecords.map(r => [
      r.employee_code, r.employee_name, r.department || '',
      r.is_contractor ? 'Contractor' : 'Permanent',
      r.days_present || 0, summary.standardWorkingDays || '',
      r.ot_days || 0, r.ed_days || 0,
      r.total_ot_ed_days || ((r.ot_days || 0) + (r.ed_days || 0)),
      Math.round(r.ot_daily_rate || 0),
      Math.round(r.ot_pay || 0),
      Math.round(r.ed_pay || 0),
      Math.round((r.ot_pay || 0) + (r.ed_pay || 0))
    ])
    const csv = [header, ...rows].map(row => row.map(v =>
      typeof v === 'string' && v.includes(',') ? `"${v}"` : v
    ).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payable-ot-${year}-${String(month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-title">OT &amp; Extra Duty Payable</h2>
          <p className="section-subtitle mt-1">
            Combined overtime and finance-approved extra duty register for {monthYearLabel(month, year)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="stat-card border-l-4 border-l-slate-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">Employees</span>
          <span className="text-2xl font-bold text-slate-800">{summary.totalEmployees || 0}</span>
        </div>
        <div className={clsx('stat-card border-l-4', (summary.employeesWithOT || 0) > 0 ? 'border-l-cyan-500' : 'border-l-slate-300')}>
          <span className="text-xs font-semibold text-slate-400 uppercase">With OT</span>
          <span className="text-2xl font-bold text-cyan-700">{summary.employeesWithOT || 0}</span>
        </div>
        <div className={clsx('stat-card border-l-4', (summary.employeesWithED || 0) > 0 ? 'border-l-fuchsia-500' : 'border-l-slate-300')}>
          <span className="text-xs font-semibold text-slate-400 uppercase">With ED</span>
          <span className="text-2xl font-bold text-fuchsia-700">{summary.employeesWithED || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-blue-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">OT Days</span>
          <span className="text-2xl font-bold text-blue-700">{summary.totalOTDays || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-purple-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">ED Days</span>
          <span className="text-2xl font-bold text-purple-700">{summary.totalEDDays || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-cyan-500">
          <span className="text-xs font-semibold text-slate-400 uppercase">OT Pay</span>
          <span className="text-xl font-bold text-cyan-700">{fmtINR(summary.totalOTPay || 0)}</span>
        </div>
        <div className="stat-card border-l-4 border-l-fuchsia-500">
          <span className="text-xs font-semibold text-slate-400 uppercase">ED Pay</span>
          <span className="text-xl font-bold text-fuchsia-700">{fmtINR(summary.totalEDPay || 0)}</span>
        </div>
        <div className="stat-card border-l-4 border-l-emerald-500">
          <span className="text-xs font-semibold text-slate-400 uppercase">Total Due</span>
          <span className="text-xl font-bold text-emerald-700">{fmtINR(summary.totalCombinedPay || 0)}</span>
        </div>
      </div>

      {/* Month Context */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
        <div className="font-semibold mb-1">
          {monthYearLabel(month, year)}: {summary.daysInMonth || '—'} calendar days ·
          {' '}{summary.sundaysInMonth || '—'} Sundays ·
          {' '}{summary.standardWorkingDays || '—'} standard working days
        </div>
        <div className="text-blue-700">
          OT triggers when <strong>days present &gt; {summary.standardWorkingDays || '—'}</strong>.
          OT Rate = Gross ÷ {summary.daysInMonth || '—'} per day.
          Contractors never accrue OT.
        </div>
      </div>

      <p className="text-xs text-slate-500" data-testid="ed-grant-pointer">
        Extra duty is granted on the{' '}
        <Link to="/extra-duty-grants" className="text-blue-600 hover:underline font-medium">Extra Duty Grants</Link>{' '}
        page (HR raises, finance approves). Approved grants show here after Stage 7 is re-run.
      </p>

      <OTRegisterTab
        otRecords={otRecords}
        noOTRecords={noOTRecords}
        summary={summary}
        isLoading={isLoading}
        showNoOT={showNoOT}
        setShowNoOT={setShowNoOT}
        exportCSV={exportCSV}
      />
    </div>
  )
}

/* ── OT Register Tab ──────────────────────────────────────── */
function OTRegisterTab({ otRecords, noOTRecords, summary, isLoading, showNoOT, setShowNoOT, exportCSV }) {
  const { toggle, isExpanded } = useExpandableRows()

  return (
    <>
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span className="font-semibold text-slate-700">OT &amp; ED Register — {otRecords.length} records</span>
          <button onClick={exportCSV} className="btn-secondary text-xs" disabled={otRecords.length === 0}>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-compact text-[11px]">
            <thead>
              <tr>
                <th className="w-6"></th>
                <th>Code</th>
                <th>Name</th>
                <th>Dept</th>
                <th>Type</th>
                <th className="text-center">Present</th>
                <th className="text-center">Std. Work</th>
                <th className="text-center bg-blue-50 text-blue-700">Punch OT</th>
                <th className="text-center bg-purple-50 text-purple-700">Fin. ED</th>
                <th className="text-center">Total OT+ED</th>
                <th className="text-right">Rate/Day</th>
                <th className="text-right bg-cyan-50 text-cyan-700">OT Pay</th>
                <th className="text-right bg-fuchsia-50 text-fuchsia-700">ED Pay</th>
                <th className="text-right bg-emerald-50 text-emerald-700">Total Due</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={14} className="text-center py-8 text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && otRecords.length === 0 && (
                <tr><td colSpan={14} className="text-center py-8 text-slate-400">
                  No OT or ED records for this period.
                </td></tr>
              )}
              {otRecords.map(r => {
                const expanded = isExpanded(r.employee_code)
                const totalDue = (r.ot_pay || 0) + (r.ed_pay || 0)
                const totalOtEdDays = (r.ot_days || 0) + (r.ed_days || 0)
                return (
                  <React.Fragment key={r.employee_code}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggle(r.employee_code)}>
                      <td><DrillDownChevron open={expanded} /></td>
                      <td className="font-mono text-slate-500">{r.employee_code}</td>
                      <td className="font-medium">{r.employee_name}</td>
                      <td className="text-slate-500">{r.department || '—'}</td>
                      <td>
                        <span className={clsx(
                          'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                          r.is_contractor ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        )}>
                          {r.is_contractor ? 'Cont' : 'Perm'}
                        </span>
                      </td>
                      <td className="text-center font-mono">{r.days_present || 0}</td>
                      <td className="text-center font-mono text-slate-400">{summary.standardWorkingDays || '—'}</td>
                      <td className="text-center font-mono text-blue-600 bg-blue-50/50">{r.ot_days || 0}</td>
                      <td className="text-center font-mono text-purple-600 bg-purple-50/50">{r.ed_days || 0}</td>
                      <td className="text-center font-mono font-bold text-slate-700">{Math.round(totalOtEdDays * 100) / 100}</td>
                      <td className="text-right font-mono text-slate-500">{fmtINR(r.ot_daily_rate || 0)}</td>
                      <td className="text-right font-mono text-cyan-700">{(r.ot_pay || 0) > 0 ? fmtINR(r.ot_pay) : '—'}</td>
                      <td className="text-right font-mono text-fuchsia-700">{(r.ed_pay || 0) > 0 ? fmtINR(r.ed_pay) : '—'}</td>
                      <td className="text-right font-mono font-bold text-emerald-700">{fmtINR(totalDue)}</td>
                    </tr>
                    {expanded && (
                      <DrillDownRow colSpan={14}>
                        <div className="p-3 bg-slate-50/60 text-xs space-y-2">
                          {r.ot_note && (
                            <div className="text-slate-600 italic">{r.ot_note}</div>
                          )}
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <div className="text-slate-400 uppercase tracking-wide text-[10px] mb-1">Attendance</div>
                              <div>Present: <span className="font-mono">{r.days_present || 0}</span></div>
                              <div>Half: <span className="font-mono">{r.days_half_present || 0}</span></div>
                              <div>WOP: <span className="font-mono">{r.days_wop || 0}</span></div>
                              <div>Paid Sun: <span className="font-mono">{r.paid_sundays || 0}</span></div>
                              <div>Paid Hol: <span className="font-mono">{r.paid_holidays || 0}</span></div>
                            </div>
                            <div>
                              <div className="text-slate-400 uppercase tracking-wide text-[10px] mb-1">OT &amp; ED Breakdown</div>
                              <div>Std Working: <span className="font-mono">{summary.standardWorkingDays}</span></div>
                              <div>Punch OT: <span className="font-mono text-blue-600">{r.ot_days || 0}d × {fmtINR(r.ot_daily_rate || 0)} = {fmtINR(r.ot_pay || 0)}</span></div>
                              <div>Finance ED: <span className="font-mono text-purple-600">{r.ed_days || 0}d × {fmtINR(r.ot_daily_rate || 0)} = {fmtINR(r.ed_pay || 0)}</span></div>
                              <div className="font-semibold mt-1">Total Due: <span className="font-mono text-emerald-700">{fmtINR(totalDue)}</span></div>
                            </div>
                            <div>
                              <div className="text-slate-400 uppercase tracking-wide text-[10px] mb-1">Take Home</div>
                              <div>Gross: <span className="font-mono">{fmtINR(r.gross_salary || 0)}</span></div>
                              <div>Net Salary: <span className="font-mono">{fmtINR(r.net_salary || 0)}</span></div>
                              <div>+ OT Pay: <span className="font-mono text-cyan-700">{fmtINR(r.ot_pay || 0)}</span></div>
                              <div>+ ED Pay: <span className="font-mono text-fuchsia-700">{fmtINR(r.ed_pay || 0)}</span></div>
                              <div className="font-bold mt-1 text-slate-800">
                                Take Home: <span className="font-mono text-emerald-700">{fmtINR(r.take_home || ((r.total_payable || r.net_salary || 0) + (r.ed_pay || 0)))}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
            {otRecords.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold text-xs">
                  <td colSpan={7} className="text-right">TOTALS</td>
                  <td className="text-center font-mono text-blue-700">{summary.totalOTDays || 0}</td>
                  <td className="text-center font-mono text-purple-700">{summary.totalEDDays || 0}</td>
                  <td className="text-center font-mono text-slate-700">{Math.round(((summary.totalOTDays || 0) + (summary.totalEDDays || 0)) * 100) / 100}</td>
                  <td></td>
                  <td className="text-right font-mono text-cyan-700">{fmtINR(summary.totalOTPay || 0)}</td>
                  <td className="text-right font-mono text-fuchsia-700">{fmtINR(summary.totalEDPay || 0)}</td>
                  <td className="text-right font-mono text-emerald-700">{fmtINR(summary.totalCombinedPay || 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Collapsible — Employees with no OT */}
      <div className="card">
        <button
          onClick={() => setShowNoOT(s => !s)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-700 text-sm">
            Employees with no OT ({noOTRecords.length})
          </span>
          <span className="text-slate-400 text-xs">{showNoOT ? 'Hide' : 'Show'}</span>
        </button>
        {showNoOT && (
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full table-compact text-[11px]">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Dept</th>
                  <th className="text-center">Present</th>
                  <th className="text-right">Net Salary</th>
                </tr>
              </thead>
              <tbody>
                {noOTRecords.map(r => (
                  <tr key={r.employee_code}>
                    <td className="font-mono text-slate-500">{r.employee_code}</td>
                    <td>{r.employee_name}</td>
                    <td className="text-slate-500">{r.department || '—'}</td>
                    <td className="text-center font-mono">{r.days_present || 0}</td>
                    <td className="text-right font-mono">{fmtINR(r.net_salary || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
