import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesTaDaRegister,
  salesTaDaCompute,
  salesTaDaExcelDownloadUrl,
  salesTaDaNeftDownloadUrl,
  salesTaDaNeftPreview,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import CompanyFilter from '../../components/shared/CompanyFilter'
import Modal from '../../components/ui/Modal'
import {
  classLabel,
  computationStatusLabel,
  computationStatusBadgeClass,
} from '../../utils/taDaClassLabels'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sales salary cycle: (M-1)-26 … M-25. Kept in sync with
// backend/src/services/cycleUtil.js deriveCycle(). If the backend rule
// changes, update both in lockstep. Inlined here to avoid coupling to
// the helper in SalesSalaryCompute.jsx; consider extracting both copies
// to a shared frontend util in a follow-up task.
function cycleSubtitle(month, year) {
  if (!month || !year) return ''
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const startMs = Date.UTC(prevYear, prevMonth - 1, 26)
  const endMs   = Date.UTC(year, month - 1, 25)
  const lengthDays = Math.round((endMs - startMs) / 86400000) + 1
  const startLabel = `${MONTHS[prevMonth]} 26, ${prevYear}`
  const endLabel   = `${MONTHS[month]} 25, ${year}`
  return `Cycle: ${startLabel} – ${endLabel} (${lengthDays} days)`
}

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
    // TODO 5c-iv: open EditModal
    console.log('TODO: edit', row)
  }

  const handleDetails = (row) => {
    // TODO 5c-iv: open DetailModal
    console.log('TODO: detail', row)
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
    </div>
  )
}
