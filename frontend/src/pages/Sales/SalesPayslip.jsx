import React, { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { salesPayslip } from '../../utils/api'
import { downloadSalesPayslipPDF } from '../../utils/salesPayslipPdf'

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']

function fmtINR(n) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Number(n || 0))
}

export default function SalesPayslip() {
  const { code } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const month = parseInt(params.get('month'), 10)
  const year  = parseInt(params.get('year'), 10)
  const company = params.get('company') || ''

  const { data: res, isLoading, isError, error } = useQuery({
    queryKey: ['sales-payslip', code, month, year, company],
    queryFn: () => salesPayslip(code, { month, year, company }),
    enabled: !!code && !!month && !!year && !!company,
    retry: 0,
  })

  const [pdfBusy, setPdfBusy] = useState(false)

  if (!code || !month || !year || !company) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Missing parameters: code, month, year, company are all required.
      </div>
    )
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading payslip…</div>
  }

  if (isError || !res?.data?.success) {
    const msg = error?.response?.data?.error || res?.data?.error || 'Payslip unavailable'
    return (
      <div className="p-6 space-y-3">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{msg}</div>
        <button onClick={() => navigate(-1)}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">← Back</button>
      </div>
    )
  }

  const d = res.data.data
  const { employee, period, days, earnings, totalEarnings, deductions, totalDeductions, netSalary, status, bank, computedAt, finalizedAt, finalizedBy } = d
  const isDraft = !['finalized', 'paid'].includes(status)

  const handleDownload = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      await downloadSalesPayslipPDF(d)
      toast.success('PDF downloaded')
    } catch (err) {
      toast.error('Failed to render PDF: ' + (err?.message || 'unknown error'))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 print:p-0">
      {/* Top bar (hidden on print) */}
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate(-1)}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">← Back to register</button>
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs px-2 py-0.5 rounded font-medium',
            status === 'finalized' || status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
            {status}
          </span>
          {isDraft && (
            <span className="text-xs px-2 py-0.5 rounded font-medium bg-rose-100 text-rose-700">
              DRAFT — not valid
            </span>
          )}
          <button
            onClick={handleDownload}
            disabled={pdfBusy}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white">
            {pdfBusy ? 'Rendering PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Payslip */}
      <div className="bg-white border border-slate-300 rounded-lg p-6 max-w-3xl mx-auto print:border-0 print:rounded-none print:shadow-none relative">
        {isDraft && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span
              className="font-black text-rose-600/15 tracking-widest select-none"
              style={{ transform: 'rotate(-30deg)', fontSize: '5rem', letterSpacing: '0.5rem' }}>
              NOT VALID · DRAFT
            </span>
          </div>
        )}
        <div className="border-b border-slate-200 pb-4 mb-4">
          <h1 className="text-xl font-bold text-slate-800">Sales Salary Slip</h1>
          <p className="text-sm text-slate-600">{employee.company}</p>
          <p className="text-xs text-slate-500 mt-1">Period: {MONTHS[period.month]} {period.year}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
          <div><span className="text-slate-500 text-xs">Code</span><br /><span className="font-mono">{employee.code}</span></div>
          <div><span className="text-slate-500 text-xs">Name</span><br /><span className="font-medium">{employee.name}</span></div>
          <div><span className="text-slate-500 text-xs">Designation</span><br />{employee.designation || '—'}</div>
          <div><span className="text-slate-500 text-xs">Reporting Manager</span><br />{employee.reporting_manager || '—'}</div>
          <div><span className="text-slate-500 text-xs">Headquarters</span><br />{employee.headquarters || '—'}</div>
          <div><span className="text-slate-500 text-xs">City of Operation</span><br />{employee.city_of_operation || '—'}</div>
          <div><span className="text-slate-500 text-xs">Date of Joining</span><br />{employee.doj || '—'}</div>
        </div>

        <div className="grid grid-cols-4 gap-3 text-sm mb-4 bg-slate-50 rounded p-3">
          <div><span className="text-slate-500 text-xs block">Days Given</span>{days.days_given}</div>
          <div><span className="text-slate-500 text-xs block">+ Sundays Paid</span>{days.sundays_paid}</div>
          <div><span className="text-slate-500 text-xs block">+ Holidays</span>{days.gazetted_holidays_paid}</div>
          <div><span className="text-slate-500 text-xs block">= Total Days</span><span className="font-semibold">{days.total_days}</span></div>
          <div><span className="text-slate-500 text-xs block">Calendar Days</span>{days.calendar_days}</div>
          <div className="col-span-3"><span className="text-slate-500 text-xs block">Earned Ratio</span>{(days.earned_ratio || 0).toFixed(4)}</div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1">Earnings</h3>
            <table className="w-full text-sm">
              <tbody>
                {earnings.map((e, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1">{e.label}</td>
                    <td className="py-1 text-right font-mono">₹{fmtINR(e.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold bg-slate-50">
                  <td className="py-1.5 px-1">Total Earnings</td>
                  <td className="py-1.5 px-1 text-right font-mono">₹{fmtINR(totalEarnings)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1">Deductions</h3>
            <table className="w-full text-sm">
              <tbody>
                {deductions.length === 0 && (
                  <tr><td className="py-2 text-slate-400 italic">No deductions this month</td></tr>
                )}
                {deductions.map((e, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1">{e.label}</td>
                    <td className="py-1 text-right font-mono">₹{fmtINR(e.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold bg-slate-50">
                  <td className="py-1.5 px-1">Total Deductions</td>
                  <td className="py-1.5 px-1 text-right font-mono">₹{fmtINR(totalDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-green-900">Net Salary Payable</span>
          <span className="text-xl font-bold text-green-900 font-mono">₹{fmtINR(netSalary)}</span>
        </div>

        {(bank.bank_name || bank.account_no || bank.ifsc) && (
          <div className="text-xs text-slate-500 border-t border-slate-200 pt-3 mb-2">
            <p><span className="font-medium">Bank:</span> {bank.bank_name || '—'}</p>
            <p><span className="font-medium">A/C No.:</span> {bank.account_no || '—'}</p>
            <p><span className="font-medium">IFSC:</span> {bank.ifsc || '—'}</p>
          </div>
        )}

        <div className="text-xs text-slate-400 border-t border-slate-200 pt-2">
          Computed: {computedAt}
          {finalizedAt && <> · Finalized: {finalizedAt} by {finalizedBy}</>}
        </div>
      </div>
    </div>
  )
}
