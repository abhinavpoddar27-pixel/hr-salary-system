import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLeaveApplications, submitLeaveApplication, approveLeave, rejectLeave, getEmployees, getLeaveSummary, getLeaveBalancesList, getLeaveRegister, adjustLeave, getLeaveTransactions } from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import Modal from '../components/ui/Modal'
import CompanyFilter from '../components/shared/CompanyFilter'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import GatePasses from '../components/GatePasses'

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700'
}

const LEAVE_TYPES = [
  { value: 'CL', label: 'Casual Leave' },
  { value: 'EL', label: 'Earned Leave' },
  { value: 'SL', label: 'Sick Leave' },
  { value: 'LWP', label: 'Leave Without Pay' },
  { value: 'Comp Off', label: 'Compensatory Off' }
]

function ApplyLeaveModal({ show, onClose, employees }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    employee_code: '', leave_type: 'CL', start_date: '', end_date: '', days: 1, reason: ''
  })

  const submit = useMutation({
    mutationFn: (data) => submitLeaveApplication(data),
    onSuccess: () => {
      toast.success('Leave application submitted')
      queryClient.invalidateQueries({ queryKey: ['leave-applications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      onClose()
      setForm({ employee_code: '', leave_type: 'CL', start_date: '', end_date: '', days: 1, reason: '' })
    }
  })

  // Auto-calc days
  const calcDays = (start, end) => {
    if (!start || !end) return 1
    const d1 = new Date(start), d2 = new Date(end)
    const diff = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)) + 1
    return Math.max(1, diff)
  }

  const handleDateChange = (field, val) => {
    const updated = { ...form, [field]: val }
    if (updated.start_date && updated.end_date) {
      updated.days = calcDays(updated.start_date, updated.end_date)
    }
    setForm(updated)
  }

  if (!show) return null

  return (
    <Modal show={show} onClose={onClose} title="Apply for Leave" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
          <select className="input w-full" value={form.employee_code} onChange={e => setForm(f => ({ ...f, employee_code: e.target.value }))}>
            <option value="">Select Employee</option>
            {(employees || []).map(e => <option key={e.code} value={e.code}>{e.code} - {e.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Leave Type</label>
            <select className="input w-full" value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}>
              {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Days</label>
            <input type="number" className="input w-full" value={form.days} onChange={e => setForm(f => ({ ...f, days: parseFloat(e.target.value) || 1 }))} min="0.5" step="0.5" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
            <input type="date" className="input w-full" value={form.start_date} onChange={e => handleDateChange('start_date', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
            <input type="date" className="input w-full" value={form.end_date} onChange={e => handleDateChange('end_date', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
          <textarea className="input w-full" rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Enter reason for leave..." />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!form.employee_code || !form.start_date || !form.end_date || submit.isPending}
            onClick={() => submit.mutate(form)}
          >
            {submit.isPending ? 'Submitting...' : 'Submit Application'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const MAIN_TABS = [
  { id: 'applications', label: 'Applications' },
  { id: 'balances', label: 'Leave Balances' },
  { id: 'register', label: 'Leave Register' },
  { id: 'adjustments', label: 'Adjustments' },
  { id: 'gate_passes', label: 'Gate Passes' }
]

export default function LeaveManagement() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const queryClient = useQueryClient()
  const [mainTab, setMainTab] = useState('applications')
  const [statusFilter, setStatusFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [showApply, setShowApply] = useState(false)
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const { toggle: toggleDrill, isExpanded: isDrillExpanded } = useExpandableRows()

  // -- Balances tab state --
  const [balSearch, setBalSearch] = useState('')

  // -- Adjustments tab state --
  const [adjForm, setAdjForm] = useState({ employee_code: '', leave_type: 'CL', transaction_type: 'Credit', days: 1, reason: '' })
  const [adjViewCode, setAdjViewCode] = useState('')

  const { data: leavesRes, isLoading } = useQuery({
    queryKey: ['leave-applications', month, year, statusFilter !== 'All' ? statusFilter : undefined, selectedCompany],
    queryFn: () => getLeaveApplications({
      month: month, year: year,
      company: selectedCompany,
      ...(statusFilter !== 'All' ? { status: statusFilter } : {})
    })
  })
  const leaves = leavesRes?.data?.data || []
  const stats = leavesRes?.data?.stats || {}

  const { data: empRes } = useQuery({
    queryKey: ['employees-list', selectedCompany],
    queryFn: () => getEmployees({ status: 'Active', company: selectedCompany })
  })
  const employees = empRes?.data?.data || []

  // -- Leave Balances query --
  const { data: balancesRes, isLoading: balLoading } = useQuery({
    queryKey: ['leave-balances-list', year, selectedCompany, balSearch],
    queryFn: () => getLeaveBalancesList({ company: selectedCompany, year, ...(balSearch ? { search: balSearch } : {}) }),
    enabled: mainTab === 'balances'
  })
  const balances = balancesRes?.data?.data || []

  // -- Leave Register query --
  const { data: registerRes, isLoading: regLoading } = useQuery({
    queryKey: ['leave-register', month, year, selectedCompany],
    queryFn: () => getLeaveRegister({ month, year, company: selectedCompany }),
    enabled: mainTab === 'register'
  })
  const registerData = registerRes?.data?.data || []

  // -- Adjustments: mutation + transactions query --
  const adjustMutation = useMutation({
    mutationFn: (data) => adjustLeave(data),
    onSuccess: () => {
      toast.success('Leave adjustment saved')
      queryClient.invalidateQueries({ queryKey: ['leave-balances-list'] })
      queryClient.invalidateQueries({ queryKey: ['leave-transactions'] })
      setAdjForm(f => ({ ...f, days: 1, reason: '' }))
    }
  })

  const { data: txnRes, isLoading: txnLoading } = useQuery({
    queryKey: ['leave-transactions', adjViewCode, year],
    queryFn: () => getLeaveTransactions(adjViewCode, { year }),
    enabled: mainTab === 'adjustments' && !!adjViewCode
  })
  const transactions = txnRes?.data?.data || []

  const approve = useMutation({
    mutationFn: (id) => approveLeave(id, { approved_by: 'admin' }),
    onSuccess: () => {
      toast.success('Leave approved')
      queryClient.invalidateQueries({ queryKey: ['leave-applications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }) => rejectLeave(id, { rejection_reason: reason }),
    onSuccess: () => {
      toast.success('Leave rejected')
      setRejectModal(null)
      setRejectReason('')
      queryClient.invalidateQueries({ queryKey: ['leave-applications'] })
    }
  })

  const filtered = useMemo(() => {
    let result = leaves
    if (typeFilter !== 'All') result = result.filter(l => l.leave_type === typeFilter)
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(l =>
        l.employee_code?.toLowerCase().includes(s) ||
        l.employee_name?.toLowerCase().includes(s)
      )
    }
    return result
  }, [leaves, typeFilter, search])

  const STAT_CARDS = [
    { label: 'Total Applications', value: stats.total || 0, color: 'blue' },
    { label: 'Pending', value: stats.pending || 0, color: 'amber' },
    { label: 'Approved', value: stats.approved || 0, color: 'green' },
    { label: 'Rejected', value: stats.rejected || 0, color: 'red' }
  ]

  const STATUS_TABS = ['All', 'Pending', 'Approved', 'Rejected']

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Leave Management</h2>
          <p className="text-sm text-slate-500">Manage leave applications and approvals</p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
        {mainTab === 'applications' && (
          <button className="btn btn-primary" onClick={() => setShowApply(true)}>
            + Apply Leave
          </button>
        )}
      </div>

      {/* Main Tabs */}
      <div className="flex bg-slate-100 rounded-lg p-0.5 w-fit">
        {MAIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            className={clsx('px-4 py-1.5 text-sm font-medium rounded-md transition-all', {
              'bg-white text-slate-800 shadow-sm': mainTab === t.id,
              'text-slate-500 hover:text-slate-700': mainTab !== t.id
            })}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Applications Tab ── */}
      {mainTab === 'applications' && <>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(s => (
          <div key={s.label} className="card p-4">
            <div className="text-sm text-slate-500">{s.label}</div>
            <div className={clsx('text-2xl font-bold mt-1', {
              'text-blue-600': s.color === 'blue',
              'text-amber-600': s.color === 'amber',
              'text-green-600': s.color === 'green',
              'text-red-600': s.color === 'red'
            })}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {STATUS_TABS.map(t => (
            <button
              key={t}
              onClick={() => setStatusFilter(t)}
              className={clsx('px-4 py-1.5 text-sm font-medium rounded-md transition-all', {
                'bg-white text-slate-800 shadow-sm': statusFilter === t,
                'text-slate-500 hover:text-slate-700': statusFilter !== t
              })}
            >{t}</button>
          ))}
        </div>

        <select className="input text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="All">All Types</option>
          {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <input
          type="text"
          className="input text-sm w-56"
          placeholder="Search employee..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th className="text-center">Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Applied</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">No leave applications found</td></tr>
              ) : (
                filtered.map(l => (
                  <React.Fragment key={l.id}>
                  <tr onClick={() => toggleDrill(l.id)} className="cursor-pointer hover:bg-blue-50/50 transition-colors">
                    <td>
                      <div className="flex items-center gap-1">
                        <DrillDownChevron isExpanded={isDrillExpanded(l.id)} />
                        <div>
                          <div className="font-medium text-slate-800">{l.employee_name || l.employee_code}</div>
                          <div className="text-xs text-slate-500">{l.employee_code}{l.department ? ` | ${l.department}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {l.leave_type}
                      </span>
                    </td>
                    <td className="text-sm">{l.start_date ? new Date(l.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}</td>
                    <td className="text-sm">{l.end_date ? new Date(l.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}</td>
                    <td className="text-center font-bold text-slate-700">{l.days}</td>
                    <td className="text-sm text-slate-600 max-w-40 truncate">{l.reason || '-'}</td>
                    <td>
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_COLORS[l.status] || 'bg-slate-100 text-slate-600')}>
                        {l.status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">
                      {l.applied_at ? new Date(l.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                    </td>
                    <td className="text-center">
                      {l.status === 'Pending' && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => approve.mutate(l.id)}
                            disabled={approve.isPending}
                            className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectModal(l)}
                            className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {l.status === 'Approved' && l.approved_by && (
                        <span className="text-xs text-slate-400">by {l.approved_by}</span>
                      )}
                    </td>
                  </tr>
                  {isDrillExpanded(l.id) && (
                    <DrillDownRow colSpan={9}>
                      <EmployeeQuickView
                        employeeCode={l.employee_code}
                        contextContent={
                          <div>
                            <div className="text-xs font-semibold text-slate-500 mb-2">Leave Details</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div><span className="text-slate-400">Leave Type:</span> <span className="font-medium">{l.leave_type}</span></div>
                              <div><span className="text-slate-400">From:</span> <span>{l.start_date ? new Date(l.start_date).toLocaleDateString('en-IN') : '-'}</span></div>
                              <div><span className="text-slate-400">To:</span> <span>{l.end_date ? new Date(l.end_date).toLocaleDateString('en-IN') : '-'}</span></div>
                              <div><span className="text-slate-400">Days:</span> <span className="font-medium">{l.days}</span></div>
                              <div className="col-span-2"><span className="text-slate-400">Reason:</span> <span>{l.reason || '-'}</span></div>
                              <div><span className="text-slate-400">Status:</span> <span className="font-medium">{l.status}</span></div>
                              <div><span className="text-slate-400">Applied:</span> <span>{l.applied_at ? new Date(l.applied_at).toLocaleDateString('en-IN') : '-'}</span></div>
                            </div>
                          </div>
                        }
                      />
                    </DrillDownRow>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal */}
      <ApplyLeaveModal show={showApply} onClose={() => setShowApply(false)} employees={employees} />

      {/* Reject Modal */}
      {rejectModal && (
        <Modal show={!!rejectModal} onClose={() => { setRejectModal(null); setRejectReason('') }} title="Reject Leave" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Reject leave for <span className="font-semibold">{rejectModal.employee_name || rejectModal.employee_code}</span>?
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason for Rejection</label>
              <textarea className="input w-full" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Enter reason..." />
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" onClick={() => { setRejectModal(null); setRejectReason('') }}>Cancel</button>
              <button
                className="btn bg-red-600 text-white hover:bg-red-700"
                disabled={reject.isPending}
                onClick={() => reject.mutate({ id: rejectModal.id, reason: rejectReason })}
              >
                {reject.isPending ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      </>}

      {/* ── Leave Balances Tab ── */}
      {mainTab === 'balances' && (
        <>
          <div className="flex items-center gap-4">
            <input
              type="text"
              className="input text-sm w-64"
              placeholder="Search by name or code..."
              value={balSearch}
              onChange={e => setBalSearch(e.target.value)}
            />
            <span className="text-sm text-slate-500">Year: {year}</span>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Company</th>
                    <th className="text-center">CL</th>
                    <th className="text-center">EL</th>
                    <th className="text-center">SL</th>
                    <th className="text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {balLoading ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading...</td></tr>
                  ) : balances.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-400">No leave balances found</td></tr>
                  ) : (
                    balances.map(b => (
                      <tr key={b.employee_code}>
                        <td className="font-medium text-slate-700">{b.employee_code}</td>
                        <td>{b.employee_name || b.name || '-'}</td>
                        <td className="text-sm text-slate-600">{b.department || '-'}</td>
                        <td className="text-sm text-slate-600">{b.company || '-'}</td>
                        <td className="text-center font-medium">{b.CL ?? b.cl ?? 0}</td>
                        <td className="text-center font-medium">{b.EL ?? b.el ?? 0}</td>
                        <td className="text-center font-medium">{b.SL ?? b.sl ?? 0}</td>
                        <td className="text-center font-bold text-slate-800">{(b.CL ?? b.cl ?? 0) + (b.EL ?? b.el ?? 0) + (b.SL ?? b.sl ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Leave Register Tab ── */}
      {mainTab === 'register' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Leave Type</th>
                  <th className="text-center">Days</th>
                  <th>Date</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {regLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading...</td></tr>
                ) : registerData.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">No leave records for this month</td></tr>
                ) : (
                  registerData.map((r, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-700">{r.employee_code}</td>
                      <td>{r.employee_name || r.name || '-'}</td>
                      <td className="text-sm text-slate-600">{r.department || '-'}</td>
                      <td>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          {r.leave_type}
                        </span>
                      </td>
                      <td className="text-center font-bold text-slate-700">{r.days}</td>
                      <td className="text-sm">{r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : (r.date || '-')}</td>
                      <td className="text-sm text-slate-600 max-w-48 truncate">{r.reason || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Adjustments Tab ── */}
      {mainTab === 'adjustments' && (
        <>
          {/* Adjustment Form */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">New Adjustment</h3>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Employee</label>
                <select
                  className="input w-full text-sm"
                  value={adjForm.employee_code}
                  onChange={e => {
                    setAdjForm(f => ({ ...f, employee_code: e.target.value }))
                    setAdjViewCode(e.target.value)
                  }}
                >
                  <option value="">Select Employee</option>
                  {(employees || []).map(e => <option key={e.code} value={e.code}>{e.code} - {e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Leave Type</label>
                <select className="input w-full text-sm" value={adjForm.leave_type} onChange={e => setAdjForm(f => ({ ...f, leave_type: e.target.value }))}>
                  <option value="CL">Casual Leave</option>
                  <option value="EL">Earned Leave</option>
                  <option value="SL">Sick Leave</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Transaction Type</label>
                <select className="input w-full text-sm" value={adjForm.transaction_type} onChange={e => setAdjForm(f => ({ ...f, transaction_type: e.target.value }))}>
                  <option value="Credit">Credit</option>
                  <option value="Debit">Debit</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Days</label>
                <input type="number" className="input w-full text-sm" value={adjForm.days} onChange={e => setAdjForm(f => ({ ...f, days: parseFloat(e.target.value) || 0 }))} min="0.5" step="0.5" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
                <input type="text" className="input w-full text-sm" value={adjForm.reason} onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason..." />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="btn btn-primary text-sm"
                disabled={!adjForm.employee_code || !adjForm.days || adjustMutation.isPending}
                onClick={() => adjustMutation.mutate(adjForm)}
              >
                {adjustMutation.isPending ? 'Saving...' : 'Submit Adjustment'}
              </button>
            </div>
          </div>

          {/* Transaction History */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Adjustment History</h3>
            </div>
            {!adjViewCode ? (
              <div className="text-center py-8 text-slate-400 text-sm">Select an employee to view history</div>
            ) : txnLoading ? (
              <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No transactions found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-compact w-full">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Leave Type</th>
                      <th>Type</th>
                      <th className="text-center">Days</th>
                      <th>Reason</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t, i) => (
                      <tr key={i}>
                        <td className="text-sm">{t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                        <td>
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{t.leave_type}</span>
                        </td>
                        <td>
                          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', {
                            'bg-green-100 text-green-700': t.transaction_type === 'Credit',
                            'bg-red-100 text-red-700': t.transaction_type === 'Debit'
                          })}>{t.transaction_type}</span>
                        </td>
                        <td className="text-center font-bold">{t.days}</td>
                        <td className="text-sm text-slate-600 max-w-48 truncate">{t.reason || '-'}</td>
                        <td className="text-xs text-slate-500">{t.created_by || t.adjusted_by || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Gate Passes Tab ── */}
      {mainTab === 'gate_passes' && <GatePasses />}

    </div>
  )
}
