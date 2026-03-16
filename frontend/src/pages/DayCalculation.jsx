import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getDayCalculations, calculateDays } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtPct } from '../utils/formatters'
import clsx from 'clsx'

export default function DayCalculation() {
  const { selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [expandedRow, setExpandedRow] = useState(null)

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['day-calculations', selectedMonth, selectedYear],
    queryFn: () => getDayCalculations({ month: selectedMonth, year: selectedYear }),
    retry: 0
  })

  const calcs = res?.data?.data || []

  const calcMutation = useMutation({
    mutationFn: () => calculateDays({ month: selectedMonth, year: selectedYear }),
    onSuccess: (res) => {
      toast.success(`Day calculation complete for ${res.data.processed} employees`)
      refetch()
      queryClient.invalidateQueries(['org-overview'])
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Calculation failed')
  })

  const totals = calcs.reduce((acc, r) => ({
    present: acc.present + r.days_present,
    absent: acc.absent + r.days_absent,
    paidSundays: acc.paidSundays + r.paid_sundays,
    lop: acc.lop + r.lop_days,
    payable: acc.payable + r.total_payable_days,
  }), { present: 0, absent: 0, paidSundays: 0, lop: 0, payable: 0 })

  return (
    <div>
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'active' }} />

      <div className="p-6 space-y-4 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Stage 6: Day Calculation & Leave Adjustment</h2>
            <p className="text-sm text-slate-500">Calculate paid days using Sunday granting rules, leave deductions, and holiday adjustments.</p>
          </div>
          <button
            onClick={() => calcMutation.mutate()}
            disabled={calcMutation.isPending}
            className="btn-primary"
          >
            {calcMutation.isPending ? '⏳ Calculating...' : '▶ Run Day Calculation'}
          </button>
        </div>

        {calcs.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Employees', value: calcs.length },
              { label: 'Avg Present Days', value: (totals.present / calcs.length).toFixed(1) },
              { label: 'Total Paid Sundays', value: totals.paidSundays.toFixed(0) },
              { label: 'Total LOP Days', value: totals.lop.toFixed(1) },
              { label: 'Avg Payable Days', value: (totals.payable / calcs.length).toFixed(1) },
            ].map(s => (
              <div key={s.label} className="card p-3 text-center">
                <div className="text-xl font-bold text-slate-800">{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {calcs.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">📅</div>
            <h3 className="font-semibold text-slate-700 mb-2">No day calculations yet</h3>
            <p className="text-slate-500 mb-4">Click "Run Day Calculation" to compute payable days for all employees.</p>
          </div>
        )}

        {calcs.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-compact">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Dept</th>
                    <th>Cal. Days</th>
                    <th>Sundays</th>
                    <th>Present</th>
                    <th>½ Days</th>
                    <th>Absent</th>
                    <th>Paid Sun.</th>
                    <th>Holidays</th>
                    <th>CL Used</th>
                    <th>EL Used</th>
                    <th>LOP</th>
                    <th className="bg-blue-50 text-blue-700">Payable Days</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {calcs.map(r => (
                    <React.Fragment key={r.id}>
                      <tr>
                        <td>
                          <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                          <div className="text-xs text-slate-400">{r.employee_code}</div>
                        </td>
                        <td className="text-xs text-slate-600">{r.department}</td>
                        <td>{r.total_calendar_days}</td>
                        <td>{r.total_sundays}</td>
                        <td className="text-green-600 font-medium">{r.days_present}</td>
                        <td className="text-yellow-600">{r.days_half_present}</td>
                        <td className="text-red-600">{r.days_absent}</td>
                        <td className="text-blue-600">{r.paid_sundays}</td>
                        <td className="text-purple-600">{r.paid_holidays}</td>
                        <td className="text-orange-600">{r.cl_used || 0}</td>
                        <td className="text-orange-600">{r.el_used || 0}</td>
                        <td className={clsx('font-medium', r.lop_days > 0 ? 'text-red-600' : 'text-slate-400')}>{r.lop_days}</td>
                        <td className="bg-blue-50 font-bold text-blue-700 text-base">{r.total_payable_days}</td>
                        <td>
                          <button onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)} className="text-xs text-blue-500 hover:underline">
                            {expandedRow === r.id ? '▲ Hide' : '▼ Weeks'}
                          </button>
                        </td>
                      </tr>
                      {expandedRow === r.id && r.week_breakdown && (
                        <tr>
                          <td colSpan={14} className="bg-slate-50 px-6 py-3">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Week-by-Week Breakdown:</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                              {(() => {
                                try {
                                  const weeks = typeof r.week_breakdown === 'string' ? JSON.parse(r.week_breakdown) : r.week_breakdown
                                  return weeks.map((w, i) => (
                                    <div key={i} className={clsx('rounded-lg p-2 text-xs border', w.sundayPaid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
                                      <div className="font-semibold mb-1">Sunday: {w.sundayDate}</div>
                                      <div>Worked: <strong>{w.workedDays}/{w.availableDays}</strong></div>
                                      {w.clUsed > 0 && <div>CL used: {w.clUsed}</div>}
                                      {w.elUsed > 0 && <div>EL used: {w.elUsed}</div>}
                                      {w.lop > 0 && <div className="text-red-600">LOP: {w.lop}</div>}
                                      <div className={clsx('font-medium mt-1', w.sundayPaid ? 'text-green-600' : 'text-red-600')}>
                                        {w.sundayPaid ? '✓ Paid Sunday' : '✗ Unpaid Sunday'}
                                      </div>
                                    </div>
                                  ))
                                } catch (e) { return <div className="text-slate-400">No breakdown data</div> }
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
