import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getLoans, createLoan as createLoanApi, approveLoan, rejectLoan,
  closeLoan, getLoanDetails, processLoanDeductions
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import Modal from '../components/ui/Modal'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

const LOAN_TYPES = ['Salary Advance', 'Personal Loan', 'Festival Advance', 'Emergency']
const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-700',
  Active: 'bg-green-100 text-green-700',
  Completed: 'bg-blue-100 text-blue-700',
  Rejected: 'bg-red-100 text-red-700',
  Closed: 'bg-slate-100 text-slate-600',
}

export default function Loans() {
  const { selectedMonth, selectedYear } = useAppStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [filterType, setFilterType] = useState('')
  const { toggle: toggleDrill, isExpanded: isDrillExpanded } = useExpandableRows()

  const { data: res, isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => getLoans(),
    retry: 0
  })
  const allLoans = res?.data?.data || []
  const stats = res?.data?.stats || {}

  const loans = useMemo(() => {
    let filtered = allLoans
    if (tab === 'pending') filtered = filtered.filter(l => l.status === 'Pending')
    else if (tab === 'active') filtered = filtered.filter(l => l.status === 'Active')
    else if (tab === 'completed') filtered = filtered.filter(l => l.status === 'Completed' || l.status === 'Closed')
    if (filterType) filtered = filtered.filter(l => l.loan_type === filterType)
    return filtered
  }, [allLoans, tab, filterType])

  const TABS = [
    { id: 'all', label: 'All Loans', count: allLoans.length },
    { id: 'pending', label: 'Pending', count: allLoans.filter(l => l.status === 'Pending').length },
    { id: 'active', label: 'Active', count: allLoans.filter(l => l.status === 'Active').length },
    { id: 'completed', label: 'Closed', count: allLoans.filter(l => l.status === 'Completed' || l.status === 'Closed').length },
  ]

  const approveMutation = useMutation({
    mutationFn: ({ id, startMonth, startYear }) => approveLoan(id, { startMonth, startYear }),
    onSuccess: () => { toast.success('Loan approved'); qc.invalidateQueries({ queryKey: ['loans'] }); }
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => rejectLoan(id, { reason }),
    onSuccess: () => { toast.success('Loan rejected'); qc.invalidateQueries({ queryKey: ['loans'] }); }
  })

  const closeMutation = useMutation({
    mutationFn: ({ id, reason }) => closeLoan(id, { reason }),
    onSuccess: () => { toast.success('Loan closed'); qc.invalidateQueries({ queryKey: ['loans'] }); }
  })

  const processDeductionsMutation = useMutation({
    mutationFn: () => processLoanDeductions(selectedMonth, selectedYear),
    onSuccess: (res) => {
      toast.success(`${res.data.processed} deductions processed`)
      qc.invalidateQueries({ queryKey: ['loans'] })
    }
  })

  return (
    <div className="p-6 space-y-5 max-w-screen-xl animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="section-title">Loan Management</h2>
          <p className="section-subtitle mt-1">Create, approve, and track employee loans with automatic EMI deductions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => processDeductionsMutation.mutate()} className="btn-ghost text-sm"
            disabled={processDeductionsMutation.isPending}>
            Process Deductions ({selectedMonth}/{selectedYear})
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + New Loan
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="stat-card border-l-4 border-l-blue-400">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Loans</span>
          <span className="text-2xl font-bold text-slate-800">{stats.totalLoans || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-green-400">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active</span>
          <span className="text-2xl font-bold text-green-600">{stats.activeLoans || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-amber-400">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Approval</span>
          <span className="text-2xl font-bold text-amber-600">{stats.pendingApproval || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-purple-400">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Outstanding</span>
          <span className="text-2xl font-bold text-purple-600">{stats.outstandingBalance?.toLocaleString() || 0}</span>
        </div>
        <div className="stat-card border-l-4 border-l-cyan-400">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recovered</span>
          <span className="text-2xl font-bold text-cyan-600">{stats.totalRecovered?.toLocaleString() || 0}</span>
        </div>
      </div>

      {/* Tabs + Filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              )}>
              {t.label} <span className="text-xs opacity-70 ml-1">({t.count})</span>
            </button>
          ))}
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="select text-sm w-44">
          <option value="">All types</option>
          {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Loans Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>#</th>
                <th>Employee</th>
                <th><Abbr code="Dept">Dept</Abbr></th>
                <th>Type</th>
                <th className="text-right">Principal</th>
                <th className="text-right"><Abbr code="EMI">EMI</Abbr></th>
                <th className="text-center">Tenure</th>
                <th className="text-right">Recovered</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    Loading...
                  </div>
                </td></tr>
              ) : loans.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-slate-400">
                  No loans found. Click "+ New Loan" to create one.
                </td></tr>
              ) : loans.map(l => (
                <React.Fragment key={l.id}>
                <tr onClick={() => toggleDrill(l.id)} className="cursor-pointer hover:bg-blue-50/50 transition-colors">
                  <td className="text-slate-400 text-xs">{l.id}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <DrillDownChevron isExpanded={isDrillExpanded(l.id)} />
                      <div>
                        <div className="font-medium text-sm">{l.employee_name || l.employee_code}</div>
                        <div className="text-xs text-slate-400 font-mono">{l.employee_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-sm">{l.department}</td>
                  <td>
                    <span className="text-xs font-medium px-2 py-0.5 bg-slate-100 rounded">{l.loan_type}</span>
                  </td>
                  <td className="text-right font-mono">{l.principal_amount?.toLocaleString()}</td>
                  <td className="text-right font-mono">{l.emi_amount?.toLocaleString()}</td>
                  <td className="text-center">{l.tenure_months}m</td>
                  <td className="text-right font-mono text-green-600">{(l.total_recovered || 0).toLocaleString()}</td>
                  <td className="text-right font-mono text-amber-600">{(l.remaining_balance || 0).toLocaleString()}</td>
                  <td>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[l.status] || 'bg-slate-100 text-slate-600')}>
                      {l.status}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => setShowDetail(l.id)} className="btn-ghost text-xs px-2 py-1">View</button>
                      {l.status === 'Pending' && (
                        <>
                          <button onClick={() => approveMutation.mutate({
                            id: l.id,
                            startMonth: l.start_month || selectedMonth,
                            startYear: l.start_year || selectedYear
                          })} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100">
                            Approve
                          </button>
                          <button onClick={() => rejectMutation.mutate({ id: l.id, reason: 'Rejected by admin' })}
                            className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100">
                            Reject
                          </button>
                        </>
                      )}
                      {l.status === 'Active' && (
                        <button onClick={() => closeMutation.mutate({ id: l.id, reason: 'Early closure' })}
                          className="text-xs px-2 py-1 bg-slate-50 text-slate-700 rounded hover:bg-slate-100">
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {isDrillExpanded(l.id) && (
                  <DrillDownRow colSpan={11}>
                    <EmployeeQuickView
                      employeeCode={l.employee_code}
                      contextContent={
                        <div>
                          <div className="text-xs font-semibold text-slate-500 mb-2">Loan Details</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-slate-400">Loan Type:</span> <span className="font-medium">{l.loan_type}</span></div>
                            <div><span className="text-slate-400">Principal:</span> <span className="font-mono">₹{Number(l.principal_amount || 0).toLocaleString('en-IN')}</span></div>
                            <div><span className="text-slate-400">EMI:</span> <span className="font-mono">₹{Number(l.emi_amount || 0).toLocaleString('en-IN')}</span></div>
                            <div><span className="text-slate-400">Remaining:</span> <span className="font-mono">₹{Number(l.remaining_balance || 0).toLocaleString('en-IN')}</span></div>
                            <div><span className="text-slate-400">Tenure:</span> <span>{l.tenure_months} months</span></div>
                            <div><span className="text-slate-400">Status:</span> <span className="font-medium">{l.status}</span></div>
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

      {/* Create Loan Modal */}
      {showCreate && <CreateLoanModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['loans'] }); }} />}

      {/* Loan Detail Modal */}
      {showDetail && <LoanDetailModal loanId={showDetail} onClose={() => setShowDetail(null)} />}

      <AbbreviationLegend keys={['EMI', 'Dept', 'PF', 'ESI']} />
    </div>
  )
}

function CreateLoanModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    employeeCode: '', loanType: 'Personal Loan',
    principalAmount: '', interestRate: 0, tenureMonths: 12, remarks: ''
  })

  const mutation = useMutation({
    mutationFn: () => createLoanApi(form),
    onSuccess: () => { toast.success('Loan created'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create loan')
  })

  const emi = form.principalAmount && form.tenureMonths
    ? Math.ceil(parseFloat(form.principalAmount) / parseInt(form.tenureMonths))
    : 0

  return (
    <Modal title="Create New Loan" onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Employee Code</label>
            <input type="text" value={form.employeeCode} onChange={e => setForm({ ...form, employeeCode: e.target.value })}
              className="input" placeholder="e.g. EMP001" />
          </div>
          <div>
            <label className="label">Loan Type</label>
            <select value={form.loanType} onChange={e => setForm({ ...form, loanType: e.target.value })} className="select">
              {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Principal Amount</label>
            <input type="number" value={form.principalAmount} onChange={e => setForm({ ...form, principalAmount: parseFloat(e.target.value) || '' })}
              className="input" placeholder="50000" />
          </div>
          <div>
            <label className="label">Interest Rate (%)</label>
            <input type="number" value={form.interestRate} onChange={e => setForm({ ...form, interestRate: parseFloat(e.target.value) || 0 })}
              className="input" step="0.5" />
          </div>
          <div>
            <label className="label">Tenure (months)</label>
            <input type="number" value={form.tenureMonths} onChange={e => setForm({ ...form, tenureMonths: parseInt(e.target.value) || 1 })}
              className="input" min="1" max="60" />
          </div>
        </div>

        {form.principalAmount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div className="text-sm text-blue-800">
              Estimated <Abbr code="EMI">EMI</Abbr>: <strong>₹{emi.toLocaleString()}</strong>/month for {form.tenureMonths} months
            </div>
          </div>
        )}

        <div>
          <label className="label">Remarks</label>
          <textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
            className="input min-h-[60px]" placeholder="Optional notes..." />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!form.employeeCode || !form.principalAmount || mutation.isPending}
            className="btn-primary">
            {mutation.isPending ? 'Creating...' : 'Create Loan'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LoanDetailModal({ loanId, onClose }) {
  const { data: res } = useQuery({
    queryKey: ['loan-detail', loanId],
    queryFn: () => getLoanDetails(loanId),
    retry: 0
  })
  const loan = res?.data?.data

  if (!loan) return (
    <Modal title="Loan Details" onClose={onClose}>
      <div className="text-center py-8 text-slate-400">Loading...</div>
    </Modal>
  )

  const progressPct = loan.total_amount > 0 ? Math.round((loan.total_recovered || 0) / loan.total_amount * 100) : 0

  return (
    <Modal title={`Loan #${loan.id} — ${loan.employee_name || loan.employee_code}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-500">Type</div>
            <div className="font-semibold text-sm">{loan.loan_type}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-500">Principal</div>
            <div className="font-semibold text-sm">₹{loan.principal_amount?.toLocaleString()}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-500"><Abbr code="EMI">EMI</Abbr></div>
            <div className="font-semibold text-sm">₹{loan.emi_amount?.toLocaleString()}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-500">Status</div>
            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[loan.status])}>{loan.status}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-500">Recovery Progress</span>
            <span className="font-semibold text-slate-700">{progressPct}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2.5">
            <div className="bg-green-500 h-2.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Recovered: ₹{(loan.total_recovered || 0).toLocaleString()}</span>
            <span>Remaining: ₹{(loan.remaining_balance || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Repayment Schedule */}
        {loan.repayments && loan.repayments.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-slate-700 mb-2">Repayment Schedule</h4>
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className="py-1 text-left">#</th>
                    <th className="py-1 text-left">Month</th>
                    <th className="py-1 text-right"><Abbr code="EMI">EMI</Abbr></th>
                    <th className="py-1 text-right">Principal</th>
                    <th className="py-1 text-right">Interest</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.repayments.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 text-slate-400">{i + 1}</td>
                      <td className="py-1">{['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.month]} {r.year}</td>
                      <td className="py-1 text-right font-mono">₹{r.emi_amount?.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono">₹{r.principal_component?.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono">₹{r.interest_component?.toLocaleString()}</td>
                      <td className="py-1">
                        <span className={clsx('px-1.5 py-0.5 rounded text-xs',
                          r.status === 'Deducted' ? 'bg-green-100 text-green-700' :
                          r.status === 'Cancelled' ? 'bg-slate-100 text-slate-500' :
                          'bg-amber-100 text-amber-700'
                        )}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  )
}
