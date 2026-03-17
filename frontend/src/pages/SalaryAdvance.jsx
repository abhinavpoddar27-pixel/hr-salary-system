import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAppStore } from '../store/appStore'
import { fmtINR, monthYearLabel, fmtDate } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import api from '../utils/api'

/* ── Reusable sortable table hook ────────────────────── */
function useSortable(defaultKey = '', defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState(defaultDir)
  const toggle = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const indicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const sortFn = (a, b) => {
    if (!sortKey) return 0
    let va = a[sortKey], vb = b[sortKey]
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  }
  return { sortKey, sortDir, toggle, indicator, sortFn }
}

export default function SalaryAdvance() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selected, setSelected] = useState(new Set())
  const [filterView, setFilterView] = useState('all')
  const [search, setSearch] = useState('')
  const sort = useSortable('employee_name')
  const { toggle, isExpanded } = useExpandableRows()

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['advance-list', selectedMonth, selectedYear],
    queryFn: () => api.get('/advance/list', { params: { month: selectedMonth, year: selectedYear } }),
    retry: 0
  })

  const allRecords = res?.data?.data || []
  const totals = res?.data?.totals || {}

  const records = useMemo(() => {
    let filtered = allRecords
    if (filterView === 'eligible') filtered = filtered.filter(r => r.is_eligible && !r.paid)
    if (filterView === 'paid') filtered = filtered.filter(r => r.paid)
    if (filterView === 'ineligible') filtered = filtered.filter(r => !r.is_eligible)
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(r =>
        (r.employee_name || '').toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q) ||
        (r.department || '').toLowerCase().includes(q)
      )
    }
    return [...filtered].sort(sort.sortFn)
  }, [allRecords, filterView, search, sort.sortKey, sort.sortDir])

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

  const SortHeader = ({ k, children, className = '' }) => (
    <th onClick={() => sort.toggle(k)} className={clsx('cursor-pointer select-none hover:text-blue-600', className)}>
      {children}{sort.indicator(k)}
    </th>
  )

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Salary Advance</h2>
            <p className="section-subtitle mt-1">
              {monthYearLabel(selectedMonth, selectedYear)} — Calculate and process salary advances (1/3 gross for eligible employees).
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Use the month selector in the header to view/calculate advances for any month.
            </p>
          </div>
          <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending} className="btn-primary">
            {calculateMutation.isPending ? 'Calculating...' : `Calculate Advances for ${monthYearLabel(selectedMonth, selectedYear)}`}
          </button>
        </div>

        {/* Info Card */}
        <div className="card p-4 bg-blue-50/50 border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Policy:</span> Employees with &ge;9 working days (1st–15th) receive 1/3 of gross salary as advance.
            Advance is auto-recovered during final salary computation. Select any month using the header dropdown to calculate or view advances.
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

        {/* Filter tabs + search + batch actions */}
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
            <input
              type="text"
              placeholder="Search name, code, dept..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input w-48 text-xs"
            />
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
            <h3 className="font-semibold text-slate-700 mb-2">No advance data for {monthYearLabel(selectedMonth, selectedYear)}</h3>
            <p className="text-slate-500">Click "Calculate Advances" to process salary advances for this month.</p>
            <p className="text-xs text-slate-400 mt-2">Make sure attendance data has been imported for this month first.</p>
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
                    <SortHeader k="employee_name"><Abbr code="Emp">Employee</Abbr></SortHeader>
                    <SortHeader k="department"><Abbr code="Dept">Dept</Abbr></SortHeader>
                    <SortHeader k="working_days_1_to_15" className="text-center">Working Days (1st-15th)</SortHeader>
                    <SortHeader k="is_eligible" className="text-center">Eligible</SortHeader>
                    <SortHeader k="advance_amount" className="text-center">Advance Amount</SortHeader>
                    <th>Status</th>
                    <SortHeader k="paid_date">Paid Date</SortHeader>
                    <th>Recovered</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <React.Fragment key={r.id}>
                    <tr onClick={() => toggle(r.id)} className={clsx('transition-colors cursor-pointer hover:bg-blue-50/50', isExpanded(r.id) && 'bg-blue-50/70', !r.is_eligible && !isExpanded(r.id) && 'opacity-50')}>
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
                        <div className="flex items-center gap-1.5">
                          <DrillDownChevron isExpanded={isExpanded(r.id)} />
                          <div>
                            <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                            <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-xs text-slate-600">{r.department}</td>
                      <td className="text-center font-mono font-medium">{r.working_days_1_to_15}</td>
                      <td className="text-center">
                        {r.is_eligible ? (
                          <span className="badge-green text-xs">Yes</span>
                        ) : (
                          <span className="badge-red text-xs">No</span>
                        )}
                      </td>
                      <td className="font-mono font-bold text-center">{r.is_eligible ? fmtINR(r.advance_amount) : '—'}</td>
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
                    {isExpanded(r.id) && (
                      <DrillDownRow colSpan={10}>
                        <EmployeeQuickView
                          employeeCode={r.employee_code}
                          contextContent={
                            <div className="text-xs space-y-2">
                              <p className="font-semibold text-slate-600">Advance Details</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex justify-between"><span className="text-slate-500">Working Days (1st-15th)</span><span className="font-mono font-medium">{r.working_days_1_to_15}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Eligible</span><span className={r.is_eligible ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{r.is_eligible ? 'Yes' : 'No'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Advance Amount</span><span className="font-mono font-bold">{r.is_eligible ? fmtINR(r.advance_amount) : '—'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="font-medium">{r.paid ? 'Paid' : r.is_eligible ? 'Pending' : '—'}</span></div>
                                {r.paid_date && <div className="flex justify-between"><span className="text-slate-500">Paid Date</span><span className="font-mono">{r.paid_date}</span></div>}
                                <div className="flex justify-between"><span className="text-slate-500">Recovered</span><span className="font-medium">{r.recovered ? 'Yes' : r.paid ? 'Pending' : '—'}</span></div>
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

        <AbbreviationLegend keys={['Emp', 'Dept']} />
      </div>
    </div>
  )
}
