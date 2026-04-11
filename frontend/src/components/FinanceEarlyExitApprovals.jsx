import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEarlyExitPendingFinance, getEarlyExitDeductions, approveEarlyExitDeduction, rejectEarlyExitDeduction } from '../utils/api'
import { useAppStore } from '../store/appStore'
import { fmtINR } from '../utils/formatters'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

export default function FinanceEarlyExitApprovals({ month, year }) {
  const { selectedCompany } = useAppStore()
  const queryClient = useQueryClient()
  const [subTab, setSubTab] = useState('pending')
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectRemark, setRejectRemark] = useState('')

  // Pending
  const { data: pendingRes, isLoading: pendingLoading } = useQuery({
    queryKey: ['early-exit-deductions-pending', month, year, selectedCompany],
    queryFn: () => getEarlyExitPendingFinance({ month, year, company: selectedCompany || undefined })
  })
  const pending = pendingRes?.data?.data || []

  // Approved
  const { data: approvedRes } = useQuery({
    queryKey: ['early-exit-deductions-approved', month, year, selectedCompany],
    queryFn: () => getEarlyExitDeductions({ month, year, finance_status: 'approved', company: selectedCompany || undefined }),
    enabled: subTab === 'approved'
  })
  const approved = approvedRes?.data?.data || []

  // Rejected
  const { data: rejectedRes } = useQuery({
    queryKey: ['early-exit-deductions-rejected', month, year, selectedCompany],
    queryFn: () => getEarlyExitDeductions({ month, year, finance_status: 'rejected', company: selectedCompany || undefined }),
    enabled: subTab === 'rejected'
  })
  const rejected = rejectedRes?.data?.data || []

  const approveMut = useMutation({
    mutationFn: (id) => approveEarlyExitDeduction(id),
    onSuccess: () => {
      toast.success('Deduction approved')
      queryClient.invalidateQueries({ queryKey: ['early-exit-deductions-pending'] })
      queryClient.invalidateQueries({ queryKey: ['early-exit-deductions-approved'] })
    }
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, remark }) => rejectEarlyExitDeduction(id, { finance_remark: remark }),
    onSuccess: () => {
      toast.success('Deduction rejected')
      setRejectModal(null)
      setRejectRemark('')
      queryClient.invalidateQueries({ queryKey: ['early-exit-deductions-pending'] })
      queryClient.invalidateQueries({ queryKey: ['early-exit-deductions-rejected'] })
    }
  })

  const handleReject = () => {
    if (!rejectRemark.trim()) {
      toast.error('Finance remark is required for rejection')
      return
    }
    rejectMut.mutate({ id: rejectModal.id, remark: rejectRemark.trim() })
  }

  const SUB_TABS = [
    { id: 'pending', label: 'Pending Approvals', badge: pending.length },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' }
  ]

  const renderTable = (data, showActions) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <th className="px-3 py-2">Employee</th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Shift End</th>
            <th className="px-3 py-2">Punch Out</th>
            <th className="px-3 py-2">Flagged Min</th>
            <th className="px-3 py-2">Gate Pass</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">HR Remark</th>
            {showActions && <th className="px-3 py-2">Actions</th>}
            {!showActions && <th className="px-3 py-2">Finance Remark</th>}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">No records</td></tr>
          ) : data.map(r => (
            <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50">
              <td className="px-3 py-2 font-medium">{r.employee_name}</td>
              <td className="px-3 py-2 text-slate-600">{r.employee_code}</td>
              <td className="px-3 py-2">{r.date}</td>
              <td className="px-3 py-2">{r.shift_end_time}</td>
              <td className="px-3 py-2">{r.actual_punch_out_time}</td>
              <td className="px-3 py-2">
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-bold',
                  r.flagged_minutes > 120 ? 'bg-red-100 text-red-700' :
                  r.flagged_minutes >= 30 ? 'bg-amber-100 text-amber-700' :
                  'bg-yellow-100 text-yellow-700'
                )}>
                  {r.flagged_minutes}m
                </span>
              </td>
              <td className="px-3 py-2">
                {r.has_gate_pass ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                    Yes{r.gate_pass_quota_breach ? ' (breach)' : ''}
                  </span>
                ) : <span className="text-xs text-slate-400">No</span>}
              </td>
              <td className="px-3 py-2 capitalize">{r.deduction_type?.replace('_', ' ')}</td>
              <td className="px-3 py-2 font-medium">{r.deduction_amount ? `₹${r.deduction_amount}` : '—'}</td>
              <td className="px-3 py-2 max-w-[150px] truncate text-slate-600" title={r.hr_remark}>{r.hr_remark}</td>
              {showActions ? (
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 font-medium"
                      onClick={() => {
                        if (confirm('Approve this deduction?')) approveMut.mutate(r.id)
                      }}
                      disabled={approveMut.isPending}
                    >
                      Approve
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                      onClick={() => { setRejectModal(r); setRejectRemark('') }}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              ) : (
                <td className="px-3 py-2 max-w-[150px] truncate text-slate-600" title={r.finance_remark}>{r.finance_remark || '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex bg-slate-100 rounded-lg p-0.5 w-fit">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={clsx('px-4 py-1.5 text-sm font-medium rounded-md transition-all', {
              'bg-white text-slate-800 shadow-sm': subTab === t.id,
              'text-slate-500 hover:text-slate-700': subTab !== t.id
            })}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="ml-1.5 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="card overflow-hidden">
        {subTab === 'pending' && renderTable(pending, true)}
        {subTab === 'approved' && renderTable(approved, false)}
        {subTab === 'rejected' && renderTable(rejected, false)}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <Modal show={true} onClose={() => setRejectModal(null)} title="Reject Early Exit Deduction" size="sm">
          <div className="p-4 space-y-4">
            <div className="text-sm">
              <strong>{rejectModal.employee_name}</strong> ({rejectModal.employee_code}) — {rejectModal.date}
            </div>
            <div className="text-sm">
              Type: <strong className="capitalize">{rejectModal.deduction_type?.replace('_', ' ')}</strong>
              {rejectModal.deduction_amount ? ` | Amount: ₹${rejectModal.deduction_amount}` : ''}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Finance Remark *</label>
              <textarea
                className="input w-full"
                rows={3}
                value={rejectRemark}
                onChange={e => setRejectRemark(e.target.value)}
                placeholder="Reason for rejection..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn" onClick={() => setRejectModal(null)}>Cancel</button>
              <button className="btn bg-red-600 hover:bg-red-700 text-white" onClick={handleReject} disabled={rejectMut.isPending}>
                {rejectMut.isPending ? 'Rejecting...' : 'Reject Deduction'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
