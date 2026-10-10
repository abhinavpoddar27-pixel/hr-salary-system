import React, { useState, useMemo } from 'react'
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
  { id: 'FINANCE_FLAGGED', label: 'Flagged' },
  { id: 'FINANCE_REJECTED', label: 'Rejected' },
  { id: 'FINANCE_APPROVED', label: 'Approved' },
]
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
  // Diagnostic: true when the user looks like "finance" by any heuristic but
  // the strict normalizeRole() didn't land on the canonical value. Surfaces
  // in the banner below so the admin can clean up the offending DB row.
  const financeRoleLooksOdd = rawRole.includes('finance') && role !== 'finance' && role !== 'admin'

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
  const [returnIds, setReturnIds] = useState(null)
  const [returnReason, setReturnReason] = useState('')
  const [editGrant, setEditGrant] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [finFilter, setFinFilter] = useState('all')
  const qc = useQueryClient()

  const { data: sumRes } = useQuery({ queryKey: ['edg-summary', month, year], queryFn: () => getExtraDutyGrantsSummary(month, year), retry: 0 })
  const summary = sumRes?.data?.data || {}
  const { data: grantsRes } = useQuery({ queryKey: ['edg-list', month, year, activeTab], queryFn: () => activeTab === 'finance' ? getFinanceReviewQueue(month, year) : getExtraDutyGrants(month, year), retry: 0 })
  const grants = grantsRes?.data?.data || []

  // Finance Review tab: filter chips + rows that need action first. The server
  // sorts finance_status alphabetically (APPROVED first), which buried the
  // rejected rows under hundreds of approved ones.
  const isFinanceTab = activeTab === 'finance'
  const finCounts = useMemo(() => {
    const c = { all: grants.length, FINANCE_FLAGGED: 0, FINANCE_REJECTED: 0, UNREVIEWED: 0, FINANCE_APPROVED: 0 }
    for (const g of grants) if (c[g.finance_status] !== undefined) c[g.finance_status]++
    return c
  }, [grants])
  const viewGrants = useMemo(() => {
    if (!isFinanceTab) return grants
    const rows = finFilter === 'all' ? grants.slice() : grants.filter(g => g.finance_status === finFilter)
    return rows.sort((a, b) => (FIN_SORT_RANK[a.finance_status] ?? 9) - (FIN_SORT_RANK[b.finance_status] ?? 9))
  }, [grants, isFinanceTab, finFilter])

  // Bulk selection helpers. Approve: UNREVIEWED rows. Return to HR: rejected/flagged rows.
  const bulkEligibleIds = useMemo(
    () => grants.filter(g => g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED').map(g => g.id),
    [grants]
  )
  const returnableIds = useMemo(() => grants.filter(isReturnable).map(g => g.id), [grants])
  const selectedApproveIds = selectedIds.filter(id => bulkEligibleIds.includes(id))
  const selectedReturnIds = selectedIds.filter(id => returnableIds.includes(id))
  // Header checkbox: every selectable row in the current view. On "All" it keeps
  // the old behaviour (unreviewed only) so one click can't mix approve + return.
  const headerIds = useMemo(() => viewGrants
    .filter(g => finFilter === 'all'
      ? bulkEligibleIds.includes(g.id)
      : (bulkEligibleIds.includes(g.id) || returnableIds.includes(g.id)))
    .map(g => g.id), [viewGrants, finFilter, bulkEligibleIds, returnableIds])
  const allSelected = headerIds.length > 0 && headerIds.every(id => selectedIds.includes(id))
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : headerIds)
  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const changeFilter = (f) => { setFinFilter(f); setSelectedIds([]) }

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
      setReturnIds(null); setReturnReason(''); setSelectedIds([])
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
  const bulkFinApproveMut = useMutation({
    mutationFn: (ids) => bulkFinanceApproveGrants(ids),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['edg-list'] }); qc.invalidateQueries({ queryKey: ['edg-summary'] }); setSelectedIds([]); toast.success(`${res?.data?.count || 0} grants approved`) }
  })

  const hrBadge = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-green-100 text-green-800', REJECTED: 'bg-red-100 text-red-800' }
  const finBadge = { UNREVIEWED: 'bg-slate-100 text-slate-600', FINANCE_APPROVED: 'bg-green-100 text-green-800', FINANCE_FLAGGED: 'bg-amber-100 text-amber-800', FINANCE_REJECTED: 'bg-red-100 text-red-800' }

  const showSelectColumn = activeTab === 'finance' && canFinance

  return (
    <div className={clsx('p-6 space-y-5 animate-fade-in', showSelectColumn && selectedIds.length > 0 && 'pb-24')}>
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

      {/* Role visibility banner on the Finance Review tab — always shown so
          an admin debugging "where did my buttons go" can immediately see
          the detected role, the canFinance verdict, and whether the failsafe
          had to kick in. Harmless for legitimate finance users (it just
          confirms their role is recognised) and invaluable when a legacy
          role string is hiding approval controls. */}
      {activeTab === 'finance' && (canHR || canFinance) && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-[11px] text-blue-900 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span><strong>User:</strong> {user?.username || '(unknown)'}</span>
          <span><strong>Role (raw):</strong> <code className="bg-blue-100 px-1 rounded">{JSON.stringify(user?.role)}</code></span>
          <span><strong>Normalised:</strong> <code className="bg-blue-100 px-1 rounded">{role}</code></span>
          <span><strong>canFinance:</strong> <code className={clsx('px-1 rounded', canFinance ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>{String(canFinance)}</code></span>
          {financeRoleLooksOdd && (
            <span className="text-amber-800">⚠ Role contains "finance" but isn't canonical — failsafe engaged. Ask admin to normalise this user record.</span>
          )}
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
            <button key={t.id} onClick={() => { setActiveTab(t.id); setSelectedIds([]); setFinFilter('all') }}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {canHR && <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ New Grant</button>}
        </div>
      </div>

      {isFinanceTab && (
        <div className="flex flex-wrap items-center gap-2" data-testid="fin-filters">
          {FIN_FILTERS.map(f => (
            <button key={f.id} onClick={() => changeFilter(f.id)}
              data-filter={f.id}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                finFilter === f.id
                  ? (f.id === 'FINANCE_REJECTED' ? 'bg-red-600 text-white border-red-600' : f.id === 'FINANCE_FLAGGED' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600')
                  : (f.id === 'FINANCE_REJECTED' && finCounts.FINANCE_REJECTED > 0 ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'))}>
              {f.label} ({finCounts[f.id] ?? 0})
            </button>
          ))}
          {canFinance && (finCounts.FINANCE_REJECTED + finCounts.FINANCE_FLAGGED) > 0 && finFilter === 'all' && (
            <span className="text-[11px] text-slate-500">To send rejected grants back to HR: pick <strong>Rejected</strong>, tick the header box, then <strong>↩ Return to HR</strong>.</span>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-compact w-full text-[11px]">
          <thead>
            <tr>
              {showSelectColumn && (
                <th className="w-8">
                  <input type="checkbox"
                    checked={allSelected}
                    disabled={headerIds.length === 0}
                    onChange={toggleSelectAll}
                    data-testid="select-all"
                    title={finFilter === 'all' ? 'Select all unreviewed rows' : 'Select all rows in this view'} />
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
            {viewGrants.map(g => {
              const bulkEligible = g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED'
              const returnable = isReturnable(g)
              const note = returnedNote(g)
              return (
                <tr key={g.id} data-fin={g.finance_status} className={g.finance_status === 'FINANCE_FLAGGED' ? 'bg-amber-50' : g.finance_status === 'FINANCE_REJECTED' ? 'bg-red-50/60' : ''}>
                  {showSelectColumn && (
                    <td>
                      <input type="checkbox"
                        disabled={!bulkEligible && !returnable}
                        checked={selectedIds.includes(g.id)}
                        onChange={() => toggleSelect(g.id)} />
                    </td>
                  )}
                  <td className="font-medium">{g.employee_name || g.employee_code}<div className="text-[10px] text-slate-400">{g.employee_code}</div></td>
                  <td className="text-slate-500">{g.department}</td>
                  <td className="font-mono">{g.grant_date}</td>
                  <td className="text-xs">{g.grant_type?.replace(/_/g, ' ')}</td>
                  <td className="text-center font-mono">{g.duty_days}{note && <div className="text-[10px] text-amber-700 font-sans text-left max-w-[220px] whitespace-normal" title={note}>↩ {note}</div>}</td>
                  <td className="text-xs">{g.verification_source}</td>
                  <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', hrBadge[g.status])}>{g.status}</span></td>
                  <td><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', finBadge[g.finance_status])}>{g.finance_status?.replace('FINANCE_', '')}</span></td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {canHR && g.status === 'PENDING' && <>
                        <button onClick={() => approveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">Approve</button>
                        <button onClick={() => { setRejectId(g.id); setRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">Reject</button>
                      </>}
                      {canHR && isHrEditable(g) && (
                        <button onClick={() => openEdit(g)} className="text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✎ Edit</button>
                      )}
                      {canFinance && g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED' && <>
                        <button onClick={() => finApproveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✓ Approve</button>
                        <button onClick={() => { setFlagId(g.id); setFlagReason(''); setFlagNotes('') }} className="text-amber-600 hover:bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-medium">⚑ Flag</button>
                        <button onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✕ Reject</button>
                      </>}
                      {canFinance && g.status === 'APPROVED' && g.finance_status === 'FINANCE_FLAGGED' && <>
                        <button onClick={() => finApproveMut.mutate(g.id)} className="text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✓ Approve</button>
                        <button onClick={() => { setFinRejectId(g.id); setFinRejectReason('') }} className="text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded text-[10px] font-medium">✕ Reject</button>
                      </>}
                      {canFinance && returnable && (
                        <button onClick={() => { setReturnIds([g.id]); setReturnReason('') }} className="text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded text-[10px] font-medium" title="Send back to HR to correct and resubmit">↩ Return to HR</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {viewGrants.length === 0 && <tr><td colSpan={showSelectColumn ? 10 : 9} className="text-center py-8 text-slate-400">{grants.length === 0 ? 'No grants for this period' : 'No grants in this filter'}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Sticky action bar — stays on screen while finance scrolls a long list. */}
      {showSelectColumn && selectedIds.length > 0 && (
        <div data-testid="bulk-bar" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-2.5">
          <span className="text-sm text-slate-700 font-medium">{selectedIds.length} selected</span>
          {selectedApproveIds.length > 0 && (
            <button onClick={() => bulkFinApproveMut.mutate(selectedApproveIds)}
              disabled={bulkFinApproveMut.isPending}
              className="btn-primary text-sm">
              {bulkFinApproveMut.isPending ? 'Approving...' : `Bulk Approve (${selectedApproveIds.length})`}
            </button>
          )}
          {selectedReturnIds.length > 0 && (
            <button onClick={() => { setReturnIds(selectedReturnIds); setReturnReason('') }}
              className="btn-secondary text-sm">
              {`↩ Return to HR (${selectedReturnIds.length})`}
            </button>
          )}
          <button onClick={() => setSelectedIds([])} className="text-xs text-slate-500 hover:text-slate-800 px-2">Clear</button>
        </div>
      )}

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

      {/* Finance Return-to-HR Modal */}
      {returnIds && (
        <Modal onClose={() => setReturnIds(null)} title={returnIds.length === 1 ? 'Return Grant to HR' : `Return ${returnIds.length} Grants to HR`}>
          <div className="space-y-3">
            <p className="text-xs text-slate-600">The grant goes back to HR as pending. HR corrects it (e.g. the number of days) and approves it again, then it comes back to you for review. The earlier rejection stays in the audit trail.</p>
            <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)}
              className="input w-full h-20" placeholder="What should HR correct? (required, e.g. 'Power cut — give 0.5 day, not 1')" />
            <button onClick={() => finReturnMut.mutate({ ids: returnIds, reason: returnReason.trim() })}
              disabled={returnReason.trim().length < 5 || finReturnMut.isPending}
              className="btn-primary w-full">
              {finReturnMut.isPending ? 'Returning...' : 'Return to HR'}
            </button>
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
            <button onClick={() => editMut.mutate({ id: editGrant.id, data: editForm })} disabled={editMut.isPending} className="btn-primary w-full">{editMut.isPending ? 'Saving...' : 'Save'}</button>
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
