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
  const sortFn = (a, b) => {
    let aV = a[sortKey], bV = b[sortKey]
    if (typeof aV === 'string') aV = (aV || '').toLowerCase()
    if (typeof bV === 'string') bV = (bV || '').toLowerCase()
    if (aV == null) return sortDir === 'asc' ? 1 : -1
    if (bV == null) return sortDir === 'asc' ? -1 : 1
    return sortDir === 'asc' ? (aV < bV ? -1 : aV > bV ? 1 : 0) : (aV > bV ? -1 : aV < bV ? 1 : 0)
  }
  const indicator = (col) => {
    if (sortKey !== col) return <span className="text-slate-300 ml-0.5 text-[10px]">{'\u2195'}</span>
    return <span className="text-blue-600 ml-0.5 text-[10px]">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
  }
  return { sortKey, sortDir, toggle, sortFn, indicator }
}

export default function SalaryAdvance() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selected, setSelected] = useState(new Set())
  const [filterView, setFilterView] = useState('all')
  const [search, setSearch] = useState('')
  const [remarkModal, setRemarkModal] = useState(null) // { id, code, name, amount } or 'bulk'
  const [reduceAmount, setReduceAmount] = useState('')
  const sort = useSortable('employee_name')
  const { toggle: toggleRow, isExpanded } = useExpandableRows()

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['advance-list', selectedMonth, selectedYear],
    queryFn: () => api.get('/advance/list', { params: { month: selectedMonth, year: selectedYear } }),
    retry: 0
  })

  const allRecords = res?.data?.data || []
  const totals = res?.data?.totals || {}

  const records = useMemo(() => {
    let filtered = allRecords
    if (filterView === 'eligible') filtered = filtered.filter(r => r.is_eligible && !r.paid && r.remark !== 'NO_ADVANCE')
    if (filterView === 'paid') filtered = filtered.filter(r => r.paid)
    if (filterView === 'ineligible') filtered = filtered.filter(r => !r.is_eligible)
    if (filterView === 'no-advance') filtered = filtered.filter(r => r.remark === 'NO_ADVANCE')
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
    onSuccess: () => { toast.success(`${selected.size} advances marked as paid`); setSelected(new Set()); refetch() }
  })

  const setRemarkMutation = useMutation({
    mutationFn: ({ id, remark, reducedAmount }) => api.put(`/advance/${id}/set-remark`, { remark, reducedAmount }),
    onSuccess: () => { toast.success('Remark updated'); setRemarkModal(null); refetch() }
  })

  const batchRemarkMutation = useMutation({
    mutationFn: ({ remark, reducedAmount }) => api.put('/advance/batch-remark', { ids: [...selected], remark, reducedAmount }),
    onSuccess: () => { toast.success(`Remark set on ${selected.size} records`); setSelected(new Set()); setRemarkModal(null); refetch() }
  })

  const eligibleUnpaid = allRecords.filter(r => r.is_eligible && !r.paid && r.remark !== 'NO_ADVANCE')
  const noAdvanceCount = allRecords.filter(r => r.remark === 'NO_ADVANCE').length

  const SortHeader = ({ k, children, className = '' }) => (
    <th onClick={() => sort.toggle(k)} className={clsx('cursor-pointer select-none hover:text-blue-600', className)}>
      {children}{sort.indicator(k)}
    </th>
  )

  // PDF Export — exclude "No Advance Taken" employees
  async function handleExportPDF() {
    const html2pdf = (await import('html2pdf.js')).default
    const printable = allRecords.filter(r => r.remark !== 'NO_ADVANCE' && r.is_eligible)
    if (printable.length === 0) { toast.error('No records to export'); return }

    const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const rows = printable.map((r, i) =>
      `<tr><td style="padding:4px 6px;border:1px solid #ddd;text-align:center">${i+1}</td>
       <td style="padding:4px 6px;border:1px solid #ddd">${r.employee_name} (${r.employee_code})</td>
       <td style="padding:4px 6px;border:1px solid #ddd">${r.department || ''}</td>
       <td style="padding:4px 6px;border:1px solid #ddd;text-align:center">${r.working_days_1_to_15}</td>
       <td style="padding:4px 6px;border:1px solid #ddd;text-align:right;font-weight:bold">${fmtINR(r.advance_amount)}</td>
       <td style="padding:4px 6px;border:1px solid #ddd">${r.remark === 'REDUCED' ? 'Reduced' : r.paid ? 'Paid' : 'Pending'}</td>
       <td style="padding:4px 6px;border:1px solid #ddd"></td></tr>`
    ).join('')

    const totalAmt = printable.reduce((s, r) => s + (r.advance_amount || 0), 0)

    const html = `<div style="font-family:Arial;font-size:11px;padding:20px">
      <h2 style="text-align:center;margin-bottom:4px">Salary Advance Register</h2>
      <p style="text-align:center;color:#666;margin-top:0">${MONTHS[selectedMonth]} ${selectedYear}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:6px;border:1px solid #ddd">Sr</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:left">Employee</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:left">Dept</th>
          <th style="padding:6px;border:1px solid #ddd">Days</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:right">Amount</th>
          <th style="padding:6px;border:1px solid #ddd">Status</th>
          <th style="padding:6px;border:1px solid #ddd">Signature</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f0f0f0;font-weight:bold">
          <td colspan="4" style="padding:6px;border:1px solid #ddd;text-align:right">Total (${printable.length} employees)</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right">${fmtINR(totalAmt)}</td>
          <td colspan="2" style="padding:6px;border:1px solid #ddd"></td>
        </tr></tfoot>
      </table>
      <p style="margin-top:20px;font-size:9px;color:#999">Generated on ${new Date().toLocaleDateString('en-IN')}</p>
    </div>`

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    try {
      await html2pdf().set({
        margin: [8, 8, 8, 8], filename: `Advance_Register_${MONTHS[selectedMonth]}_${selectedYear}.pdf`,
        image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(container).save()
      toast.success('PDF exported')
    } finally { document.body.removeChild(container) }
  }

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Salary Advance</h2>
            <p className="section-subtitle mt-1">
              {monthYearLabel(selectedMonth, selectedYear)} — Calculate and process salary advances (55% gross for eligible employees).
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleExportPDF} className="btn-secondary text-xs">Export PDF</button>
            <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending} className="btn-primary">
              {calculateMutation.isPending ? 'Calculating...' : `Calculate Advances`}
            </button>
          </div>
        </div>

        {/* Policy Info */}
        <div className="card p-4 bg-blue-50/50 border-blue-200">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Policy:</span> Attendance counted from 1st to 20th (Sundays with {'\u2265'}4 working days count as paid days). If {'\u2265'}15 working days {'\u2192'} advance = 55% of gross salary. If {'<'}15 days {'\u2192'} advance = 80% of pro-rata salary due. Advance recovered from final salary.
          </p>
        </div>

        {/* Summary Cards */}
        {allRecords.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="stat-card border-l-4 border-l-blue-400">
              <span className="text-xs font-semibold text-slate-400 uppercase">Total Employees</span>
              <span className="text-2xl font-bold text-slate-800">{totals.total || 0}</span>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-400">
              <span className="text-xs font-semibold text-slate-400 uppercase">Eligible</span>
              <span className="text-2xl font-bold text-emerald-700">{totals.eligible || 0}</span>
            </div>
            <div className="stat-card border-l-4 border-l-amber-400">
              <span className="text-xs font-semibold text-slate-400 uppercase">Total Advance</span>
              <span className="text-xl font-bold text-slate-800">{fmtINR(totals.totalAmount || 0)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-green-400">
              <span className="text-xs font-semibold text-slate-400 uppercase">Paid</span>
              <span className="text-xl font-bold text-green-700">{fmtINR(totals.paidAmount || 0)}</span>
              <span className="text-xs text-slate-400">{totals.paid || 0} employees</span>
            </div>
            <div className="stat-card border-l-4 border-l-slate-400">
              <span className="text-xs font-semibold text-slate-400 uppercase">No Advance</span>
              <span className="text-2xl font-bold text-slate-500">{noAdvanceCount}</span>
            </div>
          </div>
        )}

        {/* Filter tabs + search + bulk actions */}
        {allRecords.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All', count: allRecords.length },
                { key: 'eligible', label: 'Eligible', count: eligibleUnpaid.length },
                { key: 'paid', label: 'Paid', count: allRecords.filter(r => r.paid).length },
                { key: 'no-advance', label: 'No Advance', count: noAdvanceCount },
                { key: 'ineligible', label: 'Ineligible', count: allRecords.filter(r => !r.is_eligible).length },
              ].map(f => (
                <button key={f.key} onClick={() => setFilterView(f.key)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    filterView === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}>{f.label} ({f.count})</button>
              ))}
            </div>
            <input type="text" placeholder="Search name, code, dept..." value={search} onChange={e => setSearch(e.target.value)} className="input w-48 text-xs" />
            {selected.size > 0 && (
              <div className="flex gap-1">
                <button onClick={() => batchPaidMutation.mutate()} disabled={batchPaidMutation.isPending} className="btn-primary text-xs">
                  Mark {selected.size} Paid
                </button>
                <button onClick={() => batchRemarkMutation.mutate({ remark: 'NO_ADVANCE' })} className="btn-ghost text-xs border border-slate-200">
                  No Advance ({selected.size})
                </button>
                <button onClick={() => setRemarkModal('bulk')} className="btn-ghost text-xs border border-slate-200">
                  Reduce ({selected.size})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        {allRecords.length === 0 && !isLoading ? (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">₹</div>
            <h3 className="font-semibold text-slate-700 mb-2">No advance data for {monthYearLabel(selectedMonth, selectedYear)}</h3>
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
                    <SortHeader k="employee_name"><Abbr code="Emp">Employee</Abbr></SortHeader>
                    <SortHeader k="department"><Abbr code="Dept">Dept</Abbr></SortHeader>
                    <SortHeader k="working_days_1_to_15" className="text-center">Days (1-20)</SortHeader>
                    <SortHeader k="is_eligible" className="text-center">Eligible</SortHeader>
                    <SortHeader k="advance_amount" className="text-center">Amount</SortHeader>
                    <th>Remark</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <React.Fragment key={r.id}>
                    <tr onClick={() => toggleRow(r.id)} className={clsx(
                      'transition-colors cursor-pointer hover:bg-blue-50/50',
                      isExpanded(r.id) && 'bg-blue-50/70',
                      r.remark === 'NO_ADVANCE' && 'opacity-40',
                      !r.is_eligible && !isExpanded(r.id) && r.remark !== 'NO_ADVANCE' && 'opacity-50'
                    )}>
                      <td>
                        {r.is_eligible && !r.paid && r.remark !== 'NO_ADVANCE' && (
                          <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => {
                            e.stopPropagation()
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
                        {r.is_eligible ? <span className="badge-green text-xs">Yes</span> : <span className="badge-red text-xs">No</span>}
                      </td>
                      <td className="font-mono font-bold text-center">
                        {r.remark === 'NO_ADVANCE' ? <span className="text-slate-400 line-through">{fmtINR(0)}</span> :
                         r.is_eligible ? fmtINR(r.advance_amount) : '\u2014'}
                      </td>
                      <td>
                        {r.remark === 'NO_ADVANCE' ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">No Advance</span> :
                         r.remark === 'REDUCED' ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">Reduced</span> :
                         '\u2014'}
                      </td>
                      <td>
                        {r.paid ? <span className="badge-green text-xs">Paid</span> :
                         r.remark === 'NO_ADVANCE' ? <span className="text-slate-300">\u2014</span> :
                         r.is_eligible ? <span className="badge-yellow text-xs">Pending</span> :
                         <span className="text-slate-400">\u2014</span>}
                      </td>
                      <td>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {r.is_eligible && !r.paid && r.remark !== 'NO_ADVANCE' && (
                            <button onClick={() => markPaidMutation.mutate(r.id)} className="btn-ghost text-[10px] text-green-600 px-1">Paid</button>
                          )}
                          {r.is_eligible && !r.paid && (
                            <>
                              <button onClick={() => setRemarkMutation.mutate({ id: r.id, remark: 'NO_ADVANCE' })} className="btn-ghost text-[10px] text-slate-500 px-1">No Adv.</button>
                              <button onClick={() => { setRemarkModal({ id: r.id, code: r.employee_code, name: r.employee_name, amount: r.advance_amount }); setReduceAmount(String(r.advance_amount)) }} className="btn-ghost text-[10px] text-amber-600 px-1">Reduce</button>
                            </>
                          )}
                          {r.remark === 'NO_ADVANCE' && (
                            <button onClick={() => setRemarkMutation.mutate({ id: r.id, remark: '' })} className="btn-ghost text-[10px] text-blue-600 px-1">Undo</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded(r.id) && (
                      <DrillDownRow colSpan={9}>
                        <EmployeeQuickView employeeCode={r.employee_code}
                          contextContent={
                            <div className="text-xs space-y-2">
                              <p className="font-semibold text-slate-600">Advance Details</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex justify-between"><span className="text-slate-500">Working Days (1st-20th)</span><span className="font-mono font-medium">{r.working_days_1_to_15}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Eligible</span><span className={r.is_eligible ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{r.is_eligible ? 'Yes' : 'No'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Advance Amount</span><span className="font-mono font-bold">{r.is_eligible ? fmtINR(r.advance_amount) : '\u2014'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Remark</span><span className="font-medium">{r.remark || '\u2014'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="font-medium">{r.paid ? 'Paid' : r.remark === 'NO_ADVANCE' ? 'No Advance' : r.is_eligible ? 'Pending' : '\u2014'}</span></div>
                                {r.paid_date && <div className="flex justify-between"><span className="text-slate-500">Paid Date</span><span className="font-mono">{r.paid_date}</span></div>}
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

      {/* Reduce Amount Modal */}
      {remarkModal && remarkModal !== 'bulk' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setRemarkModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-glass-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1 text-sm">Reduce Advance</h3>
            <p className="text-xs text-slate-500 mb-3">{remarkModal.name} ({remarkModal.code})</p>
            <p className="text-xs text-slate-400 mb-2">System calculated: {fmtINR(remarkModal.amount)}</p>
            <label className="label">Reduced Amount</label>
            <input type="number" value={reduceAmount} onChange={e => setReduceAmount(e.target.value)} className="input" placeholder="Enter reduced amount" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setRemarkMutation.mutate({ id: remarkModal.id, remark: 'REDUCED', reducedAmount: parseFloat(reduceAmount) })} disabled={!reduceAmount || parseFloat(reduceAmount) <= 0} className="btn-primary flex-1 text-sm">Save</button>
              <button onClick={() => setRemarkModal(null)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Reduce Modal */}
      {remarkModal === 'bulk' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setRemarkModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-glass-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1 text-sm">Bulk Reduce Advance</h3>
            <p className="text-xs text-slate-500 mb-3">{selected.size} employees selected</p>
            <label className="label">Reduced Amount (same for all)</label>
            <input type="number" value={reduceAmount} onChange={e => setReduceAmount(e.target.value)} className="input" placeholder="Enter reduced amount" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => batchRemarkMutation.mutate({ remark: 'REDUCED', reducedAmount: parseFloat(reduceAmount) })} disabled={!reduceAmount || parseFloat(reduceAmount) <= 0} className="btn-primary flex-1 text-sm">Apply to {selected.size}</button>
              <button onClick={() => setRemarkModal(null)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
