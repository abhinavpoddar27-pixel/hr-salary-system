import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getExtraDutyGrants, getExtraDutyGrantsSummary, createExtraDutyGrant, approveExtraDutyGrant, rejectExtraDutyGrant, financeApproveGrant, financeFlagGrant, getFinanceReviewQueue } from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import { fmtINR } from '../utils/formatters'
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
  const [activeTab, setActiveTab] = useState('hr')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ employee_code: '', grant_date: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1, verification_source: 'Gate Register', reference_number: '', remarks: '', original_punch_date: '' })
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const qc = useQueryClient()

  const { data: sumRes } = useQuery({ queryKey: ['edg-summary', month, year], queryFn: () => getExtraDutyGrantsSummary(month, year), retry: 0 })
  const summary = sumRes?.data?.data || {}
  const { data: grantsRes } = useQuery({ queryKey: ['edg-list', month, year, activeTab], queryFn: () => activeTab === 'finance' ? getFinanceReviewQueue(month, year) : getExtraDutyGrants(month, year), retry: 0 })
  const grants = grantsRes?.data?.data || []

  const createMut = useMutation({ mutationFn: createExtraDutyGrant, onSuccess: () => { qc.invalidateQueries(['edg']); setShowCreate(false); toast.success('Grant created') } })
  const approveMut = useMutation({ mutationFn: (id) => approveExtraDutyGrant(id), onSuccess: () => { qc.invalidateQueries(['edg']); toast.success('Approved') } })
  const rejectMut = useMutation({ mutationFn: ({ id, reason }) => rejectExtraDutyGrant(id, reason), onSuccess: () => { qc.invalidateQueries(['edg']); setRejectId(null); toast.success('Rejected') } })
  const finApproveMut = useMutation({ mutationFn: (id) => financeApproveGrant(id), onSuccess: () => { qc.invalidateQueries(['edg']); toast.success('Finance approved') } })

  const canHR = ['admin', 'hr'].includes(user?.role)
  const canFinance = ['admin', 'finance'].includes(user?.role)

  const hrBadge = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-green-100 text-green-800', REJECTED: 'bg-red-100 text-red-800' }
  const finBadge = { UNREVIEWED: 'bg-slate-100 text-slate-600', FINANCE_APPROVED: 'bg-green-100 text-green-800', FINANCE_FLAGGED: 'bg-amber-100 text-amber-800', FINANCE_REJECTED: 'bg-red-100 text-red-800' }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="section-title">Extra Duty Grants</h2><p className="section-subtitle mt-1">Manage overnight/extended shift grants with HR + Finance approval</p></div>
        <div className="flex items-center gap-3"><CompanyFilter /><DateSelector {...dateProps} /></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Total" value={summary.total || 0} />
        <KPI label="Pending HR" value={summary.pending || 0} color="amber" />
        <KPI label="HR Approved" value={summary.hrApproved || 0} color="blue" />
        <KPI label="Finance OK" value={summary.financeApproved || 0} color="green" />
        <KPI label="Impact" value={fmtINR(summary.totalImpact || 0)} color="indigo" />
      </div>

      <div className="flex items-center gap-3">
        <div className="border-b border-slate-200 flex gap-0">
          {[{ id: 'hr', label: 'HR Queue' }, { id: 'finance', label: 'Finance Review' }, { id: 'all', label: 'All Grants' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500')}>
              {t.label}
            </button>
          ))}
        </div>
        {canHR && <button onClick={() => setShowCreate(true)} className="btn-primary text-sm ml-auto">+ New Grant</button>}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-compact w-full text-[11px]">
          <thead><tr><th>Employee</th><th>Dept</th><th>Grant Date</th><th>Type</th><th>Days</th><th>Source</th><th>HR Status</th><th>Finance</th><th>Impact</th><th>Actions</th></tr></thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.id} className={g.finance_status === 'FINANCE_FLAGGED' ? 'bg-amber-50' : ''}>
                <td className="font-medium">{g.employee_name || g.employee_code}<div className="text-[10px] text-slate-400">{g.employee_code}</div></td>
                <td className="text-slate-500">{g.department}</td>
                <td className="font-mono">{g.grant_date}</td>
                <td className="text-xs">{g.grant_type?.replace(/_/g, ' ')}</td>
                <td className="text-center font-mono">{g.duty_days}</td>
                <td className="text-xs">{g.verification_source}</td>
                <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', hrBadge[g.status])}>{g.status}</span></td>
                <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', finBadge[g.finance_status])}>{g.finance_status?.replace('FINANCE_', '')}</span></td>
                <td className="font-mono text-indigo-600">{g.salary_impact_amount ? fmtINR(g.salary_impact_amount) : '—'}</td>
                <td className="flex gap-1">
                  {canHR && g.status === 'PENDING' && <>
                    <button onClick={() => approveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1 py-0.5 rounded text-[10px]">Approve</button>
                    <button onClick={() => { setRejectId(g.id); setRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1 py-0.5 rounded text-[10px]">Reject</button>
                  </>}
                  {canFinance && g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED' && <>
                    <button onClick={() => finApproveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1 py-0.5 rounded text-[10px]">Fin OK</button>
                  </>}
                </td>
              </tr>
            ))}
            {grants.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-slate-400">No grants for this period</td></tr>}
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

      {/* Reject Modal */}
      {rejectId && (
        <Modal onClose={() => setRejectId(null)} title="Reject Grant">
          <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="input w-full h-20" placeholder="Rejection reason (required)..." />
          <button onClick={() => rejectMut.mutate({ id: rejectId, reason: rejectReason })} disabled={!rejectReason} className="btn-danger w-full mt-3">Reject</button>
        </Modal>
      )}
    </div>
  )
}
