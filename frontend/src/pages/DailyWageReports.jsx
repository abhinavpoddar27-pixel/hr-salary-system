import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getDWMonthlyReport, getDWDepartmentCost, getDWContractorReport,
  getDWSeasonalTrends, getDWContractors
} from '../utils/api'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import * as XLSX from 'xlsx'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function DailyWageReports() {
  const now = new Date()
  const [tab, setTab] = useState('monthly')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [selectedContractorId, setSelectedContractorId] = useState('')

  const tabs = [
    { key: 'monthly', label: 'Monthly Report' },
    { key: 'department', label: 'Department Cost' },
    { key: 'contractor', label: 'Contractor Summary' },
    { key: 'trends', label: 'Seasonal Trends' }
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Daily Wage Reports</h1>
        <p className="text-sm text-slate-500 mt-0.5">Reporting and analytics for daily wage operations</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'monthly' && <MonthlyReport month={month} year={year} setMonth={setMonth} setYear={setYear} />}
      {tab === 'department' && <DepartmentCost month={month} year={year} setMonth={setMonth} setYear={setYear} />}
      {tab === 'contractor' && <ContractorSummary contractorId={selectedContractorId} setContractorId={setSelectedContractorId} />}
      {tab === 'trends' && <SeasonalTrends />}
    </div>
  )
}

// ── Month/Year Selector ───────────────────────────────────────
function MonthYearPicker({ month, year, setMonth, setYear }) {
  return (
    <div className="flex gap-2 items-center">
      <select value={month} onChange={e => setMonth(Number(e.target.value))}
        className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select value={year} onChange={e => setYear(Number(e.target.value))}
        className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
        {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ── Tab 1: Monthly Report ─────────────────────────────────────
function MonthlyReport({ month, year, setMonth, setYear }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['dw-report-monthly', month, year],
    queryFn: () => getDWMonthlyReport(month, year),
    retry: 0
  })
  const data = res?.data?.data || {}
  const contractors = data.contractors || []
  const totals = data.grand_totals || {}
  const [expanded, setExpanded] = useState(null)

  const exportXlsx = () => {
    const rows = contractors.map(c => ({
      Contractor: c.contractor_name, 'Days Worked': c.total_days_worked,
      'Worker-Days': c.total_worker_days, 'Avg Rate': c.avg_rate,
      Wages: c.total_wages, Commission: c.total_commission,
      'Total Liability': c.total_liability, Paid: c.payment_status?.paid || 0,
      Outstanding: c.payment_status?.outstanding || 0
    }))
    rows.push({
      Contractor: 'TOTAL', 'Days Worked': totals.total_days_worked,
      'Worker-Days': totals.total_worker_days, 'Avg Rate': '',
      Wages: totals.total_wages, Commission: totals.total_commission,
      'Total Liability': totals.total_liability, Paid: totals.total_paid,
      Outstanding: totals.total_outstanding
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report')
    XLSX.writeFile(wb, `daily-wage-monthly-${year}-${String(month).padStart(2, '0')}.xlsx`)
    toast.success('Report exported')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonthYearPicker month={month} year={year} setMonth={setMonth} setYear={setYear} />
        {contractors.length > 0 && (
          <button onClick={exportXlsx} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            Export .xlsx
          </button>
        )}
      </div>

      {isLoading ? <div className="text-center py-8 text-slate-400">Loading...</div>
      : contractors.length === 0 ? <div className="text-center py-12 text-slate-400">No data for this month</div>
      : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                <th className="px-3 py-3">Contractor</th>
                <th className="px-3 py-3">Days</th>
                <th className="px-3 py-3">Workers</th>
                <th className="px-3 py-3">Avg Rate</th>
                <th className="px-3 py-3">Wages</th>
                <th className="px-3 py-3">Commission</th>
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">Paid</th>
                <th className="px-3 py-3">Outstanding</th>
                <th className="px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contractors.map(c => (
                <React.Fragment key={c.contractor_id}>
                  <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(expanded === c.contractor_id ? null : c.contractor_id)}>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{c.contractor_name}</td>
                    <td className="px-3 py-2.5">{c.total_days_worked}</td>
                    <td className="px-3 py-2.5">{c.total_worker_days}</td>
                    <td className="px-3 py-2.5">{fmt(c.avg_rate)}</td>
                    <td className="px-3 py-2.5">{fmt(c.total_wages)}</td>
                    <td className="px-3 py-2.5">{fmt(c.total_commission)}</td>
                    <td className="px-3 py-2.5 font-semibold text-blue-700">{fmt(c.total_liability)}</td>
                    <td className="px-3 py-2.5 text-green-600">{fmt(c.payment_status?.paid)}</td>
                    <td className="px-3 py-2.5 text-red-600">{fmt(c.payment_status?.outstanding)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{expanded === c.contractor_id ? '▲' : '▼'}</td>
                  </tr>
                  {expanded === c.contractor_id && (
                    <tr><td colSpan={10} className="px-3 py-2 bg-slate-50/70">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {(c.department_breakdown || []).map((d, i) => (
                          <span key={i} className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-600">
                            {d.department}: {d.workers} workers
                          </span>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              <tr className="bg-slate-100 font-semibold text-slate-700">
                <td className="px-3 py-2.5">TOTAL</td>
                <td className="px-3 py-2.5">{totals.total_days_worked}</td>
                <td className="px-3 py-2.5">{totals.total_worker_days}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5">{fmt(totals.total_wages)}</td>
                <td className="px-3 py-2.5">{fmt(totals.total_commission)}</td>
                <td className="px-3 py-2.5 text-blue-700">{fmt(totals.total_liability)}</td>
                <td className="px-3 py-2.5 text-green-600">{fmt(totals.total_paid)}</td>
                <td className="px-3 py-2.5 text-red-600">{fmt(totals.total_outstanding)}</td>
                <td className="px-3 py-2.5"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 2: Department Cost ────────────────────────────────────
function DepartmentCost({ month, year, setMonth, setYear }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['dw-report-dept', month, year],
    queryFn: () => getDWDepartmentCost(month, year),
    retry: 0
  })
  const data = res?.data?.data || {}
  const departments = data.departments || []
  const grandTotal = data.grand_total || {}

  const chartData = departments.map(d => ({
    name: d.department,
    cost: d.total_cost
  }))

  return (
    <div className="space-y-3">
      <MonthYearPicker month={month} year={year} setMonth={setMonth} setYear={setYear} />

      {isLoading ? <div className="text-center py-8 text-slate-400">Loading...</div>
      : departments.length === 0 ? <div className="text-center py-12 text-slate-400">No data for this month</div>
      : (
        <>
          {chartData.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Cost by Department</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={75} />
                  <Tooltip formatter={v => [`₹${fmt(v)}`, 'Cost']} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="cost" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Worker-Days</th>
                  <th className="px-4 py-3">Wage Cost</th>
                  <th className="px-4 py-3">Commission Cost</th>
                  <th className="px-4 py-3">Total Cost</th>
                  <th className="px-4 py-3">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((d, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{d.department}</td>
                    <td className="px-4 py-2.5">{d.worker_days}</td>
                    <td className="px-4 py-2.5">{fmt(d.wage_cost)}</td>
                    <td className="px-4 py-2.5">{fmt(d.commission_cost)}</td>
                    <td className="px-4 py-2.5 font-semibold text-blue-700">{fmt(d.total_cost)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{grandTotal.total_cost ? ((d.total_cost / grandTotal.total_cost) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-semibold text-slate-700">
                  <td className="px-4 py-2.5">TOTAL</td>
                  <td className="px-4 py-2.5">{grandTotal.worker_days}</td>
                  <td className="px-4 py-2.5">{fmt(grandTotal.wage_cost)}</td>
                  <td className="px-4 py-2.5">{fmt(grandTotal.commission_cost)}</td>
                  <td className="px-4 py-2.5 text-blue-700">{fmt(grandTotal.total_cost)}</td>
                  <td className="px-4 py-2.5">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 3: Contractor Summary ─────────────────────────────────
function ContractorSummary({ contractorId, setContractorId }) {
  const { data: cRes } = useQuery({
    queryKey: ['dw-contractors-all-reports'],
    queryFn: () => getDWContractors(),
    retry: 0
  })
  const contractors = cRes?.data?.data || []

  const { data: reportRes, isLoading } = useQuery({
    queryKey: ['dw-report-contractor', contractorId],
    queryFn: () => getDWContractorReport(contractorId),
    retry: 0, enabled: !!contractorId
  })
  const report = reportRes?.data?.data || {}

  const trendData = (report.trend || []).reverse().map(t => ({
    name: `${MONTHS[t.month - 1]} ${t.year}`,
    workers: t.worker_days,
    spend: t.total_spend
  }))

  return (
    <div className="space-y-3">
      <select value={contractorId} onChange={e => setContractorId(e.target.value)}
        className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
        <option value="">Select a contractor...</option>
        {contractors.map(c => <option key={c.id} value={c.id}>{c.contractor_name}</option>)}
      </select>

      {!contractorId ? <div className="text-center py-12 text-slate-400">Select a contractor to view summary</div>
      : isLoading ? <div className="text-center py-8 text-slate-400">Loading...</div>
      : (
        <>
          {/* Details card */}
          {report.contractor && (
            <div className="bg-white rounded-lg border border-slate-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-slate-400">Name:</span> <strong>{report.contractor.contractor_name}</strong></div>
              <div><span className="text-slate-400">Wage Rate:</span> {fmt(report.contractor.current_daily_wage_rate)}</div>
              <div><span className="text-slate-400">Commission:</span> {fmt(report.contractor.current_commission_rate)}</div>
              <div><span className="text-slate-400">Status:</span> {report.contractor.is_active ? 'Active' : 'Inactive'}</div>
            </div>
          )}

          {/* This month */}
          {report.this_month && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="text-[10px] text-slate-400 uppercase font-medium">This Month Workers</div>
                <div className="text-xl font-bold text-slate-700">{report.this_month.worker_days}</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="text-[10px] text-slate-400 uppercase font-medium">This Month Spend</div>
                <div className="text-xl font-bold text-blue-700">{fmt(report.this_month.total_spend)}</div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="text-[10px] text-slate-400 uppercase font-medium">Total Paid</div>
                <div className="text-xl font-bold text-green-700">{fmt(report.payment_summary?.total_paid)}</div>
              </div>
            </div>
          )}

          {/* 6-month trend */}
          {trendData.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">6-Month Trend</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trendData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="workers" stroke="#3b82f6" name="Worker-Days" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="spend" stroke="#10b981" name="Spend (₹)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Rate history */}
          {report.rate_history?.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Rate History</h3>
              <div className="space-y-1 text-xs">
                {report.rate_history.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-slate-400">{r.effective_date}</span>
                    <span>W: {fmt(r.old_wage_rate)} → {fmt(r.new_wage_rate)}</span>
                    <span>C: {fmt(r.old_commission_rate)} → {fmt(r.new_commission_rate)}</span>
                    <span className={clsx('px-1.5 py-0.5 rounded-full', r.approval_status === 'approved' ? 'bg-green-100 text-green-700' : r.approval_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                      {r.approval_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Tab 4: Seasonal Trends ────────────────────────────────────
function SeasonalTrends() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['dw-seasonal-trends'],
    queryFn: getDWSeasonalTrends,
    retry: 0
  })
  const months = (res?.data?.data || []).reverse()

  const chartData = months.map(m => ({
    name: `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`,
    workers: m.worker_days,
    cost: m.total_liability,
    contractors: m.contractor_count
  }))

  return (
    <div className="space-y-4">
      {isLoading ? <div className="text-center py-8 text-slate-400">Loading...</div>
      : months.length === 0 ? <div className="text-center py-12 text-slate-400">No trend data available</div>
      : (
        <>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">12-Month Trends — Worker-Days & Total Cost</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="workers" stroke="#3b82f6" name="Worker-Days" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#ef4444" name="Total Cost (₹)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3">Worker-Days</th>
                  <th className="px-4 py-3">Wages</th>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Total Cost</th>
                  <th className="px-4 py-3">Contractors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {months.map((m, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{MONTHS[m.month - 1]} {m.year}</td>
                    <td className="px-4 py-2.5">{m.worker_days}</td>
                    <td className="px-4 py-2.5">{fmt(m.total_wages)}</td>
                    <td className="px-4 py-2.5">{fmt(m.total_commission)}</td>
                    <td className="px-4 py-2.5 font-semibold text-blue-700">{fmt(m.total_liability)}</td>
                    <td className="px-4 py-2.5">{m.contractor_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
