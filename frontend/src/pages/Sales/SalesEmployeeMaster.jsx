import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  getSalesEmployees,
  createSalesEmployee,
  updateSalesEmployee,
  markSalesEmployeeLeft
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import CompanyFilter from '../../components/shared/CompanyFilter'

const STATUS_OPTIONS = ['Active', 'Inactive', 'Left', 'Exited']
const DESIGNATION_OPTIONS = ['SO', 'SSO', 'ASE', 'ASM', 'TSI', 'SR ASM', 'RSM', 'PSR', 'Other']
const DEFAULT_COMPANY_OPTIONS = ['Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd']

const BANK_FIELDS_REQUIRED = ['bank_name', 'account_no', 'ifsc']

function statusBadge(status) {
  const colour = status === 'Active'
    ? 'bg-green-100 text-green-700'
    : status === 'Left' || status === 'Exited'
      ? 'bg-red-100 text-red-700'
      : 'bg-slate-100 text-slate-600'
  return <span className={clsx('inline-block px-2 py-0.5 rounded text-xs font-medium', colour)}>{status || 'Active'}</span>
}

function emptyForm(defaultCompany = '') {
  return {
    code: '', name: '', company: defaultCompany,
    state: '', headquarters: '', city_of_operation: '',
    reporting_manager: '', designation: '', punch_no: '',
    working_hours: '',
    aadhaar: '', pan: '', dob: '', doj: '', contact: '', personal_contact: '',
    gross_salary: '',
    pf_applicable: 0, esi_applicable: 0, pt_applicable: 0,
    bank_name: '', account_no: '', ifsc: '',
    status: 'Active'
  }
}

function EmployeeForm({ initial, isEdit, onSubmit, onCancel, submitting }) {
  const { selectedCompany } = useAppStore()
  const [form, setForm] = useState(() => ({ ...emptyForm(selectedCompany), ...(initial || {}) }))
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const validate = () => {
    const errs = {}
    if (!isEdit) {
      if (!form.code?.trim()) errs.code = 'Required'
      if (!form.company?.trim()) errs.company = 'Required'
    }
    if (!form.name?.trim()) errs.name = 'Required'
    for (const f of BANK_FIELDS_REQUIRED) {
      if (!String(form[f] || '').trim()) errs[f] = 'Required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) {
      toast.error('Please fill all required fields')
      return
    }
    // Coerce numbers + booleans
    const payload = { ...form }
    payload.gross_salary = payload.gross_salary === '' ? 0 : parseFloat(payload.gross_salary) || 0
    payload.pf_applicable = payload.pf_applicable ? 1 : 0
    payload.esi_applicable = payload.esi_applicable ? 1 : 0
    payload.pt_applicable = payload.pt_applicable ? 1 : 0
    if (isEdit) {
      delete payload.code
      delete payload.company
    }
    onSubmit(payload)
  }

  const lbl = (req) => <span className="block text-xs font-medium text-slate-600 mb-1">{req}</span>
  const errLine = (k) => errors[k] && <p className="text-xs text-red-600 mt-1">{errors[k]}</p>

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section>
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Identity</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {lbl('Code *')}
            <input disabled={isEdit} value={form.code} onChange={e => set('code', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.code ? 'border-red-400' : 'border-slate-300', isEdit && 'bg-slate-100')} />
            {errLine('code')}
          </div>
          <div>
            {lbl('Company *')}
            <select disabled={isEdit} value={form.company} onChange={e => set('company', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm bg-white', errors.company ? 'border-red-400' : 'border-slate-300', isEdit && 'bg-slate-100')}>
              <option value="">— Select company —</option>
              {DEFAULT_COMPANY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {errLine('company')}
          </div>
          <div className="col-span-2">
            {lbl('Name *')}
            <input value={form.name} onChange={e => set('name', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.name ? 'border-red-400' : 'border-slate-300')} />
            {errLine('name')}
          </div>
          <div>
            {lbl('Designation')}
            <select value={form.designation} onChange={e => set('designation', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">—</option>
              {DESIGNATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            {lbl('Status')}
            <select value={form.status || 'Active'} onChange={e => set('status', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>{lbl('Aadhaar')}<input value={form.aadhaar} onChange={e => set('aadhaar', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('PAN')}<input value={form.pan} onChange={e => set('pan', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('DOB')}<input type="date" value={form.dob || ''} onChange={e => set('dob', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Date of Joining')}<input type="date" value={form.doj || ''} onChange={e => set('doj', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Contact')}<input value={form.contact} onChange={e => set('contact', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Personal Contact')}<input value={form.personal_contact} onChange={e => set('personal_contact', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Territory</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>{lbl('State')}<input value={form.state} onChange={e => set('state', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Headquarters')}<input value={form.headquarters} onChange={e => set('headquarters', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('City of Operation')}<input value={form.city_of_operation} onChange={e => set('city_of_operation', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Reporting Manager')}<input value={form.reporting_manager} onChange={e => set('reporting_manager', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Punch No.')}<input value={form.punch_no} onChange={e => set('punch_no', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div>{lbl('Working Hours')}<input value={form.working_hours} onChange={e => set('working_hours', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Salary &amp; Statutory</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>{lbl('Gross Monthly (₹)')}<input type="number" value={form.gross_salary} onChange={e => set('gross_salary', e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.pf_applicable} onChange={e => set('pf_applicable', e.target.checked ? 1 : 0)} /> PF</label>
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.esi_applicable} onChange={e => set('esi_applicable', e.target.checked ? 1 : 0)} /> ESI</label>
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.pt_applicable} onChange={e => set('pt_applicable', e.target.checked ? 1 : 0)} /> PT</label>
          </div>
        </div>
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-amber-900 mb-2">Bank Details <span className="text-red-600">(Required)</span></h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {lbl('Bank Name *')}
            <input value={form.bank_name} onChange={e => set('bank_name', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.bank_name ? 'border-red-400' : 'border-slate-300')} />
            {errLine('bank_name')}
          </div>
          <div>
            {lbl('Account No. *')}
            <input value={form.account_no} onChange={e => set('account_no', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.account_no ? 'border-red-400' : 'border-slate-300')} />
            {errLine('account_no')}
          </div>
          <div className="col-span-2">
            {lbl('IFSC *')}
            <input value={form.ifsc} onChange={e => set('ifsc', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.ifsc ? 'border-red-400' : 'border-slate-300')} />
            {errLine('ifsc')}
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-400">
          {submitting ? 'Saving…' : (isEdit ? 'Save changes' : 'Create sales employee')}
        </button>
      </div>
    </form>
  )
}

export default function SalesEmployeeMaster() {
  const qc = useQueryClient()
  const { selectedCompany } = useAppStore()

  const [filters, setFilters] = useState({ status: '', state: '', manager: '', hq: '' })
  const [modalMode, setModalMode] = useState(null) // 'create' | 'edit'
  const [editing, setEditing] = useState(null)
  const [confirmLeft, setConfirmLeft] = useState(null)

  const queryParams = useMemo(() => {
    const p = {}
    if (selectedCompany) p.company = selectedCompany
    if (filters.status)  p.status  = filters.status
    if (filters.state)   p.state   = filters.state
    if (filters.manager) p.manager = filters.manager
    if (filters.hq)      p.hq      = filters.hq
    return p
  }, [selectedCompany, filters])

  const { data: res, isLoading } = useQuery({
    queryKey: ['sales-employees', queryParams],
    queryFn: () => getSalesEmployees(queryParams),
    retry: 0
  })
  const rows = res?.data?.data || []

  const distinctStates = useMemo(() => {
    const set = new Set()
    rows.forEach(r => { if (r.state) set.add(r.state) })
    return Array.from(set).sort()
  }, [rows])

  const createMut = useMutation({
    mutationFn: (data) => createSalesEmployee(data),
    onSuccess: () => {
      toast.success('Sales employee created')
      qc.invalidateQueries({ queryKey: ['sales-employees'] })
      setModalMode(null); setEditing(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Create failed')
  })

  const updateMut = useMutation({
    mutationFn: ({ code, company, data }) => updateSalesEmployee(code, company, data),
    onSuccess: () => {
      toast.success('Sales employee updated')
      qc.invalidateQueries({ queryKey: ['sales-employees'] })
      setModalMode(null); setEditing(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Update failed')
  })

  const markLeftMut = useMutation({
    mutationFn: ({ code, company }) => markSalesEmployeeLeft(code, company, {}),
    onSuccess: () => {
      toast.success('Marked as Left')
      qc.invalidateQueries({ queryKey: ['sales-employees'] })
      setConfirmLeft(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Mark-left failed')
  })

  const openCreate = () => { setEditing(null); setModalMode('create') }
  const openEdit = (row) => { setEditing(row); setModalMode('edit') }

  const handleSubmit = (payload) => {
    if (modalMode === 'edit') {
      updateMut.mutate({ code: editing.code, company: editing.company, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Sales Employees</h1>
          <p className="text-xs text-slate-500">Master data for sales team. Codes are scoped per company.</p>
        </div>
        <div className="flex items-center gap-2">
          <CompanyFilter />
          <button onClick={openCreate} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white">+ New</button>
          <button disabled title="Bulk import coming in Phase 2"
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-200 text-slate-400 cursor-not-allowed">
            Bulk Import
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3 bg-white rounded-lg border border-slate-200">
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="border border-slate-300 rounded px-2 py-1 text-xs bg-white">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.state} onChange={e => setFilters(f => ({ ...f, state: e.target.value }))}
          className="border border-slate-300 rounded px-2 py-1 text-xs bg-white">
          <option value="">All states</option>
          {distinctStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Manager contains…" value={filters.manager}
          onChange={e => setFilters(f => ({ ...f, manager: e.target.value }))}
          className="border border-slate-300 rounded px-2 py-1 text-xs" />
        <input placeholder="HQ contains…" value={filters.hq}
          onChange={e => setFilters(f => ({ ...f, hq: e.target.value }))}
          className="border border-slate-300 rounded px-2 py-1 text-xs" />
        <div className="text-xs text-slate-500 ml-auto">{rows.length} row{rows.length === 1 ? '' : 's'}</div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Designation</th>
              <th className="px-3 py-2 text-left">HQ</th>
              <th className="px-3 py-2 text-left">City</th>
              <th className="px-3 py-2 text-left">Manager</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400 text-sm">No sales employees match the current filters.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                <td className="px-3 py-2 text-slate-600">{r.designation || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.headquarters || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.city_of_operation || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.reporting_manager || '—'}</td>
                <td className="px-3 py-2">{statusBadge(r.status)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800">Edit</button>
                    {r.status !== 'Left' && r.status !== 'Exited' && (
                      <button onClick={() => setConfirmLeft(r)} className="text-red-600 hover:text-red-800">Mark Left</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMode && (
        <Modal open onClose={() => { setModalMode(null); setEditing(null) }}
          title={modalMode === 'edit' ? `Edit sales employee — ${editing?.code}` : 'New sales employee'}
          size="lg">
          <EmployeeForm
            initial={editing}
            isEdit={modalMode === 'edit'}
            onSubmit={handleSubmit}
            onCancel={() => { setModalMode(null); setEditing(null) }}
            submitting={createMut.isPending || updateMut.isPending}
          />
        </Modal>
      )}

      {confirmLeft && (
        <ConfirmDialog
          title={`Mark ${confirmLeft.code} as Left?`}
          message={`${confirmLeft.name} will be set to status=Left with today as DOL. This cannot be undone from the UI (edit the row to reopen).`}
          confirmText="Mark Left"
          cancelText="Cancel"
          onCancel={() => setConfirmLeft(null)}
          onConfirm={() => markLeftMut.mutate({ code: confirmLeft.code, company: confirmLeft.company })}
        />
      )}
    </div>
  )
}
