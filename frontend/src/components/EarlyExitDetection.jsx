import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getEarlyExits, getEarlyExitSummary, detectEarlyExits,
  getEarlyExitEmployeeAnalytics, submitEarlyExitDeduction,
  cancelEarlyExitDeduction, reviseEarlyExitDeduction
} from '../utils/api'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function flagColor(mins) {
  if (mins > 120) return 'bg-red-100 text-red-700'
  if (mins >= 30) return 'bg-amber-100 text-amber-700'
  return 'bg-yellow-100 text-yellow-700'
}

export default function EarlyExitDetection({ selectedMonth, selectedYear, selectedCompany }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const [showDetectModal, setShowDetectModal] = useState(false)
  const [detectDate, setDetectDate] = useState((() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] })())

  const { data: summaryRes } = useQuery({
    queryKey: ['early-exit-summary', selectedMonth, selectedYear, selectedCompany],
    queryFn: () => getEarlyExitSummary({ month: selectedMonth, year: selectedYear, company: selectedCompany || undefined })
  })
  const summary = summaryRes?.data || {}

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['early-exits', selectedMonth, selectedYear, selectedCompany, statusFilter],
    queryFn: () => getEarlyExits({
      month: selectedMonth,
      year: selectedYear,
      company: selectedCompany || undefined,
      detection_status: statusFilter || undefined
    })
  })
  const records = listRes?.data?.data || []

  const departments = useMemo(() => [...new Set(records.map(r => r.department).filter(Boolean))].sort(), [records])

  const filtered = useMemo(() => {
    let arr = records
    if (search) {
      const s = search.toLowerCase()
      arr = arr.filter(r =>
        r.employee_code?.toLowerCase().includes(s) ||
        r.employee_name?.toLowerCase().includes(s)
      )
    }
    if (deptFilter) arr = arr.filter(r => r.department === deptFilter)
    return arr
  }, [records, search, deptFilter])

  const detectMut = useMutation({
    mutationFn: () => detectEarlyExits({ date: detectDate }),
    onSuccess: (res) => {
      const d = res.data
      toast.success(`Detection complete: ${d.detected} flagged, ${d.exempted} exempted, ${d.skipped} skipped`)
      queryClient.invalidateQueries({ queryKey: ['early-exits'] })
      queryClient.invalidateQueries({ queryKey: ['early-exit-summary'] })
      setShowDetectModal(false)
    }
  })

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-sm text-slate-500">Total Flagged</div>
          <div className="text-2xl font-bold text-red-600">{summary.flagged || 0}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Pending HR Action</div>
          <div className="text-2xl font-bold text-amber-600">{summary.pending_hr || 0}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Pending Finance</div>
          <div className="text-2xl font-bold text-blue-600">{summary.pending_finance || 0}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Avg Minutes Early</div>
          <div className="text-2xl font-bold text-slate-700">{Math.round(summary.avg_flagged_minutes || 0)}</div>
          {summary.trend !== undefined && summary.trend !== 0 && (
            <div className={clsx('text-xs mt-1', summary.trend > 0 ? 'text-red-500' : 'text-green-500')}>
              {summary.trend > 0 ? '▲' : '▼'} {Math.abs(summary.trend)} vs prev 30d
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input className="input w-56" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="flagged">Flagged</option>
          <option value="actioned">Actioned</option>
          <option value="exempted">Exempted</option>
        </select>
        <select className="input w-48" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={() => setShowDetectModal(true)}>
          Re-run Detection
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
                <th className="px-3 py-2">Shift End</th>
                <th className="px-3 py-2">Punch Out</th>
                <th className="px-3 py-2">Flagged Min</th>
                <th className="px-3 py-2">Gate Pass</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No detections found. Run detection for a date to populate.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                    onClick={() => setSelectedRow(r)}>
                  <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-2 text-slate-600">{r.employee_code}</td>
                  <td className="px-3 py-2 text-slate-600">{r.department}</td>
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2">{r.shift_end_time}</td>
                  <td className="px-3 py-2">{r.actual_punch_out_time}</td>
                  <td className="px-3 py-2">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-bold', flagColor(r.flagged_minutes))}>
                      {r.flagged_minutes} min
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.has_gate_pass ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {r.gate_pass_overage_minutes > 0 ? 'Partial' : 'Yes'}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.detection_status} deductionStatus={r.deduction_finance_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detection Modal */}
      {showDetectModal && (
        <Modal show={true} onClose={() => setShowDetectModal(false)} title="Run Early Exit Detection" size="sm">
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Detection Date</label>
              <input type="date" className="input w-full" value={detectDate} onChange={e => setDetectDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn" onClick={() => setShowDetectModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => detectMut.mutate()} disabled={detectMut.isPending}>
                {detectMut.isPending ? 'Running...' : 'Run Detection'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail Panel */}
      {selectedRow && (
        <EarlyExitDetailPanel
          detection={selectedRow}
          onClose={() => setSelectedRow(null)}
          month={selectedMonth}
          year={selectedYear}
        />
      )}
    </div>
  )
}

function StatusBadge({ status, deductionStatus }) {
  if (deductionStatus === 'approved') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Approved</span>
  if (deductionStatus === 'pending') return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Pending Finance</span>
  if (deductionStatus === 'rejected') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Rejected</span>
  if (status === 'actioned') return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Actioned</span>
  if (status === 'exempted') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Exempted</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Flagged</span>
}

function EarlyExitDetailPanel({ detection, onClose, month, year }) {
  const queryClient = useQueryClient()
  const [deductionType, setDeductionType] = useState('half_day')
  const [customAmount, setCustomAmount] = useState('')
  const [hrRemark, setHrRemark] = useState('')
  const [remarkError, setRemarkError] = useState(false)

  const { data: analyticsRes } = useQuery({
    queryKey: ['early-exit-employee-analytics', detection.employee_code],
    queryFn: () => getEarlyExitEmployeeAnalytics(detection.employee_code)
  })
  const analytics = analyticsRes?.data || {}

  // Estimate daily gross for amount calculation
  const dailyGross = detection.daily_gross_at_time || 0
  const halfDayAmount = Math.round(dailyGross / 2)
  const fullDayAmount = dailyGross

  const computedAmount = deductionType === 'warning' ? 0
    : deductionType === 'half_day' ? halfDayAmount
    : deductionType === 'full_day' ? fullDayAmount
    : parseInt(customAmount) || 0

  // Auto remark
  const autoRemark = `Early exit on ${detection.date}: left at ${detection.actual_punch_out_time} (shift ends ${detection.shift_end_time}), ${detection.flagged_minutes} min early.${detection.has_gate_pass ? ' Had gate pass.' : ''}`

  const submitMut = useMutation({
    mutationFn: (data) => submitEarlyExitDeduction(data),
    onSuccess: () => {
      toast.success('Deduction submitted for finance approval')
      queryClient.invalidateQueries({ queryKey: ['early-exits'] })
      queryClient.invalidateQueries({ queryKey: ['early-exit-summary'] })
      onClose()
    }
  })

  const cancelMut = useMutation({
    mutationFn: () => cancelEarlyExitDeduction(detection.deduction_id),
    onSuccess: () => {
      toast.success('Deduction cancelled')
      queryClient.invalidateQueries({ queryKey: ['early-exits'] })
      onClose()
    }
  })

  const reviseMut = useMutation({
    mutationFn: (data) => reviseEarlyExitDeduction(detection.deduction_id, data),
    onSuccess: () => {
      toast.success('Deduction revised and resubmitted')
      queryClient.invalidateQueries({ queryKey: ['early-exits'] })
      onClose()
    }
  })

  const handleSubmit = () => {
    const remarkText = hrRemark.trim() || autoRemark
    if (!remarkText) { setRemarkError(true); return }
    submitMut.mutate({
      early_exit_detection_id: detection.id,
      deduction_type: deductionType,
      deduction_amount: computedAmount || undefined,
      hr_remark: remarkText
    })
  }

  const handleRevise = () => {
    const remarkText = hrRemark.trim() || autoRemark
    if (!remarkText) { setRemarkError(true); return }
    reviseMut.mutate({
      deduction_type: deductionType,
      deduction_amount: computedAmount || undefined,
      hr_remark: remarkText
    })
  }

  const canAction = detection.detection_status === 'flagged' && !detection.deduction_finance_status
  const isRejected = detection.deduction_finance_status === 'rejected'
  const isPending = detection.deduction_finance_status === 'pending'

  return (
    <Modal show={true} onClose={onClose} title={`Early Exit — ${detection.employee_name}`} size="lg">
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Header */}
        <div className="flex gap-4 items-center">
          <div>
            <div className="font-semibold text-lg">{detection.employee_name}</div>
            <div className="text-sm text-slate-500">{detection.employee_code} — {detection.department}</div>
          </div>
          {analytics.is_habitual && (
            <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-bold">HABITUAL</span>
          )}
        </div>

        {/* Analytics */}
        {analytics.chart_data?.length > 0 && (
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">30-Day Rolling Windows</div>
            <div className="flex gap-2">
              {analytics.chart_data.map((w, i) => (
                <div key={i} className="flex-1 text-center">
                  <div className={clsx('text-lg font-bold', w.count >= 3 ? 'text-red-600' : w.count > 0 ? 'text-amber-600' : 'text-green-600')}>
                    {w.count}
                  </div>
                  <div className="text-[10px] text-slate-400">{w.period}</div>
                </div>
              ))}
            </div>
            {analytics.trend !== 0 && (
              <div className={clsx('text-xs mt-1 text-center', analytics.trend > 0 ? 'text-red-500' : 'text-green-500')}>
                Trend: {analytics.trend > 0 ? '▲' : '▼'} {Math.abs(analytics.trend)} vs previous window
              </div>
            )}
          </div>
        )}

        {/* Detection Details */}
        <div className="card p-3 grid grid-cols-3 gap-3 text-sm">
          <div><span className="text-slate-500">Date:</span> {detection.date}</div>
          <div><span className="text-slate-500">Shift End:</span> {detection.shift_end_time}</div>
          <div><span className="text-slate-500">Punch Out:</span> {detection.actual_punch_out_time}</div>
          <div><span className="text-slate-500">Minutes Early:</span> {detection.minutes_early}</div>
          <div><span className="text-slate-500">Flagged:</span> {detection.flagged_minutes} min</div>
          <div><span className="text-slate-500">Gate Pass:</span> {detection.has_gate_pass ? 'Yes' : 'No'}</div>
        </div>

        {/* Auto Remark */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          {autoRemark}
        </div>

        {/* Pending Finance */}
        {isPending && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
            <div className="font-semibold text-blue-800">Pending Finance Approval</div>
            <div className="text-blue-600 mt-1">Type: {detection.deduction_type} | Amount: ₹{detection.deduction_amount}</div>
            <button className="btn text-xs mt-2 text-red-600 border-red-200" onClick={() => cancelMut.mutate()}>
              Cancel Submission
            </button>
          </div>
        )}

        {/* Rejected */}
        {isRejected && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
            <div className="font-semibold text-red-800">Rejected by Finance</div>
            {detection.finance_remark && <div className="text-red-600 mt-1">Remark: {detection.finance_remark}</div>}
          </div>
        )}

        {/* HR Action Section */}
        {(canAction || isRejected) && (
          <div className="space-y-3 border-t pt-3">
            <div className="font-semibold text-sm">
              {isRejected ? 'Revise and Resubmit' : 'HR Deduction Action'}
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Deduction Type</label>
              <select className="input w-full" value={deductionType} onChange={e => setDeductionType(e.target.value)}>
                <option value="warning">Warning (no deduction)</option>
                <option value="half_day">Half-Day ({halfDayAmount > 0 ? `₹${halfDayAmount}` : ''})</option>
                <option value="full_day">Full-Day ({fullDayAmount > 0 ? `₹${fullDayAmount}` : ''})</option>
                <option value="custom">Custom Amount</option>
              </select>
            </div>

            {deductionType === 'custom' && (
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">Amount (₹)</label>
                <input type="number" className="input w-full" value={customAmount}
                       onChange={e => setCustomAmount(e.target.value)} min="1" />
              </div>
            )}

            {deductionType !== 'warning' && computedAmount > 0 && (
              <div className="text-sm text-slate-600">Deduction amount: <strong>₹{computedAmount}</strong></div>
            )}

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">HR Remark</label>
              <textarea
                className={clsx('input w-full', remarkError && 'border-red-400')}
                rows={2}
                value={hrRemark}
                onChange={e => { setHrRemark(e.target.value); setRemarkError(false) }}
                placeholder={autoRemark}
              />
              {remarkError && <div className="text-xs text-red-500 mt-1">Remark is required</div>}
            </div>

            <div className="flex justify-end gap-3">
              <button className="btn" onClick={onClose}>Close</button>
              {isRejected ? (
                <button className="btn btn-primary" onClick={handleRevise} disabled={reviseMut.isPending}>
                  {reviseMut.isPending ? 'Submitting...' : 'Revise and Resubmit'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitMut.isPending}>
                  {submitMut.isPending ? 'Submitting...' : 'Submit for Finance Approval'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* History */}
        {analytics.history?.length > 0 && (
          <div className="border-t pt-3">
            <div className="font-semibold text-sm mb-2">Detection History</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500 uppercase">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Flagged</th>
                    <th className="px-2 py-1">Gate Pass</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Deduction</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.history.slice(0, 20).map(h => (
                    <tr key={h.id} className="border-b border-slate-100">
                      <td className="px-2 py-1">{h.date}</td>
                      <td className="px-2 py-1">{h.flagged_minutes}m</td>
                      <td className="px-2 py-1">{h.has_gate_pass ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1"><StatusBadge status={h.detection_status} deductionStatus={h.deduction_finance_status} /></td>
                      <td className="px-2 py-1">{h.deduction_type || '—'} {h.deduction_amount ? `₹${h.deduction_amount}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
