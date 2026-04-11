import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getShortLeaves, createShortLeave, getShortLeaveQuota, cancelShortLeave, getEmployees } from '../utils/api'
import { useAppStore } from '../store/appStore'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500'
}

export default function GatePasses() {
  const { selectedCompany, selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: res, isLoading } = useQuery({
    queryKey: ['short-leaves', selectedMonth, selectedYear, selectedCompany, typeFilter, statusFilter],
    queryFn: () => getShortLeaves({
      calendar_month: selectedMonth,
      calendar_year: selectedYear,
      company: selectedCompany || undefined,
      leave_type: typeFilter || undefined,
      status: statusFilter || undefined
    })
  })
  const records = res?.data?.data || []

  const filtered = useMemo(() => {
    if (!search) return records
    const s = search.toLowerCase()
    return records.filter(r =>
      r.employee_code?.toLowerCase().includes(s) ||
      r.employee_name?.toLowerCase().includes(s) ||
      r.department?.toLowerCase().includes(s)
    )
  }, [records, search])

  const totalActive = records.filter(r => r.status === 'active').length
  const breachCount = records.filter(r => r.quota_breach && r.status === 'active').length
  const cancelledCount = records.filter(r => r.status === 'cancelled').length

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }) => cancelShortLeave(id, { cancel_reason: reason }),
    onSuccess: () => { toast.success('Gate pass cancelled'); queryClient.invalidateQueries({ queryKey: ['short-leaves'] }) },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to cancel')
  })

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-sm text-slate-500">Total This Month</div>
          <div className="text-2xl font-bold text-blue-600">{totalActive}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Quota Breaches</div>
          <div className="text-2xl font-bold text-red-600">{breachCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Cancelled</div>
          <div className="text-2xl font-bold text-slate-600">{cancelledCount}</div>
        </div>
      </div>

      {/* Filters + Create */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="input w-56"
          placeholder="Search employee..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-40" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="short_leave">Short Leave</option>
          <option value="half_day">Half Day</option>
        </select>
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Gate Pass
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Dept</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Leave Until</th>
                <th className="px-3 py-2">Remark</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No gate passes found</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-2 text-slate-600">{r.employee_code}</td>
                  <td className="px-3 py-2 text-slate-600">{r.department}</td>
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                      {r.leave_type === 'short_leave' ? 'Short Leave' : 'Half Day'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.duration_hours}h</td>
                  <td className="px-3 py-2">{r.authorized_leave_until}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.remark}>{r.remark}</td>
                  <td className="px-3 py-2">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[r.status])}>
                      {r.status}
                    </span>
                    {r.quota_breach ? (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">BREACH</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === 'active' && (
                      <button
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                        onClick={() => {
                          if (confirm('Cancel this gate pass?')) {
                            cancelMut.mutate({ id: r.id, reason: 'Cancelled by HR' })
                          }
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateGatePassModal
          show={showCreate}
          onClose={() => setShowCreate(false)}
          company={selectedCompany}
          month={selectedMonth}
          year={selectedYear}
        />
      )}
    </div>
  )
}

function CreateGatePassModal({ show, onClose, company, month, year }) {
  const queryClient = useQueryClient()
  const [empCode, setEmpCode] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [leaveType, setLeaveType] = useState('short_leave')
  const [remark, setRemark] = useState('')
  const [forceQuota, setForceQuota] = useState(false)
  const [remarkError, setRemarkError] = useState(false)

  const { data: empRes } = useQuery({
    queryKey: ['employees-active', company],
    queryFn: () => getEmployees({ status: 'Active', company: company || undefined })
  })
  const employees = empRes?.data?.data || []

  const filteredEmps = useMemo(() => {
    if (!empSearch) return employees.slice(0, 20)
    const s = empSearch.toLowerCase()
    return employees.filter(e =>
      e.code?.toLowerCase().includes(s) ||
      e.name?.toLowerCase().includes(s)
    ).slice(0, 20)
  }, [employees, empSearch])

  const selectedEmp = employees.find(e => e.code === empCode)

  // Quota check
  const dateObj = date ? new Date(date + 'T00:00:00') : null
  const qMonth = dateObj ? dateObj.getMonth() + 1 : month
  const qYear = dateObj ? dateObj.getFullYear() : year

  const { data: quotaRes } = useQuery({
    queryKey: ['short-leave-quota', empCode, qMonth, qYear],
    queryFn: () => getShortLeaveQuota(empCode, { month: qMonth, year: qYear }),
    enabled: !!empCode
  })
  const quota = quotaRes?.data

  // Compute duration
  const duration = leaveType === 'short_leave' ? 3 : 'Half shift'

  const createMut = useMutation({
    mutationFn: (data) => createShortLeave(data),
    onSuccess: (res) => {
      toast.success('Gate pass created')
      queryClient.invalidateQueries({ queryKey: ['short-leaves'] })
      onClose()
    },
    onError: (err) => {
      const data = err.response?.data
      if (data?.quota_warning && !forceQuota) {
        if (confirm(`${data.message} Create anyway (quota breach)?`)) {
          setForceQuota(true)
          createMut.mutate({
            employee_code: empCode,
            date,
            leave_type: leaveType,
            remark: remark.trim(),
            force_quota_breach: true
          })
        }
      }
    }
  })

  const handleSubmit = () => {
    if (!remark.trim()) {
      setRemarkError(true)
      return
    }
    setRemarkError(false)
    createMut.mutate({
      employee_code: empCode,
      date,
      leave_type: leaveType,
      remark: remark.trim(),
      force_quota_breach: forceQuota
    })
  }

  const quotaColor = !quota ? 'text-slate-500' :
    quota.used >= 2 ? 'text-red-600' :
    quota.used === 1 ? 'text-amber-600' : 'text-green-600'

  return (
    <Modal show={show} onClose={onClose} title="Create Gate Pass" size="md">
      <div className="space-y-4 p-4">
        {/* Employee search */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1 block">Employee</label>
          <input
            className="input w-full"
            placeholder="Search by name or code..."
            value={empSearch}
            onChange={e => { setEmpSearch(e.target.value); setEmpCode('') }}
          />
          {empSearch && !empCode && (
            <div className="border rounded-md mt-1 max-h-40 overflow-y-auto bg-white shadow-sm">
              {filteredEmps.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-400 italic">
                  No employees found matching "{empSearch}"
                </div>
              ) : (
                filteredEmps.map(e => (
                  <button
                    key={e.code}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b border-slate-100"
                    onClick={() => { setEmpCode(e.code); setEmpSearch(`${e.name} (${e.code})`) }}
                  >
                    {e.name} <span className="text-slate-400">({e.code})</span> — {e.department}
                  </button>
                ))
              )}
            </div>
          )}
          {selectedEmp && <div className="text-xs text-slate-500 mt-1">{selectedEmp.department} | {selectedEmp.company}</div>}
          {!empCode && !empSearch && (
            <div className="text-xs text-slate-400 mt-1">Start typing to search by name or code</div>
          )}
        </div>

        {/* Date */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1 block">Date</label>
          <input type="date" className="input w-full" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        {/* Leave type */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1 block">Leave Type</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="short_leave" checked={leaveType === 'short_leave'} onChange={() => setLeaveType('short_leave')} />
              <span className="text-sm">Short Leave (3 hrs)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="half_day" checked={leaveType === 'half_day'} onChange={() => setLeaveType('half_day')} />
              <span className="text-sm">Half Day</span>
            </label>
          </div>
        </div>

        {/* Duration (read-only) */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-700 mb-1 block">Duration</label>
            <input className="input w-full bg-slate-50" value={typeof duration === 'number' ? `${duration} hrs` : duration} readOnly />
          </div>
          {quota && (
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700 mb-1 block">Quota</label>
              <div className={clsx('text-sm font-semibold mt-1', quotaColor)}>
                {quota.used >= 2 && '⚠ '}{quota.used} / {quota.limit} used
                {quota.used >= 2 && <div className="text-xs font-normal text-red-500 mt-0.5">Quota exceeded — will be a breach</div>}
              </div>
            </div>
          )}
        </div>

        {/* Remark */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1 block">Remark *</label>
          <textarea
            className={clsx('input w-full', remarkError && 'border-red-400')}
            rows={2}
            value={remark}
            onChange={e => { setRemark(e.target.value); setRemarkError(false) }}
            placeholder="Reason for gate pass..."
          />
          {remarkError && <div className="text-xs text-red-500 mt-1">Remark is required</div>}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500 flex-1">
            {!empCode && <span className="text-amber-600">⚠ Select an employee to continue</span>}
            {empCode && !date && <span className="text-amber-600">⚠ Pick a date</span>}
          </div>
          <div className="flex gap-3">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className={clsx('btn', quota?.used >= 2 ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'btn-primary')}
              onClick={handleSubmit}
              disabled={!empCode || !date || createMut.isPending}
              title={!empCode ? 'Select an employee first' : !date ? 'Pick a date' : undefined}
            >
              {createMut.isPending ? 'Creating...' : quota?.used >= 2 ? 'Create Gate Pass (Quota Breach)' : 'Create Gate Pass'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
