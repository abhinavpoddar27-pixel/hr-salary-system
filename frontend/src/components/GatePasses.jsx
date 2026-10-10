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
                      <span
                        className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold"
                        title={r.breach_reason ? `Over allowance — ${r.breach_reason}` : 'Over the monthly allowance'}
                      >BREACH</span>
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

// Monthly allowance (owner ruling 10 Oct 2026): 2 Short Leaves OR 1 Half Day.
// The server is the source of truth; these mirror it only for the screen.
const SHORT_LEAVE_HOURS = 2
const MIN_BREACH_REASON = 10

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}` }

function usedText(q) {
  const parts = []
  if (q.short_leaves_used) parts.push(plural(q.short_leaves_used, 'Short Leave'))
  if (q.half_days_used) parts.push(plural(q.half_days_used, 'Half Day'))
  return parts.length ? parts.join(' + ') : 'nothing yet'
}

function stillAllowedText(q) {
  if (q.can_half_day) return '2 Short Leaves or 1 Half Day'
  if (q.can_short_leave) return '1 Short Leave'
  return 'nothing more this month'
}

function CreateGatePassModal({ show, onClose, company, month, year }) {
  const queryClient = useQueryClient()
  const { user } = useAppStore()
  const isAdmin = user?.role === 'admin'
  const [empCode, setEmpCode] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [leaveType, setLeaveType] = useState('short_leave')
  const [remark, setRemark] = useState('')
  const [remarkError, setRemarkError] = useState(false)
  const [breachReason, setBreachReason] = useState('')

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

  // Quota for the month of the chosen date
  const dateObj = date ? new Date(date + 'T00:00:00') : null
  const qMonth = dateObj ? dateObj.getMonth() + 1 : month
  const qYear = dateObj ? dateObj.getFullYear() : year

  const { data: quotaRes, isFetching: quotaLoading } = useQuery({
    queryKey: ['short-leave-quota', empCode, qMonth, qYear],
    queryFn: () => getShortLeaveQuota(empCode, { month: qMonth, year: qYear }),
    enabled: !!empCode && !!dateObj && !isNaN(dateObj?.getTime())
  })
  const quota = quotaRes?.data

  const canType = (t) => !quota || (t === 'half_day' ? quota.can_half_day : quota.can_short_leave)
  const overQuota = !!quota && !canType(leaveType)
  const blocked = overQuota && !isAdmin
  const reasonOk = breachReason.trim().length >= MIN_BREACH_REASON

  const createMut = useMutation({
    mutationFn: (data) => createShortLeave(data),
    onSuccess: (res) => {
      toast.success(res?.data?.quota_breach ? 'Gate pass created over the monthly allowance' : 'Gate pass created')
      queryClient.invalidateQueries({ queryKey: ['short-leaves'] })
      queryClient.invalidateQueries({ queryKey: ['short-leave-quota'] })
      onClose()
    },
    onError: (err) => {
      const data = err.response?.data
      // Quota may have changed since the screen loaded — refresh it so the
      // modal shows the current allowance, and say why it was refused.
      queryClient.invalidateQueries({ queryKey: ['short-leave-quota'] })
      toast.error(data?.message || data?.error || 'Could not create the gate pass')
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
      force_quota_breach: overQuota && isAdmin,
      breach_reason: overQuota && isAdmin ? breachReason.trim() : undefined
    })
  }

  const quotaColor = !quota ? 'text-slate-500' :
    quota.remaining_points === 0 ? 'text-red-600' :
    quota.used_points > 0 ? 'text-amber-600' : 'text-green-600'

  const submitDisabled = !empCode || !date || createMut.isPending || blocked ||
    (overQuota && isAdmin && !reasonOk) || (!!empCode && quotaLoading && !quota)

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
          <div className="flex gap-4 flex-wrap">
            {[
              { value: 'short_leave', label: `Short Leave (${SHORT_LEAVE_HOURS} hrs)` },
              { value: 'half_day', label: 'Half Day' },
            ].map(opt => {
              const unavailable = !!quota && !canType(opt.value)
              return (
                <label key={opt.value} className={clsx('flex items-center gap-2 cursor-pointer', unavailable && !isAdmin && 'opacity-50 cursor-not-allowed')}>
                  <input
                    type="radio"
                    name="gate-pass-type"
                    value={opt.value}
                    checked={leaveType === opt.value}
                    disabled={unavailable && !isAdmin}
                    onChange={() => setLeaveType(opt.value)}
                  />
                  <span className="text-sm">{opt.label}</span>
                  {unavailable && <span className="text-xs text-red-500">not available</span>}
                </label>
              )
            })}
          </div>
          <div className="text-xs text-slate-400 mt-1">Allowance: 2 Short Leaves or 1 Half Day per month</div>
        </div>

        {/* Duration (read-only) + allowance */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-700 mb-1 block">Duration</label>
            <input className="input w-full bg-slate-50" value={leaveType === 'short_leave' ? `${SHORT_LEAVE_HOURS} hrs` : 'Half shift'} readOnly />
          </div>
          {quota && (
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700 mb-1 block">This month</label>
              <div className={clsx('text-sm font-semibold mt-1', quotaColor)}>
                Used: {usedText(quota)}
                <div className="text-xs font-normal text-slate-500 mt-0.5">Still allowed: {stillAllowedText(quota)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Over the allowance */}
        {blocked && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {leaveType === 'half_day' ? 'A Half Day' : 'A Short Leave'} is not available — the monthly allowance (2 Short Leaves or 1 Half Day) is used up. Only an admin can allow one more.
          </div>
        )}
        {overQuota && isAdmin && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-sm text-amber-800 mb-1">
              This goes over the monthly allowance. It will be marked as a breach. Write why you are allowing it.
            </div>
            <textarea
              className={clsx('input w-full', breachReason && !reasonOk && 'border-red-400')}
              rows={2}
              value={breachReason}
              onChange={e => setBreachReason(e.target.value)}
              placeholder="Reason for going over the allowance (at least 10 characters)"
              aria-label="Reason for going over the allowance"
            />
            {!reasonOk && <div className="text-xs text-amber-700 mt-1">{Math.max(0, MIN_BREACH_REASON - breachReason.trim().length)} more characters needed</div>}
          </div>
        )}

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
              className={clsx('btn-primary disabled:opacity-50', overQuota && 'from-amber-500 to-amber-600')}
              onClick={handleSubmit}
              disabled={submitDisabled}
              title={!empCode ? 'Select an employee first' : !date ? 'Pick a date' : blocked ? 'Monthly allowance used up' : undefined}
            >
              {createMut.isPending ? 'Creating...' : overQuota && isAdmin ? 'Create over allowance' : 'Create Gate Pass'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
