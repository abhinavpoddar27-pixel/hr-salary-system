import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getExtraDutyGrants, getExtraDutyGrantsSummary, createExtraDutyGrant,
  approveExtraDutyGrant, rejectExtraDutyGrant,
  financeApproveGrant, financeFlagGrant, financeRejectGrant, bulkFinanceApproveGrants,
  getFinanceReviewQueue
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import Modal from '../components/ui/Modal'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function KPI({ label, value, color = 'blue' }) {
  const colors = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700', indigo: 'text-indigo-700' }
  return <div className="card p-3"><div className={clsx('text-xl font-bold', colors[color])}>{value}</div><div className="text-[10px] text-slate-400 uppercase font-medium">{label}</div></div>
}

export default function ExtraDutyGrants() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()

  // Case-insensitive role check — the user-create endpoint doesn't normalise
  // `role`, so a user accidentally created with "Finance" instead of "finance"
  // would silently fail a plain equality check. Lowercasing here hardens both
  // the HR and Finance gates against that class of bug.
  const role = (user?.role || '').toLowerCase()
  const canHR = ['admin', 'hr'].includes(role)
  const canFinance = ['admin', 'finance'].includes(role)

  // Finance users land on the Finance Review tab by default; everyone else
  // starts on the HR queue.
  const [activeTab, setActiveTab] = useState(role === 'finance' ? 'finance' : 'hr')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ employee_code: '', grant_date: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1, verification_source: 'Gate Register', reference_number: '', remarks: '', original_punch_date: '' })
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [flagId, setFlagId] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagNotes, setFlagNotes] = useState('')
  const [finRejectId, setFinRejectId] = useState(null)
  const [finRejectReason, setFinRejectReason] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const qc = useQueryClient()

  const { data: sumRes } = useQuery({ queryKey: ['edg-summary', month, year], queryFn: () => getExtraDutyGrantsSummary(month, year), retry: 0 })
  const summary = sumRes?.data?.data || {}
  const { data: grantsRes } = useQuery({ queryKey: ['edg-list', month, year, activeTab], queryFn: () => activeTab === 'finance' ? getFinanceReviewQueue(month, year) : getExtraDutyGrants(month, year), retry: 0 })
  const grants = grantsRes?.data?.data || []

  // Bulk selection helpers — only the UNREVIEWED finance rows are selectable.
  const bulkEligibleIds = useMemo(
    () => grants.filter(g => g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED').map(g => g.id),
    [grants]
  )
  const allSelected = bulkEligibleIds.length > 0 && bulkEligibleIds.every(id => selectedIds.includes(id))
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : bulkEligibleIds)
  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const createMut = useMutation({ mutationFn: createExtraDutyGrant, onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setShowCreate(false); toast.success('Grant created') } })
  const approveMut = useMutation({ mutationFn: (id) => approveExtraDutyGrant(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); toast.success('Approved') } })
  const rejectMut = useMutation({ mutationFn: ({ id, reason }) => rejectExtraDutyGrant(id, reason), onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setRejectId(null); toast.success('Rejected') } })
  const finApproveMut = useMutation({ mutationFn: (id) => financeApproveGrant(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); toast.success('Finance approved') } })
  const finFlagMut = useMutation({
    mutationFn: ({ id, reason, notes }) => financeFlagGrant(id, reason, notes),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setFlagId(null); setFlagReason(''); setFlagNotes(''); toast.success('Flagged for review') }
  })
  const finRejectMut = useMutation({
    mutationFn: ({ id, reason }) => financeRejectGrant(id, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setFinRejectId(null); setFinRejectReason(''); toast.success('Finance rejected') }
  })
  const bulkFinApproveMut = useMutation({
    mutationFn: (ids) => bulkFinanceApproveGrants(ids),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setSelectedIds([]); toast.success(`${res?.data?.count || 0} grants approved`) }
  })

  const hrBadge = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-green-100 text-green-800', REJECTED: 'bg-red-100 text-red-800' }
  const finBadge = { UNREVIEWED: 'bg-slate-100 text-slate-600', FINANCE_APPROVED: 'bg-green-100 text-green-800', FINANCE_FLAGGED: 'bg-amber-100 text-amber-800', FINANCE_REJECTED: 'bg-red-100 text-red-800' }

  const showSelectColumn = activeTab === 'finance' && canFinance

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="section-title">Extra Duty Grants</h2><p className="section-subtitle mt-1">Manage overnight/extended shift grants with HR + Finance approval</p></div>
        <div className="flex items-center gap-3"><CompanyFilter /><DateSelector {...dateProps} /></div>
      </div>

      {/* Access diagnostic — only shown when the user has neither HR nor Finance
          access on a page that requires them. Surfaces the raw role value from
          localStorage so the admin can see exactly why access was denied and
          fix the underlying user record. */}
      {!canHR && !canFinance && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1">
          <div className="font-semibold">⚠ No approval access</div>
          <div>You're logged in as <strong>{user?.username || '(unknown)'}</strong> with role <code className="bg-amber-100 px-1 rounded">{JSON.stringify(user?.role)}</code>.</div>
          <div>To get HR or Finance approval buttons your role must be <code>hr</code>, <code>finance</code>, or <code>admin</code>. Ask an admin to update your role under Settings → User Management, then log out and back in.</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total" value={summary.total || 0} />
        <KPI label="Pending HR" value={summary.pending || 0} color="amber" />
        <KPI label="HR Approved" value={summary.hrApproved || 0} color="blue" />
        <KPI label="Finance OK" value={summary.financeApproved || 0} color="green" />
      </div>

      <div className="flex items-center gap-3">
        <div className="border-b border-slate-200 flex gap-0">
          {[{ id: 'hr', label: 'HR Queue' }, { id: 'finance', label: 'Finance Review' }, { id: 'all', label: 'All Grants' }].map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setSelectedIds([]) }}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {showSelectColumn && selectedIds.length > 0 && (
            <button onClick={() => bulkFinApproveMut.mutate(selectedIds)}
              disabled={bulkFinApproveMut.isPending}
              className="btn-primary text-sm">
              {bulkFinApproveMut.isPending ? 'Approving...' : `Bulk Approve (${selectedIds.length})`}
            </button>
          )}
          {canHR && <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ New Grant</button>}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-compact w-full text-[11px]">
          <thead>
            <tr>
              {showSelectColumn && (
                <th className="w-8">
                  <input type="checkbox"
                    checked={allSelected}
                    disabled={bulkEligibleIds.length === 0}
                    onChange={toggleSelectAll}
                    title="Select all UNREVIEWED rows" />
                </th>
              )}
              <th>Employee</th>
              <th>Dept</th>
              <th>Grant Date</th>
              <th>Type</th>
              <th>Days</th>
              <th>Source</th>
              <th>HR Status</th>
              <th>Finance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {grants.map(g => {
              const bulkEligible = g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED'
              return (
                <tr key={g.id} className={g.finance_status === 'FINANCE_FLAGGED' ? 'bg-amber-50' : ''}>
                  {showSelectColumn && (
                    <td>
                      <input type="checkbox"
                        disabled={!bulkEligible}
                        checked={selectedIds.includes(g.id)}
                        onChange={() => toggleSelect(g.id)} />
                    </td>
                  )}
                  <td className="font-medium">{g.employee_name || g.employee_code}<div className="text-[10px] text-slate-400">{g.employee_code}</div></td>
                  <td className="text-slate-500">{g.department}</td>
                  <td className="font-mono">{g.grant_date}</td>
                  <td className="text-xs">{g.grant_type?.replace(/_/g, ' ')}</td>
                  <td className="text-center font-mono">{g.duty_days}</td>
                  <td className="text-xs">{g.verification_source}</td>
                  <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', hrBadge[g.status])}>{g.status}</span></td>
                  <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', finBadge[g.finance_status])}>{g.finance_status?.replace('FINANCE_', '')}</span></td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {canHR && g.status === 'PENDING' && <>
                        <button onClick={() => approveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">Approve</button>
                        <button onClick={() => { setRejectId(g.id); setRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">Reject</button>
                      </>}
                      {canFinance && g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED' && <>
                        <button onClick={() => finApproveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✓ Approve</button>
                        <button onClick={() => { setFlagId(g.id); setFlagReason(''); setFlagNotes('') }} className="text-amber-600 hover:bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-medium">⚑ Flag</button>
                        <button onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✕ Reject</button>
                      </>}
                      {canFinance && g.status === 'APPROVED' && g.finance_status === 'FINANCE_FLAGGED' && <>
                        <button onClick={() => finApproveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✓ Approve</button>
                        <button onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✕ Reject</button>
                      </>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {grants.length === 0 && <tr><td colSpan={showSelectColumn ? 10 : 9} className="text-center py-8 text-slate-400">No grants for this period</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="New Extra Duty Grant">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Employee Code *</label><input value={form.employee_code} onChange={e => setForm(f => ({ ...f, employee_code: e.target.value }))} className="input" /></div>
              <div><label className="label">Grant Date *</label><input type="date" value={form.grant_date} onChange={e => setForm(f => ({ ...f, grant_date: e.target.value }))} className="input" /></div>
              <div><label className="label">Type</label><select value={form.grant_type} onChange={e => setForm(f => ({ ...f, grant_type: e.target.value }))} className="input"><option value="OVERNIGHT_STAY">Overnight Stay</option><option value="EXTENDED_SHIFT">Extended Shift</option><option value="OTHER">Other</option></select></div>
              <div><label className="label">Duty Days</label><input type="number" step="0.5" min="0.5" max="2" value={form.duty_days} onChange={e => setForm(f => ({ ...f, duty_days: parseFloat(e.target.value) }))} className="input" /></div>
              <div><label className="label">Verification Source *</label><select value={form.verification_source} onChange={e => setForm(f => ({ ...f, verification_source: e.target.value }))} className="input"><option>Gate Register</option><option>Production Office</option><option>Supervisor Confirmed</option><option>Other</option></select></div>
              <div><label className="label">Reference #</label><input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} className="input" /></div>
            </div>
            <div><label className="label">Remarks</label><textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="input w-full h-16" /></div>
            <button onClick={() => createMut.mutate({ ...form, month, year, company: selectedCompany })} disabled={createMut.isPending} className="btn-primary w-full">{createMut.isPending ? 'Creating...' : 'Create Grant'}</button>
          </div>
        </Modal>
      )}

      {/* HR Reject Modal */}
      {rejectId && (
        <Modal onClose={() => setRejectId(null)} title="Reject Grant">
          <div className="space-y-3">
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="input w-full h-20" placeholder="Rejection reason (required)..." />
            <button onClick={() => rejectMut.mutate({ id: rejectId, reason: rejectReason })} disabled={!rejectReason || rejectMut.isPending} className="btn-danger w-full">
              {rejectMut.isPending ? 'Rejecting...' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}

      {/* Finance Flag Modal */}
      {flagId && (
        <Modal onClose={() => setFlagId(null)} title="Flag Grant for Review">
          <div className="space-y-3">
            <div>
              <label className="label">Flag Reason *</label>
              <select value={flagReason} onChange={e => setFlagReason(e.target.value)} className="input w-full">
                <option value="">Select reason...</option>
                <option value="EXCESSIVE_AMOUNT">Excessive salary impact</option>
                <option value="DUPLICATE_SUSPECTED">Possible duplicate</option>
                <option value="MISSING_EVIDENCE">Missing verification evidence</option>
                <option value="RATE_MISMATCH">Rate calculation mismatch</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea value={flagNotes} onChange={e => setFlagNotes(e.target.value)}
                className="input w-full h-20" placeholder="Additional notes..." />
            </div>
            <button onClick={() => finFlagMut.mutate({ id: flagId, reason: flagReason, notes: flagNotes })}
              disabled={!flagReason || finFlagMut.isPending}
              className="btn-warning w-full">
              {finFlagMut.isPending ? 'Flagging...' : 'Flag for Review'}
            </button>
          </div>
        </Modal>
      )}

      {/* Finance Reject Modal */}
      {finRejectId && (
        <Modal onClose={() => setFinRejectId(null)} title="Finance Reject Grant">
          <div className="space-y-3">
            <textarea value={finRejectReason} onChange={e => setFinRejectReason(e.target.value)}
              className="input w-full h-20" placeholder="Rejection reason (required)..." />
            <button onClick={() => finRejectMut.mutate({ id: finRejectId, reason: finRejectReason })}
              disabled={!finRejectReason || finRejectMut.isPending}
              className="btn-danger w-full">
              {finRejectMut.isPending ? 'Rejecting...' : 'Finance Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
