import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSalaryRegister, computeSalary, finaliseSalary, getPayslip } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtINR, monthYearLabel } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal'
import clsx from 'clsx'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import api from '../utils/api'

export default function SalaryComputation() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [showDetails, setShowDetails] = useState(null)
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [payslipEmployee, setPayslipEmployee] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [filterView, setFilterView] = useState('all')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['salary-register', selectedMonth, selectedYear],
    queryFn: () => getSalaryRegister(selectedMonth, selectedYear),
    retry: 0
  })

  const allSalaries = res?.data?.data || []

  const salaries = useMemo(() => {
    let filtered = allSalaries
    if (filterDept) filtered = filtered.filter(s => s.department?.toLowerCase().includes(filterDept.toLowerCase()))
    if (filterView === 'held') filtered = filtered.filter(s => s.salary_held)
    if (filterView === 'changed') filtered = filtered.filter(s => s.gross_changed)
    if (filterView === 'active') filtered = filtered.filter(s => !s.salary_held)
    return filtered
  }, [allSalaries, filterDept, filterView])

  const computeMutation = useMutation({
    mutationFn: () => computeSalary({ month: selectedMonth, year: selectedYear }),
    onSuccess: (r) => {
      const d = r.data
      let msg = `Salary computed for ${d.processed} employees`
      if (d.excluded?.length) msg += ` | ${d.excluded.length} excluded (0 days)`
      if (d.held?.length) msg += ` | ${d.held.length} held`
      toast.success(msg)
      refetch()
    }
  })

  const finaliseMutation = useMutation({
    mutationFn: () => finaliseSalary({ month: selectedMonth, year: selectedYear }),
    onSuccess: () => { toast.success('Salary finalised!'); refetch() }
  })

  const releaseHoldMutation = useMutation({
    mutationFn: (code) => api.put(`/payroll/salary/${code}/hold-release`, { month: selectedMonth, year: selectedYear }),
    onSuccess: () => { toast.success('Salary hold released'); refetch() }
  })

  const { data: payslipRes } = useQuery({
    queryKey: ['payslip', payslipEmployee, selectedMonth, selectedYear],
    queryFn: () => getPayslip(payslipEmployee, selectedMonth, selectedYear),
    enabled: !!payslipEmployee
  })
  const payslip = payslipRes?.data?.data

  const computedTotals = useMemo(() => {
    const active = allSalaries.filter(s => !s.salary_held)
    return {
      gross: allSalaries.reduce((s, r) => s + (r.gross_earned || 0), 0),
      pf: allSalaries.reduce((s, r) => s + (r.pf_employee || 0) + (r.pf_employer || 0), 0),
      esi: allSalaries.reduce((s, r) => s + (r.esi_employee || 0) + (r.esi_employer || 0), 0),
      net: active.reduce((s, r) => s + (r.net_salary || 0), 0),
      heldNet: allSalaries.filter(s => s.salary_held).reduce((s, r) => s + (r.net_salary || 0), 0),
    }
  }, [allSalaries])

  const heldCount = allSalaries.filter(s => s.salary_held).length
  const changedCount = allSalaries.filter(s => s.gross_changed).length

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1:'done', 2:'done', 3:'done', 4:'done', 5:'done', 6:'done', 7:'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 7: Salary Computation</h2>
            <p className="section-subtitle mt-1">{monthYearLabel(selectedMonth, selectedYear)} — Compute, review, and finalise salary.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => computeMutation.mutate()} disabled={computeMutation.isPending} className="btn-primary">
              {computeMutation.isPending ? 'Computing...' : 'Compute Salary'}
            </button>
            {allSalaries.length > 0 && !allSalaries[0]?.is_finalised && (
              <button onClick={() => finaliseMutation.mutate()} disabled={finaliseMutation.isPending} className="btn-success">
                Finalise
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        {allSalaries.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="stat-card border-l-4 border-l-blue-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Gross</span>
              <span className="text-xl font-bold text-slate-800">{fmtINR(computedTotals.gross)}</span>
              <span className="text-xs text-slate-400">{allSalaries.length} employees</span>
            </div>
            <div className="stat-card border-l-4 border-l-indigo-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider"><Abbr code="PF">PF</Abbr> (Both)</span>
              <span className="text-xl font-bold text-indigo-600">{fmtINR(computedTotals.pf)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-purple-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider"><Abbr code="ESI">ESI</Abbr> (Both)</span>
              <span className="text-xl font-bold text-purple-600">{fmtINR(computedTotals.esi)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Bank Transfer</span>
              <span className="text-xl font-bold text-emerald-700">{fmtINR(computedTotals.net)}</span>
              {heldCount > 0 && <span className="text-xs text-amber-600">{heldCount} held ({fmtINR(computedTotals.heldNet)})</span>}
            </div>
            <div className="stat-card border-l-4 border-l-amber-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Flags</span>
              <div className="flex gap-3 mt-1">
                {changedCount > 0 && (
                  <span className="salary-change-flag text-xs px-2 py-1 rounded-lg">{changedCount} changed</span>
                )}
                {heldCount > 0 && (
                  <span className="salary-held-flag text-xs px-2 py-1 rounded-lg">{heldCount} held</span>
                )}
                {!changedCount && !heldCount && <span className="text-sm text-slate-400">None</span>}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        {allSalaries.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="label"><Abbr code="Dept">Dept</Abbr> Filter</label>
              <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
            </div>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All', count: allSalaries.length },
                { key: 'active', label: 'Active', count: allSalaries.length - heldCount },
                { key: 'held', label: 'Held', count: heldCount },
                { key: 'changed', label: 'Changed', count: changedCount },
              ].map(f => (
                <button key={f.key}
                  onClick={() => setFilterView(f.key)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    filterView === f.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Calendar Panel */}
        {calendarEmployee && (
          <div className="card p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">
                Daily Attendance: {calendarEmployee.name} ({calendarEmployee.code})
              </h3>
              <button onClick={() => setCalendarEmployee(null)} className="btn-ghost text-xs">Close</button>
            </div>
            <CalendarView employeeCode={calendarEmployee.code} month={selectedMonth} year={selectedYear} />
          </div>
        )}

        {/* Empty State */}
        {allSalaries.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">₹</div>
            <h3 className="font-semibold text-slate-700 mb-2">No salary data</h3>
            <p className="text-slate-500 mb-4">Complete Day Calculation (Stage 6) first, then compute salary.</p>
          </div>
        )}

        {/* Salary Register Table */}
        {salaries.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header flex items-center justify-between">
              <span className="font-semibold text-slate-700">Salary Register — {salaries.length} records</span>
              {allSalaries[0]?.is_finalised && <span className="badge-green text-xs">Finalised</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th><Abbr code="Emp">Employee</Abbr></th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th>Days</th>
                    <th>Gross</th>
                    <th><Abbr code="PF">PF</Abbr></th>
                    <th><Abbr code="ESI">ESI</Abbr></th>
                    <th><Abbr code="PT">PT</Abbr></th>
                    <th><Abbr code="LOP">LOP</Abbr></th>
                    <th>Adv.</th>
                    <th><Abbr code="EMI">Loan</Abbr></th>
                    <th>Tot.Ded</th>
                    <th className="bg-green-50 text-green-700">Net</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {salaries.map(s => (
                    <React.Fragment key={s.employee_code}>
                      <tr onClick={() => setShowDetails(showDetails === s.employee_code ? null : s.employee_code)} className={clsx(
                        'transition-colors cursor-pointer hover:bg-blue-50/50',
                        showDetails === s.employee_code && 'bg-blue-50/70',
                        s.salary_held && showDetails !== s.employee_code && 'bg-amber-50/50',
                        s.gross_changed && !s.salary_held && showDetails !== s.employee_code && 'bg-blue-50/30'
                      )}>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <DrillDownChevron isExpanded={showDetails === s.employee_code} />
                            {s.gross_changed ? (
                              <span className="salary-change-flag w-5 h-5 flex items-center justify-center rounded text-xs font-bold shrink-0 print-visible" title={`Gross changed: ${fmtINR(s.prev_month_gross)} → ${fmtINR(s.gross_salary)}`}>
                                ◆
                              </span>
                            ) : null}
                            <div>
                              <div className="font-medium text-sm">{s.employee_name || s.employee_code}</div>
                              <div className="text-xs text-slate-400 font-mono">{s.employee_code}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-xs text-slate-600">{s.department}</td>
                        <td className="text-center font-mono">{s.payable_days}</td>
                        <td className="font-mono">{fmtINR(s.gross_earned)}</td>
                        <td className="text-indigo-600 font-mono">{fmtINR(s.pf_employee)}</td>
                        <td className="text-purple-600 font-mono">{fmtINR(s.esi_employee)}</td>
                        <td className="font-mono">{fmtINR(s.professional_tax)}</td>
                        <td className={clsx('font-mono', s.lop_deduction > 0 && 'text-red-600')}>{fmtINR(s.lop_deduction)}</td>
                        <td className="font-mono">{fmtINR(s.advance_recovery)}</td>
                        <td className="font-mono">{fmtINR(s.loan_recovery)}</td>
                        <td className="text-red-600 font-mono">{fmtINR(s.total_deductions)}</td>
                        <td className="bg-green-50 font-bold text-green-700 font-mono">{fmtINR(s.net_salary)}</td>
                        <td>
                          {s.is_finalised ? (
                            <span className="badge-green text-xs">Final</span>
                          ) : s.salary_held ? (
                            <div className="flex items-center gap-1">
                              <span className="salary-held-flag text-xs px-1.5 py-0.5 rounded">Held</span>
                              <button onClick={() => releaseHoldMutation.mutate(s.employee_code)} className="btn-ghost text-xs px-1 text-blue-600">
                                Release
                              </button>
                            </div>
                          ) : (
                            <span className="badge-yellow text-xs">Draft</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setShowDetails(showDetails === s.employee_code ? null : s.employee_code)} className="btn-ghost text-xs px-1 text-blue-600">
                              {showDetails === s.employee_code ? '▲' : '▼'}
                            </button>
                            <button onClick={() => setPayslipEmployee(s.employee_code)} className="btn-ghost text-xs px-1 text-slate-500" title="Payslip">
                              Slip
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setCalendarEmployee({ code: s.employee_code, name: s.employee_name || s.employee_code }); }}
                              className="btn-ghost text-xs px-1 text-blue-600" title="Calendar"
                            >
                              Cal
                            </button>
                          </div>
                        </td>
                      </tr>
                      {showDetails === s.employee_code && (
                        <DrillDownRow colSpan={14}>
                          <EmployeeQuickView
                            employeeCode={s.employee_code}
                            contextContent={
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold mb-1 text-slate-600">Earnings</p>
                                  <div className="space-y-0.5">
                                    {[['Basic', s.basic_earned], ['DA', s.da_earned], ['HRA', s.hra_earned], ['Conv.', s.conveyance_earned], ['Other', s.other_allowances_earned], ['OT', s.ot_pay]].map(([k,v]) => v > 0 && (
                                      <div key={k} className="flex justify-between"><span>{k}</span><span className="font-mono font-medium">{fmtINR(v)}</span></div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="font-semibold mb-1 text-slate-600">Deductions</p>
                                  <div className="space-y-0.5">
                                    {[['PF (Emp)', s.pf_employee], ['PF (Empr)', s.pf_employer], ['ESI (Emp)', s.esi_employee], ['ESI (Empr)', s.esi_employer], ['PT', s.professional_tax], ['TDS', s.tds], ['LOP', s.lop_deduction], ['Advance', s.advance_recovery], ['Loan EMI', s.loan_recovery], ['Other', s.other_deductions]].map(([k,v]) => v > 0 && (
                                      <div key={k} className="flex justify-between"><span>{k}</span><span className="font-mono font-medium text-red-600">{fmtINR(v)}</span></div>
                                    ))}
                                  </div>
                                  {s.gross_changed && (
                                    <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                                      <span className="text-xs text-blue-700 font-semibold">Gross Changed:</span>
                                      <span className="text-xs text-blue-600 ml-1">{fmtINR(s.prev_month_gross)} → {fmtINR(s.gross_salary)}</span>
                                    </div>
                                  )}
                                  {s.salary_held && (
                                    <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                                      <span className="text-xs text-amber-700 font-semibold">Held:</span>
                                      <span className="text-xs text-amber-600 ml-1">{s.hold_reason}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            }
                          />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-xs">
                    <td colSpan={3}>TOTAL ({salaries.length})</td>
                    <td className="font-mono">{fmtINR(salaries.reduce((s, r) => s + (r.gross_earned || 0), 0))}</td>
                    <td className="font-mono text-indigo-600">{fmtINR(salaries.reduce((s, r) => s + (r.pf_employee || 0), 0))}</td>
                    <td className="font-mono text-purple-600">{fmtINR(salaries.reduce((s, r) => s + (r.esi_employee || 0), 0))}</td>
                    <td className="font-mono">{fmtINR(salaries.reduce((s, r) => s + (r.professional_tax || 0), 0))}</td>
                    <td colSpan={3} />
                    <td className="font-mono text-red-600">{fmtINR(salaries.reduce((s, r) => s + (r.total_deductions || 0), 0))}</td>
                    <td className="bg-green-100 text-green-700 font-mono">{fmtINR(salaries.filter(s => !s.salary_held).reduce((s, r) => s + (r.net_salary || 0), 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Payslip Modal */}
        <Modal open={!!payslipEmployee} onClose={() => setPayslipEmployee(null)} title={`Payslip — ${payslip?.employee?.name || payslipEmployee}`} size="lg">
          {payslip && (
            <ModalBody>
              <div className="space-y-4 text-sm">
                <div className="text-center border-b pb-3">
                  <h3 className="font-bold text-lg">{payslip.employee.company || 'Company'}</h3>
                  <p className="text-xs text-slate-500">Salary Slip for {payslip.period.period}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-500">Name:</span> <span className="font-medium">{payslip.employee.name}</span></div>
                  <div><span className="text-slate-500">Code:</span> <span className="font-mono">{payslip.employee.code}</span></div>
                  <div><span className="text-slate-500">Dept:</span> {payslip.employee.department}</div>
                  <div><span className="text-slate-500">Designation:</span> {payslip.employee.designation}</div>
                  <div><span className="text-slate-500"><Abbr code="UAN">UAN</Abbr>:</span> <span className="font-mono">{payslip.employee.uan || '—'}</span></div>
                  <div><span className="text-slate-500">Bank:</span> <span className="font-mono">{payslip.employee.bank_account || '—'}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold text-xs text-slate-500 uppercase mb-2 border-b pb-1">Earnings</h4>
                    {payslip.earnings.map(e => (
                      <div key={e.label} className="flex justify-between py-0.5 text-xs">
                        <span>{e.label}</span><span className="font-mono">{fmtINR(e.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t mt-1 font-bold text-xs">
                      <span>Gross Earned</span><span className="font-mono">{fmtINR(payslip.grossEarned)}</span>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-500 uppercase mb-2 border-b pb-1">Deductions</h4>
                    {payslip.deductions.map(d => (
                      <div key={d.label} className="flex justify-between py-0.5 text-xs">
                        <span>{d.label}</span><span className="font-mono text-red-600">{fmtINR(d.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t mt-1 font-bold text-xs">
                      <span>Total Deductions</span><span className="font-mono text-red-600">{fmtINR(payslip.totalDeductions)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-green-50 p-3 rounded-xl border border-green-200 flex justify-between items-center">
                  <span className="font-bold text-green-800">Net Salary</span>
                  <span className="text-xl font-bold text-green-700 font-mono">{fmtINR(payslip.netSalary)}</span>
                </div>
                {(payslip.grossChanged || payslip.salaryHeld) && (
                  <div className="flex gap-2">
                    {payslip.grossChanged ? <span className="salary-change-flag text-xs px-2 py-1 rounded-lg print-visible">Gross Changed: {fmtINR(payslip.prevMonthGross)} → Current</span> : null}
                    {payslip.salaryHeld ? <span className="salary-held-flag text-xs px-2 py-1 rounded-lg print-visible">Held: {payslip.holdReason}</span> : null}
                  </div>
                )}
                <div className="text-xs text-slate-500 border-t pt-2">
                  Employer PF: {fmtINR(payslip.pfEmployer)} | Employer ESI: {fmtINR(payslip.esiEmployer)}
                </div>
              </div>
            </ModalBody>
          )}
          <ModalFooter>
            <button onClick={() => window.print()} className="btn-primary text-sm">Print</button>
            <button onClick={() => setPayslipEmployee(null)} className="btn-ghost text-sm">Close</button>
          </ModalFooter>
        </Modal>

        <AbbreviationLegend keys={['PF', 'EPF', 'EPS', 'ESI', 'PT', 'LOP', 'DA', 'HRA', 'OT', 'TDS', 'EMI', 'NEFT', 'IFSC', 'UAN']} />
      </div>
    </div>
  )
}
