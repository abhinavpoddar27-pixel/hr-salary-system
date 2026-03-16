import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSalaryRegister, computeSalary, finaliseSalary } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtINR, fmtINR2, monthYearLabel } from '../utils/formatters'
import clsx from 'clsx'

export default function SalaryComputation() {
  const { selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [showDetails, setShowDetails] = useState(null)

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['salary-register', selectedMonth, selectedYear],
    queryFn: () => getSalaryRegister(selectedMonth, selectedYear),
    retry: 0
  })

  const salaries = res?.data?.data || []

  const computeMutation = useMutation({
    mutationFn: () => computeSalary({ month: selectedMonth, year: selectedYear }),
    onSuccess: (r) => {
      toast.success(`Salary computed for ${r.data.processed} employees`)
      refetch()
    }
  })

  const finaliseMutation = useMutation({
    mutationFn: () => finaliseSalary({ month: selectedMonth, year: selectedYear }),
    onSuccess: () => { toast.success('Salary finalised!'); refetch() }
  })

  const totals = salaries.reduce((acc, s) => ({
    gross: acc.gross + (s.total_earned || 0),
    pf: acc.pf + (s.employee_pf || 0) + (s.employer_pf || 0),
    esi: acc.esi + (s.employee_esi || 0) + (s.employer_esi || 0),
    net: acc.net + (s.net_pay || 0)
  }), { gross: 0, pf: 0, esi: 0, net: 0 })

  return (
    <div>
      <PipelineProgress stageStatus={{ 1:'done', 2:'done', 3:'done', 4:'done', 5:'done', 6:'done', 7:'active' }} />

      <div className="p-6 space-y-4 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Stage 7: Salary Computation</h2>
            <p className="text-sm text-slate-500">{monthYearLabel(selectedMonth, selectedYear)} — Compute, review, and finalise salary for all employees.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => computeMutation.mutate()} disabled={computeMutation.isPending} className="btn-primary">
              {computeMutation.isPending ? '⏳ Computing...' : '▶ Compute Salary'}
            </button>
            {salaries.length > 0 && !salaries[0]?.is_finalised && (
              <button onClick={() => finaliseMutation.mutate()} disabled={finaliseMutation.isPending} className="btn-success">
                🔒 Finalise
              </button>
            )}
          </div>
        </div>

        {/* Totals */}
        {salaries.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Total Gross</div>
              <div className="text-xl font-bold text-slate-800">{fmtINR(totals.gross)}</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Total PF (Both)</div>
              <div className="text-xl font-bold text-blue-600">{fmtINR(totals.pf)}</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Total ESI (Both)</div>
              <div className="text-xl font-bold text-purple-600">{fmtINR(totals.esi)}</div>
            </div>
            <div className="card p-4 text-center border-green-200 bg-green-50">
              <div className="text-xs text-green-600 mb-1">Total Net Salary</div>
              <div className="text-2xl font-bold text-green-700">{fmtINR(totals.net)}</div>
            </div>
          </div>
        )}

        {salaries.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">₹</div>
            <h3 className="font-semibold text-slate-700 mb-2">No salary data</h3>
            <p className="text-slate-500 mb-4">Complete Day Calculation (Stage 6) first, then compute salary.</p>
          </div>
        )}

        {/* Salary Register Table */}
        {salaries.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Dept</th>
                    <th>Days</th>
                    <th>Gross</th>
                    <th>PF (Emp)</th>
                    <th>ESI (Emp)</th>
                    <th>PT</th>
                    <th>LOP Ded.</th>
                    <th>Advance</th>
                    <th>Total Ded.</th>
                    <th className="bg-green-50 text-green-700">Net Salary</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {salaries.map(s => (
                    <React.Fragment key={s.id}>
                      <tr>
                        <td>
                          <div className="font-medium">{s.employee_name || s.employee_code}</div>
                          <div className="text-slate-400">{s.employee_code}</div>
                        </td>
                        <td>{s.department}</td>
                        <td className="text-center">{s.payable_days}</td>
                        <td>{fmtINR(s.total_earned)}</td>
                        <td className="text-blue-600">{fmtINR(s.employee_pf)}</td>
                        <td className="text-purple-600">{fmtINR(s.employee_esi)}</td>
                        <td>{fmtINR(s.professional_tax)}</td>
                        <td className={s.lop_deduction > 0 ? 'text-red-600' : ''}>{fmtINR(s.lop_deduction)}</td>
                        <td>{fmtINR(s.advance_recovery)}</td>
                        <td className="text-red-600">{fmtINR(s.total_deductions)}</td>
                        <td className="bg-green-50 font-bold text-green-700">{fmtINR(s.net_pay)}</td>
                        <td>{s.is_finalised ? <span className="badge-green">🔒 Final</span> : <span className="badge-yellow">Draft</span>}</td>
                        <td>
                          <button onClick={() => setShowDetails(showDetails === s.employee_code ? null : s.employee_code)} className="text-blue-500 hover:underline text-xs">
                            {showDetails === s.employee_code ? '▲' : '▼'}
                          </button>
                        </td>
                      </tr>
                      {showDetails === s.employee_code && (
                        <tr className="bg-slate-50">
                          <td colSpan={13} className="px-4 py-3">
                            <div className="grid grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="font-semibold mb-1 text-slate-600">Earnings</p>
                                <div className="space-y-0.5">
                                  {[['Basic', s.basic_earned], ['DA', s.da_earned], ['HRA', s.hra_earned], ['Conveyance', s.conveyance_earned], ['Other Allow.', s.other_allowances_earned], ['OT Pay', s.ot_pay]].map(([k,v]) => v > 0 && (
                                    <div key={k} className="flex justify-between"><span>{k}</span><span className="font-medium">{fmtINR(v)}</span></div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 text-slate-600">Deductions</p>
                                <div className="space-y-0.5">
                                  {[['PF Employee', s.employee_pf], ['PF Employer', s.employer_pf], ['ESI Employee', s.employee_esi], ['ESI Employer', s.employer_esi], ['Prof. Tax', s.professional_tax], ['TDS', s.tds], ['LOP', s.lop_deduction], ['Advance', s.advance_recovery]].map(([k,v]) => v > 0 && (
                                    <div key={k} className="flex justify-between"><span>{k}</span><span className="font-medium text-red-600">{fmtINR(v)}</span></div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 text-slate-600">Attendance</p>
                                <div className="space-y-0.5">
                                  {[['Present Days', s.days_present], ['Absent Days', s.days_absent], ['Paid Sundays', s.paid_sundays], ['LOP Days', s.lop_days], ['Payable Days', s.total_payable_days]].map(([k,v]) => (
                                    <div key={k} className="flex justify-between"><span>{k}</span><span className="font-medium">{v}</span></div>
                                  ))}
                                </div>
                                <div className="mt-2 text-xs text-slate-500">Bank: {s.bank_account || '—'}</div>
                                <div className="text-xs text-slate-500">IFSC: {s.ifsc || '—'}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={3}>TOTAL ({salaries.length} employees)</td>
                    <td>{fmtINR(totals.gross)}</td>
                    <td colSpan={5} />
                    <td className="text-red-600">{fmtINR(salaries.reduce((s, r) => s + (r.total_deductions || 0), 0))}</td>
                    <td className="bg-green-100 text-green-700">{fmtINR(totals.net)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
