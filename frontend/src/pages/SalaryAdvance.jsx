import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAppStore } from '../store/appStore'
import { fmtINR, monthYearLabel, fmtDate } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import clsx from 'clsx'
import api from '../utils/api'

export default function SalaryAdvance() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selected, setSelected] = useState(new Set())
  const [filterView, setFilterView] = useState('all')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['advance-list', selectedMonth, selectedYear],
    queryFn: () => api.get('/advance/list', { params: { month: selectedMonth, year: selectedYear } }),
    retry: 0
  })

  const allRecords = res?.data?.data || []
  const totals = res?.data?.totals || {}

  const records = useMemo(() => {
    if (filterView === 'eligible') return allRecords.filter(r => r.is_eligible && !r.paid)
    if (filterView === 'paid') return allRecords.filter(r => r.paid)
    if (filterView === 'ineligible') return allRecords.filter(r => !r.is_eligible)
    return allRecords
  }, [allRecords, filterView])

  const calculateMutation = useMutation({
    mutationFn: () => api.post('/advance/calculate', { month: selectedMonth, year: selectedYear }),
    onSuccess: (r) => {
      toast.success(`Advance calculated: ${r.data.eligible} eligible of ${r.data.total} | Total: ${fmtINR(r.data.totalAdvanceAmount)}`)
      refetch()
    }
  })

  const markPaidMutation = useMutation({
    mutationFn: (id) => api.put(`/advance/${id}/mark-paid`, { paymentMode: 'Bank Transfer' }),
    onSuccess: () => { toast.success('Advance marked as paid'); refetch() }
  })

  const batchPaidMutation = useMutation({
    mutationFn: () => api.put('/advance/batch-mark-paid', { ids: [...selected], paymentMode: 'Bank Transfer' }),
    onSuccess: () => {
      toast.success(`${selected.size} advances marked as paid`)
      setSelected(new Set())
      refetch()
    }
  })

  const eligibleUnpaid = allRecords.filter(r => r.is_eligible && !r.paid)

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Salary Advance</h2>
            <p className="section-subtitle mt-1">
              {monthYearLabel(selectedMonth, selectedYear)} — Calculate and process salary advances (1/3 gross for eligible employees).
            </p>
          </div>
          <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending} className="btn-primary">
            {calculateMutation.isPending ? 'Calculating...' : 'Calculate Advances'}
          </button>
        </div>

        {/* Info Card */}
        <div className="card p-4 bg-blue-50/50 border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Policy:</span> Advance is processed on the 19th. Employees with &gt;9 working days
            (1st–15th) receive 1/3 of gross salary. Advance is auto-recovered during final salary computation.
          </p>
        </div>

        {/* Summary Cards */}
        {allRecords.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="stat-card border-l-4 border-l-blue-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Employees</span>
              <span className="text-2xl font-bold text-slate-800">{totals.total || 0}</span>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Eligible</span>
              <span className="text-2xl font-bold text-emerald-700">{totals.eligible || 0}</span>
            </div>
            <div className="stat-card border-l-4 border-l-amber-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Advance</span>
              <span className="text-xl font-bold text-slate-800">{fmtINR(totals.totalAmount || 0)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-green-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Paid</span>
              <span className="text-xl font-bold text-green-700">{fmtINR(totals.paidAmount || 0)}</span>
              <span className="text-xs text-slate-400">{totals.paid || 0} employees</span>
            </div>
          </div>
        )}

        {/* Filter tabs + batch actions */}
        {allRecords.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All', count: allRecords.length },
                { key: 'eligible', label: 'Eligible (Unpaid)', count: eligibleUnpaid.length },
                { key: 'paid', label: 'Paid', count: allRecords.filter(r => r.paid).length },
                { key: 'ineligible', label: 'Ineligible', count: allRecords.filter(r => !r.is_eligible).length },
              ].map(f => (
                <button key={f.key}
                  onClick={() => setFilterView(f.key)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    filterView === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
            {selected.size > 0 && (
              <button onClick={() => batchPaidMutation.mutate()} disabled={batchPaidMutation.isPending} className="btn-primary text-sm">
                Mark {selected.size} as Paid
              </button>
            )}
          </div>
        )}

        {/* Table */}
        {allRecords.length === 0 && !isLoading ? (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">₹</div>
            <h3 className="font-semibold text-slate-700 mb-2">No advance data</h3>
            <p className="text-slate-500">Click "Calculate Advances" to process salary advances for this month.</p>
          </div>
        ) : records.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="font-semibold text-slate-700">Advance Register — {records.length} records</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input type="checkbox" onChange={e => {
                        if (e.target.checked) setSelected(new Set(eligibleUnpaid.map(r => r.id)))
                        else setSelected(new Set())
                      }} className="rounded" />
                    </th>
                    <th><Abbr code="Emp">Employee</Abbr></th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th>Working Days (1st-15th)</th>
                    <th>Eligible</th>
                    <th>Advance Amount</th>
                    <th>Status</th>
                    <th>Paid Date</th>
                    <th>Recovered</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className={clsx('transition-colors', !r.is_eligible && 'opacity-50')}>
                      <td>
                        {r.is_eligible && !r.paid && (
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => {
                            const next = new Set(selected)
                            if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                            setSelected(next)
                          }} className="rounded" />
                        )}
                      </td>
                      <td>
                        <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                        <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                      </td>
                      <td className="text-xs text-slate-600">{r.department}</td>
                      <td className="text-center font-mono font-medium">{r.working_days_1_to_15}</td>
                      <td>
                        {r.is_eligible ? (
                          <span className="badge-green text-xs">Yes</span>
                        ) : (
                          <span className="badge-red text-xs">No</span>
                        )}
                      </td>
                      <td className="font-mono font-bold">{r.is_eligible ? fmtINR(r.advance_amount) : '—'}</td>
                      <td>
                        {r.paid ? (
                          <span className="badge-green text-xs">Paid</span>
                        ) : r.is_eligible ? (
                          <span className="badge-yellow text-xs">Pending</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="font-mono text-xs">{r.paid_date || '—'}</td>
                      <td>
                        {r.recovered ? (
                          <span className="badge-green text-xs">Recovered</span>
                        ) : r.paid ? (
                          <span className="badge-yellow text-xs">Pending</span>
                        ) : '—'}
                      </td>
                      <td>
                        {r.is_eligible && !r.paid && (
                          <button onClick={() => markPaidMutation.mutate(r.id)} className="btn-ghost text-xs text-blue-600">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['Emp', 'Dept']} />
      </div>
    </div>
  )
}
