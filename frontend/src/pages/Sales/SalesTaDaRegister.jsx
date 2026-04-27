import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesTaDaRegister,
  salesTaDaCompute,
  salesTaDaEmployeeDetail,
  salesTaDaInputsPatch,
  salesTaDaExcelDownloadUrl,
  salesTaDaNeftDownloadUrl,
  salesTaDaNeftPreview,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { cycleSubtitle } from '../../utils/cycleUtil'
import CompanyFilter from '../../components/shared/CompanyFilter'
import Modal from '../../components/ui/Modal'
import {
  classLabel,
  computationStatusLabel,
  computationStatusBadgeClass,
} from '../../utils/taDaClassLabels'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_OPTIONS = [
  { value: '',                label: 'All Statuses' },
  { value: 'computed',        label: 'Computed' },
  { value: 'partial',         label: 'Partial' },
  { value: 'flag_for_review', label: 'Flag for Review' },
  { value: 'paid',            label: 'Paid' },
]

const CLASS_OPTIONS = [
  { value: '',  label: 'All Classes' },
  { value: '0', label: 'Class 0' },
  { value: '1', label: 'Class 1' },
  { value: '2', label: 'Class 2' },
  { value: '3', label: 'Class 3' },
  { value: '4', label: 'Class 4' },
  { value: '5', label: 'Class 5' },
]

function fmtINR(n) {
  const v = Number(n || 0)
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v)
}

function MonthYearPicker({ month, year, onChange }) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const years = [thisYear - 1, thisYear, thisYear + 1]
  return (
    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
      <select
        value={month}
        onChange={e => onChange(parseInt(e.target.value, 10), year)}
        className="font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer text-sm"
      >
        {MONTHS.slice(1).map((m, i) => (
          <option key={i + 1} value={i + 1}>{m}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={e => onChange(month, parseInt(e.target.value, 10))}
        className="font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer text-sm"
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

function StatusBadge({ status }) {
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium border', computationStatusBadgeClass(status))}>
      {computationStatusLabel(status)}
    </span>
  )
}

function DACell({ row }) {
  const total = Number(row.total_da || 0)
  const local = Number(row.da_local_amount || 0)
  const out   = Number(row.da_outstation_amount || 0)
  if (local > 0 && out > 0) {
    return (
      <span className="font-mono text-sm">
        ₹{fmtINR(total)} <span className="text-xs text-slate-400">(₹{fmtINR(local)} + ₹{fmtINR(out)})</span>
      </span>
    )
  }
  return <span className="font-mono text-sm">₹{fmtINR(total)}</span>
}

function TACell({ row }) {
  const total = Number(row.total_ta || 0)
  const pri = Number(row.ta_primary_amount || 0)
  const sec = Number(row.ta_secondary_amount || 0)
  if (pri > 0 && sec > 0) {
    return (
      <span className="font-mono text-sm">
        ₹{fmtINR(total)} <span className="text-xs text-slate-400">(₹{fmtINR(pri)} + ₹{fmtINR(sec)})</span>
      </span>
    )
  }
  return <span className="font-mono text-sm">₹{fmtINR(total)}</span>
}

const NEFT_MODE_LABELS = {
  computed_only: 'Computed only',
  all:           'All eligible (Computed + Partial)',
}

function NeftConfirmModal({ mode, month, year, company, onCancel }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sales-ta-da-neft-preview', month, year, company, mode],
    queryFn: () => salesTaDaNeftPreview({ month, year, company, mode }),
    enabled: !!month && !!year && !!company && !!mode,
    retry: 0,
  })
  const preview = data?.data?.data || {}
  const totals = preview.totals || { count: 0, totalAmount: 0 }
  const missing = Array.isArray(preview.missing) ? preview.missing : []

  const handleDownload = () => {
    const url = salesTaDaNeftDownloadUrl({ month, year, company, mode })
    window.open(url, '_blank')
    onCancel()
  }

  return (
    <Modal open onClose={onCancel} title={`Download NEFT — ${NEFT_MODE_LABELS[mode] || mode}`} size="md">
      <div className="space-y-4">
        {isLoading && (
          <p className="text-sm text-slate-500">Loading preview…</p>
        )}
        {isError && (
          <p className="text-sm text-red-600">
            Preview failed: {error?.response?.data?.error || error?.message || 'unknown error'}
          </p>
        )}
        {!isLoading && !isError && (
          <>
            <p className="text-sm text-slate-700">
              Ready: <strong>{totals.count}</strong> employee(s) included.
              {missing.length > 0 ? (
                <>
                  {' '}<strong>{missing.length}</strong> excluded due to missing bank details
                  <span className="block mt-1 text-xs text-slate-500 font-mono">
                    {missing.map(m => m.employee_code || m).join(', ')}
                  </span>
                </>
              ) : (
                <> No employees excluded.</>
              )}
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              On download, <code>neft_exported_at</code> will be stamped on every included row.
              Continue?
            </p>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isLoading || isError || totals.count === 0}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            Download
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Which input fields are editable per TA/DA class. Distinct from
// `ratesForClass()` in taDaClassLabels.js which lists the *rate* fields
// (da_rate, ta_rate_primary, etc.) — those live on the employee master,
// not on the monthly input. Inputs are HR/finance-entered each cycle.
function inputFieldsForClass(c) {
  switch (Number(c)) {
    case 2: return ['in_city_days', 'outstation_days']
    case 3: return ['total_km']
    case 4: return ['in_city_days', 'outstation_days', 'total_km']
    case 5: return ['in_city_days', 'outstation_days', 'bike_km', 'car_km']
    default: return []   // class 0 / 1 / unknown → notes-only
  }
}

const INPUT_LABELS = {
  in_city_days:    'In-city days',
  outstation_days: 'Outstation days',
  total_km:        'Total km',
  bike_km:         'Bike km',
  car_km:          'Car km',
}

function EditInputsModal({ target, month, year, company, onClose }) {
  const qc = useQueryClient()

  // Initialize form state from the register row's monthly-input fields.
  // Empty string means "no value, will be sent as null on PATCH" — keeps
  // controlled inputs working without React warnings.
  const initial = useMemo(() => ({
    in_city_days:    target.in_city_days    ?? '',
    outstation_days: target.outstation_days ?? '',
    total_km:        target.total_km        ?? '',
    bike_km:         target.bike_km         ?? '',
    car_km:          target.car_km          ?? '',
    notes:           target.input_notes     ?? '',
  }), [target])

  const [form, setForm] = useState(initial)
  const [serverError, setServerError] = useState('')

  const taDaClass = target.ta_da_class_at_compute
  const daysWorked = Number(target.days_worked_at_compute || 0)
  const visibleFields = inputFieldsForClass(taDaClass)
  const isClass0 = Number(taDaClass) === 0
  const isClass1 = Number(taDaClass) === 1

  // ── Validation ──
  const errors = useMemo(() => {
    const e = {}
    for (const k of ['in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km']) {
      const v = form[k]
      if (v === '' || v === null || v === undefined) continue
      const n = typeof v === 'number' ? v : parseFloat(v)
      if (!Number.isFinite(n) || n < 0) {
        e[k] = 'Must be a non-negative number'
      }
    }
    // Cross-field: in_city + outstation ≤ days_worked
    const ic = form.in_city_days === '' ? null : parseFloat(form.in_city_days)
    const os = form.outstation_days === '' ? null : parseFloat(form.outstation_days)
    if (ic !== null && os !== null && Number.isFinite(ic) && Number.isFinite(os)) {
      const sum = ic + os
      if (sum > daysWorked) {
        const msg = `Split exceeds days worked: ${sum} > ${daysWorked}`
        e.in_city_days = e.in_city_days || msg
        e.outstation_days = e.outstation_days || msg
      }
    }
    return e
  }, [form, daysWorked])

  const hasErrors = Object.keys(errors).length > 0
  const isDirty = (
    form.notes !== initial.notes ||
    form.in_city_days !== initial.in_city_days ||
    form.outstation_days !== initial.outstation_days ||
    form.total_km !== initial.total_km ||
    form.bike_km !== initial.bike_km ||
    form.car_km !== initial.car_km
  )

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setServerError('')
  }

  const buildPatchBody = () => {
    const body = {}
    const numericKeys = ['in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km']
    for (const k of numericKeys) {
      if (form[k] !== initial[k]) {
        body[k] = form[k] === '' ? null : Number(form[k])
      }
    }
    if (form.notes !== initial.notes) body.notes = form.notes === '' ? null : form.notes
    return body
  }

  const saveMut = useMutation({
    mutationFn: (body) => salesTaDaInputsPatch(target.employee_code, { month, year, company }, body),
    onSuccess: (r) => {
      const computation = r?.data?.data?.computation
      const newStatus = computation?.status || 'updated'
      toast.success(`Updated. Status: ${newStatus}`)
      qc.invalidateQueries({ queryKey: ['sales-ta-da-register'] })
      onClose()
    },
    onError: (err) => {
      const status = err?.response?.status
      const msg = err?.response?.data?.error || err?.message || 'Update failed'
      // 400 → keep modal open so HR can correct; 500/network → show inline
      // server error and let HR retry or cancel.
      if (status === 400 || status === 500) {
        setServerError(msg)
      } else {
        toast.error(msg)
      }
    },
  })

  const handleSave = () => {
    if (hasErrors) return
    const body = buildPatchBody()
    if (Object.keys(body).length === 0) {
      toast.error('No changes to save')
      return
    }
    setServerError('')
    saveMut.mutate(body)
  }

  const NumberInput = ({ field }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {INPUT_LABELS[field]}
      </label>
      <input
        type="number"
        step="0.5"
        min="0"
        value={form[field]}
        onChange={e => handleChange(field, e.target.value)}
        className={clsx(
          'w-full border rounded px-2 py-1.5 text-sm',
          errors[field] ? 'border-red-400' : 'border-slate-300'
        )}
      />
      {errors[field] && (
        <p className="text-xs text-red-600 mt-0.5">{errors[field]}</p>
      )}
    </div>
  )

  return (
    <Modal
      open
      onClose={() => !saveMut.isPending && onClose()}
      title={`Edit TA/DA Inputs — ${target.employee_code} ${target.employee_name || ''}`.trim()}
      size="lg"
    >
      <div className="space-y-4">
        <div className="text-xs text-slate-500">
          Class: <strong className="text-slate-700">{classLabel(taDaClass)}</strong>
          {' · '}Days worked: <strong className="text-slate-700">{daysWorked}</strong>
        </div>

        {isClass0 && (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            Class 0: HR review required. No edits allowed.
          </div>
        )}
        {isClass1 && (
          <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-2">
            Class 1: auto-computed from days worked. No inputs needed.
          </div>
        )}

        {visibleFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleFields.map(f => <NumberInput key={f} field={f} />)}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Notes
          </label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={e => handleChange('notes', e.target.value)}
            placeholder="Optional remark — context for finance/audit"
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </div>

        {serverError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <strong>Error:</strong> {serverError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={saveMut.isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={hasErrors || !isDirty || saveMut.isPending}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Read-only key/value row used inside DetailViewModal sections.
function DetailRow({ label, value, mono = false, highlight = false }) {
  const display = (value === null || value === undefined || value === '') ? '—' : value
  return (
    <div className="flex justify-between items-baseline gap-3 py-1 border-b border-slate-100 last:border-b-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={clsx(
          'text-sm text-right',
          mono && 'font-mono',
          highlight ? 'font-semibold text-slate-900' : 'text-slate-700'
        )}
      >
        {display}
      </span>
    </div>
  )
}

function DetailSection({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wide mb-1">
        {title}
      </h3>
      <div className="bg-slate-50 border border-slate-200 rounded p-2">
        {children}
      </div>
    </div>
  )
}

function fmtRupees(n) {
  if (n === null || n === undefined) return '—'
  return `₹${fmtINR(n)}`
}

function DetailViewModal({ target, month, year, company, onClose }) {
  const qc = useQueryClient()

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sales-ta-da-employee-detail', target.code, month, year, company],
    queryFn: () => salesTaDaEmployeeDetail(target.code, { month, year, company }),
    enabled: !!target.code && !!month && !!year && !!company,
    retry: 0,
  })

  const data       = res?.data?.data || {}
  const employee   = data.employee   || {}
  const cycle      = data.cycle      || {}
  const computation = data.computation || null

  const recomputeMut = useMutation({
    mutationFn: () => salesTaDaCompute({
      month, year, company, employeeCode: target.code,
    }),
    onSuccess: (r) => {
      const d = r?.data?.data || {}
      const errCount = Array.isArray(d.errors) ? d.errors.length : 0
      const errSuffix = errCount > 0 ? `, ${errCount} error(s)` : ''
      toast.success(`Recomputed ${target.code}: ${d.computed || 0} computed, ${d.partial || 0} partial, ${d.flagged || 0} flagged${errSuffix}`)
      qc.invalidateQueries({ queryKey: ['sales-ta-da-register'] })
      qc.invalidateQueries({ queryKey: ['sales-ta-da-employee-detail', target.code] })
      refetch()
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || 'Recompute failed')
    },
  })

  return (
    <Modal
      open
      onClose={() => !recomputeMut.isPending && onClose()}
      title={`TA/DA Detail — ${target.code}${target.name ? ' ' + target.name : ''}`}
      size="lg"
    >
      {isLoading && (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
      {isError && (
        <p className="text-sm text-red-600">
          Failed to load: {error?.response?.data?.error || error?.message || 'unknown error'}
        </p>
      )}
      {!isLoading && !isError && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <DetailSection title="Identity">
            <DetailRow label="Code"             value={employee.code} mono />
            <DetailRow label="Name"             value={employee.name} />
            <DetailRow label="Designation"      value={employee.designation} />
            <DetailRow label="HQ"               value={employee.headquarters} />
            <DetailRow label="City of Operation" value={employee.city_of_operation} />
          </DetailSection>

          <DetailSection title="Cycle">
            <DetailRow label="Start"       value={cycle.start} mono />
            <DetailRow label="End"         value={cycle.end} mono />
            <DetailRow label="Length (days)" value={cycle.length_days} mono />
          </DetailSection>

          {!computation ? (
            <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
              No TA/DA computation exists for this employee in this cycle.
              Click <strong>Recompute this employee</strong> to generate one.
            </div>
          ) : (
            <>
              <DetailSection title="Inputs at Compute">
                <DetailRow label="Class"          value={classLabel(computation.ta_da_class_at_compute)} />
                <DetailRow label="Days worked"    value={computation.days_worked_at_compute} mono />
                <DetailRow label="In-city days"   value={computation.in_city_days_at_compute} mono />
                <DetailRow label="Outstation days" value={computation.outstation_days_at_compute} mono />
                <DetailRow label="Total km"       value={computation.total_km_at_compute} mono />
                <DetailRow label="Bike km"        value={computation.bike_km_at_compute} mono />
                <DetailRow label="Car km"         value={computation.car_km_at_compute} mono />
              </DetailSection>

              <DetailSection title="Rates at Compute">
                <DetailRow label="DA rate (in-city)"     value={fmtRupees(computation.da_rate_at_compute)} mono />
                <DetailRow label="DA rate (outstation)"  value={fmtRupees(computation.da_outstation_rate_at_compute)} mono />
                <DetailRow label="TA rate (primary)"     value={fmtRupees(computation.ta_rate_primary_at_compute)} mono />
                <DetailRow label="TA rate (secondary)"   value={fmtRupees(computation.ta_rate_secondary_at_compute)} mono />
              </DetailSection>

              <DetailSection title="Outputs">
                <DetailRow label="DA (in-city)"     value={fmtRupees(computation.da_local_amount)} mono />
                <DetailRow label="DA (outstation)"  value={fmtRupees(computation.da_outstation_amount)} mono />
                <DetailRow label="Total DA"         value={fmtRupees(computation.total_da)} mono highlight />
                <DetailRow label="TA (primary)"     value={fmtRupees(computation.ta_primary_amount)} mono />
                <DetailRow label="TA (secondary)"   value={fmtRupees(computation.ta_secondary_amount)} mono />
                <DetailRow label="Total TA"         value={fmtRupees(computation.total_ta)} mono highlight />
                <DetailRow label="Total Payable"    value={fmtRupees(computation.total_payable)} mono highlight />
              </DetailSection>

              <DetailSection title="Status">
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-xs text-slate-500">Status</span>
                  <span className={clsx(
                    'inline-block px-2 py-0.5 rounded-full text-xs font-medium border',
                    computationStatusBadgeClass(computation.status)
                  )}>
                    {computationStatusLabel(computation.status)}
                  </span>
                </div>
                <DetailRow label="Computation notes" value={computation.computation_notes} />
              </DetailSection>

              <DetailSection title="Audit">
                <DetailRow label="Computed at"      value={computation.computed_at} mono />
                <DetailRow label="Computed by"      value={computation.computed_by} />
                <DetailRow label="NEFT exported at" value={computation.neft_exported_at} mono />
                <DetailRow label="NEFT exported by" value={computation.neft_exported_by} />
                <DetailRow label="Paid at"          value={computation.paid_at} mono />
              </DetailSection>
            </>
          )}
        </div>
      )}

      <div className="flex justify-between items-center gap-2 pt-3 mt-3 border-t">
        <button
          type="button"
          onClick={() => recomputeMut.mutate()}
          disabled={recomputeMut.isPending || isLoading || isError}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
        >
          {recomputeMut.isPending ? 'Recomputing…' : 'Recompute this employee'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={recomputeMut.isPending}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}

export default function SalesTaDaRegister() {
  const qc = useQueryClient()
  const {
    selectedCompany,
    selectedMonth,
    selectedYear,
    setMonthYear,
  } = useAppStore()

  const [statusFilter, setStatusFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [showRecomputeConfirm, setShowRecomputeConfirm] = useState(false)
  // null | 'computed_only' | 'all'
  const [showNeftConfirm, setShowNeftConfirm] = useState(null)
  // null | row object
  const [editTarget, setEditTarget] = useState(null)
  // null | { code, name }
  const [detailTarget, setDetailTarget] = useState(null)

  const ready = !!selectedCompany && !!selectedMonth && !!selectedYear

  const queryParams = useMemo(() => {
    const p = {
      month: selectedMonth,
      year: selectedYear,
      company: selectedCompany,
    }
    if (statusFilter) p.status = statusFilter
    if (classFilter !== '') p.ta_da_class = classFilter
    return p
  }, [selectedCompany, selectedMonth, selectedYear, statusFilter, classFilter])

  const { data: res, isLoading, isError, error } = useQuery({
    queryKey: ['sales-ta-da-register', queryParams],
    queryFn: () => salesTaDaRegister(queryParams),
    enabled: ready,
    retry: 0,
  })

  const rows   = res?.data?.data?.rows   || []
  const totals = res?.data?.data?.totals || { total_da: 0, total_ta: 0, total_payable: 0, count: 0 }

  const recomputeMut = useMutation({
    mutationFn: () => salesTaDaCompute({
      month: selectedMonth,
      year: selectedYear,
      company: selectedCompany,
    }),
    onSuccess: (r) => {
      const d = r?.data?.data || {}
      const errCount = Array.isArray(d.errors) ? d.errors.length : 0
      const errSuffix = errCount > 0 ? `, ${errCount} error(s)` : ''
      toast.success(`Recomputed: ${d.computed || 0} computed, ${d.partial || 0} partial, ${d.flagged || 0} flagged${errSuffix}`)
      qc.invalidateQueries({ queryKey: ['sales-ta-da-register'] })
      setShowRecomputeConfirm(false)
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || 'Recompute failed')
      setShowRecomputeConfirm(false)
    },
  })

  const handleExportExcel = () => {
    if (!ready) return
    const url = salesTaDaExcelDownloadUrl({
      month: selectedMonth,
      year: selectedYear,
      company: selectedCompany,
      status: statusFilter || undefined,
    })
    window.open(url, '_blank')
  }

  const handleRecompute = () => {
    if (!ready) return
    setShowRecomputeConfirm(true)
  }

  const handleNeftComputed = () => {
    if (!ready) return
    setShowNeftConfirm('computed_only')
  }

  const handleNeftAll = () => {
    if (!ready) return
    setShowNeftConfirm('all')
  }

  const handleEdit = (row) => {
    setEditTarget(row)
  }

  const handleDetails = (row) => {
    setDetailTarget({ code: row.employee_code, name: row.employee_name })
  }

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CompanyFilter />
          <MonthYearPicker
            month={selectedMonth}
            year={selectedYear}
            onChange={(m, y) => setMonthYear(m, y)}
          />
          <p className="text-[11px] text-indigo-600 font-medium">
            {cycleSubtitle(selectedMonth, selectedYear)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRecompute}
            disabled={!ready}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            Recompute Cycle
          </button>
        </div>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-800">Sales TA/DA Register</h1>
        <p className="text-xs text-slate-500">
          {selectedCompany || '—'} · {MONTHS[selectedMonth] || '—'} {selectedYear || '—'} · {rows.length} row(s)
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
          >
            {CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={!ready || rows.length === 0}
            className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            Export Excel
          </button>
          <button
            onClick={handleNeftComputed}
            disabled={!ready}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            Export NEFT (Computed)
          </button>
          <button
            onClick={handleNeftAll}
            disabled={!ready}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
          >
            Export NEFT (All)
          </button>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Class</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Days</th>
              <th className="px-3 py-2 text-right">DA</th>
              <th className="px-3 py-2 text-right">TA</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!ready && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-slate-400 text-sm">
                  Select company, month, and year to view the TA/DA register.
                </td>
              </tr>
            )}
            {ready && isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-slate-400 text-sm">
                  Loading…
                </td>
              </tr>
            )}
            {ready && isError && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-red-600 text-sm">
                  Failed to load: {error?.response?.data?.error || error?.message || 'unknown error'}
                </td>
              </tr>
            )}
            {ready && !isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-slate-500 text-sm">
                  No TA/DA computations for this cycle. Run salary compute first to trigger
                  Phase&nbsp;α auto-compute, or click Recompute Cycle.
                </td>
              </tr>
            )}
            {ready && !isLoading && !isError && rows.map(row => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.employee_code}</td>
                <td className="px-3 py-2">
                  <div className="text-sm font-medium text-slate-800">{row.employee_name || '—'}</div>
                  {row.designation && (
                    <div className="text-xs text-slate-500">{row.designation}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {classLabel(row.ta_da_class_at_compute)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">
                  {Number(row.days_worked_at_compute || 0)}
                </td>
                <td className="px-3 py-2 text-right">
                  <DACell row={row} />
                </td>
                <td className="px-3 py-2 text-right">
                  <TACell row={row} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm font-medium text-slate-900">
                  ₹{fmtINR(row.total_payable)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5 text-xs">
                    <button
                      onClick={() => handleEdit(row)}
                      className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDetails(row)}
                      className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700"
                    >
                      Details
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sticky footer totals */}
      {ready && rows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white border-t border-slate-200 px-4 py-2 z-30">
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-500">
              Σ DA: <span className="font-mono font-medium text-slate-800">₹{fmtINR(totals.total_da)}</span>
            </span>
            <span className="text-slate-500">
              Σ TA: <span className="font-mono font-medium text-slate-800">₹{fmtINR(totals.total_ta)}</span>
            </span>
            <span className="text-slate-500">
              Σ Payable: <span className="font-mono font-semibold text-slate-900">₹{fmtINR(totals.total_payable)}</span>
            </span>
            <span className="text-slate-500">
              Count: <span className="font-medium text-slate-800">{totals.count}</span>
            </span>
          </div>
        </div>
      )}

      {/* Recompute confirmation modal */}
      {showRecomputeConfirm && (
        <Modal
          open
          onClose={() => !recomputeMut.isPending && setShowRecomputeConfirm(false)}
          title="Recompute TA/DA Cycle"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              This will recompute TA/DA for all employees in{' '}
              <strong>{MONTHS[selectedMonth]} {selectedYear}</strong> · {selectedCompany}.
              Manual edits to inputs will be preserved; outputs will be regenerated. Continue?
            </p>
            <p className="text-xs text-slate-500">
              {cycleSubtitle(selectedMonth, selectedYear)}
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowRecomputeConfirm(false)}
                disabled={recomputeMut.isPending}
                className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => recomputeMut.mutate()}
                disabled={recomputeMut.isPending}
                className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
              >
                {recomputeMut.isPending ? 'Recomputing…' : 'Recompute'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* NEFT confirmation modal (computed_only or all) */}
      {showNeftConfirm && ready && (
        <NeftConfirmModal
          mode={showNeftConfirm}
          month={selectedMonth}
          year={selectedYear}
          company={selectedCompany}
          onCancel={() => setShowNeftConfirm(null)}
        />
      )}

      {/* Edit Inputs modal */}
      {editTarget && (
        <EditInputsModal
          target={editTarget}
          month={selectedMonth}
          year={selectedYear}
          company={selectedCompany}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Detail (read-only) modal */}
      {detailTarget && (
        <DetailViewModal
          target={detailTarget}
          month={selectedMonth}
          year={selectedYear}
          company={selectedCompany}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  )
}
