import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSalaryRegister, computeSalary, finaliseSalary, getPayslip, getMonthEndChecklist, getSalaryComparison, getBulkPayslips, downloadSalarySlipExcel } from '../utils/api'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
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
import { downloadPayslipPDF } from '../utils/payslipPdf'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export default function SalaryComputation() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const [showDetails, setShowDetails] = useState(null)
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [payslipEmployee, setPayslipEmployee] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [filterView, setFilterView] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const sortIndicator = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['salary-register', month, year, selectedCompany],
    queryFn: () => getSalaryRegister(month, year, selectedCompany),
    retry: 0
  })

  const allSalaries = res?.data?.data || []

  const salaries = useMemo(() => {
    let filtered = allSalaries
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(s =>
        (s.employee_name || '').toLowerCase().includes(q) ||
        (s.employee_code || '').toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q)
      )
    }
    if (filterDept) filtered = filtered.filter(s => s.department?.toLowerCase().includes(filterDept.toLowerCase()))
    if (filterView === 'held') filtered = filtered.filter(s => s.salary_held)
    if (filterView === 'changed') filtered = filtered.filter(s => s.gross_changed)
    if (filterView === 'active') filtered = filtered.filter(s => !s.salary_held)
    if (filterView === 'returning') filtered = filtered.filter(s => s.was_left_returned)
    return filtered
  }, [allSalaries, filterDept, filterView, searchQuery])

  const [computeResult, setComputeResult] = useState(null)
  const computeMutation = useMutation({
    mutationFn: () => computeSalary({ month: month, year: year, company: selectedCompany }),
    onSuccess: (r) => {
      const d = r.data
      setComputeResult(d)
      if (d.processed > 0) {
        let msg = `Salary computed for ${d.processed} employees`
        if (d.held?.length) msg += ` | ${d.held.length} held`
        toast.success(msg)
      }
      if (d.excluded?.length) {
        toast(`${d.excluded.length} employee(s) skipped — missing salary structure or day calculation`, { icon: '⚠️', duration: 6000 })
      }
      if (d.errors > 0) {
        toast.error(`${d.errors} error(s) during computation`)
      }
      if (d.processed === 0 && !d.excluded?.length && d.errors === 0) {
        toast.error('No employees found. Ensure Day Calculation (Stage 6) is complete.')
      }
      refetch()
    }
  })

  const finaliseMutation = useMutation({
    mutationFn: () => finaliseSalary({ month: month, year: year, company: selectedCompany }),
    onSuccess: () => { toast.success('Salary finalised!'); refetch() }
  })

  const releaseHoldMutation = useMutation({
    mutationFn: (code) => api.put(`/payroll/salary/${code}/hold-release`, { month: month, year: year, company: selectedCompany }),
    onSuccess: () => { toast.success('Salary hold released'); refetch() }
  })

  const { data: payslipRes } = useQuery({
    queryKey: ['payslip', payslipEmployee, month, year],
    queryFn: () => getPayslip(payslipEmployee, month, year),
    enabled: !!payslipEmployee
  })
  const payslip = payslipRes?.data?.data

  // Month-end checklist
  const { data: checklistRes } = useQuery({
    queryKey: ['month-end-checklist', month, year, selectedCompany],
    queryFn: () => getMonthEndChecklist(month, year, selectedCompany),
    retry: 0
  })
  const checklist = checklistRes?.data?.data || []
  const checklistSummary = checklistRes?.data?.summary || {}

  // Salary comparison
  const [showComparison, setShowComparison] = useState(false)
  const { data: comparisonRes, isLoading: comparisonLoading } = useQuery({
    queryKey: ['salary-comparison', month, year, selectedCompany],
    queryFn: () => getSalaryComparison(month, year, selectedCompany),
    enabled: showComparison,
    retry: 0
  })
  const comparisonData = comparisonRes?.data?.data || []
  const comparisonSummary = comparisonRes?.data?.summary || {}

  const [pdfLoading, setPdfLoading] = useState(false)
  const [bulkPdfLoading, setBulkPdfLoading] = useState(false)
  async function handleDownloadPayslip() {
    if (!payslip) return
    setPdfLoading(true)
    try {
      await downloadPayslipPDF(payslip, null)
      toast.success('Payslip PDF downloaded')
    } catch { toast.error('PDF generation failed') }
    finally { setPdfLoading(false) }
  }

  async function handleBulkPDF() {
    setBulkPdfLoading(true)
    try {
      const res = await getBulkPayslips(month, year, selectedCompany)
      const slips = res?.data?.data || []
      if (slips.length === 0) { toast.error('No payslips to download'); return }
      for (const slip of slips) {
        try { await downloadPayslipPDF(slip, null) } catch {}
      }
      toast.success(`${slips.length} payslip PDFs generated`)
    } catch { toast.error('Bulk PDF generation failed') }
    finally { setBulkPdfLoading(false) }
  }

  const [excelLoading, setExcelLoading] = useState(false)
  async function handleExcelSlip() {
    setExcelLoading(true)
    try {
      const res = await downloadSalarySlipExcel(month, year, selectedCompany)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Salary_Slip_${month}_${year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Salary slip Excel downloaded')
    } catch { toast.error('Excel generation failed') }
    finally { setExcelLoading(false) }
  }

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
  const returningCount = allSalaries.filter(s => s.was_left_returned).length

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1:'done', 2:'done', 3:'done', 4:'done', 5:'done', 6:'done', 7:'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 7: Salary Computation</h2>
            <p className="section-subtitle mt-1">{monthYearLabel(month, year)} — Compute, review, and finalise salary.</p>
          </div>
          <div className="flex items-center gap-3">
            <CompanyFilter />
            <DateSelector {...dateProps} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => computeMutation.mutate()} disabled={computeMutation.isPending} className="btn-primary">
              {computeMutation.isPending ? 'Computing...' : 'Compute Salary'}
            </button>
            {allSalaries.length > 0 && !allSalaries[0]?.is_finalised && (
              <button onClick={() => setConfirmAction('finalise')} disabled={finaliseMutation.isPending} className="btn-success">
                {finaliseMutation.isPending ? 'Finalising...' : 'Finalise'}
              </button>
            )}
            {allSalaries.length > 0 && (
              <>
                <button onClick={handleExcelSlip} disabled={excelLoading}
                  className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium">
                  {excelLoading ? 'Generating...' : 'Salary Slip (Excel)'}
                </button>
                <button onClick={handleBulkPDF} disabled={bulkPdfLoading}
                  className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                  {bulkPdfLoading ? 'Generating...' : 'Bulk PDF'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Skipped employees alert */}
        {computeResult?.excluded?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-semibold text-amber-800 text-sm">{computeResult.excluded.length} Employee(s) Skipped</h4>
            <p className="text-xs text-amber-600 mt-1">These employees were excluded from salary computation. Click "Set Salary" to add their salary structure.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {computeResult.excluded.map(e => (
                <a key={e.code} href={`/employees?search=${e.code}`}
                  className="text-xs bg-white border border-amber-300 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 transition-colors">
                  {e.code} {e.name} — {e.reason}
                </a>
              ))}
            </div>
          </div>
        )}

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

        {/* Month-End Checklist */}
        {checklist.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Pre-Finalization Checklist</h3>
              <div className="flex gap-2 text-xs">
                {checklistSummary.warnings > 0 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">{checklistSummary.warnings} warning{checklistSummary.warnings > 1 ? 's' : ''}</span>}
                {checklistSummary.errors > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">{checklistSummary.errors} error{checklistSummary.errors > 1 ? 's' : ''}</span>}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {checklist.map(item => (
                <div key={item.id} className={clsx('px-3 py-2 rounded-lg text-xs', item.status === 'ok' && 'bg-green-50', item.status === 'warning' && 'bg-amber-50', item.status === 'error' && 'bg-red-50')}>
                  <div className="flex items-center gap-2">
                    <span>{item.status === 'ok' ? '✅' : item.status === 'warning' ? '⚠️' : '❌'}</span>
                    <div className="flex-1">
                      <span className="font-medium">{item.label}</span>
                      {item.count > 0 && item.status !== 'ok' && <span className="ml-1 text-slate-500">({item.count})</span>}
                    </div>
                    {item.link && item.status !== 'ok' && (
                      <a href={item.link} className="text-blue-600 hover:underline text-xs shrink-0">Fix</a>
                    )}
                  </div>
                  {item.detail && item.status !== 'ok' && (
                    <div className="mt-1 ml-6 text-[11px] text-slate-500 leading-snug">{item.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Salary Comparison Toggle */}
        {allSalaries.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => setShowComparison(!showComparison)} className={clsx('btn-ghost text-xs px-3 py-1.5 rounded-lg border', showComparison ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200')}>
              {showComparison ? 'Hide Comparison' : 'Month-over-Month Comparison'}
            </button>
          </div>
        )}

        {/* Salary Comparison Panel */}
        {showComparison && (
          <div className="card p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Salary Comparison — Anomalies</h3>
              {comparisonSummary.total > 0 && (
                <div className="flex gap-2 text-xs">
                  {comparisonSummary.new > 0 && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{comparisonSummary.new} new</span>}
                  {comparisonSummary.missing > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full">{comparisonSummary.missing} missing</span>}
                  {comparisonSummary.largeChange > 0 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">{comparisonSummary.largeChange} large change</span>}
                </div>
              )}
            </div>
            {comparisonLoading ? <div className="text-center text-slate-400 py-4">Loading...</div> : comparisonData.length === 0 ? (
              <div className="text-center text-green-600 py-4 text-sm">No anomalies detected — all salaries are within normal range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-compact w-full text-xs">
                  <thead>
                    <tr><th>Employee</th><th>Dept</th><th className="text-right">Prev Net</th><th className="text-right">Curr Net</th><th className="text-right">Change</th><th>Flags</th></tr>
                  </thead>
                  <tbody>
                    {comparisonData.map(c => (
                      <tr key={c.employee_code} className={clsx(
                        c.flags.includes('MISSING') && 'bg-red-50',
                        c.flags.includes('LARGE_CHANGE') && 'bg-amber-50',
                        c.flags.includes('NEW') && 'bg-blue-50'
                      )}>
                        <td><span className="font-medium">{c.employee_name}</span><br/><span className="text-slate-400 font-mono">{c.employee_code}</span></td>
                        <td>{c.department}</td>
                        <td className="text-right font-mono">{c.prev_net ? fmtINR(c.prev_net) : '—'}</td>
                        <td className="text-right font-mono">{fmtINR(c.net_salary)}</td>
                        <td className={clsx('text-right font-mono', c.net_change_pct > 20 && 'text-green-600', c.net_change_pct < -20 && 'text-red-600')}>
                          {c.net_change_pct !== undefined ? `${c.net_change_pct > 0 ? '+' : ''}${c.net_change_pct}%` : '—'}
                        </td>
                        <td>
                          <div className="flex gap-1 flex-wrap">
                            {c.flags.map(f => (
                              <span key={f} className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                                f === 'MISSING' && 'bg-red-100 text-red-700',
                                f === 'LARGE_CHANGE' && 'bg-amber-100 text-amber-700',
                                f === 'NEW' && 'bg-blue-100 text-blue-700',
                                f === 'HELD' && 'bg-amber-100 text-amber-700',
                                f === 'GROSS_CHANGED' && 'bg-purple-100 text-purple-700',
                                f === 'MODERATE_CHANGE' && 'bg-yellow-100 text-yellow-700'
                              )}>{f.replace('_', ' ')}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        {allSalaries.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <input type="text" placeholder="Search name, code, dept..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input w-56 text-sm" />
            </div>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All', count: allSalaries.length },
                { key: 'active', label: 'Active', count: allSalaries.length - heldCount },
                { key: 'held', label: 'Held', count: heldCount },
                { key: 'changed', label: 'Changed', count: changedCount },
                ...(returningCount > 0 ? [{ key: 'returning', label: 'Returning', count: returningCount }] : []),
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
            <CalendarView employeeCode={calendarEmployee.code} month={month} year={year} />
          </div>
        )}

        {/* Excluded/Error employees after compute */}
        {computeResult && (computeResult.excluded?.length > 0 || computeResult.errorDetails?.length > 0) && (
          <div className="card p-4 bg-amber-50 border-amber-200">
            <h4 className="text-sm font-bold text-amber-800 mb-2">
              {computeResult.excluded?.length || 0} employee(s) skipped during salary computation
            </h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(computeResult.excluded || []).map(e => (
                <div key={e.code} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                  <div>
                    <span className="font-mono text-slate-500">{e.code}</span>
                    <span className="ml-2 font-medium text-slate-700">{e.name}</span>
                    <span className="ml-2 text-amber-600">{e.reason}</span>
                  </div>
                  <a href="/employees" className="text-blue-600 hover:underline text-xs shrink-0 ml-2">Set Salary</a>
                </div>
              ))}
              {(computeResult.errorDetails || []).map(e => (
                <div key={e.employeeCode} className="flex items-center text-xs bg-red-50 rounded-lg px-3 py-1.5 border border-red-100">
                  <span className="font-mono text-slate-500">{e.employeeCode}</span>
                  <span className="ml-2 text-red-600">{e.error}</span>
                </div>
              ))}
            </div>
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
              <table className="w-full table-compact text-[11px]">
                <thead>
                  <tr>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('employee_name')}>Emp{sortIndicator('employee_name')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('department')}>Dept{sortIndicator('department')}</th>
                    <th className="cursor-pointer select-none text-center" onClick={() => toggleSort('payable_days')}>Days{sortIndicator('payable_days')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('gross_salary')}>Gross{sortIndicator('gross_salary')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('gross_earned')}>Earned{sortIndicator('gross_earned')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('ot_pay')} title="OT + Extra Duty (WOP days)">OT/ED{sortIndicator('ot_pay')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('pf_employee')}>PF{sortIndicator('pf_employee')}</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('esi_employee')}>ESI{sortIndicator('esi_employee')}</th>
                    <th>Adv</th>
                    <th>Loan</th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('total_deductions')}>Ded{sortIndicator('total_deductions')}</th>
                    <th className="cursor-pointer select-none bg-slate-50 text-slate-600" onClick={() => toggleSort('net_salary')} title="Net = Gross Earned − Deductions (base only, no OT)">Net{sortIndicator('net_salary')}</th>
                    <th className="cursor-pointer select-none bg-emerald-50 text-emerald-700" onClick={() => toggleSort('total_payable')} title="Total Payable = Net + OT (actual take-home)">Take Home{sortIndicator('total_payable')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...salaries].sort((a, b) => {
                    if (!sortCol) return 0;
                    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
                    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
                    return va < vb ? (sortDir === 'asc' ? -1 : 1) : va > vb ? (sortDir === 'asc' ? 1 : -1) : 0;
                  }).map(s => (
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
                            <div>
                              <div className="font-medium text-sm">{s.employee_name || s.employee_code}</div>
                              <div className="text-xs text-slate-400 font-mono">{s.employee_code}</div>
                              {s.gross_changed ? (
                                <div className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 inline-block">
                                  Gross changed: {fmtINR(s.prev_month_gross)} → {fmtINR(s.gross_salary)}
                                </div>
                              ) : null}
                              {s.was_left_returned ? (
                                <div className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 inline-block">
                                  Returning — was previously marked as Left
                                </div>
                              ) : null}
                              {s.salary_held ? (
                                <div className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 inline-block">
                                  Held: {s.hold_reason}
                                </div>
                              ) : null}
                              {s.finance_remark && !s.salary_held ? (
                                <div className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200 inline-block">
                                  {s.finance_remark}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="text-slate-500">
                          {s.department}
                          {s.is_contractor ? <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">CONT</span> : null}
                        </td>
                        <td className="text-center font-mono">
                          {s.payable_days}
                          {(s.ot_days || 0) > 0 && (
                            <div className="text-[9px] text-cyan-600">{s.regular_days || s.payable_days}+{s.ot_days} OT</div>
                          )}
                        </td>
                        <td className="font-mono">{fmtINR(s.gross_salary)}</td>
                        <td className="font-mono">{fmtINR(s.gross_earned)}</td>
                        <td className="font-mono text-cyan-600">
                          {s.ot_pay > 0 ? fmtINR(s.ot_pay) : '—'}
                          {(s.ot_days || 0) > 0 && s.ot_daily_rate > 0 && (
                            <div className="text-[9px] text-slate-400">{s.ot_days}×{fmtINR(s.ot_daily_rate)}</div>
                          )}
                        </td>
                        <td className="text-indigo-600 font-mono">{fmtINR(s.pf_employee)}</td>
                        <td className="text-purple-600 font-mono">{fmtINR(s.esi_employee)}</td>
                        <td className="font-mono">{fmtINR(s.advance_recovery)}</td>
                        <td className="font-mono">{fmtINR(s.loan_recovery)}</td>
                        <td className="text-red-600 font-mono">{fmtINR(s.total_deductions)}</td>
                        <td className="bg-slate-50 text-slate-700 font-mono">{fmtINR(s.net_salary)}</td>
                        <td className="bg-emerald-50 font-bold text-emerald-700 font-mono">{fmtINR(s.total_payable || s.net_salary)}</td>
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
                                    {[['PF (Emp)', s.pf_employee], ['PF (Empr)', s.pf_employer], ['ESI (Emp)', s.esi_employee], ['ESI (Empr)', s.esi_employer], ['TDS', s.tds], ['LOP', s.lop_deduction], ['Advance', s.advance_recovery], ['Loan EMI', s.loan_recovery], ['Other', s.other_deductions]].map(([k,v]) => v > 0 && (
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
                    <td className="font-mono">{fmtINR(salaries.reduce((s, r) => s + (r.gross_salary || 0), 0))}</td>
                    <td className="font-mono">{fmtINR(salaries.reduce((s, r) => s + (r.gross_earned || 0), 0))}</td>
                    <td className="font-mono text-cyan-600">{fmtINR(salaries.reduce((s, r) => s + (r.ot_pay || 0), 0))}</td>
                    <td className="font-mono text-indigo-600">{fmtINR(salaries.reduce((s, r) => s + (r.pf_employee || 0), 0))}</td>
                    <td className="font-mono text-purple-600">{fmtINR(salaries.reduce((s, r) => s + (r.esi_employee || 0), 0))}</td>
                    <td colSpan={2} />
                    <td className="font-mono text-red-600">{fmtINR(salaries.reduce((s, r) => s + (r.total_deductions || 0), 0))}</td>
                    <td className="bg-slate-100 text-slate-700 font-mono">{fmtINR(salaries.filter(s => !s.salary_held).reduce((s, r) => s + (r.net_salary || 0), 0))}</td>
                    <td className="bg-emerald-100 text-emerald-700 font-mono">{fmtINR(salaries.filter(s => !s.salary_held).reduce((s, r) => s + (r.total_payable || r.net_salary || 0), 0))}</td>
                    <td />
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
            <button onClick={handleDownloadPayslip} disabled={pdfLoading} className="btn-primary text-sm">{pdfLoading ? 'Generating...' : 'Download PDF'}</button>
            <button onClick={() => window.print()} className="btn-secondary text-sm">Print</button>
            <button onClick={() => setPayslipEmployee(null)} className="btn-ghost text-sm">Close</button>
          </ModalFooter>
        </Modal>

        <AbbreviationLegend keys={['PF', 'EPF', 'EPS', 'ESI', 'LOP', 'DA', 'HRA', 'OT', 'TDS', 'EMI', 'NEFT', 'IFSC', 'UAN']} />

        {confirmAction === 'finalise' && (
          <ConfirmDialog
            title="Finalise Salary"
            message={`This will finalise salary for ${monthYearLabel(month, year)} (${allSalaries.length} employees). Finalised salaries cannot be recomputed without admin intervention. Are you sure?`}
            confirmText="Yes, Finalise"
            variant="warning"
            onConfirm={() => { setConfirmAction(null); finaliseMutation.mutate() }}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </div>
    </div>
  )
}
