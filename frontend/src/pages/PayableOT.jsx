import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import { fmtINR, monthYearLabel } from '../utils/formatters'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import {
  getPayableOT,
  grantExtraDuty,
  revokeExtraDuty,
  listExtraDutyGrants
} from '../utils/api'

export default function PayableOT() {
  const { selectedCompany } = useAppStore()
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const [activeTab, setActiveTab] = useState('register')
  const [showNoOT, setShowNoOT] = useState(false)
  const qc = useQueryClient()

  const { data: otRes, isLoading } = useQuery({
    queryKey: ['payable-ot', month, year, selectedCompany],
    queryFn: () => getPayableOT(month, year, selectedCompany),
    retry: 0
  })
  const allRecords = otRes?.data?.data || []
  const otRecords = otRes?.data?.otRecords || []
  const summary = otRes?.data?.summary || {}
  const noOTRecords = useMemo(
    () => allRecords.filter(r => (r.ot_days || 0) === 0),
    [allRecords]
  )

  const { data: grantsRes } = useQuery({
    queryKey: ['extra-duty-grants', month, year],
    queryFn: () => listExtraDutyGrants(month, year),
    retry: 0,
    enabled: activeTab === 'grant'
  })
  const grants = grantsRes?.data?.data || []

  const grantMut = useMutation({
    mutationFn: grantExtraDuty,
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Extra duty granted')
      qc.invalidateQueries({ queryKey: ['extra-duty-grants'] })
      qc.invalidateQueries({ queryKey: ['payable-ot'] })
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || err.message || 'Grant failed')
    }
  })

  const revokeMut = useMutation({
    mutationFn: revokeExtraDuty,
    onSuccess: () => {
      toast.success('Extra duty revoked')
      qc.invalidateQueries({ queryKey: ['extra-duty-grants'] })
      qc.invalidateQueries({ queryKey: ['payable-ot'] })
    }
  })

  const [form, setForm] = useState({ employeeCode: '', days: 1, remark: '' })
  const submitGrant = () => {
    if (!form.employeeCode) return toast.error('Enter employee code')
    if (!form.days || form.days <= 0) return toast.error('Enter days (1-10)')
    grantMut.mutate({
      employeeCode: form.employeeCode.trim(),
      month, year,
      days: parseFloat(form.days),
      remark: form.remark
    })
    setForm({ employeeCode: '', days: 1, remark: '' })
  }

  const exportCSV = () => {
    const header = ['Code', 'Name', 'Department', 'Type', 'Days Present', 'Std Working',
      'Punch OT', 'Finance ED', 'Total OT', 'Rate/Day', 'OT Pay']
    const rows = otRecords.map(r => [
      r.employee_code, r.employee_name, r.department || '',
      r.is_contractor ? 'Contractor' : 'Permanent',
      r.days_present || 0, summary.standardWorkingDays || '',
      r.punch_based_ot || 0, r.finance_extra_duty || 0,
      r.ot_days || 0, Math.round(r.ot_daily_rate || 0), Math.round(r.ot_pay || 0)
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
          <h2 className="section-title">Payable OT / Extra Duty Register</h2>
          <p className="section-subtitle mt-1">
            Review overtime and extra duty payable for {monthYearLabel(month, year)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="stat-card border-l-4 border-l-slate-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">Employees</span>
          <span className="text-2xl font-bold text-slate-800">{summary.totalEmployees || 0}</span>
        </div>
        <div className={clsx('stat-card border-l-4', (summary.employeesWithOT || 0) > 0 ? 'border-l-cyan-500' : 'border-l-slate-300')}>
          <span className="text-xs font-semibold text-slate-400 uppercase">With OT</span>
          <span className="text-2xl font-bold text-cyan-700">{summary.employeesWithOT || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-indigo-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">Total OT Days</span>
          <span className="text-2xl font-bold text-slate-800">{summary.totalOTDays || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-emerald-500">
          <span className="text-xs font-semibold text-slate-400 uppercase">Total OT Pay</span>
          <span className="text-xl font-bold text-emerald-700">{fmtINR(summary.totalOTPay || 0)}</span>
        </div>
        <div className="stat-card border-l-4 border-l-blue-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">Punch OT Days</span>
          <span className="text-2xl font-bold text-blue-700">{summary.totalPunchOT || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-purple-400">
          <span className="text-xs font-semibold text-slate-400 uppercase">Finance ED Days</span>
          <span className="text-2xl font-bold text-purple-700">{summary.totalFinanceED || 0}</span>
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

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0">
        {[
          { id: 'register', label: `OT Register (${otRecords.length})` },
          { id: 'grant', label: 'Grant Extra Duty' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: OT Register */}
      {activeTab === 'register' && (
        <OTRegisterTab
          otRecords={otRecords}
          noOTRecords={noOTRecords}
          summary={summary}
          isLoading={isLoading}
          showNoOT={showNoOT}
          setShowNoOT={setShowNoOT}
          exportCSV={exportCSV}
        />
      )}

      {/* Tab 2: Grant Extra Duty */}
      {activeTab === 'grant' && (
        <GrantExtraDutyTab
          form={form}
          setForm={setForm}
          submitGrant={submitGrant}
          grantMut={grantMut}
          grants={grants}
          revokeMut={revokeMut}
        />
      )}
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
          <span className="font-semibold text-slate-700">OT Register — {otRecords.length} records</span>
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
                <th className="text-center">Punch OT</th>
                <th className="text-center">Fin. ED</th>
                <th className="text-center bg-cyan-50 text-cyan-700">Total OT</th>
                <th className="text-right">Rate/Day</th>
                <th className="text-right bg-emerald-50 text-emerald-700">OT Pay</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={12} className="text-center py-8 text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && otRecords.length === 0 && (
                <tr><td colSpan={12} className="text-center py-8 text-slate-400">
                  No OT records for this period.
                </td></tr>
              )}
              {otRecords.map(r => {
                const expanded = isExpanded(r.employee_code)
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
                      <td className="text-center font-mono text-blue-600">{r.punch_based_ot || 0}</td>
                      <td className="text-center font-mono text-purple-600">{r.finance_extra_duty || 0}</td>
                      <td className="text-center font-mono font-bold text-cyan-700">{r.ot_days || 0}</td>
                      <td className="text-right font-mono text-slate-500">{fmtINR(r.ot_daily_rate || 0)}</td>
                      <td className="text-right font-mono font-bold text-emerald-700">{fmtINR(r.ot_pay || 0)}</td>
                    </tr>
                    {expanded && (
                      <DrillDownRow colSpan={12}>
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
                              <div className="text-slate-400 uppercase tracking-wide text-[10px] mb-1">OT Breakdown</div>
                              <div>Std Working: <span className="font-mono">{summary.standardWorkingDays}</span></div>
                              <div>Punch OT: <span className="font-mono text-blue-600">{r.punch_based_ot || 0}</span></div>
                              <div>Finance ED: <span className="font-mono text-purple-600">{r.finance_extra_duty || 0}</span></div>
                              <div className="font-semibold mt-1">Total OT: <span className="font-mono text-cyan-700">{r.ot_days || 0}</span></div>
                              <div>Rate/day: <span className="font-mono">{fmtINR(r.ot_daily_rate || 0)}</span></div>
                            </div>
                            <div>
                              <div className="text-slate-400 uppercase tracking-wide text-[10px] mb-1">Payable</div>
                              <div>Gross: <span className="font-mono">{fmtINR(r.gross_salary || 0)}</span></div>
                              <div>Net Salary: <span className="font-mono">{fmtINR(r.net_salary || 0)}</span></div>
                              <div>+ OT Pay: <span className="font-mono text-emerald-700">{fmtINR(r.ot_pay || 0)}</span></div>
                              <div className="font-bold mt-1 text-slate-800">
                                Total Payable: <span className="font-mono text-emerald-700">{fmtINR(r.total_payable || 0)}</span>
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
                  <td colSpan={9} className="text-right">TOTALS</td>
                  <td className="text-center font-mono text-cyan-700">{summary.totalOTDays || 0}</td>
                  <td></td>
                  <td className="text-right font-mono text-emerald-700">{fmtINR(summary.totalOTPay || 0)}</td>
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

/* ── Grant Extra Duty Tab ──────────────────────────────── */
function GrantExtraDutyTab({ form, setForm, submitGrant, grantMut, grants, revokeMut }) {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="font-semibold text-slate-700 mb-3 text-sm">Grant Extra Duty</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Employee Code *</label>
            <input
              value={form.employeeCode}
              onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))}
              className="input"
              placeholder="e.g. 22713"
            />
          </div>
          <div>
            <label className="label">Days (1–10) *</label>
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              value={form.days}
              onChange={e => setForm(f => ({ ...f, days: parseFloat(e.target.value) }))}
              className="input"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Remark</label>
            <input
              value={form.remark}
              onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
              className="input"
              placeholder="Reason / reference number"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            After granting, re-run Salary Computation (Stage 7) to apply OT to the register.
          </div>
          <button
            onClick={submitGrant}
            disabled={grantMut.isPending}
            className="btn-primary text-sm"
          >
            {grantMut.isPending ? 'Granting…' : 'Grant'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-slate-700">Active Grants — {grants.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-compact text-[11px]">
            <thead>
              <tr>
                <th className="w-6">#</th>
                <th>Employee</th>
                <th>Dept</th>
                <th className="text-center">Days</th>
                <th>Remark</th>
                <th>Granted By</th>
                <th>When</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">
                  No extra duty grants for this period.
                </td></tr>
              )}
              {grants.map((g, i) => (
                <tr key={g.id} className="hover:bg-slate-50">
                  <td className="text-slate-400">{i + 1}</td>
                  <td className="font-medium">
                    {g.employee_name}
                    <div className="text-[9px] text-slate-400 font-mono">{g.employee_code}</div>
                  </td>
                  <td className="text-slate-500">{g.department || '—'}</td>
                  <td className="text-center font-mono font-bold text-purple-700">{g.days || 0}</td>
                  <td className="text-slate-600">{g.remark || g.correction_notes || '—'}</td>
                  <td className="text-slate-500 text-[10px]">{g.granted_by || '—'}</td>
                  <td className="text-slate-400 text-[10px]">{(g.corrected_at || '').slice(0, 16)}</td>
                  <td>
                    <button
                      onClick={() => {
                        if (window.confirm(`Revoke ${g.days} extra duty day(s) for ${g.employee_code}?`)) {
                          revokeMut.mutate(g.id)
                        }
                      }}
                      className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-xs"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
