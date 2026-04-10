import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDWContractors, createDWContractor, updateDWContractor,
  deactivateDWContractor, reactivateDWContractor,
  getDWContractorRates, proposeDWRateChange,
  getPendingDWRateChanges, approveDWRateChange, rejectDWRateChange
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canHR as canHRFn, canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────
function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function Badge({ active }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function RateStatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700'
  }
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', map[status] || 'bg-slate-100 text-slate-500')}>
      {status}
    </span>
  )
}

function PctChange({ oldVal, newVal }) {
  if (!oldVal || oldVal === 0) return null
  const pct = ((newVal - oldVal) / oldVal * 100).toFixed(1)
  const up = newVal > oldVal
  return (
    <span className={clsx('text-xs font-medium ml-1', up ? 'text-green-600' : 'text-red-600')}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────
function Overlay({ open, onClose, title, children, wide }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={clsx('relative bg-white rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto', wide ? 'w-full max-w-2xl' : 'w-full max-w-lg')}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
export default function DailyWageContractors() {
  const { user } = useAppStore()
  const canHR = canHRFn(user)
  const canFinance = canFinanceFn(user)
  const qc = useQueryClient()

  // ── State ──────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState('all') // 'all' | '1' | '0'
  const [expandedId, setExpandedId] = useState(null)
  const [showAddEdit, setShowAddEdit] = useState(false)
  const [editingContractor, setEditingContractor] = useState(null)
  const [showRateChange, setShowRateChange] = useState(null) // contractor object
  const [activeTab, setActiveTab] = useState('list') // 'list' | 'rate-approvals'

  // ── Form state ─────────────────────────────────────────────
  const emptyForm = { contractor_name: '', phone_number: '', email: '', bank_account: '', current_daily_wage_rate: '', current_commission_rate: '', payment_terms: 'monthly' }
  const [form, setForm] = useState(emptyForm)
  const emptyRateForm = { new_wage_rate: '', new_commission_rate: '', effective_date: '', remarks: '' }
  const [rateForm, setRateForm] = useState(emptyRateForm)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [rejectingId, setRejectingId] = useState(null)

  // ── Queries ────────────────────────────────────────────────
  const { data: contractorsRes, isLoading } = useQuery({
    queryKey: ['dw-contractors', showActive, search],
    queryFn: () => getDWContractors({ is_active: showActive === 'all' ? undefined : showActive, search: search || undefined }),
    retry: 0
  })
  const contractors = contractorsRes?.data?.data || []

  const { data: pendingRatesRes } = useQuery({
    queryKey: ['dw-rate-changes-pending'],
    queryFn: getPendingDWRateChanges,
    retry: 0
  })
  const pendingRates = pendingRatesRes?.data?.data || []

  // ── Mutations ──────────────────────────────────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['dw-contractors'] })
    qc.invalidateQueries({ queryKey: ['dw-rate-changes-pending'] })
  }

  const createMut = useMutation({
    mutationFn: createDWContractor,
    onSuccess: () => { invalidateAll(); setShowAddEdit(false); setForm(emptyForm); toast.success('Contractor created') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to create')
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateDWContractor(id, data),
    onSuccess: () => { invalidateAll(); setShowAddEdit(false); setEditingContractor(null); setForm(emptyForm); toast.success('Contractor updated') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update')
  })
  const deactivateMut = useMutation({
    mutationFn: deactivateDWContractor,
    onSuccess: () => { invalidateAll(); toast.success('Contractor deactivated') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const reactivateMut = useMutation({
    mutationFn: reactivateDWContractor,
    onSuccess: () => { invalidateAll(); toast.success('Contractor reactivated') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const proposeRateMut = useMutation({
    mutationFn: ({ id, data }) => proposeDWRateChange(id, data),
    onSuccess: () => { invalidateAll(); setShowRateChange(null); setRateForm(emptyRateForm); toast.success('Rate change proposed — pending finance approval') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const approveRateMut = useMutation({
    mutationFn: approveDWRateChange,
    onSuccess: () => { invalidateAll(); toast.success('Rate change approved') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })
  const rejectRateMut = useMutation({
    mutationFn: ({ id, remarks }) => rejectDWRateChange(id, remarks),
    onSuccess: () => { invalidateAll(); setRejectingId(null); setRejectRemarks(''); toast.success('Rate change rejected') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed')
  })

  // ── Handlers ───────────────────────────────────────────────
  const openAdd = () => { setEditingContractor(null); setForm(emptyForm); setShowAddEdit(true) }
  const openEdit = (c) => {
    setEditingContractor(c)
    setForm({
      contractor_name: c.contractor_name, phone_number: c.phone_number || '', email: c.email || '',
      bank_account: c.bank_account || '', current_daily_wage_rate: c.current_daily_wage_rate,
      current_commission_rate: c.current_commission_rate, payment_terms: c.payment_terms || 'monthly'
    })
    setShowAddEdit(true)
  }
  const openRateChange = (c) => {
    setShowRateChange(c)
    setRateForm({ new_wage_rate: c.current_daily_wage_rate, new_commission_rate: c.current_commission_rate, effective_date: new Date().toISOString().slice(0, 10), remarks: '' })
  }
  const submitForm = () => {
    const data = { ...form, current_daily_wage_rate: Number(form.current_daily_wage_rate) || 0, current_commission_rate: Number(form.current_commission_rate) || 0 }
    if (editingContractor) updateMut.mutate({ id: editingContractor.id, data })
    else createMut.mutate(data)
  }
  const submitRateChange = () => {
    if (!showRateChange) return
    proposeRateMut.mutate({ id: showRateChange.id, data: { new_wage_rate: Number(rateForm.new_wage_rate), new_commission_rate: Number(rateForm.new_commission_rate), effective_date: rateForm.effective_date, remarks: rateForm.remarks } })
  }

  // ── Computed ────────────────────────────────────────────────
  const totalCostPerWorker = useMemo(() => {
    const w = Number(form.current_daily_wage_rate) || 0
    const c = Number(form.current_commission_rate) || 0
    return w + c
  }, [form.current_daily_wage_rate, form.current_commission_rate])

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Contractor Master</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage daily wage contractors, rates, and approvals</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingRates.length > 0 && (
            <button onClick={() => setActiveTab('rate-approvals')}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
              {pendingRates.length} Pending Rate {pendingRates.length === 1 ? 'Change' : 'Changes'}
            </button>
          )}
          {canHR && (
            <button onClick={openAdd} className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              + Add Contractor
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <button onClick={() => setActiveTab('list')}
          className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'list' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          Contractors
        </button>
        {(canFinance || canHR) && (
          <button onClick={() => setActiveTab('rate-approvals')}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'rate-approvals' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            Rate Approvals {pendingRates.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">{pendingRates.length}</span>}
          </button>
        )}
      </div>

      {/* ── Tab: Contractor List ──────────────────────────────── */}
      {activeTab === 'list' && (
        <>
          {/* Filter bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" placeholder="Search by name, phone, email..." value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <select value={showActive} onChange={e => setShowActive(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">All</option>
              <option value="1">Active Only</option>
              <option value="0">Inactive Only</option>
            </select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : contractors.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg">No contractors found</p>
              <p className="text-sm mt-1">Add a contractor to get started</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Contractor</th>
                    <th className="px-4 py-3">Wage Rate</th>
                    <th className="px-4 py-3">Commission</th>
                    <th className="px-4 py-3">Total/Worker</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Payment Terms</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contractors.map(c => (
                    <React.Fragment key={c.id}>
                      <tr className={clsx('hover:bg-slate-50 cursor-pointer transition-colors', expandedId === c.id && 'bg-blue-50/50')}
                        onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                        <td className="px-4 py-3 font-medium text-slate-800">{c.contractor_name}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(c.current_daily_wage_rate)}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(c.current_commission_rate)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{fmt(c.current_daily_wage_rate + c.current_commission_rate)}</td>
                        <td className="px-4 py-3"><Badge active={c.is_active === 1} /></td>
                        <td className="px-4 py-3 text-slate-500 capitalize">{c.payment_terms}</td>
                        <td className="px-4 py-3 text-slate-400">{expandedId === c.id ? '▲' : '▼'}</td>
                      </tr>
                      {expandedId === c.id && (
                        <tr>
                          <td colSpan={7} className="px-4 py-4 bg-slate-50/70">
                            <ExpandedRow contractor={c} canHR={canHR} onEdit={() => openEdit(c)}
                              onRateChange={() => openRateChange(c)}
                              onDeactivate={() => deactivateMut.mutate(c.id)}
                              onReactivate={() => reactivateMut.mutate(c.id)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Tab: Rate Approvals ───────────────────────────────── */}
      {activeTab === 'rate-approvals' && (
        <RateApprovals pendingRates={pendingRates} canFinance={canFinance}
          onApprove={(id) => approveRateMut.mutate(id)}
          onReject={(id) => { setRejectingId(id); setRejectRemarks('') }}
          approving={approveRateMut.isPending} />
      )}

      {/* ── Add/Edit Modal ────────────────────────────────────── */}
      <Overlay open={showAddEdit} onClose={() => { setShowAddEdit(false); setEditingContractor(null) }}
        title={editingContractor ? 'Edit Contractor' : 'Add Contractor'}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Contractor Name *</label>
            <input type="text" value={form.contractor_name} onChange={e => setForm(f => ({ ...f, contractor_name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
              <input type="text" value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Bank Account</label>
            <input type="text" value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Daily Wage Rate *</label>
              <input type="number" min="0" step="0.01" value={form.current_daily_wage_rate} onChange={e => setForm(f => ({ ...f, current_daily_wage_rate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Commission Rate *</label>
              <input type="number" min="0" step="0.01" value={form.current_commission_rate} onChange={e => setForm(f => ({ ...f, current_commission_rate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <span className="text-slate-600">Total Cost per Worker: </span>
            <span className="font-bold text-blue-700">{fmt(totalCostPerWorker)}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Payment Terms</label>
            <select value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setShowAddEdit(false); setEditingContractor(null) }}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submitForm} disabled={createMut.isPending || updateMut.isPending || !form.contractor_name}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {(createMut.isPending || updateMut.isPending) ? 'Saving...' : editingContractor ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Overlay>

      {/* ── Rate Change Modal ─────────────────────────────────── */}
      <Overlay open={!!showRateChange} onClose={() => setShowRateChange(null)} title="Propose Rate Change">
        {showRateChange && (
          <div className="space-y-3">
            <div className="bg-slate-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-slate-700">{showRateChange.contractor_name}</p>
              <p className="text-slate-500 mt-1">Current rates: Wage {fmt(showRateChange.current_daily_wage_rate)} | Commission {fmt(showRateChange.current_commission_rate)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">New Wage Rate</label>
                <input type="number" min="0" step="0.01" value={rateForm.new_wage_rate}
                  onChange={e => setRateForm(f => ({ ...f, new_wage_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                <PctChange oldVal={showRateChange.current_daily_wage_rate} newVal={Number(rateForm.new_wage_rate) || 0} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">New Commission Rate</label>
                <input type="number" min="0" step="0.01" value={rateForm.new_commission_rate}
                  onChange={e => setRateForm(f => ({ ...f, new_commission_rate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                <PctChange oldVal={showRateChange.current_commission_rate} newVal={Number(rateForm.new_commission_rate) || 0} />
              </div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <span className="text-slate-600">New Total per Worker: </span>
              <span className="font-bold text-blue-700">{fmt((Number(rateForm.new_wage_rate) || 0) + (Number(rateForm.new_commission_rate) || 0))}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Effective Date *</label>
              <input type="date" value={rateForm.effective_date}
                onChange={e => setRateForm(f => ({ ...f, effective_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
              <textarea rows={2} value={rateForm.remarks}
                onChange={e => setRateForm(f => ({ ...f, remarks: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              Rate changes require finance approval before taking effect. New entries will use the current rate until the change is approved.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowRateChange(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={submitRateChange} disabled={proposeRateMut.isPending || !rateForm.effective_date}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {proposeRateMut.isPending ? 'Submitting...' : 'Propose Rate Change'}
              </button>
            </div>
          </div>
        )}
      </Overlay>

      {/* ── Reject Rate Change Modal ──────────────────────────── */}
      <Overlay open={!!rejectingId} onClose={() => setRejectingId(null)} title="Reject Rate Change">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rejection Reason *</label>
            <textarea rows={3} value={rejectRemarks} onChange={e => setRejectRemarks(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="Provide reason for rejection..." />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setRejectingId(null)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={() => rejectRateMut.mutate({ id: rejectingId, remarks: rejectRemarks })}
              disabled={rejectRateMut.isPending || !rejectRemarks.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {rejectRateMut.isPending ? 'Rejecting...' : 'Reject'}
            </button>
          </div>
        </div>
      </Overlay>
    </div>
  )
}

// ── Expanded Row ──────────────────────────────────────────────
function ExpandedRow({ contractor: c, canHR, onEdit, onRateChange, onDeactivate, onReactivate }) {
  const { data: ratesRes } = useQuery({
    queryKey: ['dw-contractor-rates', c.id],
    queryFn: () => getDWContractorRates(c.id),
    retry: 0
  })
  const rates = ratesRes?.data?.data || []

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Contact & Bank */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase">Contact Info</h4>
        <div className="text-sm space-y-1">
          {c.phone_number && <p><span className="text-slate-400">Phone:</span> {c.phone_number}</p>}
          {c.email && <p><span className="text-slate-400">Email:</span> {c.email}</p>}
          {c.bank_account && <p><span className="text-slate-400">Bank A/C:</span> {c.bank_account}</p>}
          {!c.phone_number && !c.email && <p className="text-slate-400 italic">No contact info</p>}
        </div>
        {canHR && (
          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={onEdit} className="px-3 py-1 text-xs font-medium rounded border border-slate-300 text-slate-600 hover:bg-slate-100">Edit</button>
            <button onClick={onRateChange} className="px-3 py-1 text-xs font-medium rounded border border-blue-300 text-blue-600 hover:bg-blue-50">Rate Change</button>
            {c.is_active === 1 ? (
              <button onClick={onDeactivate} className="px-3 py-1 text-xs font-medium rounded border border-red-300 text-red-600 hover:bg-red-50">Deactivate</button>
            ) : (
              <button onClick={onReactivate} className="px-3 py-1 text-xs font-medium rounded border border-green-300 text-green-600 hover:bg-green-50">Reactivate</button>
            )}
          </div>
        )}
      </div>

      {/* Rate History */}
      <div className="md:col-span-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Rate History</h4>
        {rates.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No rate changes yet</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {rates.map(r => (
              <div key={r.id} className="flex items-start gap-3 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-600">
                      Wage: {fmt(r.old_wage_rate)} → {fmt(r.new_wage_rate)}
                      <PctChange oldVal={r.old_wage_rate} newVal={r.new_wage_rate} />
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">
                      Comm: {fmt(r.old_commission_rate)} → {fmt(r.new_commission_rate)}
                      <PctChange oldVal={r.old_commission_rate} newVal={r.new_commission_rate} />
                    </span>
                    <RateStatusBadge status={r.approval_status} />
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Effective: {r.effective_date} | Proposed by {r.proposed_by} on {r.proposed_at?.slice(0, 10)}
                    {r.approved_by && <> | {r.approval_status === 'approved' ? 'Approved' : 'Rejected'} by {r.approved_by}</>}
                    {r.remarks && <> — {r.remarks}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Rate Approvals Tab ───────────────────────────────────────
function RateApprovals({ pendingRates, canFinance, onApprove, onReject, approving }) {
  if (pendingRates.length === 0) {
    return <div className="text-center py-12 text-slate-400">No pending rate changes</div>
  }
  return (
    <div className="space-y-3">
      {pendingRates.map(r => (
        <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-slate-800">{r.contractor_name}</p>
              <div className="flex items-center gap-4 text-sm mt-1">
                <span className="text-slate-500">
                  Wage: {fmt(r.old_wage_rate)} → <span className="font-semibold text-slate-700">{fmt(r.new_wage_rate)}</span>
                  <PctChange oldVal={r.old_wage_rate} newVal={r.new_wage_rate} />
                </span>
                <span className="text-slate-500">
                  Commission: {fmt(r.old_commission_rate)} → <span className="font-semibold text-slate-700">{fmt(r.new_commission_rate)}</span>
                  <PctChange oldVal={r.old_commission_rate} newVal={r.new_commission_rate} />
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Effective: {r.effective_date} | Proposed by {r.proposed_by} on {r.proposed_at?.slice(0, 10)}
                {r.remarks && <span className="ml-2 text-slate-500">— {r.remarks}</span>}
              </div>
            </div>
            {canFinance && (
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => onApprove(r.id)} disabled={approving}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
                <button onClick={() => onReject(r.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Reject</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
