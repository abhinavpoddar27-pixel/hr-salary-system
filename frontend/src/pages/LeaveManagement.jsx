import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLeaveApplications, submitLeaveApplication, approveLeave, rejectLeave, getEmployees, getLeaveSummary } from '../utils/api'
import { useAppStore } from '../store/appStore'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

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

export default function LeaveManagement() {
  const { selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [showApply, setShowApply] = useState(false)
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: leavesRes, isLoading } = useQuery({
    queryKey: ['leave-applications', selectedMonth, selectedYear, statusFilter !== 'All' ? statusFilter : undefined],
    queryFn: () => getLeaveApplications({
      month: selectedMonth, year: selectedYear,
      ...(statusFilter !== 'All' ? { status: statusFilter } : {})
    })
  })
  const leaves = leavesRes?.data?.data || []
  const stats = leavesRes?.data?.stats || {}

  const { data: empRes } = useQuery({
    queryKey: ['employees-list'],
    queryFn: () => getEmployees({ status: 'Active' })
  })
  const employees = empRes?.data?.data || []

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
        <button className="btn btn-primary" onClick={() => setShowApply(true)}>
          + Apply Leave
        </button>
      </div>

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
                  <tr key={l.id}>
                    <td>
                      <div className="font-medium text-slate-800">{l.employee_name || l.employee_code}</div>
                      <div className="text-xs text-slate-500">{l.employee_code}{l.department ? ` | ${l.department}` : ''}</div>
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
    </div>
  )
}
