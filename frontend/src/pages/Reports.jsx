import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getAttendanceSummaryReport, getMissPunchReport, getSalaryRegister,
  getBankTransferSheet, getPFStatement, getESIStatement, getAuditTrail,
  getHeadcountReport, getPFECR, downloadPFECR, getESIContribution,
  downloadESIContribution, getBankSalaryFile, downloadBankSalaryFile,
  getBulkPayslips, getCompanyConfig, getDepartmentPayroll
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import { fmtINR, fmtDate } from '../utils/formatters'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import { downloadBulkPayslipsPDF } from '../utils/payslipPdf'

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Helper: Export table data to CSV
function exportToCSV(data, columns, filename) {
  if (!data || data.length === 0) { toast.error('No data to export'); return }
  const header = columns.map(c => c.label).join(',')
  const rows = data.map(row => columns.map(c => {
    const val = c.accessor ? c.accessor(row) : row[c.key]
    return `"${String(val ?? '').replace(/"/g, '""')}"`
  }).join(','))
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
  toast.success(`Exported ${filename}`)
}

// Report card component
function ReportCard({ title, description, icon, children }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <h3 className="font-semibold text-slate-700">{title}</h3>
            <p className="text-xs text-slate-400">{description}</p>
          </div>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

export default function Reports() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const [activeReport, setActiveReport] = useState('attendance')
  const companyFilter = selectedCompany
  const { toggle, isExpanded, collapseAll } = useExpandableRows()

  // Collapse all expanded rows when switching reports
  useEffect(() => { collapseAll() }, [activeReport, collapseAll])

  // Attendance Summary
  const { data: attRes, isLoading: attLoading } = useQuery({
    queryKey: ['report-attendance', month, year, companyFilter],
    queryFn: () => getAttendanceSummaryReport(month, year, companyFilter),
    enabled: activeReport === 'attendance',
    retry: 0
  })
  const attData = attRes?.data?.data || []

  // Miss Punch Report
  const { data: mpRes, isLoading: mpLoading } = useQuery({
    queryKey: ['report-misspunch', month, year, companyFilter],
    queryFn: () => getMissPunchReport(month, year, companyFilter),
    enabled: activeReport === 'misspunch',
    retry: 0
  })
  const mpData = mpRes?.data?.data || []

  // Salary Register
  const { data: salRes, isLoading: salLoading } = useQuery({
    queryKey: ['salary-register', month, year, companyFilter],
    queryFn: () => getSalaryRegister(month, year, companyFilter),
    enabled: activeReport === 'salary',
    retry: 0
  })
  const salData = salRes?.data?.data || []
  const salTotals = salRes?.data?.totals || {}

  // Bank NEFT
  const { data: bankRes, isLoading: bankLoading } = useQuery({
    queryKey: ['bank-neft', month, year, companyFilter],
    queryFn: () => getBankTransferSheet(month, year, companyFilter),
    enabled: activeReport === 'bank',
    retry: 0
  })
  const bankData = bankRes?.data?.data || []

  // PF Statement
  const { data: pfRes, isLoading: pfLoading } = useQuery({
    queryKey: ['pf-report', month, year, companyFilter],
    queryFn: () => getPFStatement(month, year, companyFilter),
    enabled: activeReport === 'pf',
    retry: 0
  })
  const pfData = pfRes?.data?.data || {}

  // ESI Statement
  const { data: esiRes, isLoading: esiLoading } = useQuery({
    queryKey: ['esi-report', month, year, companyFilter],
    queryFn: () => getESIStatement(month, year, companyFilter),
    enabled: activeReport === 'esi',
    retry: 0
  })
  const esiData = esiRes?.data?.data || {}

  // Audit Trail
  const { data: auditRes, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-trail', month, year, companyFilter],
    queryFn: () => getAuditTrail(month, year, companyFilter),
    enabled: activeReport === 'audit',
    retry: 0
  })
  const auditData = auditRes?.data?.data || []

  // PF ECR
  const { data: ecrRes, isLoading: ecrLoading } = useQuery({
    queryKey: ['pf-ecr', month, year, companyFilter],
    queryFn: () => getPFECR(month, year, companyFilter),
    enabled: activeReport === 'pf-ecr',
    retry: 0
  })
  const ecrData = ecrRes?.data?.data || []
  const ecrTotals = ecrRes?.data?.totals || {}

  // ESI Contribution
  const { data: esiContribRes, isLoading: esiContribLoading } = useQuery({
    queryKey: ['esi-contrib', month, year, companyFilter],
    queryFn: () => getESIContribution(month, year, companyFilter),
    enabled: activeReport === 'esi-contrib',
    retry: 0
  })
  const esiContribData = esiContribRes?.data?.data || []
  const esiContribTotals = esiContribRes?.data?.totals || {}

  // Bank Salary File
  const { data: bankFileRes, isLoading: bankFileLoading } = useQuery({
    queryKey: ['bank-file', month, year, companyFilter],
    queryFn: () => getBankSalaryFile(month, year, companyFilter),
    enabled: activeReport === 'bank-file',
    retry: 0
  })
  const bankFileData = bankFileRes?.data?.data || []
  const bankFileMissing = bankFileRes?.data?.missing || []
  const bankFileTotals = bankFileRes?.data?.totals || {}

  // Department Payroll
  const { data: deptPayrollRes, isLoading: deptPayrollLoading } = useQuery({
    queryKey: ['dept-payroll', month, year, companyFilter],
    queryFn: () => getDepartmentPayroll(month, year, companyFilter),
    enabled: activeReport === 'department-payroll',
    retry: 0
  })
  const deptPayrollData = deptPayrollRes?.data?.data || {}

  const [bulkPdfLoading, setBulkPdfLoading] = useState(false)

  async function handleDownloadFile(downloadFn, month, year, company) {
    try {
      const response = await downloadFn(month, year, company)
      const contentDisposition = response.headers['content-disposition'] || ''
      const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/i)
      const filename = filenameMatch ? filenameMatch[1] : 'export.txt'

      const blob = new Blob([response.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${filename}`)
    } catch (err) {
      toast.error('Download failed')
    }
  }

  async function handleBulkPayslips() {
    setBulkPdfLoading(true)
    try {
      const res = await getBulkPayslips(month, year, companyFilter)
      const payslips = res.data?.data || []
      const companyConf = res.data?.companyConfig || null
      if (payslips.length === 0) { toast.error('No payslips to generate'); return }
      await downloadBulkPayslipsPDF(payslips, companyConf, month, year)
      toast.success(`Generated ${payslips.length} payslips`)
    } catch (err) {
      toast.error('Failed to generate payslips')
    } finally {
      setBulkPdfLoading(false)
    }
  }

  const REPORTS = [
    { id: 'attendance', label: 'Attendance Summary', desc: 'Per-employee present/absent/LOP summary' },
    { id: 'misspunch', label: 'Miss Punch', desc: 'All miss punch cases and resolutions' },
    { id: 'salary', label: 'Salary Register', desc: 'Full salary register with all components' },
    { id: 'bank', label: 'Bank NEFT', desc: 'Bank transfer sheet for net pay' },
    { id: 'pf', label: 'PF Statement', desc: 'Provident Fund challan data' },
    { id: 'esi', label: 'ESI Statement', desc: 'ESI challan data' },
    { id: 'pf-ecr', label: 'PF ECR File', desc: 'EPFO Electronic Challan Return format' },
    { id: 'esi-contrib', label: 'ESI Contribution File', desc: 'ESIC portal upload format' },
    { id: 'bank-file', label: 'Bank Salary File', desc: 'PNB bulk salary upload CSV' },
    { id: 'payslips', label: 'Payslips (Bulk PDF)', desc: 'Download all employee payslips' },
    { id: 'audit', label: 'Audit Trail', desc: 'All field-level changes with before/after' },
    { id: 'department-payroll', label: 'Department Payroll', desc: 'Dept-wise payroll cost centre' },
  ]

  const monthLabel = `${MONTH_NAMES[month]}_${year}`

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <CompanyFilter />
        <DateSelector {...dateProps} />
      </div>
      <div className="flex gap-6 mt-4">
        {/* Left: report list */}
        <div className="w-60 flex-shrink-0">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-3">Reports</h2>
          <div className="space-y-1">
            {REPORTS.map(r => (
              <button
                key={r.id}
                onClick={() => setActiveReport(r.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeReport === r.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div>{r.label}</div>
                <div className="text-xs text-slate-400 mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: report content */}
        <div className="flex-1 space-y-4">
          {/* Attendance Summary */}
          {activeReport === 'attendance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Attendance Summary — {MONTH_NAMES[month]} {year}</h3>
                <button
                  onClick={() => exportToCSV(attData, [
                    { key: 'employee_code', label: 'Code' },
                    { key: 'employee_name', label: 'Name' },
                    { key: 'department', label: 'Department' },
                    { key: 'present_days', label: 'Present' },
                    { key: 'absent_days', label: 'Absent' },
                    { key: 'half_days', label: 'Half Days' },
                    { key: 'wo_days', label: 'WO' },
                    { key: 'paid_sundays', label: 'Paid Sundays' },
                    { key: 'total_payable', label: 'Payable Days' },
                    { key: 'lop_days', label: 'LOP' },
                  ], `attendance_${monthLabel}.csv`)}
                  className="btn-secondary text-sm"
                >
                  ⬇ Export CSV
                </button>
              </div>
              {attLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Department</th>
                          <th className="text-center">Present</th>
                          <th className="text-center">Absent</th>
                          <th className="text-center">½ Day</th>
                          <th className="text-center">WO</th>
                          <th className="text-center">WOP</th>
                          <th className="text-center">Paid Sun</th>
                          <th className="text-center">LOP</th>
                          <th className="text-center font-bold">Payable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attData.length === 0 ? (
                          <tr><td colSpan={11} className="text-center py-6 text-slate-400">No data. Run payroll pipeline first.</td></tr>
                        ) : attData.map((e, i) => (
                          <React.Fragment key={e.employee_code || i}>
                            <tr onClick={() => toggle(e.employee_code)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(e.employee_code) ? 'bg-blue-50' : ''}`}>
                              <td className="text-slate-500"><DrillDownChevron isExpanded={isExpanded(e.employee_code)} /> {e.employee_code}</td>
                              <td className="font-medium">{e.employee_name}</td>
                              <td>{e.department}</td>
                              <td className="text-center text-green-700">{e.present_days}</td>
                              <td className="text-center text-red-600">{e.absent_days}</td>
                              <td className="text-center">{e.half_days}</td>
                              <td className="text-center text-slate-400">{e.wo_days}</td>
                              <td className="text-center text-green-600">{e.wop_days}</td>
                              <td className="text-center text-blue-600">{e.paid_sundays}</td>
                              <td className="text-center text-red-500">{e.lop_days > 0 ? e.lop_days : '—'}</td>
                              <td className="text-center font-bold text-brand-700">{e.total_payable}</td>
                            </tr>
                            {isExpanded(e.employee_code) && (
                              <DrillDownRow colSpan={11}>
                                <EmployeeQuickView
                                  employeeCode={e.employee_code}
                                  contextContent={
                                    <div>
                                      <div className="text-xs font-semibold text-slate-500 mb-2">Attendance Breakdown</div>
                                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                                        <div className="bg-green-50 rounded-lg px-3 py-2"><span className="text-slate-500">Present:</span> <strong className="text-green-700">{e.present_days}</strong></div>
                                        <div className="bg-red-50 rounded-lg px-3 py-2"><span className="text-slate-500">Absent:</span> <strong className="text-red-600">{e.absent_days}</strong></div>
                                        <div className="bg-amber-50 rounded-lg px-3 py-2"><span className="text-slate-500">Half Days:</span> <strong className="text-amber-700">{e.half_days}</strong></div>
                                        <div className="bg-slate-50 rounded-lg px-3 py-2"><span className="text-slate-500">Weekly Off:</span> <strong className="text-slate-600">{e.wo_days}</strong></div>
                                        <div className="bg-green-50 rounded-lg px-3 py-2"><span className="text-slate-500">WO Present:</span> <strong className="text-green-600">{e.wop_days}</strong></div>
                                        <div className="bg-blue-50 rounded-lg px-3 py-2"><span className="text-slate-500">Paid Sundays:</span> <strong className="text-blue-600">{e.paid_sundays}</strong></div>
                                        <div className="bg-red-50 rounded-lg px-3 py-2"><span className="text-slate-500">LOP:</span> <strong className="text-red-500">{e.lop_days || 0}</strong></div>
                                        <div className="bg-brand-50 rounded-lg px-3 py-2"><span className="text-slate-500">Payable:</span> <strong className="text-brand-700">{e.total_payable}</strong></div>
                                      </div>
                                    </div>
                                  }
                                />
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Miss Punch Report */}
          {activeReport === 'misspunch' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Miss Punch Report — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(mpData, [
                  { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Name' },
                  { key: 'date', label: 'Date' }, { key: 'miss_punch_type', label: 'Issue' },
                  { key: 'in_time_original', label: 'IN (Original)' }, { key: 'out_time_original', label: 'OUT (Original)' },
                  { key: 'in_time_final', label: 'IN (Final)' }, { key: 'out_time_final', label: 'OUT (Final)' },
                  { key: 'miss_punch_resolved', label: 'Resolved' }, { key: 'correction_remark', label: 'Remark' }
                ], `miss_punch_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              {mpLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Date</th>
                          <th>Issue Type</th>
                          <th>IN (Orig)</th>
                          <th>OUT (Orig)</th>
                          <th>IN (Final)</th>
                          <th>OUT (Final)</th>
                          <th>Resolved</th>
                          <th>Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mpData.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-6 text-slate-400">No miss punch data</td></tr>
                        ) : mpData.map((r, i) => {
                          const mpKey = r.employee_code + '_' + r.date
                          return (
                            <React.Fragment key={mpKey + '_' + i}>
                              <tr onClick={() => toggle(mpKey)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(mpKey) ? 'bg-blue-50' : ''}`}>
                                <td>
                                  <DrillDownChevron isExpanded={isExpanded(mpKey)} />
                                  <div className="inline-block ml-1">
                                    <div className="font-medium">{r.employee_name}</div>
                                    <div className="text-xs text-slate-400">{r.employee_code}</div>
                                  </div>
                                </td>
                                <td>{fmtDate(r.date)}</td>
                                <td><span className="badge badge-absent text-xs">{r.miss_punch_type}</span></td>
                                <td className="text-slate-400">{r.in_time_original || '—'}</td>
                                <td className="text-slate-400">{r.out_time_original || '—'}</td>
                                <td className={r.in_time_final ? 'text-green-700 font-medium' : ''}>{r.in_time_final || '—'}</td>
                                <td className={r.out_time_final ? 'text-green-700 font-medium' : ''}>{r.out_time_final || '—'}</td>
                                <td className="text-center">{r.miss_punch_resolved ? <span className="text-green-600">✓</span> : <span className="text-amber-500">⏳</span>}</td>
                                <td className="text-xs text-slate-500">{r.correction_remark || '—'}</td>
                              </tr>
                              {isExpanded(mpKey) && (
                                <DrillDownRow colSpan={9}>
                                  <EmployeeQuickView
                                    employeeCode={r.employee_code}
                                    contextContent={
                                      <div>
                                        <div className="text-xs font-semibold text-slate-500 mb-2">Miss Punch Resolution Details</div>
                                        <div className="bg-white rounded-lg border border-slate-100 p-3 space-y-2 text-xs">
                                          <div className="flex justify-between"><span className="text-slate-500">Date:</span> <strong>{fmtDate(r.date)}</strong></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Issue Type:</span> <span className="badge badge-absent text-xs">{r.miss_punch_type}</span></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Original IN:</span> <span className="text-slate-600">{r.in_time_original || '—'}</span></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Original OUT:</span> <span className="text-slate-600">{r.out_time_original || '—'}</span></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Final IN:</span> <span className="text-green-700 font-medium">{r.in_time_final || '—'}</span></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Final OUT:</span> <span className="text-green-700 font-medium">{r.out_time_final || '—'}</span></div>
                                          <div className="flex justify-between"><span className="text-slate-500">Resolved:</span> {r.miss_punch_resolved ? <span className="text-green-600 font-medium">Yes</span> : <span className="text-amber-500 font-medium">Pending</span>}</div>
                                          {r.correction_remark && <div className="pt-1 border-t border-slate-100"><span className="text-slate-500">Remark:</span> <span className="text-slate-700">{r.correction_remark}</span></div>}
                                        </div>
                                      </div>
                                    }
                                  />
                                </DrillDownRow>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Salary Register */}
          {activeReport === 'salary' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Salary Register — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(salData, [
                  { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Name' },
                  { key: 'department', label: 'Dept' }, { key: 'gross_salary', label: 'Gross' },
                  { key: 'basic', label: 'Basic' }, { key: 'hra', label: 'HRA' },
                  { key: 'payable_days', label: 'Payable Days' }, { key: 'earned_basic', label: 'Earned Basic' },
                  { key: 'earned_hra', label: 'Earned HRA' }, { key: 'total_earned', label: 'Total Earned' },
                  { key: 'employee_pf', label: 'EE PF' }, { key: 'employee_esi', label: 'EE ESI' },
                  { key: 'professional_tax', label: 'PT' }, { key: 'total_deductions', label: 'Total Ded.' },
                  { key: 'net_pay', label: 'Net Pay' }
                ], `salary_register_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              {/* Totals */}
              {Object.keys(salTotals).length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="card p-3 text-center"><div className="text-lg font-bold text-slate-700">{fmtINR(salTotals.totalGross || 0)}</div><div className="text-xs text-slate-500">Gross Payroll</div></div>
                  <div className="card p-3 text-center"><div className="text-lg font-bold text-red-600">{fmtINR(salTotals.totalDeductions || 0)}</div><div className="text-xs text-slate-500">Total Deductions</div></div>
                  <div className="card p-3 text-center bg-green-50"><div className="text-lg font-bold text-green-700">{fmtINR(salTotals.totalNet || 0)}</div><div className="text-xs text-slate-500 font-medium">Net Payroll</div></div>
                  <div className="card p-3 text-center"><div className="text-lg font-bold text-blue-600">{fmtINR(salTotals.totalPFLiability || 0)}</div><div className="text-xs text-slate-500">PF Liability</div></div>
                </div>
              )}
              {salLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full text-xs">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Dept</th>
                          <th className="text-center">Days</th>
                          <th className="text-right">Gross</th>
                          <th className="text-right">Earned</th>
                          <th className="text-right">EE PF</th>
                          <th className="text-right">EE ESI</th>
                          <th className="text-right">PT</th>
                          <th className="text-right">Ded.</th>
                          <th className="text-right font-bold text-brand-700">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salData.length === 0 ? (
                          <tr><td colSpan={11} className="text-center py-6 text-slate-400">Run salary computation first</td></tr>
                        ) : salData.map((e, i) => (
                          <React.Fragment key={e.employee_code || i}>
                            <tr onClick={() => toggle(e.employee_code)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(e.employee_code) ? 'bg-blue-50' : ''}`}>
                              <td><DrillDownChevron isExpanded={isExpanded(e.employee_code)} /> {e.employee_code}</td>
                              <td className="font-medium">{e.employee_name}</td>
                              <td>{e.department}</td>
                              <td className="text-center">{e.payable_days}</td>
                              <td className="text-right">{fmtINR(e.gross_salary)}</td>
                              <td className="text-right">{fmtINR(e.total_earned)}</td>
                              <td className="text-right text-blue-600">{fmtINR(e.employee_pf)}</td>
                              <td className="text-right text-purple-600">{fmtINR(e.employee_esi)}</td>
                              <td className="text-right">{fmtINR(e.professional_tax)}</td>
                              <td className="text-right text-red-600">{fmtINR(e.total_deductions)}</td>
                              <td className="text-right font-bold text-green-700">{fmtINR(e.net_pay)}</td>
                            </tr>
                            {isExpanded(e.employee_code) && (
                              <DrillDownRow colSpan={11}>
                                <EmployeeQuickView employeeCode={e.employee_code} showPayslip={true} />
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bank NEFT */}
          {activeReport === 'bank' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Bank Transfer Sheet — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(bankData, [
                  { key: 'employee_code', label: 'Emp Code' }, { key: 'employee_name', label: 'Name' },
                  { key: 'account_number', label: 'Account No.' }, { key: 'bank_name', label: 'Bank' },
                  { key: 'ifsc_code', label: 'IFSC' }, { key: 'net_pay', label: 'Amount' }
                ], `bank_neft_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              <div className="card p-3 bg-blue-50 border border-blue-200 text-sm text-blue-800">
                Total Net Payable: <strong>{fmtINR(bankData.reduce((s, e) => s + (parseFloat(e.net_pay) || 0), 0))}</strong> ({bankData.length} employees)
              </div>
              {bankLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full">
                      <thead>
                        <tr>
                          <th>Sr.</th>
                          <th>Employee</th>
                          <th>Account Number</th>
                          <th>Bank</th>
                          <th>IFSC</th>
                          <th className="text-right">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankData.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-6 text-slate-400">Run salary computation first</td></tr>
                        ) : bankData.map((e, i) => (
                          <React.Fragment key={e.employee_code || i}>
                            <tr onClick={() => toggle(e.employee_code)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(e.employee_code) ? 'bg-blue-50' : ''}`}>
                              <td className="text-slate-400"><DrillDownChevron isExpanded={isExpanded(e.employee_code)} /> {i + 1}</td>
                              <td>
                                <div className="font-medium">{e.employee_name}</div>
                                <div className="text-xs text-slate-400">{e.employee_code}</div>
                              </td>
                              <td className="font-mono">{e.account_number || <span className="text-red-400">Not Set</span>}</td>
                              <td>{e.bank_name || '—'}</td>
                              <td className="font-mono text-xs">{e.ifsc_code || '—'}</td>
                              <td className="text-right font-bold text-green-700">{fmtINR(e.net_pay)}</td>
                            </tr>
                            {isExpanded(e.employee_code) && (
                              <DrillDownRow colSpan={6}>
                                <EmployeeQuickView
                                  employeeCode={e.employee_code}
                                  contextContent={
                                    <div>
                                      <div className="text-xs font-semibold text-slate-500 mb-2">Bank Transfer Details</div>
                                      <div className="bg-white rounded-lg border border-slate-100 p-3 space-y-2 text-xs">
                                        <div className="flex justify-between"><span className="text-slate-500">Account No.:</span> <strong className="font-mono">{e.account_number || 'Not Set'}</strong></div>
                                        <div className="flex justify-between"><span className="text-slate-500">Bank:</span> <strong>{e.bank_name || '—'}</strong></div>
                                        <div className="flex justify-between"><span className="text-slate-500">IFSC:</span> <strong className="font-mono">{e.ifsc_code || '—'}</strong></div>
                                        <div className="flex justify-between pt-2 border-t border-slate-100"><span className="text-slate-500">Net Pay:</span> <strong className="text-green-700">{fmtINR(e.net_pay)}</strong></div>
                                      </div>
                                    </div>
                                  }
                                />
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PF Report */}
          {activeReport === 'pf' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">PF Statement — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(pfData.employees || [], [
                  { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Name' },
                  { key: 'uan', label: 'UAN' }, { key: 'pf_wages', label: 'PF Wages' },
                  { key: 'employee_pf', label: 'EE PF (12%)' }, { key: 'employer_pf', label: 'ER PF (3.67%)' },
                  { key: 'eps', label: 'EPS (8.33%)' }
                ], `pf_statement_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="card p-3 text-center"><div className="font-bold text-blue-600">{fmtINR(pfData.totals?.employeePF || 0)}</div><div className="text-xs text-slate-500">EE PF</div></div>
                <div className="card p-3 text-center"><div className="font-bold text-green-600">{fmtINR(pfData.totals?.employerPF || 0)}</div><div className="text-xs text-slate-500">ER PF</div></div>
                <div className="card p-3 text-center"><div className="font-bold text-purple-600">{fmtINR(pfData.totals?.eps || 0)}</div><div className="text-xs text-slate-500">EPS</div></div>
                <div className="card p-3 text-center bg-blue-50"><div className="font-bold text-blue-700">{fmtINR(pfData.totals?.total || 0)}</div><div className="text-xs text-slate-600 font-semibold">Total</div></div>
              </div>
              {pfLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full">
                      <thead>
                        <tr>
                          <th>Code</th><th>Name</th><th>UAN</th>
                          <th className="text-right">PF Wages</th>
                          <th className="text-right">EE PF</th>
                          <th className="text-right">ER PF</th>
                          <th className="text-right">EPS</th>
                          <th className="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pfData.employees || []).map((e, i) => (
                          <React.Fragment key={e.employee_code || i}>
                            <tr onClick={() => toggle(e.employee_code)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(e.employee_code) ? 'bg-blue-50' : ''}`}>
                              <td><DrillDownChevron isExpanded={isExpanded(e.employee_code)} /> {e.employee_code}</td>
                              <td className="font-medium">{e.employee_name}</td>
                              <td className="text-slate-400">{e.uan || '—'}</td>
                              <td className="text-right">{fmtINR(e.pf_wages)}</td>
                              <td className="text-right">{fmtINR(e.employee_pf)}</td>
                              <td className="text-right">{fmtINR(e.employer_pf)}</td>
                              <td className="text-right">{fmtINR(e.eps)}</td>
                              <td className="text-right font-semibold">{fmtINR((e.employee_pf || 0) + (e.employer_pf || 0) + (e.eps || 0))}</td>
                            </tr>
                            {isExpanded(e.employee_code) && (
                              <DrillDownRow colSpan={8}>
                                <EmployeeQuickView
                                  employeeCode={e.employee_code}
                                  extraInfo={{
                                    'UAN': e.uan || '—',
                                    'PF Wages': fmtINR(e.pf_wages),
                                    'EE PF (12%)': fmtINR(e.employee_pf),
                                    'ER PF (3.67%)': fmtINR(e.employer_pf),
                                    'EPS (8.33%)': fmtINR(e.eps),
                                    'Total PF': fmtINR((e.employee_pf || 0) + (e.employer_pf || 0) + (e.eps || 0)),
                                  }}
                                />
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESI Report */}
          {activeReport === 'esi' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">ESI Statement — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(esiData.employees || [], [
                  { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Name' },
                  { key: 'esi_number', label: 'ESI No.' }, { key: 'esi_wages', label: 'ESI Wages' },
                  { key: 'employee_esi', label: 'EE ESI (0.75%)' }, { key: 'employer_esi', label: 'ER ESI (3.25%)' }
                ], `esi_statement_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3 text-center"><div className="font-bold text-blue-600">{fmtINR(esiData.totals?.employeeESI || 0)}</div><div className="text-xs text-slate-500">EE ESI</div></div>
                <div className="card p-3 text-center"><div className="font-bold text-green-600">{fmtINR(esiData.totals?.employerESI || 0)}</div><div className="text-xs text-slate-500">ER ESI</div></div>
                <div className="card p-3 text-center bg-purple-50"><div className="font-bold text-purple-700">{fmtINR(esiData.totals?.total || 0)}</div><div className="text-xs text-slate-600 font-semibold">Total</div></div>
              </div>
              {esiLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full">
                      <thead>
                        <tr>
                          <th>Code</th><th>Name</th><th>ESI No.</th>
                          <th className="text-right">ESI Wages</th>
                          <th className="text-right">EE ESI</th>
                          <th className="text-right">ER ESI</th>
                          <th className="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(esiData.employees || []).map((e, i) => (
                          <React.Fragment key={e.employee_code || i}>
                            <tr onClick={() => toggle(e.employee_code)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(e.employee_code) ? 'bg-blue-50' : ''}`}>
                              <td><DrillDownChevron isExpanded={isExpanded(e.employee_code)} /> {e.employee_code}</td>
                              <td className="font-medium">{e.employee_name}</td>
                              <td className="text-slate-400">{e.esi_number || '—'}</td>
                              <td className="text-right">{fmtINR(e.esi_wages)}</td>
                              <td className="text-right">{fmtINR(e.employee_esi)}</td>
                              <td className="text-right">{fmtINR(e.employer_esi)}</td>
                              <td className="text-right font-semibold">{fmtINR((e.employee_esi || 0) + (e.employer_esi || 0))}</td>
                            </tr>
                            {isExpanded(e.employee_code) && (
                              <DrillDownRow colSpan={7}>
                                <EmployeeQuickView
                                  employeeCode={e.employee_code}
                                  extraInfo={{
                                    'ESI No.': e.esi_number || '—',
                                    'ESI Wages': fmtINR(e.esi_wages),
                                    'EE ESI (0.75%)': fmtINR(e.employee_esi),
                                    'ER ESI (3.25%)': fmtINR(e.employer_esi),
                                    'Total ESI': fmtINR((e.employee_esi || 0) + (e.employer_esi || 0)),
                                  }}
                                />
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PF ECR File */}
          {activeReport === 'pf-ecr' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">PF ECR File — {MONTH_NAMES[month]} {year}</h3>
                <button
                  onClick={() => handleDownloadFile(downloadPFECR, month, year, companyFilter)}
                  className="btn-primary text-sm"
                >
                  Download ECR (.txt)
                </button>
              </div>
              {ecrData.length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="card p-3 text-center"><div className="font-bold text-slate-700">{ecrTotals.count}</div><div className="text-xs text-slate-500">Employees</div></div>
                  <div className="card p-3 text-center"><div className="font-bold text-blue-600">{fmtINR(ecrTotals.totalEEPF)}</div><div className="text-xs text-slate-500">EE PF</div></div>
                  <div className="card p-3 text-center"><div className="font-bold text-green-600">{fmtINR(ecrTotals.totalEPS)}</div><div className="text-xs text-slate-500">EPS</div></div>
                  <div className="card p-3 text-center"><div className="font-bold text-purple-600">{fmtINR(ecrTotals.totalERPF)}</div><div className="text-xs text-slate-500">ER PF Diff</div></div>
                </div>
              )}
              {ecrLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full text-xs">
                      <thead>
                        <tr><th>UAN</th><th>Name</th><th className="text-right">Gross</th><th className="text-right">EPF Wages</th><th className="text-right">EE PF</th><th className="text-right">EPS</th><th className="text-right">ER Diff</th><th className="text-center">NCP Days</th></tr>
                      </thead>
                      <tbody>
                        {ecrData.length === 0 ? (
                          <tr><td colSpan={8} className="text-center py-6 text-slate-400">No PF data. Run salary computation first.</td></tr>
                        ) : ecrData.map((e, i) => (
                          <tr key={e.employee_code || i}>
                            <td className="font-mono text-xs">{e.uan || <span className="text-red-400">Missing</span>}</td>
                            <td className="font-medium">{e.employee_name}</td>
                            <td className="text-right">{fmtINR(e.gross_earned)}</td>
                            <td className="text-right">{fmtINR(e.pf_wages)}</td>
                            <td className="text-right text-blue-600">{fmtINR(e.pf_employee)}</td>
                            <td className="text-right text-green-600">{fmtINR(e.eps)}</td>
                            <td className="text-right text-purple-600">{fmtINR((e.pf_employer || 0) - (e.eps || 0))}</td>
                            <td className="text-center">{Math.max(0, Math.round((e.total_calendar_days || 30) - (e.total_sundays || 0) - (e.total_holidays || 0) - (e.payable_days || 0)))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESI Contribution File */}
          {activeReport === 'esi-contrib' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">ESI Contribution File — {MONTH_NAMES[month]} {year}</h3>
                <button
                  onClick={() => handleDownloadFile(downloadESIContribution, month, year, companyFilter)}
                  className="btn-primary text-sm"
                >
                  Download ESI File (.txt)
                </button>
              </div>
              {esiContribData.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="card p-3 text-center"><div className="font-bold text-slate-700">{esiContribTotals.count}</div><div className="text-xs text-slate-500">Employees</div></div>
                  <div className="card p-3 text-center"><div className="font-bold text-blue-600">{fmtINR(esiContribTotals.totalEEESI)}</div><div className="text-xs text-slate-500">IP Contribution</div></div>
                  <div className="card p-3 text-center"><div className="font-bold text-green-600">{fmtINR(esiContribTotals.totalERESI)}</div><div className="text-xs text-slate-500">ER Contribution</div></div>
                </div>
              )}
              {esiContribLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full text-xs">
                      <thead>
                        <tr><th>IP Number</th><th>Name</th><th className="text-center">Days</th><th className="text-right">Total Wages</th><th className="text-right">IP Contribution</th><th className="text-center">Reason</th></tr>
                      </thead>
                      <tbody>
                        {esiContribData.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-6 text-slate-400">No ESI data</td></tr>
                        ) : esiContribData.map((e, i) => (
                          <tr key={e.employee_code || i}>
                            <td className="font-mono text-xs">{e.esi_number || <span className="text-red-400">Missing</span>}</td>
                            <td className="font-medium">{e.employee_name}</td>
                            <td className="text-center">{Math.round(e.payable_days || 0)}</td>
                            <td className="text-right">{fmtINR(e.esi_wages)}</td>
                            <td className="text-right text-blue-600">{fmtINR(e.esi_employee)}</td>
                            <td className="text-center">{e.date_of_joining && new Date(e.date_of_joining) >= new Date(year, month - 1, 1) ? '1' : '0'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bank Salary File */}
          {activeReport === 'bank-file' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Bank Salary Upload File — {MONTH_NAMES[month]} {year}</h3>
                <button
                  onClick={() => handleDownloadFile(downloadBankSalaryFile, month, year, companyFilter)}
                  className="btn-primary text-sm"
                >
                  Download Bank File (.csv)
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3 text-center"><div className="font-bold text-green-700">{fmtINR(bankFileTotals.totalAmount || 0)}</div><div className="text-xs text-slate-500">Total Transfer Amount</div></div>
                <div className="card p-3 text-center"><div className="font-bold text-slate-700">{bankFileTotals.count || 0}</div><div className="text-xs text-slate-500">Employees</div></div>
                {bankFileTotals.missingCount > 0 && (
                  <div className="card p-3 text-center bg-red-50 border-red-200"><div className="font-bold text-red-600">{bankFileTotals.missingCount}</div><div className="text-xs text-red-500">Missing Bank Details</div></div>
                )}
              </div>
              {bankFileMissing.length > 0 && (
                <div className="card p-4 bg-amber-50 border-amber-200">
                  <h4 className="text-sm font-semibold text-amber-800 mb-2">Employees with Missing Bank Details</h4>
                  <div className="space-y-1">
                    {bankFileMissing.map(m => (
                      <div key={m.employee_code} className="text-xs text-amber-700">
                        <span className="font-mono">{m.employee_code}</span> — {m.employee_name} ({m.department}) — Net: {fmtINR(m.net_salary)}
                        {m.missing_account && <span className="ml-1 badge badge-red text-xs">No Account</span>}
                        {m.missing_ifsc && <span className="ml-1 badge badge-red text-xs">No IFSC</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {bankFileLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full text-xs">
                      <thead>
                        <tr><th>Sr</th><th>Name</th><th>Account Number</th><th>IFSC</th><th className="text-right">Amount</th></tr>
                      </thead>
                      <tbody>
                        {bankFileData.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-6 text-slate-400">No data</td></tr>
                        ) : bankFileData.map((e, i) => (
                          <tr key={e.employee_code || i}>
                            <td>{i + 1}</td>
                            <td className="font-medium">{e.employee_name}</td>
                            <td className="font-mono">{e.account_number}</td>
                            <td className="font-mono text-xs">{e.ifsc_code}</td>
                            <td className="text-right font-bold text-green-700">{fmtINR(e.net_salary)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bulk Payslips */}
          {activeReport === 'payslips' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Payslips — {MONTH_NAMES[month]} {year}</h3>
                <button
                  onClick={handleBulkPayslips}
                  disabled={bulkPdfLoading}
                  className="btn-primary text-sm"
                >
                  {bulkPdfLoading ? 'Generating PDF...' : 'Download All Payslips (PDF)'}
                </button>
              </div>
              <div className="card p-6 text-center">
                <div className="text-3xl mb-3">PDF</div>
                <p className="text-slate-600 mb-2">Generate a single PDF containing all employee payslips for {MONTH_NAMES[month]} {year}.</p>
                <p className="text-xs text-slate-400">Each payslip will be on a separate page with company header, earnings, deductions, and attendance summary.</p>
                {companyFilter && <p className="text-xs text-blue-600 mt-2">Filtered to: {companyFilter}</p>}
              </div>
            </div>
          )}

          {/* Audit Trail */}
          {activeReport === 'audit' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Audit Trail — {MONTH_NAMES[month]} {year}</h3>
                <button onClick={() => exportToCSV(auditData, [
                  { key: 'created_at', label: 'Timestamp' }, { key: 'table_name', label: 'Table' },
                  { key: 'record_id', label: 'Record ID' }, { key: 'field_name', label: 'Field' },
                  { key: 'old_value', label: 'Old Value' }, { key: 'new_value', label: 'New Value' },
                  { key: 'stage', label: 'Stage' }, { key: 'remark', label: 'Remark' }
                ], `audit_trail_${monthLabel}.csv`)} className="btn-secondary text-sm">⬇ Export CSV</button>
              </div>
              {auditLoading ? <div className="card p-8 text-center text-slate-400">Loading...</div> : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-compact w-full text-xs">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Table</th>
                          <th>Record</th>
                          <th>Field</th>
                          <th>Old Value</th>
                          <th>New Value</th>
                          <th>Stage</th>
                          <th>Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditData.length === 0 ? (
                          <tr><td colSpan={8} className="text-center py-6 text-slate-400">No audit entries found</td></tr>
                        ) : auditData.map((a, i) => (
                          <React.Fragment key={i}>
                            <tr onClick={() => toggle(i)} className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded(i) ? 'bg-blue-50' : ''}`}>
                              <td className="text-slate-400 whitespace-nowrap"><DrillDownChevron isExpanded={isExpanded(i)} /> {a.created_at}</td>
                              <td className="font-mono">{a.table_name}</td>
                              <td className="font-mono">{a.record_id}</td>
                              <td className="text-blue-700">{a.field_name}</td>
                              <td className="text-red-600 font-mono">{a.old_value || '—'}</td>
                              <td className="text-green-700 font-mono">{a.new_value || '—'}</td>
                              <td><span className="badge bg-slate-100 text-slate-600">{a.stage}</span></td>
                              <td className="text-slate-500">{a.remark}</td>
                            </tr>
                            {isExpanded(i) && (
                              <DrillDownRow colSpan={8}>
                                <div className="flex flex-col lg:flex-row gap-4">
                                  <div className="flex-1">
                                    <div className="text-xs font-semibold text-slate-500 mb-2">Audit Change Detail</div>
                                    <div className="bg-white rounded-lg border border-slate-100 p-3 space-y-2 text-xs">
                                      <div className="flex justify-between"><span className="text-slate-500">Timestamp:</span> <strong>{a.created_at}</strong></div>
                                      <div className="flex justify-between"><span className="text-slate-500">Table:</span> <strong className="font-mono">{a.table_name}</strong></div>
                                      <div className="flex justify-between"><span className="text-slate-500">Record ID:</span> <strong className="font-mono">{a.record_id}</strong></div>
                                      <div className="flex justify-between"><span className="text-slate-500">Field:</span> <strong className="text-blue-700">{a.field_name}</strong></div>
                                      <div className="flex justify-between"><span className="text-slate-500">Stage:</span> <span className="badge bg-slate-100 text-slate-600">{a.stage}</span></div>
                                      {a.remark && <div className="flex justify-between"><span className="text-slate-500">Remark:</span> <span className="text-slate-700">{a.remark}</span></div>}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-xs font-semibold text-slate-500 mb-2">Before / After Comparison</div>
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className="bg-red-50 rounded-lg border border-red-100 p-3">
                                        <div className="text-[10px] uppercase text-red-400 font-semibold mb-1">Before</div>
                                        <div className="text-sm font-mono text-red-700 break-all">{a.old_value || '(empty)'}</div>
                                      </div>
                                      <div className="bg-green-50 rounded-lg border border-green-100 p-3">
                                        <div className="text-[10px] uppercase text-green-400 font-semibold mb-1">After</div>
                                        <div className="text-sm font-mono text-green-700 break-all">{a.new_value || '(empty)'}</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </DrillDownRow>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Department Payroll */}
          {activeReport === 'department-payroll' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-slate-800">Department Payroll Cost Centre — {MONTH_NAMES[month]} {year}</h3>
              {deptPayrollLoading ? (
                <div className="card p-8 text-center text-slate-400">Loading...</div>
              ) : deptPayrollData.departments?.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="card p-3 text-center bg-blue-50 border-blue-100">
                      <div className="text-xl font-bold text-slate-800">{deptPayrollData.grandTotals.headcount}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Total Headcount</div>
                    </div>
                    <div className="card p-3 text-center bg-green-50 border-green-100">
                      <div className="text-xl font-bold text-green-700">₹{(deptPayrollData.grandTotals.netSalary / 100000).toFixed(1)}L</div>
                      <div className="text-xs text-slate-500 mt-0.5">Total Net Salary</div>
                    </div>
                    <div className="card p-3 text-center bg-purple-50 border-purple-100">
                      <div className="text-xl font-bold text-purple-700">₹{(deptPayrollData.grandTotals.totalCTC / 100000).toFixed(1)}L</div>
                      <div className="text-xs text-slate-500 mt-0.5">Total CTC (incl. ER PF/ESI)</div>
                    </div>
                    <div className="card p-3 text-center bg-amber-50 border-amber-100">
                      <div className="text-xl font-bold text-slate-800">{deptPayrollData.departments.length}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Departments</div>
                    </div>
                  </div>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="table-compact w-full text-xs">
                        <thead>
                          <tr>
                            <th>Department</th>
                            <th className="text-right">HC</th>
                            <th className="text-right">Gross Earned</th>
                            <th className="text-right">PF (ER)</th>
                            <th className="text-right">ESI (ER)</th>
                            <th className="text-right">Net Salary</th>
                            <th className="text-right">OT + ED</th>
                            <th className="text-right">Total CTC</th>
                            <th className="text-right">Per Employee</th>
                            <th className="text-right">Cost %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deptPayrollData.departments.map((d, i) => (
                            <tr key={d.department || i}>
                              <td className="font-medium">{d.department}</td>
                              <td className="text-right">{d.headcount}</td>
                              <td className="text-right">₹{d.grossEarned.toLocaleString('en-IN')}</td>
                              <td className="text-right">₹{d.pfEmployer.toLocaleString('en-IN')}</td>
                              <td className="text-right">₹{d.esiEmployer.toLocaleString('en-IN')}</td>
                              <td className="text-right text-blue-700">₹{d.netSalary.toLocaleString('en-IN')}</td>
                              <td className="text-right text-amber-600">₹{(d.otPay + d.edPay).toLocaleString('en-IN')}</td>
                              <td className="text-right font-semibold">₹{d.totalCTC.toLocaleString('en-IN')}</td>
                              <td className="text-right text-slate-500">₹{d.perEmployeeCost.toLocaleString('en-IN')}</td>
                              <td className="text-right">
                                <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{d.costShare}%</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="font-bold bg-slate-50 border-t-2 border-slate-200">
                            <td>TOTAL</td>
                            <td className="text-right">{deptPayrollData.grandTotals.headcount}</td>
                            <td className="text-right">₹{deptPayrollData.grandTotals.grossEarned.toLocaleString('en-IN')}</td>
                            <td className="text-right">₹{deptPayrollData.grandTotals.pfEmployer.toLocaleString('en-IN')}</td>
                            <td className="text-right">₹{deptPayrollData.grandTotals.esiEmployer.toLocaleString('en-IN')}</td>
                            <td className="text-right text-blue-700">₹{deptPayrollData.grandTotals.netSalary.toLocaleString('en-IN')}</td>
                            <td className="text-right">—</td>
                            <td className="text-right">₹{deptPayrollData.grandTotals.totalCTC.toLocaleString('en-IN')}</td>
                            <td className="text-right">—</td>
                            <td className="text-right">100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="card p-8 text-center text-slate-400">No salary data found. Run Stage 7 salary computation first.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
