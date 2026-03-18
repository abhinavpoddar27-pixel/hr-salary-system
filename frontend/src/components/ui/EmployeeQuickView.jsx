import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEmployee, getPayslip } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { fmtINR } from '../../utils/formatters'
import CalendarView from './CalendarView'
import BehavioralProfile from './BehavioralProfile'
import Skeleton from './Skeleton'
import clsx from 'clsx'

/**
 * EmployeeQuickView — Standardized employee detail panel for inline drill-down.
 *
 * Drop this into any <DrillDownRow> to show employee info + attendance calendar
 * plus optional page-specific context content.
 *
 * Props:
 *   employeeCode  — Required. The employee code to look up.
 *   month/year    — Optional. Defaults to global selectedMonth/selectedYear.
 *   contextContent — Optional JSX. Rendered on the right side for page-specific detail.
 *   showPayslip   — If true, fetch and show payslip breakdown.
 *   compact       — If true, hide calendar and show minimal info.
 *   extraInfo     — Optional object with additional key-value pairs to display.
 *   showBehavioral — If true, show a "Behavioral" tab with full pattern analysis.
 */
export default function EmployeeQuickView({
  employeeCode,
  month: propMonth,
  year: propYear,
  contextContent,
  showPayslip = false,
  showBehavioral = false,
  compact = false,
  extraInfo,
}) {
  const [activeTab, setActiveTab] = useState('context')
  const { selectedMonth, selectedYear } = useAppStore()
  const month = propMonth || selectedMonth
  const year = propYear || selectedYear

  const { data: empRes, isLoading: empLoading } = useQuery({
    queryKey: ['employee-quick', employeeCode],
    queryFn: () => getEmployee(employeeCode),
    enabled: !!employeeCode,
    staleTime: 120000,
  })

  const { data: payslipRes, isLoading: payLoading } = useQuery({
    queryKey: ['payslip-quick', employeeCode, month, year],
    queryFn: () => getPayslip(employeeCode, month, year),
    enabled: !!employeeCode && showPayslip,
    staleTime: 120000,
  })

  const emp = empRes?.data?.data || empRes?.data || null
  const payslip = payslipRes?.data?.data || payslipRes?.data || null

  if (empLoading) return <Skeleton variant="card" />

  if (!emp) {
    return (
      <div className="text-sm text-slate-400 py-2">
        No employee data found for {employeeCode}
      </div>
    )
  }

  const salary = emp.salary_structure || emp
  const grossSalary = salary?.gross_salary || emp?.gross_salary || 0

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Left: Employee Info Card + Calendar */}
      <div className={compact ? 'min-w-[200px]' : 'min-w-[280px] lg:w-[340px]'}>
        {/* Info Card */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">
            {(emp.employee_name || emp.name || '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-slate-800 truncate">
              {emp.employee_name || emp.name}
            </div>
            <div className="text-xs text-slate-500">
              {employeeCode} · {emp.department || '—'}
            </div>
            <div className="text-xs text-slate-400">
              {emp.designation || '—'} · {emp.shift || 'General'} shift
            </div>
          </div>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          <Stat label="Gross" value={fmtINR(grossSalary)} />
          <Stat label="Type" value={emp.employment_type || emp.type || '—'} />
          {emp.pf_applicable ? <Stat label="PF" value="Yes" color="green" /> : <Stat label="PF" value="No" color="slate" />}
          {emp.esi_applicable ? <Stat label="ESI" value="Yes" color="green" /> : <Stat label="ESI" value="No" color="slate" />}
          {extraInfo && Object.entries(extraInfo).map(([k, v]) => (
            <Stat key={k} label={k} value={v} />
          ))}
        </div>

        {/* Attendance Calendar */}
        {!compact && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Attendance Calendar</div>
            <CalendarView employeeCode={employeeCode} month={month} year={year} compact />
          </div>
        )}
      </div>

      {/* Right: Context-specific content, Behavioral Profile, or Payslip */}
      {(contextContent || showPayslip || showBehavioral) && (
        <div className="flex-1 min-w-0">
          {/* Tab switcher when behavioral profile is enabled */}
          {showBehavioral && contextContent && (
            <div className="flex gap-0 border-b border-slate-200 mb-3">
              <button onClick={() => setActiveTab('context')}
                className={clsx('px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                  activeTab === 'context' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600')}>
                Details
              </button>
              <button onClick={() => setActiveTab('behavioral')}
                className={clsx('px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                  activeTab === 'behavioral' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600')}>
                Behavioral Profile
              </button>
            </div>
          )}
          {activeTab === 'context' && contextContent}
          {activeTab === 'behavioral' && showBehavioral && (
            <BehavioralProfile employeeCode={employeeCode} month={month} year={year} />
          )}
          {/* When no context but behavioral is on, show it directly */}
          {!contextContent && showBehavioral && (
            <BehavioralProfile employeeCode={employeeCode} month={month} year={year} />
          )}
          {showPayslip && payslip && <PayslipBreakdown payslip={payslip} loading={payLoading} />}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color = 'blue' }) {
  return (
    <div className="bg-white rounded-lg border border-slate-100 px-2 py-1.5">
      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
      <div className={`text-xs font-semibold text-${color}-700 truncate`}>{value}</div>
    </div>
  )
}

function PayslipBreakdown({ payslip, loading }) {
  if (loading) return <Skeleton variant="card" />
  if (!payslip) return <div className="text-xs text-slate-400">No payslip data for this month</div>

  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 mb-2">Payslip Breakdown</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {payslip.basic_earned > 0 && <PayItem label="Basic" value={payslip.basic_earned} />}
        {payslip.da_earned > 0 && <PayItem label="DA" value={payslip.da_earned} />}
        {payslip.hra_earned > 0 && <PayItem label="HRA" value={payslip.hra_earned} />}
        {payslip.other_allowance_earned > 0 && <PayItem label="Other Allow." value={payslip.other_allowance_earned} />}
        {payslip.production_incentive > 0 && <PayItem label="Prod. Incentive" value={payslip.production_incentive} />}
        {payslip.overtime_amount > 0 && <PayItem label="Overtime" value={payslip.overtime_amount} color="blue" />}
      </div>
      <div className="mt-2 pt-2 border-t border-slate-100">
        <div className="text-xs font-semibold text-slate-500 mb-1">Deductions</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {payslip.ee_pf > 0 && <PayItem label="PF (EE)" value={payslip.ee_pf} deduction />}
          {payslip.ee_esi > 0 && <PayItem label="ESI (EE)" value={payslip.ee_esi} deduction />}
          {payslip.professional_tax > 0 && <PayItem label="PT" value={payslip.professional_tax} deduction />}
          {payslip.advance_recovery > 0 && <PayItem label="Advance" value={payslip.advance_recovery} deduction />}
          {payslip.loan_recovery > 0 && <PayItem label="Loan EMI" value={payslip.loan_recovery} deduction />}
          {payslip.tds > 0 && <PayItem label="TDS" value={payslip.tds} deduction />}
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between">
        <span className="text-xs text-slate-500">Payable Days: <strong>{payslip.total_payable_days || '—'}</strong></span>
        <span className="text-sm font-bold text-green-700">Net: {fmtINR(payslip.net_salary)}</span>
      </div>
    </div>
  )
}

function PayItem({ label, value, deduction = false, color }) {
  const c = deduction ? 'text-red-600' : (color ? `text-${color}-600` : 'text-slate-700')
  return (
    <div className="text-xs">
      <span className="text-slate-400">{label}: </span>
      <span className={`font-medium ${c}`}>{deduction ? '-' : ''}{fmtINR(value)}</span>
    </div>
  )
}
