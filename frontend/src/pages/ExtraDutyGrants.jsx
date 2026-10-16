import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getExtraDutyGrants, getExtraDutyGrantsSummary, createExtraDutyGrant,
  approveExtraDutyGrant, rejectExtraDutyGrant,
  financeApproveGrant, financeFlagGrant, financeRejectGrant, bulkFinanceApproveGrants,
  getFinanceReviewQueue, financeReturnGrant, bulkFinanceReturnGrants, updateExtraDutyGrant
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import StatusBadge from '../components/ui/StatusBadge'
import ReviewQueue from '../components/bulk/ReviewQueue'
import ExtraDutyBulkGrant from '../components/bulk/ExtraDutyBulkGrant'
import BulkBatchList from '../components/bulk/BulkBatchList'
import { hrBulkApproveGrants } from '../utils/bulkApi'
import { normalizeRole, canHR as canHRFn, canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// Finance can send a rejected/flagged grant back to HR for correction
// (owner ruling 8 Oct 2026). Pre-biometric grants are excluded server-side too.
const isReturnable = (g) => g.status === 'APPROVED'
  && (g.finance_status === 'FINANCE_REJECTED' || g.finance_status === 'FINANCE_FLAGGED')
  && g.grant_type !== 'PRE_BIOMETRIC_ACTIVATION' && !g.is_processed
const isHrEditable = (g) => g.status === 'PENDING' && g.finance_status === 'UNREVIEWED'
  && g.grant_type !== 'PRE_BIOMETRIC_ACTIVATION' && !g.is_processed
// Finance Review order: rows that need a decision first.
const FIN_SORT_RANK = { UNREVIEWED: 0, FINANCE_FLAGGED: 1, FINANCE_REJECTED: 2, FINANCE_APPROVED: 3 }
const FIN_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'UNREVIEWED', label: 'Unreviewed' },
  { id: 'FINANCE_FLAGGED', label: 'Flagged', tone: 'amber' },
  { id: 'FINANCE_REJECTED', label: 'Rejected', tone: 'red' },
  { id: 'FINANCE_APPROVED', label: 'Approved' },
]
const finStatusOf = (g) => g.finance_status
const isFinApprovable = (g) => g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED'
const isHrApprovable = (g) => g.status === 'PENDING'
// Flagged / rejected rows are tinted on every tab (as before the ReviewQueue extraction).
const grantRowProps = (g) => ({
  'data-fin': g.finance_status,
  className: g.finance_status === 'FINANCE_FLAGGED' ? 'bg-amber-50' : g.finance_status === 'FINANCE_REJECTED' ? 'bg-red-50/60' : '',
})
const returnedNote = (g) => (g.status === 'PENDING' && typeof g.finance_notes === 'string'
  && g.finance_notes.startsWith('Returned by finance')) ? g.finance_notes : ''

function KPI({ label, value, color = 'blue' }) {
  const colors = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700', indigo: 'text-indigo-700' }
  return <div className="card p-3"><div className={clsx('text-xl font-bold', colors[color])}>{value}</div><div className="text-[10px] text-slate-400 uppercase font-medium">{label}</div></div>
}

export default function ExtraDutyGrants() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()

  // Canonical role check via shared normalizeRole() — tolerates case,
  // trailing whitespace, and compound labels like "Finance Team" / "HR_Manager"
  // that legacy user rows may still carry in localStorage. Mirrors the
  // backend-side normalizeRole() in backend/src/routes/auth.js so a user
  // accepted by the API is never silently rejected by the UI.
  const role = normalizeRole(user?.role)
  const canHR = canHRFn(user)
  // Failsafe: ALSO treat any role that contains "finance" as finance-capable.
  // This is a defensive net for legacy / custom / exotic role strings that
  // normalizeRole() might not tokenize cleanly (e.g. "Accounts & Finance",
  // "Head-Finance-Dept", "financeadmin"). The backend's requireFinanceOrAdmin
  // middleware on every write endpoint is still the authoritative gate, so
  // the worst case is a user seeing buttons that 403 on click — never a
  // silent lockout of a legitimate finance user.
  const rawRole = String(user?.role || '').toLowerCase()
  const canFinance = canFinanceFn(user) || rawRole.includes('finance')

  // Finance users land on the Finance Review tab by default; everyone else
  // starts on the HR queue.
  const [activeTab, setActiveTab] = useState(role === 'finance' ? 'finance' : 'hr')
  const [showCreate, setShowCreate] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [form, setForm] = useState({ employee_code: '', grant_date: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1, verification_source: 'Gate Register', reference_number: '', remarks: '', original_punch_date: '' })
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [flagId, setFlagId] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagNotes, setFlagNotes] = useState('')
  const [finRejectId, setFinRejectId] = useState(null)
  const [finRejectReason, setFinRejectReason] = useState('')
  const [editGrant, setEditGrant] = useState(null)
  const [editForm, setEditForm] = useState({})
  const qc = useQueryClient()

  const { data: sumRes } = useQuery({ queryKey: ['edg-summary', month, year], queryFn: () => getExtraDutyGrantsSummary(month, year), retry: 0 })
  const summary = sumRes?.data?.data || {}
  const { data: grantsRes } = useQuery({ queryKey: ['edg-list', month, year, activeTab], queryFn: () => activeTab === 'finance' ? getFinanceReviewQueue(month, year)
    : activeTab === 'hr' ? getExtraDutyGrants(month, year, { status: 'PENDING' }) // F-11: HR Queue = waiting for HR only
    : getExtraDutyGrants(month, year), retry: 0 })
  const grants = grantsRes?.data?.data || []

  const isFinanceTab = activeTab === 'finance'

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
  const finReturnMut = useMutation({
    mutationFn: ({ ids, reason }) => ids.length === 1 ? financeReturnGrant(ids[0], reason) : bulkFinanceReturnGrants(ids, reason),
    onSuccess: (res, { ids }) => {
      qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] })
      const n = ids.length === 1 ? 1 : (res?.data?.count || 0)
      const skipped = res?.data?.skipped?.length || 0
      toast.success(`${n} grant${n === 1 ? '' : 's'} returned to HR for correction` + (skipped ? ` (${skipped} skipped)` : ''))
    }
  })
  const editMut = useMutation({
    mutationFn: ({ id, data }) => updateExtraDutyGrant(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setEditGrant(null); toast.success('Grant updated — approve it to send it back to finance') }
  })
  const openEdit = (g) => {
    setEditGrant(g)
    setEditForm({ duty_days: g.duty_days, grant_type: g.grant_type, verification_source: g.verification_source, reference_number: g.reference_number || '', remarks: g.remarks || '' })
  }
  const refreshGrants = () => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); qc.invalidateQueries({ queryKey: ['bulk-batches'] }) }
  const bulkHrApproveMut = useMutation({
    mutationFn: (ids) => hrBulkApproveGrants(ids),
    onSuccess: (res) => { refreshGrants(); toast.success(`${res?.data?.count || 0} grant(s) approved — sent to finance review`) }
  })
  const bulkFinApproveMut = useMutation({
    mutationFn: (ids) => bulkFinanceApproveGrants(ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] })
      // F151 F-3: say how many the server skipped (not HR-approved or already decided).
      const n = res?.data?.count || 0
      const m = res?.data?.skipped?.length || 0
      const why = 'not HR-approved or already decided'
      if (!m) toast.success(`Approved ${n}`)
      else if (n) toast.success(`Approved ${n} · Skipped ${m} (${why})`, { duration: 6000 })
      else toast(`Nothing approved · Skipped ${m} (${why})`, { icon: 'ℹ️', duration: 6000 })
    }
  })

  // One column list for every tab. The Finance Review tab adds chips, ordering, the
  // select column and the bulk bar through <ReviewQueue>; the other tabs are a plain list.
  const columns = [
    { key: 'employee', header: 'Employee', className: 'font-medium',
      render: g => <>{g.employee_name || g.employee_code}<div className="text-[10px] text-slate-400">{g.employee_code}</div></> },
    { key: 'department', header: 'Dept', className: 'text-slate-500', render: g => g.department },
    { key: 'grant_date', header: 'Grant Date', className: 'font-mono', render: g => g.grant_date },
    { key: 'grant_type', header: 'Type', className: 'text-xs', render: g => g.grant_type?.replace(/_/g, ' ') },
    { key: 'duty_days', header: 'Days', className: 'text-center font-mono',
      render: g => { const note = returnedNote(g); return <>{g.duty_days}{note && <div className="text-[10px] text-amber-700 font-sans text-left max-w-[220px] whitespace-normal" title={note}>↩ {note}</div>}</> } },
    { key: 'verification_source', header: 'Source', className: 'text-xs', render: g => g.verification_source },
    { key: 'status', header: 'HR Status', render: g => <StatusBadge domain="ed_hr" status={g.status} size="xs" /> },
    { key: 'finance_status', header: 'Finance', render: g => <StatusBadge domain="ed_finance" status={g.finance_status} size="xs" /> },
    { key: 'actions', header: 'Actions', render: (g, api) => (
      <div className="flex gap-1 flex-wrap">
        {canHR && g.status === 'PENDING' && <>
          <Button variant="link" tone="green" onClick={() => approveMut.mutate(g.id)}>Approve</Button>
          <Button variant="link" tone="red" onClick={() => { setRejectId(g.id); setRejectReason('') }}>Reject</Button>
        </>}
        {canHR && isHrEditable(g) && (
          <Button variant="link" tone="blue" onClick={() => openEdit(g)}>✎ Edit</Button>
        )}
        {canFinance && g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED' && <>
          <Button variant="link" tone="green" onClick={() => finApproveMut.mutate(g.id)}>✓ Approve</Button>
          <Button variant="link" tone="amber" onClick={() => { setFlagId(g.id); setFlagReason(''); setFlagNotes('') }}>⚑ Flag</Button>
          <Button variant="link" tone="red" onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }}>✕ Reject</Button>
        </>}
        {canFinance && g.status === 'APPROVED' && g.finance_status === 'FINANCE_FLAGGED' && <>
          <Button variant="link" tone="green" onClick={() => finApproveMut.mutate(g.id)}>✓ Approve</Button>
          <Button variant="link" tone="red" onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }}>✕ Reject</Button>
        </>}
        {canFinance && isReturnable(g) && (
          <Button variant="link" tone="indigo" onClick={() => api.openAction('return', [g.id])} title="Send back to HR to correct and resubmit">↩ Return to HR</Button>
        )}
      </div>
    ) },
  ]

  const finActions = [
    { id: 'approve', label: n => `Bulk Approve (${n})`, variant: 'primary', eligible: isFinApprovable,
      busy: bulkFinApproveMut.isPending, busyLabel: 'Approving...', run: ids => bulkFinApproveMut.mutateAsync(ids) },
    { id: 'return', label: n => `↩ Return to HR (${n})`, variant: 'secondary', eligible: isReturnable,
      needsReason: true, minReasonLen: 5,
      reasonTitle: n => n === 1 ? 'Return Grant to HR' : `Return ${n} Grants to HR`,
      reasonIntro: 'The grant goes back to HR as pending. HR corrects it (e.g. the number of days) and approves it again, then it comes back to you for review. The earlier rejection stays in the audit trail.',
      reasonPlaceholder: "What should HR correct? (required, e.g. 'Power cut — give 0.5 day, not 1')",
      submitLabel: 'Return to HR', submitBusyLabel: 'Returning...',
      run: (ids, reason) => finReturnMut.mutateAsync({ ids, reason }) },
  ]

  const hrActions = [
    { id: 'hr-approve', label: n => `HR Approve (${n})`, variant: 'primary', eligible: isHrApprovable,
      busy: bulkHrApproveMut.isPending, busyLabel: 'Approving...',
      confirmTitle: 'Approve as HR?', confirmLabel: 'Approve',
      confirmText: (n) => `Approve ${n} grant${n === 1 ? '' : 's'} as HR? They go to finance review.`,
      run: ids => bulkHrApproveMut.mutateAsync(ids) },
  ]
  const isHrTab = activeTab === 'hr'

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="section-title">Extra Duty Grants</h2><p className="section-subtitle mt-1">Manage overnight/extended shift grants with HR + Finance approval</p></div>
        <div className="flex items-center gap-3"><CompanyFilter /><DateSelector {...dateProps} /></div>
      </div>

      {/* Users without HR or Finance access can read the grants but not act on them (F-14: no role debug text). */}
      {!canHR && !canFinance && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-testid="ed-no-access-note">
          You can view extra duty grants but cannot approve them. Approvals need an HR, Finance or Admin login.
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
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {canHR && <Button variant="secondary" className="text-sm" onClick={() => setShowBulk(true)} disabled={showBulk}>+ Bulk Grant</Button>}
          {canHR && <Button variant="primary" className="text-sm" onClick={() => setShowCreate(true)}>+ New Grant</Button>}
        </div>
      </div>

      {canHR && showBulk && (
        <ExtraDutyBulkGrant onClose={() => setShowBulk(false)} onSaved={refreshGrants} pageMonth={month} pageYear={year} />
      )}

      {isHrTab && <p className="text-xs text-slate-500" data-testid="hr-queue-hint">Grants waiting for HR approval. Approved and rejected grants are on <strong>All Grants</strong>.</p>}

      {/* key: a tab change remounts the queue, which resets its filter and selection. */}
      <ReviewQueue
        key={activeTab}
        rows={grants}
        statusOf={finStatusOf}
        columns={columns}
        rowProps={grantRowProps}
        filters={isFinanceTab ? FIN_FILTERS : null}
        order={isFinanceTab ? FIN_SORT_RANK : null}
        filtersTestId="fin-filters"
        selectable={(isFinanceTab && canFinance) || (isHrTab && canHR)}
        allFilterActions={isHrTab ? ['hr-approve'] : ['approve']}
        actions={isHrTab ? hrActions : finActions}
        filterHint={(counts, f) => canFinance && (counts.FINANCE_REJECTED + counts.FINANCE_FLAGGED) > 0 && f === 'all' && (
          <span className="text-[11px] text-slate-500">To send rejected grants back to HR: pick <strong>Rejected</strong>, tick the header box, then <strong>↩ Return to HR</strong>.</span>
        )}
        emptyText={isHrTab ? 'Nothing waiting for HR approval this month' : 'No grants for this period'}
        emptyFilterText="No grants in this filter"
      />

      {canHR && <BulkBatchList kind="extra-duty" month={month} year={year} onChanged={refreshGrants} />}

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
            <Button variant="primary" className="w-full" onClick={() => createMut.mutate({ ...form, month, year, company: selectedCompany })} busy={createMut.isPending} busyLabel="Creating...">Create Grant</Button>
          </div>
        </Modal>
      )}

      {/* HR Reject Modal */}
      {rejectId && (
        <Modal onClose={() => setRejectId(null)} title="Reject Grant">
          <div className="space-y-3">
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="input w-full h-20" placeholder="Rejection reason (required)..." />
            <Button variant="danger" className="w-full" onClick={() => rejectMut.mutate({ id: rejectId, reason: rejectReason })} disabled={!rejectReason} busy={rejectMut.isPending} busyLabel="Rejecting...">
              Reject
            </Button>
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
            <Button variant="warning" className="w-full" onClick={() => finFlagMut.mutate({ id: flagId, reason: flagReason, notes: flagNotes })}
              disabled={!flagReason} busy={finFlagMut.isPending} busyLabel="Flagging...">
              Flag for Review
            </Button>
          </div>
        </Modal>
      )}

      {/* HR Edit Modal */}
      {editGrant && (
        <Modal onClose={() => setEditGrant(null)} title={`Edit Grant — ${editGrant.employee_name || editGrant.employee_code} (${editGrant.grant_date})`}>
          <div className="space-y-3">
            {returnedNote(editGrant) && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">↩ {returnedNote(editGrant)}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Duty Days</label>
                <select value={String(editForm.duty_days)} onChange={e => setEditForm(f => ({ ...f, duty_days: parseFloat(e.target.value) }))} className="input">
                  {['0.5', '1', '1.5', '2'].map(v => <option key={v} value={v}>{v}</option>)}
                </select></div>
              <div><label className="label">Type</label><select value={editForm.grant_type} onChange={e => setEditForm(f => ({ ...f, grant_type: e.target.value }))} className="input"><option value="OVERNIGHT_STAY">Overnight Stay</option><option value="EXTENDED_SHIFT">Extended Shift</option><option value="OTHER">Other</option></select></div>
              <div><label className="label">Verification Source</label><select value={editForm.verification_source} onChange={e => setEditForm(f => ({ ...f, verification_source: e.target.value }))} className="input">
                {Array.from(new Set(['Gate Register', 'Production Office', 'Supervisor Confirmed', 'Other', editForm.verification_source].filter(Boolean))).map(v => <option key={v}>{v}</option>)}
              </select></div>
              <div><label className="label">Reference #</label><input value={editForm.reference_number} onChange={e => setEditForm(f => ({ ...f, reference_number: e.target.value }))} className="input" /></div>
            </div>
            <div><label className="label">Remarks</label><textarea value={editForm.remarks} onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))} className="input w-full h-16" /></div>
            <Button variant="primary" className="w-full" onClick={() => editMut.mutate({ id: editGrant.id, data: editForm })} busy={editMut.isPending} busyLabel="Saving...">Save</Button>
          </div>
        </Modal>
      )}

      {/* Finance Reject Modal */}
      {finRejectId && (
        <Modal onClose={() => setFinRejectId(null)} title="Finance Reject Grant">
          <div className="space-y-3">
            <textarea value={finRejectReason} onChange={e => setFinRejectReason(e.target.value)}
              className="input w-full h-20" placeholder="Rejection reason (required)..." />
            <Button variant="danger" className="w-full" onClick={() => finRejectMut.mutate({ id: finRejectId, reason: finRejectReason })}
              disabled={!finRejectReason} busy={finRejectMut.isPending} busyLabel="Rejecting...">
              Finance Reject
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
