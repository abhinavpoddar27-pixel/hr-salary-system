import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getComplianceItems, updateComplianceItem, generateComplianceCalendar, getPFStatement, getESIStatement } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { fmtDate, fmtINR } from '../utils/formatters'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ComplianceRow({ item, onEdit }) {
  const isOverdue = item.status === 'Pending' && new Date(item.due_date) < new Date()
  return (
    <tr>
      <td>
        <span className={`badge ${item.type === 'PF' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'} font-bold`}>
          {item.type}
        </span>
      </td>
      <td>{MONTH_NAMES[item.month]} {item.year}</td>
      <td className={isOverdue ? 'text-red-600 font-semibold' : ''}>{fmtDate(item.due_date)}</td>
      <td>
        <span className={`badge ${
          item.status === 'Filed' ? 'badge-present' :
          item.status === 'Pending' && isOverdue ? 'badge-absent' :
          'badge-corrected'
        }`}>
          {item.status}
          {isOverdue && item.status === 'Pending' && ' ⚠ OVERDUE'}
        </span>
      </td>
      <td>{item.challan_number || '—'}</td>
      <td>{item.filing_date ? fmtDate(item.filing_date) : '—'}</td>
      <td className="text-right">{item.amount ? fmtINR(item.amount) : '—'}</td>
      <td>{item.remarks || '—'}</td>
      <td>
        <button onClick={() => onEdit(item)} className="btn-secondary text-xs">Edit</button>
      </td>
    </tr>
  )
}

function EditComplianceModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({
    status: item.status || 'Pending',
    challanNumber: item.challan_number || '',
    filingDate: item.filing_date || '',
    amount: item.amount || '',
    remarks: item.remarks || ''
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800 mb-4">{item.type} — {MONTH_NAMES[item.month]} {item.year}</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="select">
              {['Pending', 'Filed', 'Overdue', 'Partial'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Challan Number</label>
            <input type="text" value={form.challanNumber} onChange={e => setForm(f => ({ ...f, challanNumber: e.target.value }))} className="input" placeholder="ECR challan number..." />
          </div>
          <div>
            <label className="label">Filing Date</label>
            <input type="date" value={form.filingDate} onChange={e => setForm(f => ({ ...f, filingDate: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Amount (₹)</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Remarks</label>
            <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="input" placeholder="Notes..." />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={() => onSave(item.id, form)} className="btn-primary flex-1">Save</button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Compliance() {
  const { selectedMonth, selectedYear } = useAppStore()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState('calendar')
  const [editItem, setEditItem] = useState(null)
  const [filterType, setFilterType] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const { toggle: pfToggle, isExpanded: pfIsExpanded } = useExpandableRows()
  const { toggle: esiToggle, isExpanded: esiIsExpanded } = useExpandableRows()

  const { data: compRes, isLoading } = useQuery({
    queryKey: ['compliance', selectedYear],
    queryFn: () => getComplianceItems(selectedYear),
    retry: 0
  })
  const items = compRes?.data?.data || []

  const { data: pfRes } = useQuery({
    queryKey: ['pf-statement', selectedMonth, selectedYear],
    queryFn: () => getPFStatement(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'pf'
  })
  const pfData = pfRes?.data?.data || {}

  const { data: esiRes } = useQuery({
    queryKey: ['esi-statement', selectedMonth, selectedYear],
    queryFn: () => getESIStatement(selectedMonth, selectedYear),
    retry: 0,
    enabled: activeTab === 'esi'
  })
  const esiData = esiRes?.data?.data || {}

  const generateMutation = useMutation({
    mutationFn: () => generateComplianceCalendar(selectedYear),
    onSuccess: () => { toast.success('Compliance calendar generated'); qc.invalidateQueries(['compliance', selectedYear]) }
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateComplianceItem(id, data),
    onSuccess: () => { toast.success('Updated'); setEditItem(null); qc.invalidateQueries(['compliance', selectedYear]) }
  })

  const filteredItems = items.filter(i => {
    if (filterType !== 'All' && i.type !== filterType) return false
    if (filterStatus !== 'All' && i.status !== filterStatus) return false
    return true
  })

  const pfTotal = pfData.totals?.employeePF + pfData.totals?.employerPF + pfData.totals?.eps || 0
  const esiTotal = esiData.totals?.employeeESI + esiData.totals?.employerESI || 0

  // Summary stats
  const pendingCount = items.filter(i => i.status === 'Pending').length
  const overdueCount = items.filter(i => i.status === 'Pending' && new Date(i.due_date) < new Date()).length
  const filedCount = items.filter(i => i.status === 'Filed').length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Compliance</h2>
          <p className="text-sm text-slate-500">PF/ESI filings, statutory compliance tracking</p>
        </div>
        <button onClick={() => generateMutation.mutate()} className="btn-primary" disabled={generateMutation.isPending}>
          {generateMutation.isPending ? 'Generating...' : `Generate Calendar ${selectedYear}`}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4 text-center border-l-4 border-l-green-500">
          <div className="text-2xl font-bold text-green-600">{filedCount}</div>
          <div className="text-xs text-slate-500 mt-1">Filed</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-l-amber-500">
          <div className="text-2xl font-bold text-amber-600">{pendingCount - overdueCount}</div>
          <div className="text-xs text-slate-500 mt-1">Pending</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-l-red-500">
          <div className="text-2xl font-bold text-red-600">{overdueCount}</div>
          <div className="text-xs text-slate-500 mt-1">Overdue</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-l-slate-300">
          <div className="text-2xl font-bold text-slate-700">{items.length}</div>
          <div className="text-xs text-slate-500 mt-1">Total Items</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0">
        {[{ id: 'calendar', label: 'Compliance Calendar' }, { id: 'pf', label: 'PF Details' }, { id: 'esi', label: 'ESI Details' }].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Calendar Tab */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="select max-w-[140px]">
              <option value="All">All Types</option>
              <option>PF</option>
              <option>ESI</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="select max-w-[160px]">
              <option value="All">All Statuses</option>
              <option>Pending</option>
              <option>Filed</option>
              <option>Overdue</option>
            </select>
          </div>

          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <div className="text-4xl mb-2">📋</div>
                <p>No compliance items found. Click "Generate Calendar {selectedYear}" to create them.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-compact w-full">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Period</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      <th>Challan No.</th>
                      <th>Filed On</th>
                      <th className="text-right">Amount</th>
                      <th>Remarks</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item => (
                      <ComplianceRow key={item.id} item={item} onEdit={setEditItem} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PF Tab */}
      {activeTab === 'pf' && (
        <div className="space-y-4">
          {/* Totals */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card p-4 text-center">
              <div className="text-xl font-bold text-blue-600">{fmtINR(pfData.totals?.employeePF || 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Employee PF (12%)</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xl font-bold text-green-600">{fmtINR(pfData.totals?.employerPF || 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Employer PF (3.67%)</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xl font-bold text-purple-600">{fmtINR(pfData.totals?.eps || 0)}</div>
              <div className="text-xs text-slate-500 mt-1">EPS (8.33%)</div>
            </div>
            <div className="card p-4 text-center bg-blue-50">
              <div className="text-xl font-bold text-blue-700">{fmtINR(pfData.totals?.total || 0)}</div>
              <div className="text-xs text-slate-600 mt-1 font-semibold">Total Liability</div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">PF Statement — {MONTH_NAMES[selectedMonth]} {selectedYear}</h3>
              <div className="text-sm text-slate-500">{pfData.employees?.length || 0} employees</div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>UAN</th>
                    <th className="text-right">PF Wages</th>
                    <th className="text-right">EE PF (12%)</th>
                    <th className="text-right">ER PF (3.67%)</th>
                    <th className="text-right">EPS (8.33%)</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(pfData.employees || []).length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-6 text-slate-400">Compute salary first</td></tr>
                  ) : (pfData.employees || []).map((e, i) => (
                    <React.Fragment key={e.employee_code || i}>
                      <tr onClick={() => pfToggle(e.employee_code || i)} className={`cursor-pointer transition-colors hover:bg-blue-50/50 ${pfIsExpanded(e.employee_code || i) ? 'bg-blue-50' : ''}`}>
                        <td className="font-medium"><DrillDownChevron isExpanded={pfIsExpanded(e.employee_code || i)} /> {e.employee_name}</td>
                        <td className="text-slate-500">{e.employee_code}</td>
                        <td className="text-slate-400">{e.uan || '—'}</td>
                        <td className="text-right">{fmtINR(e.pf_wages)}</td>
                        <td className="text-right">{fmtINR(e.employee_pf)}</td>
                        <td className="text-right">{fmtINR(e.employer_pf)}</td>
                        <td className="text-right">{fmtINR(e.eps)}</td>
                        <td className="text-right font-semibold">{fmtINR((e.employee_pf || 0) + (e.employer_pf || 0) + (e.eps || 0))}</td>
                      </tr>
                      {pfIsExpanded(e.employee_code || i) && (
                        <DrillDownRow colSpan={8}>
                          <EmployeeQuickView
                            employeeCode={e.employee_code}
                            contextContent={
                              <div>
                                <div className="text-xs font-semibold text-slate-500 mb-2">PF Contribution Details</div>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">PF Wages</div>
                                    <div className="text-sm font-bold text-slate-700">{fmtINR(e.pf_wages)}</div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">EE PF (12%)</div>
                                    <div className="text-sm font-bold text-blue-700">{fmtINR(e.employee_pf)}</div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">ER PF (3.67%)</div>
                                    <div className="text-sm font-bold text-green-700">{fmtINR(e.employer_pf)}</div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">EPS (8.33%)</div>
                                    <div className="text-sm font-bold text-purple-700">{fmtINR(e.eps)}</div>
                                  </div>
                                </div>
                              </div>
                            }
                          />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                {(pfData.employees || []).length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={3} className="text-right text-slate-600">TOTAL</td>
                      <td className="text-right">{fmtINR(pfData.totals?.pfWages || 0)}</td>
                      <td className="text-right">{fmtINR(pfData.totals?.employeePF || 0)}</td>
                      <td className="text-right">{fmtINR(pfData.totals?.employerPF || 0)}</td>
                      <td className="text-right">{fmtINR(pfData.totals?.eps || 0)}</td>
                      <td className="text-right text-brand-700">{fmtINR(pfData.totals?.total || 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ESI Tab */}
      {activeTab === 'esi' && (
        <div className="space-y-4">
          <div className="card p-3 bg-amber-50 border border-amber-200 text-sm text-amber-800">
            ESI applies to employees with gross salary ≤ ₹21,000/month. Employee: 0.75%, Employer: 3.25%
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <div className="text-xl font-bold text-blue-600">{fmtINR(esiData.totals?.employeeESI || 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Employee ESI (0.75%)</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xl font-bold text-green-600">{fmtINR(esiData.totals?.employerESI || 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Employer ESI (3.25%)</div>
            </div>
            <div className="card p-4 text-center bg-purple-50">
              <div className="text-xl font-bold text-purple-700">{fmtINR(esiData.totals?.total || 0)}</div>
              <div className="text-xs text-slate-600 mt-1 font-semibold">Total Liability</div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">ESI Statement — {MONTH_NAMES[selectedMonth]} {selectedYear}</h3>
              <div className="text-sm text-slate-500">{esiData.employees?.length || 0} employees under ESI</div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Code</th>
                    <th>ESI Number</th>
                    <th className="text-right">Gross Wages</th>
                    <th className="text-right">EE ESI (0.75%)</th>
                    <th className="text-right">ER ESI (3.25%)</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(esiData.employees || []).length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-slate-400">Compute salary first</td></tr>
                  ) : (esiData.employees || []).map((e, i) => (
                    <React.Fragment key={e.employee_code || i}>
                      <tr onClick={() => esiToggle(e.employee_code || i)} className={`cursor-pointer transition-colors hover:bg-blue-50/50 ${esiIsExpanded(e.employee_code || i) ? 'bg-blue-50' : ''}`}>
                        <td className="font-medium"><DrillDownChevron isExpanded={esiIsExpanded(e.employee_code || i)} /> {e.employee_name}</td>
                        <td className="text-slate-500">{e.employee_code}</td>
                        <td className="text-slate-400">{e.esi_number || '—'}</td>
                        <td className="text-right">{fmtINR(e.esi_wages)}</td>
                        <td className="text-right">{fmtINR(e.employee_esi)}</td>
                        <td className="text-right">{fmtINR(e.employer_esi)}</td>
                        <td className="text-right font-semibold">{fmtINR((e.employee_esi || 0) + (e.employer_esi || 0))}</td>
                      </tr>
                      {esiIsExpanded(e.employee_code || i) && (
                        <DrillDownRow colSpan={7}>
                          <EmployeeQuickView
                            employeeCode={e.employee_code}
                            contextContent={
                              <div>
                                <div className="text-xs font-semibold text-slate-500 mb-2">ESI Contribution Details</div>
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">Gross Wages</div>
                                    <div className="text-sm font-bold text-slate-700">{fmtINR(e.esi_wages)}</div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">EE ESI (0.75%)</div>
                                    <div className="text-sm font-bold text-blue-700">{fmtINR(e.employee_esi)}</div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="text-[10px] text-slate-400 uppercase">ER ESI (3.25%)</div>
                                    <div className="text-sm font-bold text-green-700">{fmtINR(e.employer_esi)}</div>
                                  </div>
                                </div>
                              </div>
                            }
                          />
                        </DrillDownRow>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                {(esiData.employees || []).length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={3} className="text-right text-slate-600">TOTAL</td>
                      <td className="text-right">{fmtINR(esiData.totals?.esiWages || 0)}</td>
                      <td className="text-right">{fmtINR(esiData.totals?.employeeESI || 0)}</td>
                      <td className="text-right">{fmtINR(esiData.totals?.employerESI || 0)}</td>
                      <td className="text-right text-brand-700">{fmtINR(esiData.totals?.total || 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <EditComplianceModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={(id, data) => updateMutation.mutate({ id, data })}
        />
      )}
    </div>
  )
}
