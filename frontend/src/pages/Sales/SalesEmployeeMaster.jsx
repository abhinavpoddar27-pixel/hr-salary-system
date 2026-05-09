import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  getSalesEmployees,
  createSalesEmployee,
  updateSalesEmployee,
  markSalesEmployeeLeft,
  salesTaDaRequestsList,
  salesTaDaRequestsByEmployee,
  salesTaDaRequestCreate,
  salesTaDaRequestCancel,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import CompanyFilter from '../../components/shared/CompanyFilter'
import {
  TA_DA_CLASS_LABELS,
  classLabel,
  ratesForClass,
  labelForRate,
  STATUS_BADGE,
  relativeTime,
} from '../../utils/taDaClassLabels'

const STATUS_OPTIONS = ['Active', 'Inactive', 'Left', 'Exited']
const DESIGNATION_OPTIONS = ['SO', 'SSO', 'ASE', 'ASM', 'TSI', 'SR ASM', 'RSM', 'PSR', 'Other']
const DEFAULT_COMPANY_OPTIONS = ['Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd']

const BANK_FIELDS_REQUIRED = ['bank_name', 'account_no', 'ifsc']

function formatTaDaRate(emp) {
  const cls = emp.ta_da_class
  if (cls === null || cls === undefined) {
    return <span className="text-slate-400">—</span>
  }
  if (cls === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 text-[10px] font-medium">
        Class 0 · Flag for Review
      </span>
    )
  }

  const isMissing = (v) => v === null || v === undefined || v === 0
  const fmt = (v) => isMissing(v)
    ? <span className="text-red-600">?</span>
    : v

  const da = emp.da_rate
  const daOut = emp.da_outstation_rate
  const taPrim = emp.ta_rate_primary
  const taSec = emp.ta_rate_secondary

  const pieces = [<span key="cls">Class {cls}</span>]

  if (cls === 1) {
    const missing = isMissing(da)
    pieces.push(
      <span key="da" className={missing ? 'text-red-600' : ''}>DA ₹{fmt(da)}/day</span>
    )
  } else if (cls === 2) {
    const missing = isMissing(da) || isMissing(daOut)
    pieces.push(
      <span key="da" className={missing ? 'text-red-600' : ''}>DA ₹{fmt(da)}–{fmt(daOut)}/day</span>
    )
  } else if (cls === 3) {
    const daMissing = isMissing(da)
    pieces.push(
      <span key="da" className={daMissing ? 'text-red-600' : ''}>DA ₹{fmt(da)}/day</span>
    )
    const taMissing = isMissing(taPrim)
    pieces.push(
      <span key="ta" className={taMissing ? 'text-red-600' : ''}>TA ₹{fmt(taPrim)}/km</span>
    )
  } else if (cls === 4) {
    const daMissing = isMissing(da) || isMissing(daOut)
    pieces.push(
      <span key="da" className={daMissing ? 'text-red-600' : ''}>DA ₹{fmt(da)}–{fmt(daOut)}/day</span>
    )
    const taMissing = isMissing(taPrim)
    pieces.push(
      <span key="ta" className={taMissing ? 'text-red-600' : ''}>TA ₹{fmt(taPrim)}/km</span>
    )
  } else if (cls === 5) {
    const daMissing = isMissing(da) || isMissing(daOut)
    pieces.push(
      <span key="da" className={daMissing ? 'text-red-600' : ''}>DA ₹{fmt(da)}–{fmt(daOut)}/day</span>
    )
    const taMissing = isMissing(taPrim) || isMissing(taSec)
    pieces.push(
      <span key="ta" className={taMissing ? 'text-red-600' : ''}>TA ₹{fmt(taPrim)}+{fmt(taSec)}/km</span>
    )
  } else {
    return <span className="text-slate-400">Class {cls}</span>
  }

  return (
    <span className="text-slate-700">
      {pieces.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' · '}
          {p}
        </React.Fragment>
      ))}
    </span>
  )
}

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
    // `code` is omitted on create — backend auto-assigns S### per company.
    // Edit form pre-fills `code` from the existing row via { ...initial }.
    name: '', company: defaultCompany,
    state: '', headquarters: '', city_of_operation: '',
    reporting_manager: '', designation: '', punch_no: '',
    working_hours: '',
    aadhaar: '', pan: '', dob: '', doj: '', contact: '', personal_contact: '',
    gross_salary: '',
    basic: '', hra: '', cca: '', conveyance: '',
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
      // `code` is auto-assigned server-side on create — no client validation.
      if (!form.company?.trim()) errs.company = 'Required'
    }
    if (!form.name?.trim()) errs.name = 'Required'
    for (const f of BANK_FIELDS_REQUIRED) {
      if (!String(form[f] || '').trim()) errs[f] = 'Required'
    }
    if (!isEdit) {
      const grossNum = parseFloat(form.gross_salary)
      if (!form.gross_salary || !(grossNum > 0)) errs.gross_salary = 'Required (must be > 0)'
      const componentKeys = ['basic', 'hra', 'cca', 'conveyance']
      for (const k of componentKeys) {
        if (String(form[k] || '').trim() === '') errs[k] = 'Required'
      }
      if (!errs.gross_salary && componentKeys.every(k => !errs[k])) {
        const sum = parseFloat(form.basic) + parseFloat(form.hra) + parseFloat(form.cca) + parseFloat(form.conveyance)
        if (Math.abs(sum - grossNum) > 1) {
          errs.gross_salary = `Components must sum to gross (got ₹${sum})`
        }
      }
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
    payload.basic = payload.basic === '' ? 0 : parseFloat(payload.basic) || 0
    payload.hra = payload.hra === '' ? 0 : parseFloat(payload.hra) || 0
    payload.cca = payload.cca === '' ? 0 : parseFloat(payload.cca) || 0
    payload.conveyance = payload.conveyance === '' ? 0 : parseFloat(payload.conveyance) || 0
    payload.pf_applicable = payload.pf_applicable ? 1 : 0
    payload.esi_applicable = payload.esi_applicable ? 1 : 0
    payload.pt_applicable = payload.pt_applicable ? 1 : 0
    if (isEdit) {
      delete payload.code
      delete payload.company
      delete payload.basic
      delete payload.hra
      delete payload.cca
      delete payload.conveyance
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
          {isEdit && (
            <div>
              {lbl('Code')}
              <input disabled value={form.code || ''} readOnly
                className="w-full border rounded-lg px-2 py-1.5 text-sm border-slate-300 bg-slate-100" />
            </div>
          )}
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
          <div>
            {lbl(isEdit ? 'Gross Monthly (₹)' : 'Gross Monthly (₹) *')}
            <input type="number" value={form.gross_salary} onChange={e => set('gross_salary', e.target.value)}
              className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors.gross_salary ? 'border-red-400' : 'border-slate-300')} />
            {errLine('gross_salary')}
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.pf_applicable} onChange={e => set('pf_applicable', e.target.checked ? 1 : 0)} /> PF</label>
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.esi_applicable} onChange={e => set('esi_applicable', e.target.checked ? 1 : 0)} /> ESI</label>
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!form.pt_applicable} onChange={e => set('pt_applicable', e.target.checked ? 1 : 0)} /> PT</label>
          </div>
        </div>
        {!isEdit && (
          <div className="grid grid-cols-4 gap-3 mt-3">
            {[['basic', 'Basic'], ['hra', 'HRA'], ['cca', 'CCA'], ['conveyance', 'Conveyance']].map(([k, label]) => (
              <div key={k}>
                {lbl(`${label} (₹) *`)}
                <input type="number" value={form[k]} onChange={e => set(k, e.target.value)}
                  className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm', errors[k] ? 'border-red-400' : 'border-slate-300')} />
                {errLine(k)}
              </div>
            ))}
          </div>
        )}
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

// ──────────────────────────────────────────────────────────────────────
// TA/DA Request Modal (Phase 2)
//
// HR opens this from the per-employee row "Request TA/DA Change" action.
// Saving here does NOT update the employee directly — it creates a row
// in sales_ta_da_change_requests with status='pending', awaiting finance
// approval. If a pending request already exists for this employee, the
// backend supersedes it atomically (single txn).
// ──────────────────────────────────────────────────────────────────────
function TaDaRequestModal({ employee, onClose, onSubmitted }) {
  const [cls, setCls] = useState(employee.ta_da_class ?? 0)
  const [da, setDa] = useState(employee.da_rate ?? '')
  const [daOut, setDaOut] = useState(employee.da_outstation_rate ?? '')
  const [taPri, setTaPri] = useState(employee.ta_rate_primary ?? '')
  const [taSec, setTaSec] = useState(employee.ta_rate_secondary ?? '')
  const [notes, setNotes] = useState(employee.ta_da_notes ?? '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})

  const visibleRates = ratesForClass(cls)
  const showRate = (k) => visibleRates.includes(k)

  const mutation = useMutation({
    mutationFn: (data) => salesTaDaRequestCreate(data),
    onSuccess: (res) => {
      const supersededId = res?.data?.supersededId
      toast.success(supersededId
        ? `Request submitted (superseded #${supersededId})`
        : 'Request submitted for finance approval')
      onSubmitted && onSubmitted()
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Submit failed'),
  })

  const numOrNull = (v) => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!reason.trim()) errs.reason = 'Reason is required'
    for (const k of visibleRates) {
      const map = { da_rate: da, da_outstation_rate: daOut, ta_rate_primary: taPri, ta_rate_secondary: taSec }
      const v = map[k]
      if (v !== '' && v !== null && (Number.isNaN(Number(v)) || Number(v) < 0)) {
        errs[k] = 'Must be a non-negative number'
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error('Please fix highlighted fields')
      return
    }

    mutation.mutate({
      employee_code: employee.code,
      new_ta_da_class: Number(cls),
      new_da_rate: showRate('da_rate') ? numOrNull(da) : null,
      new_da_outstation_rate: showRate('da_outstation_rate') ? numOrNull(daOut) : null,
      new_ta_rate_primary: showRate('ta_rate_primary') ? numOrNull(taPri) : null,
      new_ta_rate_secondary: showRate('ta_rate_secondary') ? numOrNull(taSec) : null,
      new_ta_da_notes: notes || null,
      reason: reason.trim(),
    })
  }

  const lbl = (s) => <span className="block text-xs font-medium text-slate-600 mb-1">{s}</span>

  const renderRateInput = (k, value, setter) => (
    <div key={k}>
      {lbl(labelForRate(k, cls))}
      <input
        type="number" step="0.01" min="0"
        value={value ?? ''}
        onChange={e => setter(e.target.value)}
        className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm',
          errors[k] ? 'border-red-400' : 'border-slate-300')}
      />
      {errors[k] && <p className="text-xs text-red-600 mt-1">{errors[k]}</p>}
    </div>
  )

  return (
    <Modal open onClose={onClose} title={`Request TA/DA Change — ${employee.code} ${employee.name}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-600 mb-1">Current</p>
          <p className="text-sm font-medium text-slate-800">{classLabel(employee.ta_da_class)}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            DA: {employee.da_rate ?? '—'} · DA-out: {employee.da_outstation_rate ?? '—'} ·
            TA-pri: {employee.ta_rate_primary ?? '—'} · TA-sec: {employee.ta_rate_secondary ?? '—'}
          </p>
        </div>

        <div>
          {lbl('TA/DA Class *')}
          <select value={cls} onChange={e => setCls(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
            {Object.entries(TA_DA_CLASS_LABELS).map(([n, lab]) => (
              <option key={n} value={n}>Class {n}: {lab}</option>
            ))}
          </select>
        </div>

        {visibleRates.length === 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            {Number(cls) === 0
              ? 'Flag for Review — no rates apply.'
              : `Class ${cls} carries no rate fields — submit with a reason and finance will resolve.`}
          </div>
        )}
        {visibleRates.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {visibleRates.includes('da_rate') && renderRateInput('da_rate', da, setDa)}
            {visibleRates.includes('da_outstation_rate') && renderRateInput('da_outstation_rate', daOut, setDaOut)}
            {visibleRates.includes('ta_rate_primary') && renderRateInput('ta_rate_primary', taPri, setTaPri)}
            {visibleRates.includes('ta_rate_secondary') && renderRateInput('ta_rate_secondary', taSec, setTaSec)}
          </div>
        )}

        <div>
          {lbl('Notes')}
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Internal notes (optional)"
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>

        <div>
          {lbl('Reason for change *')}
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Why is this change needed? Finance will see this when reviewing."
            className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm',
              errors.reason ? 'border-red-400' : 'border-slate-300')} />
          {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-400">
            {mutation.isPending ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────────────
// TA/DA History Modal (Phase 2)
// Shows all change requests for one employee, chronological. Highlights
// pending request with diff + reason. Owner can cancel from here.
// ──────────────────────────────────────────────────────────────────────
function TaDaHistoryModal({ employee, currentUsername, onClose }) {
  const qc = useQueryClient()
  const { data: res, isLoading } = useQuery({
    queryKey: ['ta-da-history', employee.code],
    queryFn: () => salesTaDaRequestsByEmployee(employee.code),
    retry: 0,
  })
  const requests = res?.data?.data || []

  const cancelMut = useMutation({
    mutationFn: (id) => salesTaDaRequestCancel(id),
    onSuccess: () => {
      toast.success('Request cancelled')
      qc.invalidateQueries({ queryKey: ['ta-da-history', employee.code] })
      qc.invalidateQueries({ queryKey: ['ta-da-pending-list'] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Cancel failed'),
  })

  const renderDiff = (r) => {
    const fields = [
      ['Class',     'old_ta_da_class',         'new_ta_da_class'],
      ['DA',        'old_da_rate',             'new_da_rate'],
      ['DA-out',    'old_da_outstation_rate',  'new_da_outstation_rate'],
      ['TA-pri',    'old_ta_rate_primary',     'new_ta_rate_primary'],
      ['TA-sec',    'old_ta_rate_secondary',   'new_ta_rate_secondary'],
      ['Notes',     'old_ta_da_notes',         'new_ta_da_notes'],
    ]
    return (
      <table className="w-full text-xs mt-2">
        <tbody>
          {fields.map(([lab, ok, nk]) => {
            const ov = r[ok], nv = r[nk]
            const changed = String(ov ?? '') !== String(nv ?? '')
            if (!changed && ov === null && nv === null) return null
            return (
              <tr key={lab} className={clsx(changed && 'bg-amber-50')}>
                <td className="py-0.5 px-2 text-slate-500 w-16">{lab}</td>
                <td className="py-0.5 px-2 text-slate-600 font-mono">{ov ?? '—'}</td>
                <td className="py-0.5 px-2 text-slate-400">→</td>
                <td className="py-0.5 px-2 text-slate-800 font-mono font-medium">{nv ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <Modal open onClose={onClose} title={`TA/DA History — ${employee.code} ${employee.name}`} size="lg">
      <div className="space-y-3">
        {isLoading && <p className="text-xs text-slate-400 text-center py-6">Loading…</p>}
        {!isLoading && requests.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-6">No TA/DA change requests yet for this employee.</p>
        )}
        {requests.map(r => {
          const badge = STATUS_BADGE[r.status] || { label: r.status, classes: 'bg-slate-100 text-slate-700' }
          const isOwner = r.requested_by === currentUsername
          return (
            <div key={r.id} className="border border-slate-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-500">#{r.id}</span>
                  <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium border', badge.classes)}>
                    {badge.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    by <strong className="text-slate-700">{r.requested_by}</strong> {relativeTime(r.requested_at)}
                  </span>
                </div>
                {r.status === 'pending' && isOwner && (
                  <button onClick={() => cancelMut.mutate(r.id)} disabled={cancelMut.isPending}
                    className="text-xs text-red-600 hover:text-red-800 disabled:text-slate-400">
                    Cancel my request
                  </button>
                )}
              </div>
              {renderDiff(r)}
              {r.reason && (
                <p className="text-xs text-slate-600 mt-2"><strong>Reason:</strong> {r.reason}</p>
              )}
              {r.rejection_reason && (
                <p className="text-xs text-red-700 mt-1"><strong>Rejection reason:</strong> {r.rejection_reason}</p>
              )}
              {r.resolved_by && (
                <p className="text-xs text-slate-500 mt-1">
                  Resolved by <strong className="text-slate-700">{r.resolved_by}</strong> {relativeTime(r.resolved_at)}
                </p>
              )}
              {r.superseded_by_request_id && (
                <p className="text-xs text-slate-500 mt-1">Superseded by #{r.superseded_by_request_id}</p>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

export default function SalesEmployeeMaster() {
  const qc = useQueryClient()
  const { selectedCompany, user } = useAppStore()
  const currentUsername = user?.username || ''

  const [filters, setFilters] = useState({ status: '', state: '', manager: '', hq: '' })
  const [modalMode, setModalMode] = useState(null) // 'create' | 'edit'
  const [editing, setEditing] = useState(null)
  const [confirmLeft, setConfirmLeft] = useState(null)
  const [taDaRequestFor, setTaDaRequestFor] = useState(null)  // employee or null
  const [taDaHistoryFor, setTaDaHistoryFor] = useState(null)  // employee or null

  // Pull all pending TA/DA requests so we can mark employees with a "Pending" pill.
  const { data: pendingRes } = useQuery({
    queryKey: ['ta-da-pending-list'],
    queryFn: () => salesTaDaRequestsList({ status: 'pending' }),
    retry: 0,
    staleTime: 30 * 1000,
  })
  const pendingByCode = useMemo(() => {
    const map = {}
    for (const r of (pendingRes?.data?.data || [])) {
      map[r.employee_code] = r
    }
    return map
  }, [pendingRes])

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
    onSuccess: (resp) => {
      const assigned = resp?.data?.data?.code
      toast.success(assigned ? `Created employee ${assigned}` : 'Sales employee created')
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
        <table className="min-w-[1300px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left hidden lg:table-cell">Designation</th>
              <th className="px-3 py-2 text-left hidden lg:table-cell">HQ</th>
              <th className="px-3 py-2 text-left">City</th>
              <th className="px-3 py-2 text-left hidden md:table-cell">Manager</th>
              <th className="px-3 py-2 text-left">TA/DA Rate</th>
              <th className="px-3 py-2 text-left">Salary</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-4 text-center text-slate-400 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-sm">No sales employees match the current filters.</td></tr>
            )}
            {rows.map(r => {
              const pending = pendingByCode[r.code]
              return (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{r.designation || '—'}</td>
                <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{r.headquarters || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.city_of_operation || '—'}</td>
                <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{r.reporting_manager || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {formatTaDaRate(r)}
                    {pending && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-medium"
                        title={`Pending request by ${pending.requested_by}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        Pending
                      </span>
                    )}
                  </div>
                </td>
                {r.gross_salary > 0 ? (
                  <td className="px-3 py-2 text-slate-700">
                    ₹{Number(r.gross_salary).toLocaleString('en-IN')}
                  </td>
                ) : (
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 text-[10px] font-medium">No salary set</span>
                  </td>
                )}
                <td className="px-3 py-2">{statusBadge(r.status)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 text-xs flex-wrap">
                    <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800">Edit</button>
                    <button onClick={() => setTaDaRequestFor(r)} className="text-indigo-600 hover:text-indigo-800">
                      Request TA/DA
                    </button>
                    <button onClick={() => setTaDaHistoryFor(r)} className="text-slate-600 hover:text-slate-800">
                      History
                    </button>
                    {r.status !== 'Left' && r.status !== 'Exited' && (
                      <button onClick={() => setConfirmLeft(r)} className="text-red-600 hover:text-red-800">Mark Left</button>
                    )}
                  </div>
                </td>
              </tr>
            )})}
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

      {taDaRequestFor && (
        <TaDaRequestModal
          employee={taDaRequestFor}
          onClose={() => setTaDaRequestFor(null)}
          onSubmitted={() => {
            qc.invalidateQueries({ queryKey: ['ta-da-pending-list'] })
            qc.invalidateQueries({ queryKey: ['ta-da-history', taDaRequestFor.code] })
          }}
        />
      )}

      {taDaHistoryFor && (
        <TaDaHistoryModal
          employee={taDaHistoryFor}
          currentUsername={currentUsername}
          onClose={() => setTaDaHistoryFor(null)}
        />
      )}
    </div>
  )
}
