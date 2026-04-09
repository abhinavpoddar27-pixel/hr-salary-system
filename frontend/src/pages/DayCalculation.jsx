import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api, { getDayCalculations, calculateDays, getEmployeeDailyAttendance, applyLeaveCorrection, getEmployeeLeaveBalance, getDayCalcStaleness } from '../utils/api'
import Modal from '../components/ui/Modal'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { Abbr, Tip } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>
  return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

function DaySummaryBox({ label, value, color = 'slate', subtext }) {
  return (
    <div className={clsx('rounded-lg p-2.5 border text-center min-w-[80px]', `bg-${color}-50 border-${color}-200`)}>
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={clsx('text-lg font-bold', `text-${color}-700`)}>{value}</div>
      {subtext && <div className="text-[10px] text-slate-400">{subtext}</div>}
    </div>
  )
}

export default function DayCalculation() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const queryClient = useQueryClient()
  const [expandedRow, setExpandedRow] = useState(null)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [sortField, setSortField] = useState('employee')
  const [sortDir, setSortDir] = useState('asc')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['day-calculations', month, year, selectedCompany],
    queryFn: () => getDayCalculations({ month, year, company: selectedCompany }),
    retry: 0
  })

  const rawCalcs = res?.data?.data || []

  const daysInMonth = new Date(year, month, 0).getDate()
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const calcs = useMemo(() => {
    let result = [...rawCalcs]
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(r =>
        (r.employee_name || '').toLowerCase().includes(s) ||
        (r.employee_code || '').toLowerCase().includes(s)
      )
    }
    if (filterDept) {
      result = result.filter(r => (r.department || '').toLowerCase().includes(filterDept.toLowerCase()))
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'employee':
          cmp = (a.employee_name || a.employee_code || '').localeCompare(b.employee_name || b.employee_code || '')
          break
        case 'present':
          cmp = (a.days_present || 0) - (b.days_present || 0)
          break
        case 'absent':
          cmp = (a.days_absent || 0) - (b.days_absent || 0)
          break
        case 'payable':
          cmp = (a.total_payable_days || 0) - (b.total_payable_days || 0)
          break
        case 'late':
          cmp = (a.late_count || 0) - (b.late_count || 0)
          break
        case 'lop':
          cmp = (a.lop_days || 0) - (b.lop_days || 0)
          break
        case 'working':
          cmp = (a.total_working_days || 0) - (b.total_working_days || 0)
          break
        case 'extraDuty':
          cmp = (a.extra_duty_days || 0) - (b.extra_duty_days || 0)
          break
        default: cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return result
  }, [rawCalcs, search, filterDept, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const calcMutation = useMutation({
    mutationFn: () => calculateDays({ month, year, company: selectedCompany }),
    onSuccess: (res) => {
      toast.success(`Day calculation complete for ${res.data.processed} employees`)
      refetch()
      queryClient.invalidateQueries(['org-overview'])
      queryClient.invalidateQueries(['day-calc-staleness'])
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Calculation failed')
  })

  // April 2026: miss-punch finance-review gate. Detects whether any
  // finance approvals/rejections happened since the last day calc
  // run for this month. If so, Stage 6 data is stale and the banner
  // nudges the user to click Recalculate. Refetches every 30s so the
  // banner updates as finance works through their queue in parallel.
  const { data: stalenessRes } = useQuery({
    queryKey: ['day-calc-staleness', month, year, selectedCompany],
    queryFn: () => getDayCalcStaleness(month, year, selectedCompany || undefined),
    refetchInterval: 30000,
    retry: 0
  })
  const staleness = stalenessRes?.data || {}

  const lateDeductionMutation = useMutation({
    mutationFn: ({ code, deductionDays, remark }) => api.put(`/payroll/day-calculations/${code}/late-deduction`, {
      month,
      year,
      deductionDays,
      remark
    }),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Late deduction applied')
      refetch()
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to apply late deduction')
  })

  // ── Leave Correction Modal State ──
  const [leaveModal, setLeaveModal] = useState(null) // { code, name, days_absent }
  const [leaveForm, setLeaveForm] = useState({ leave_type: 'CL', date: '', reason: '' })

  const { data: leaveBalanceRes, isLoading: balanceLoading } = useQuery({
    queryKey: ['leave-balance', leaveModal?.code],
    queryFn: () => getEmployeeLeaveBalance(leaveModal.code),
    enabled: !!leaveModal?.code,
    staleTime: 30000
  })
  const leaveBalance = leaveBalanceRes?.data?.data || leaveBalanceRes?.data || {}

  const leaveCorrectionMutation = useMutation({
    mutationFn: (data) => applyLeaveCorrection(data),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Leave correction applied')
      setLeaveModal(null)
      setLeaveForm({ leave_type: 'CL', date: '', reason: '' })
      queryClient.invalidateQueries({ queryKey: ['day-calculations'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] })
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to apply leave correction')
  })

  function handleSubmitLeaveCorrection() {
    if (!leaveForm.date) { toast.error('Please select a date'); return }
    if (!leaveForm.reason) { toast.error('Please enter a reason'); return }
    leaveCorrectionMutation.mutate({
      employee_code: leaveModal.code,
      date: leaveForm.date,
      leave_type: leaveForm.leave_type,
      month,
      year,
      reason: leaveForm.reason
    })
  }

  const totals = calcs.reduce((acc, r) => ({
    present: acc.present + (r.days_present || 0),
    half: acc.half + (r.days_half_present || 0),
    absent: acc.absent + (r.days_absent || 0),
    paidSundays: acc.paidSundays + (r.paid_sundays || 0),
    holidays: acc.holidays + (r.paid_holidays || 0),
    cl: acc.cl + (r.cl_used || 0),
    el: acc.el + (r.el_used || 0),
    lop: acc.lop + (r.lop_days || 0),
    payable: acc.payable + (r.total_payable_days || 0),
    extraDuty: acc.extraDuty + (r.extra_duty_days || 0),
    financeED: acc.financeED + (r.finance_ed_days || 0),
    wop: acc.wop + (r.days_wop || 0),
  }), { present: 0, half: 0, absent: 0, paidSundays: 0, holidays: 0, cl: 0, el: 0, lop: 0, payable: 0, extraDuty: 0, financeED: 0, wop: 0 })

  const zeroDayCount = rawCalcs.filter(r => (r.days_present || 0) === 0 && (r.days_half_present || 0) === 0).length
  const lopCount = rawCalcs.filter(r => (r.lop_days || 0) > 0).length
  const extraDutyCount = rawCalcs.filter(r => (r.extra_duty_days || 0) > 0).length
  const financeEDCount = rawCalcs.filter(r => (r.finance_ed_days || 0) > 0).length

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'active' }} />

      <div className="p-6 space-y-5 max-w-screen-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 6: Day Calculation & Leave Adjustment</h2>
            <p className="section-subtitle mt-1">
              Calculate paid days using Sunday granting rules, leave deductions, and holiday adjustments.
              <span className="ml-2 text-xs text-slate-400">({monthNames[month]} {year} — {daysInMonth} days)</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CompanyFilter />
            <DateSelector {...dateProps} />
          </div>
          <button
            onClick={() => calcMutation.mutate()}
            disabled={calcMutation.isPending}
            className="btn-primary"
          >
            {calcMutation.isPending ? '⏳ Calculating...' : '▶ Run Day Calculation'}
          </button>
        </div>

        {/* April 2026: stale-data banner. Surfaces when finance has
            approved/rejected miss punches since the last day calc
            run for this month — without a re-run, Stage 6 shows
            pre-approval numbers. Auto-refetches every 30s (via
            refetchInterval on the staleness query) so the banner
            updates live as finance works through their queue. */}
        {staleness.stale && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
            <span className="text-lg">⚠</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                {staleness.changedMissPunches} miss punch{staleness.changedMissPunches === 1 ? '' : 'es'} changed finance status since the last day calculation
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                Re-run Stage 6 so finance-approved resolutions flow in and finance-rejected ones get the ½P credit.
              </div>
            </div>
            <button
              onClick={() => calcMutation.mutate()}
              disabled={calcMutation.isPending}
              className="btn-primary text-sm shrink-0"
            >
              {calcMutation.isPending ? 'Recalculating...' : 'Recalculate Days'}
            </button>
          </div>
        )}

        {/* Summary Stats */}
        {rawCalcs.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-3">
            {[
              { label: 'Total Employees', value: rawCalcs.length, color: 'blue' },
              { label: 'Avg Present', value: (totals.present / (calcs.length || 1)).toFixed(1), color: 'green' },
              { label: 'Paid Sundays', value: totals.paidSundays.toFixed(0), color: 'indigo' },
              { label: 'Total Late', value: rawCalcs.reduce((s, r) => s + (r.late_count || 0), 0), color: 'amber' },
              { label: 'Total LOP', value: totals.lop.toFixed(1), color: 'red' },
              { label: 'Late Deductions', value: rawCalcs.filter(r => (r.late_deduction_days || 0) > 0).length, color: 'orange' },
              { label: 'Avg Payable', value: (totals.payable / (calcs.length || 1)).toFixed(1), color: 'emerald' },
              { label: 'Extra Duty', value: `${extraDutyCount} emp`, color: extraDutyCount > 0 ? 'cyan' : 'slate' },
              { label: '0-Day Emp', value: zeroDayCount, color: zeroDayCount > 0 ? 'red' : 'slate' },
            ].map(s => (
              <div key={s.label} className={clsx('stat-card border-l-4', `border-l-${s.color}-400`)}>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</span>
                <span className={clsx('text-2xl font-bold', `text-${s.color}-700`)}>{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        {rawCalcs.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="label">Search Employee</label>
              <input type="text" placeholder="Name or code..." value={search} onChange={e => setSearch(e.target.value)} className="input w-48" />
            </div>
            <div>
              <label className="label"><Abbr code="Dept">Dept</Abbr> Filter</label>
              <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
            </div>
            <div className="text-xs text-slate-500 py-2">
              Showing {calcs.length} of {rawCalcs.length} employees
              {lopCount > 0 && <span className="ml-2 text-amber-600">| {lopCount} with LOP</span>}
              {zeroDayCount > 0 && <span className="ml-2 text-red-600">| {zeroDayCount} with 0 days</span>}
              {extraDutyCount > 0 && <span className="ml-2 text-cyan-600">| {extraDutyCount} with Extra Duty</span>}
              {financeEDCount > 0 && <span className="ml-2 text-purple-600">| {financeEDCount} with Finance ED</span>}
            </div>
          </div>
        )}

        {/* Empty State */}
        {rawCalcs.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">📅</div>
            <h3 className="font-semibold text-slate-700 mb-2">No day calculations yet</h3>
            <p className="text-slate-500 mb-4">Click "Run Day Calculation" to compute payable days for all employees.</p>
          </div>
        )}

        {/* Main Table */}
        {calcs.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="font-semibold text-slate-700">Day Calculation Register — {calcs.length} employees</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('employee')}>
                      <Tip text="Employee name and code"><span>Employee</span></Tip>
                      <SortIcon field="employee" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th><Tip text="Total calendar days in the month">Cal</Tip></th>
                    <th><Tip text="Total Sundays in the month">Sun</Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('working')}>
                      <Tip text="Working days = Calendar - Sundays - Holidays">Work</Tip>
                      <SortIcon field="working" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('present')}>
                      <Tip text="Full days present"><Abbr code="P">Pres</Abbr></Tip>
                      <SortIcon field="present" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Tip text="Half-day present"><Abbr code="½P">½D</Abbr></Tip></th>
                    <th><Tip text="Worked on weekly off (extra duty days)"><Abbr code="WOP">WOP</Abbr></Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('absent')}>
                      <Tip text="Absent days"><Abbr code="A">Abs</Abbr></Tip>
                      <SortIcon field="absent" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('late')}>
                      <Tip text="Late arrivals">Late</Tip>
                      <SortIcon field="late" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Tip text="Paid Sundays granted">P.Sun</Tip></th>
                    <th><Tip text="Paid holidays">Hol</Tip></th>
                    <th><Tip text="CL used for Sunday granting"><Abbr code="CL">CL</Abbr></Tip></th>
                    <th><Tip text="EL used for Sunday granting"><Abbr code="EL">EL</Abbr></Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('lop')}>
                      <Tip text="Loss of Pay"><Abbr code="LOP">LOP</Abbr></Tip>
                      <SortIcon field="lop" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="cursor-pointer select-none bg-blue-50 text-blue-700" onClick={() => toggleSort('payable')}>
                      <Tip text="Total Payable Days">Payable</Tip>
                      <SortIcon field="payable" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="cursor-pointer select-none bg-cyan-50 text-cyan-700" onClick={() => toggleSort('extraDuty')}>
                      <Tip text="Extra Duty Days = Payable - Calendar Days (when payable exceeds month days)">Extra Duty</Tip>
                      <SortIcon field="extraDuty" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="bg-purple-50 text-purple-700">
                      <Tip text="Finance-approved Extra Duty grants for the month (display only — paid via salary's ed_pay)">Fin. ED</Tip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calcs.map(r => {
                    const isZeroDay = (r.days_present || 0) === 0 && (r.days_half_present || 0) === 0
                    const hasLOP = (r.lop_days || 0) > 0
                    const hasExtraDuty = (r.extra_duty_days || 0) > 0
                    return (
                      <React.Fragment key={r.id}>
                        <tr onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)} className={clsx(
                          'transition-colors cursor-pointer hover:bg-blue-50/50',
                          expandedRow === r.id && 'bg-blue-50/70',
                          isZeroDay && expandedRow !== r.id && 'bg-red-50/60',
                          !isZeroDay && hasLOP && expandedRow !== r.id && 'bg-amber-50/40',
                          !isZeroDay && !hasLOP && hasExtraDuty && expandedRow !== r.id && 'bg-cyan-50/30'
                        )}>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <DrillDownChevron isExpanded={expandedRow === r.id} />
                              {isZeroDay && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="0 working days" />}
                              {hasExtraDuty && <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" title="Extra duty" />}
                              <div>
                                <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                                <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-slate-600">{r.department}</td>
                          <td>{r.total_calendar_days}</td>
                          <td>{r.total_sundays}</td>
                          <td className="font-medium text-slate-700">{r.total_working_days || (r.total_calendar_days - r.total_sundays - (r.paid_holidays || 0))}</td>
                          <td className="text-green-600 font-medium">{r.days_present}</td>
                          <td className="text-yellow-600">{r.days_half_present || 0}</td>
                          <td className={clsx('font-medium', (r.days_wop || 0) > 0 ? 'text-cyan-600' : 'text-slate-400')}>{r.days_wop || 0}</td>
                          <td className={clsx('font-medium', r.days_absent > 0 ? 'text-red-600' : 'text-slate-400')}>
                            <div className="flex items-center gap-1">
                              {r.days_absent}
                              {r.days_absent > 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLeaveModal({ code: r.employee_code, name: r.employee_name || r.employee_code, days_absent: r.days_absent }) }}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors whitespace-nowrap"
                                  title="Apply CL/EL/SL to absent days"
                                >
                                  Apply Leave
                                </button>
                              )}
                            </div>
                          </td>
                          <td className={clsx('font-medium', (r.late_count || 0) >= 5 ? 'text-red-600' : (r.late_count || 0) > 0 ? 'text-amber-600' : 'text-slate-400')}>
                            <div className="flex items-center gap-1">
                              {r.late_count || 0}
                              {(r.late_count || 0) >= 5 && <span className="text-red-500" title="Late deduction recommended">⚠</span>}
                              {r.late_deduction_days > 0 && <span className="text-xs bg-red-100 text-red-700 px-1 rounded">-{r.late_deduction_days}d</span>}
                            </div>
                          </td>
                          <td className="text-blue-600">{r.paid_sundays}</td>
                          <td className="text-purple-600">{r.paid_holidays}</td>
                          <td className="text-orange-600">{r.cl_used || 0}</td>
                          <td className="text-orange-600">{r.el_used || 0}</td>
                          <td className={clsx('font-medium', r.lop_days > 0 ? 'text-red-600' : 'text-slate-400')}>{r.lop_days}</td>
                          <td className="bg-blue-50 font-bold text-blue-700 text-sm">{r.total_payable_days}</td>
                          <td className={clsx('font-bold text-sm', hasExtraDuty ? 'bg-cyan-50 text-cyan-700' : 'text-slate-300')}>
                            {hasExtraDuty ? r.extra_duty_days : '—'}
                          </td>
                          <td className={clsx('font-bold text-sm', (r.finance_ed_days || 0) > 0 ? 'bg-purple-50 text-purple-700' : 'text-slate-300')}>
                            {(r.finance_ed_days || 0) > 0 ? r.finance_ed_days : '—'}
                          </td>
                        </tr>
                        {expandedRow === r.id && (
                          <DrillDownRow colSpan={18}>
                            <DrillDownContent
                              r={r}
                              selectedMonth={month}
                              selectedYear={year}
                              daysInMonth={daysInMonth}
                              lateDeductionMutation={lateDeductionMutation}
                            />
                          </DrillDownRow>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-xs">
                    <td colSpan={2}>TOTAL ({calcs.length})</td>
                    <td />
                    <td />
                    <td />
                    <td className="text-green-600">{totals.present}</td>
                    <td className="text-yellow-600">{totals.half}</td>
                    <td className="text-cyan-600">{totals.wop.toFixed(1)}</td>
                    <td className="text-red-600">{totals.absent}</td>
                    <td className="text-amber-600">{calcs.reduce((s, r) => s + (r.late_count || 0), 0)}</td>
                    <td className="text-blue-600">{totals.paidSundays}</td>
                    <td className="text-purple-600">{totals.holidays}</td>
                    <td className="text-orange-600">{totals.cl}</td>
                    <td className="text-orange-600">{totals.el}</td>
                    <td className="text-red-600">{totals.lop.toFixed(1)}</td>
                    <td className="bg-blue-100 text-blue-700">{totals.payable.toFixed(1)}</td>
                    <td className={clsx(totals.extraDuty > 0 ? 'bg-cyan-100 text-cyan-700' : 'text-slate-300')}>{totals.extraDuty > 0 ? totals.extraDuty.toFixed(1) : '—'}</td>
                    <td className={clsx(totals.financeED > 0 ? 'bg-purple-100 text-purple-700' : 'text-slate-300')}>{totals.financeED > 0 ? totals.financeED.toFixed(1) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Explanation Card */}
        {rawCalcs.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-3">How Day Calculation Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Working Days</p>
                <p>Working Days = Calendar Days − Sundays − Holidays</p>
                <p className="text-slate-500 mt-1">Sundays and holidays are <strong>never</strong> counted as absent.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Sunday Granting — Monthly Leniency</p>
                <p>threshold = workingDays − 2 (leniency)</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li><strong>Present ≥ threshold</strong> → ALL Sundays paid</li>
                  <li><strong>Present &lt; threshold</strong> → lose (threshold − present) Sundays</li>
                </ul>
                <p className="text-slate-500 mt-1">No CL/EL deducted from Sunday logic — leaves are managed separately.</p>
              </div>
              <div>
                <p className="font-semibold text-amber-700 mb-1">Contractor Rules</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>No paid Sundays (daily wage only)</li>
                  <li>No paid holidays</li>
                  <li>Daily rate = Gross ÷ Days in Month</li>
                  <li>Salary = Days Present × Daily Rate</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Payable Days Formula</p>
                <p>Payable = Present + ½Days + Paid Sundays + Holidays − LOP</p>
                <p className="text-slate-500 mt-1">LOP = absent days not covered by CL/EL.</p>
              </div>
              <div>
                <p className="font-semibold text-cyan-700 mb-1">🌟 Extra Duty</p>
                <p>If <strong>Payable Days &gt; Calendar Days</strong> ({daysInMonth} for {monthNames[month]}), the excess is Extra Duty.</p>
                <p className="text-slate-500 mt-1">Happens when employee works on weekly offs (WOP) resulting in more payable days than the month has.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Row Highlights</p>
                <p className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> 0-day employees</p>
                <p className="flex items-center gap-2 mt-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> Employees with LOP</p>
                <p className="flex items-center gap-2 mt-1"><span className="w-3 h-3 rounded bg-cyan-100 border border-cyan-200" /> Extra duty employees</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Left Employees</p>
                <p className="text-slate-500">Employees marked as "Left" are automatically excluded from day calculations and salary processing.</p>
              </div>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['P', 'A', '½P', 'WO', 'WOP', 'CL', 'EL', 'SL', 'LOP', 'LWP', 'OT', 'PF', 'ESI', 'PT', 'Dept', 'Att', 'Hrs']} />
      </div>

      {/* ── Leave Correction Modal ── */}
      {leaveModal && (
        <Modal open onClose={() => setLeaveModal(null)} title={`Apply Leave: ${leaveModal.name}`} size="md">
          <div className="p-4 space-y-4">
            {/* Employee info */}
            <div className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Employee</div>
                <div className="font-semibold text-slate-800">{leaveModal.name}</div>
                <div className="text-xs text-slate-400 font-mono">{leaveModal.code}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Absent Days</div>
                <div className="text-xl font-bold text-red-600">{leaveModal.days_absent}</div>
              </div>
            </div>

            {/* Leave Balances */}
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-blue-600 uppercase mb-2">Current Leave Balance</div>
              {balanceLoading ? (
                <div className="text-xs text-slate-400">Loading balances...</div>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-lg font-bold text-blue-700">{leaveBalance.cl_balance ?? leaveBalance.cl ?? '—'}</div>
                    <div className="text-[10px] text-slate-500">CL</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-green-700">{leaveBalance.el_balance ?? leaveBalance.el ?? '—'}</div>
                    <div className="text-[10px] text-slate-500">EL</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-purple-700">{leaveBalance.sl_balance ?? leaveBalance.sl ?? '—'}</div>
                    <div className="text-[10px] text-slate-500">SL</div>
                  </div>
                </div>
              )}
            </div>

            {/* Warning for zero balance */}
            {!balanceLoading && (() => {
              const bal = leaveForm.leave_type === 'CL' ? (leaveBalance.cl_balance ?? leaveBalance.cl ?? 0)
                : leaveForm.leave_type === 'EL' ? (leaveBalance.el_balance ?? leaveBalance.el ?? 0)
                : (leaveBalance.sl_balance ?? leaveBalance.sl ?? 0)
              return bal <= 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">
                  Warning: {leaveForm.leave_type} balance is {bal} — this will create a negative balance (LWP)
                </div>
              ) : null
            })()}

            {/* Leave type selector */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Leave Type</label>
              <select
                value={leaveForm.leave_type}
                onChange={e => setLeaveForm(f => ({ ...f, leave_type: e.target.value }))}
                className="select w-full"
              >
                <option value="CL">CL (Casual Leave)</option>
                <option value="EL">EL (Earned Leave)</option>
                <option value="SL">SL (Sick Leave)</option>
              </select>
            </div>

            {/* Date input */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Date to mark as leave</label>
              <input
                type="date"
                value={leaveForm.date}
                onChange={e => setLeaveForm(f => ({ ...f, date: e.target.value }))}
                className="input w-full"
                min={`${year}-${String(month).padStart(2, '0')}-01`}
                max={`${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`}
              />
            </div>

            {/* Reason */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Reason</label>
              <input
                type="text"
                value={leaveForm.reason}
                onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                className="input w-full"
                placeholder="e.g. Employee applied for CL on this date"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setLeaveModal(null)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={handleSubmitLeaveCorrection}
                disabled={leaveCorrectionMutation.isPending}
                className="btn-primary px-4 py-2 text-sm"
              >
                {leaveCorrectionMutation.isPending ? 'Applying...' : 'Apply Leave'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ─── Drill-Down Content ─────────────────────────────────────────── */

function DrillDownContent({ r, selectedMonth, selectedYear, daysInMonth, lateDeductionMutation }) {
  const hasExtraDuty = (r.extra_duty_days || 0) > 0

  // Parse week breakdown
  let weeks = []
  try {
    weeks = typeof r.week_breakdown === 'string' ? JSON.parse(r.week_breakdown) : (r.week_breakdown || [])
  } catch (e) { weeks = [] }

  const isContractor = r.is_contractor === 1 || r.is_contractor === true
  return (
    <div className="space-y-4">
      {/* Employment type badge + Sunday leniency note */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={clsx('px-2 py-0.5 rounded-full font-medium',
          isContractor ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700')}>
          {isContractor ? '👷 Contractor (daily wage)' : '💼 Permanent'}
        </span>
        {r.sunday_note && (
          <span className="text-slate-500 italic">{r.sunday_note}</span>
        )}
      </div>
      {/* ─── Top Summary Bar ─── */}
      <div className="flex flex-wrap gap-2">
        <DaySummaryBox label="Calendar" value={r.total_calendar_days} color="slate" subtext={`${r.total_sundays} Sun`} />
        <DaySummaryBox label="Working" value={r.total_working_days || (r.total_calendar_days - r.total_sundays - (r.paid_holidays || 0))} color="slate" />
        <DaySummaryBox label="Present" value={r.days_present} color="green" subtext={r.days_half_present > 0 ? `+${r.days_half_present} half` : ''} />
        <DaySummaryBox label="WOP" value={r.days_wop || 0} color="cyan" subtext="Weekly off worked" />
        <DaySummaryBox label="Absent" value={r.days_absent} color="red" />
        <DaySummaryBox label="Paid Sun" value={r.paid_sundays} color="indigo" subtext={r.unpaid_sundays > 0 ? `${r.unpaid_sundays} unpaid` : 'All paid'} />
        <DaySummaryBox label="Holidays" value={r.paid_holidays} color="purple" />
        <DaySummaryBox label="CL Used" value={r.cl_used || 0} color="orange" />
        <DaySummaryBox label="EL Used" value={r.el_used || 0} color="orange" />
        <DaySummaryBox label="LOP" value={r.lop_days || 0} color={r.lop_days > 0 ? 'red' : 'slate'} />
        <DaySummaryBox label="Late" value={r.late_count || 0} color={(r.late_count || 0) >= 5 ? 'red' : 'amber'} subtext={r.late_deduction_days > 0 ? `-${r.late_deduction_days}d ded.` : ''} />
        <DaySummaryBox label="OT Hours" value={(r.ot_hours || 0).toFixed(1)} color="blue" subtext={`${(r.ot_days || 0).toFixed(1)} OT days`} />
        <DaySummaryBox label="Payable" value={r.total_payable_days} color="blue" subtext={`of ${daysInMonth} days`} />
        {hasExtraDuty && (
          <DaySummaryBox label="Extra Duty" value={r.extra_duty_days} color="cyan" subtext={`${r.total_payable_days} > ${daysInMonth}`} />
        )}
        {(r.finance_ed_days || 0) > 0 && (
          <DaySummaryBox
            label="Finance ED"
            value={r.finance_ed_days}
            color="purple"
            subtext="Approved grants"
          />
        )}
        {r.gross_salary > 0 && (
          <DaySummaryBox label="Gross Salary" value={`₹${(r.gross_salary || 0).toLocaleString('en-IN')}`} color="emerald" subtext={`₹${Math.round((r.gross_salary || 0) / 26).toLocaleString('en-IN')}/day`} />
        )}
      </div>

      {/* ─── Extra Duty Alert ─── */}
      {hasExtraDuty && (
        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-lg">
          <p className="text-sm font-semibold text-cyan-800">
            🌟 Extra Duty: {r.extra_duty_days} day(s)
          </p>
          <p className="text-xs text-cyan-600 mt-1">
            This employee has {r.total_payable_days} payable days in a {daysInMonth}-day month.
            The {r.extra_duty_days} extra day(s) are from working on weekly offs (WOP: {r.days_wop || 0} days).
            Extra duty may qualify for additional compensation.
          </p>
        </div>
      )}

      {/* ─── Employee Quick View + Week Breakdown ─── */}
      <EmployeeQuickView
        employeeCode={r.employee_code}
        contextContent={
          <div className="space-y-4">
            {/* Payable Days Formula */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-xs font-semibold text-slate-700 mb-2">📊 Payable Days Calculation:</p>
              <div className="text-xs text-slate-600 font-mono space-y-1">
                <div className="flex justify-between">
                  <span>Full Present Days</span><span className="font-bold text-green-700">{r.days_present}</span>
                </div>
                {(r.days_half_present || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>+ Half Days (×0.5)</span><span>{r.days_half_present}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>+ Paid Sundays</span><span className="text-indigo-600">{r.paid_sundays}</span>
                </div>
                {(r.paid_holidays || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>+ Paid Holidays</span><span className="text-purple-600">{r.paid_holidays}</span>
                  </div>
                )}
                {(r.lop_days || 0) > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>− LOP Days</span><span>{r.lop_days}</span>
                  </div>
                )}
                {(r.late_deduction_days || 0) > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>− Late Deduction</span><span>{r.late_deduction_days}</span>
                  </div>
                )}
                <div className="border-t border-slate-300 pt-1 flex justify-between font-bold text-blue-700">
                  <span>= Total Payable</span><span>{r.total_payable_days} days</span>
                </div>
                {hasExtraDuty && (
                  <div className="flex justify-between font-bold text-cyan-700 mt-1">
                    <span>→ Extra Duty ({r.total_payable_days} − {daysInMonth})</span><span>{r.extra_duty_days} days</span>
                  </div>
                )}
                {(r.finance_ed_days || 0) > 0 && (
                  <div className="flex justify-between font-bold text-purple-700 mt-1">
                    <span>★ Finance ED (approved grants)</span><span>{r.finance_ed_days} day(s)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Week Breakdown */}
            {weeks.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">📅 Week-by-Week Sunday Granting:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {weeks.map((w, i) => (
                    <div key={i} className={clsx(
                      'rounded-lg p-2.5 text-xs border',
                      w.sundayPaid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                    )}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">Week {i + 1}: Sun {w.sundayDate?.slice(5)}</span>
                        <span className={clsx('font-bold text-xs px-1.5 py-0.5 rounded', w.sundayPaid ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800')}>
                          {w.sundayPaid ? '✓ Paid' : '✗ Unpaid'}
                        </span>
                      </div>
                      <div className="flex gap-3 text-slate-600">
                        <span>Worked: <strong>{w.workedDays}/{w.availableDays}</strong></span>
                        {w.clUsed > 0 && <span className="text-orange-600">CL: {w.clUsed}</span>}
                        {w.elUsed > 0 && <span className="text-orange-600">EL: {w.elUsed}</span>}
                        {w.lop > 0 && <span className="text-red-600">LOP: {w.lop}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily Attendance Calendar */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">📆 Daily Attendance Calendar:</p>
              <CalendarView employeeCode={r.employee_code} month={selectedMonth} year={selectedYear} />
            </div>
          </div>
        }
      />

      {/* ─── Late Deduction Panel ─── */}
      {(r.late_count || 0) >= 5 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-semibold text-amber-800 mb-2">
            ⚠ This employee was late {r.late_count} times. Apply late deduction?
          </p>
          <div className="flex items-center gap-3">
            <div>
              <label className="label text-xs">Deduction (days)</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.5"
                defaultValue={r.late_deduction_days || 1}
                id={`late-ded-${r.employee_code}`}
                className="input w-20 text-xs"
              />
            </div>
            <div className="flex-1">
              <label className="label text-xs">Remark</label>
              <input
                type="text"
                defaultValue={r.late_deduction_remark || `Late coming deduction for ${r.late_count} late arrivals`}
                id={`late-remark-${r.employee_code}`}
                className="input text-xs"
                placeholder="Late deduction remark..."
              />
            </div>
            <button
              onClick={() => {
                const days = parseFloat(document.getElementById(`late-ded-${r.employee_code}`).value) || 0
                const remark = document.getElementById(`late-remark-${r.employee_code}`).value
                lateDeductionMutation.mutate({ code: r.employee_code, deductionDays: days, remark })
              }}
              className="btn-primary text-xs mt-5"
            >
              Apply Deduction
            </button>
            {r.late_deduction_days > 0 && (
              <button
                onClick={() => lateDeductionMutation.mutate({ code: r.employee_code, deductionDays: 0, remark: '' })}
                className="btn-secondary text-xs mt-5"
              >
                Remove
              </button>
            )}
          </div>
          {r.late_deduction_remark && (
            <p className="text-xs text-amber-600 mt-1 italic">Current: {r.late_deduction_remark}</p>
          )}
        </div>
      )}
    </div>
  )
}
