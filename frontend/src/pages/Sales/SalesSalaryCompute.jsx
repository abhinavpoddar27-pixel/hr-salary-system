import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesCompute,
  salesSalaryRegister,
  salesSalaryUpdate,
  salesSalaryStatusUpdate,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import CompanyFilter from '../../components/shared/CompanyFilter'
import ConfirmDialog from '../../components/ui/ConfirmDialog'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_COLOURS = {
  computed:  'bg-slate-100 text-slate-700',
  reviewed:  'bg-blue-100 text-blue-700',
  finalized: 'bg-green-100 text-green-800',
  paid:      'bg-purple-100 text-purple-700',
  hold:      'bg-amber-100 text-amber-800',
}

const ALLOWED_MOVES = {
  computed:  ['reviewed', 'hold'],
  reviewed:  ['computed', 'finalized', 'hold'],
  finalized: ['paid', 'hold'],
  paid:      [],
  hold:      ['computed', 'reviewed'],
}

function StatusBadge({ s }) {
  return <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', STATUS_COLOURS[s] || 'bg-slate-100')}>{s || '—'}</span>
}

function fmtINR(n) {
  const v = Number(n || 0)
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v)
}

function EditRowCell({ value, onSave, disabled, suffix = '' }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? 0)

  const commit = () => {
    const n = parseFloat(v)
    if (!Number.isFinite(n) || n < 0) { toast.error('Must be a non-negative number'); return }
    onSave(n)
    setEditing(false)
  }

  if (disabled) {
    return <span className="text-slate-500">{fmtINR(value)}{suffix}</span>
  }
  if (editing) {
    return (
      <input
        type="number"
        value={v}
        autoFocus
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono text-right"
      />
    )
  }
  return (
    <button onClick={() => { setV(value ?? 0); setEditing(true) }}
      className="font-mono text-sm hover:bg-amber-50 rounded px-1 py-0.5">
      {fmtINR(value)}{suffix}
    </button>
  )
}

export default function SalesSalaryCompute() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { selectedCompany, selectedMonth, selectedYear } = useAppStore()

  const [confirmStatusChange, setConfirmStatusChange] = useState(null)
  const [confirmRecompute, setConfirmRecompute] = useState(false)

  const monthYearReady = !!selectedCompany && !!selectedMonth && !!selectedYear

  const { data: regRes, isLoading: regLoading } = useQuery({
    queryKey: ['sales-salary-register', selectedCompany, selectedMonth, selectedYear],
    queryFn: () => salesSalaryRegister({
      company: selectedCompany, month: selectedMonth, year: selectedYear,
    }),
    enabled: monthYearReady,
    retry: 0,
  })
  const rows = regRes?.data?.data?.rows || []
  const totals = regRes?.data?.data?.totals || {}
  const hasRows = rows.length > 0

  const computeMut = useMutation({
    mutationFn: () => salesCompute({ month: selectedMonth, year: selectedYear, company: selectedCompany }),
    onSuccess: (r) => {
      const d = r.data?.data || {}
      toast.success(`Computed ${d.computed} row(s)${d.errors?.length ? `; ${d.errors.length} errors` : ''}`)
      if (d.finalizedRecomputeWarnings?.length) {
        toast(`⚠ ${d.finalizedRecomputeWarnings.length} finalized row(s) drifted — check drift log`, { icon: '⚠', duration: 6000 })
      }
      qc.invalidateQueries({ queryKey: ['sales-salary-register'] })
      setConfirmRecompute(false)
    },
    onError: (err) => {
      const body = err?.response?.data
      toast.error(body?.error || 'Compute failed')
      setConfirmRecompute(false)
    },
  })

  const salaryMut = useMutation({
    mutationFn: ({ id, data }) => salesSalaryUpdate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-salary-register'] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Update failed'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, data }) => salesSalaryStatusUpdate(id, data),
    onSuccess: (r) => {
      toast.success(`Status → ${r.data?.data?.status}`)
      qc.invalidateQueries({ queryKey: ['sales-salary-register'] })
      setConfirmStatusChange(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Status change failed'),
  })

  const handleCompute = () => {
    const lockedRows = rows.filter(r => ['reviewed', 'finalized', 'paid'].includes(r.status))
    if (lockedRows.length > 0) {
      setConfirmRecompute(true)
    } else {
      computeMut.mutate()
    }
  }

  // ── Pre-compute mode ─────────────────────────────────
  if (monthYearReady && !regLoading && !hasRows) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Sales Salary Compute</h1>
            <p className="text-xs text-slate-500">
              {MONTHS[selectedMonth]} {selectedYear} · {selectedCompany}
            </p>
          </div>
          <CompanyFilter />
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-600 mb-3">
            No salary computation exists for {MONTHS[selectedMonth]} {selectedYear} · {selectedCompany}.
          </p>
          <p className="text-xs text-slate-500 mb-6">
            Compute will pull the latest confirmed upload for this period, match each row to its sales
            employee master, and run the 8-step salary computation per design §9. Idempotent —
            re-runnable without data loss.
          </p>
          <button
            onClick={() => computeMut.mutate()}
            disabled={computeMut.isPending}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium"
          >
            {computeMut.isPending ? 'Computing…' : 'Compute Salaries'}
          </button>
        </div>
      </div>
    )
  }

  // ── Post-compute mode (register) ─────────────────────
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Sales Salary Register</h1>
          <p className="text-xs text-slate-500">
            {MONTHS[selectedMonth]} {selectedYear} · {selectedCompany} · {rows.length} row(s)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompanyFilter />
          <button disabled title="Coming in Phase 4"
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-200 text-slate-400 cursor-not-allowed">
            Export Excel
          </button>
          <button disabled title="Coming in Phase 4"
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-200 text-slate-400 cursor-not-allowed">
            Export Bank NEFT
          </button>
          <button
            onClick={handleCompute}
            disabled={computeMut.isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white">
            {computeMut.isPending ? 'Recomputing…' : 'Recompute'}
          </button>
        </div>
      </div>

      {regLoading && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 text-sm text-slate-400">Loading…</div>
      )}

      {!regLoading && hasRows && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-[1400px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">HQ</th>
                <th className="px-2 py-2 text-right">Days</th>
                <th className="px-2 py-2 text-right">Sundays</th>
                <th className="px-2 py-2 text-right">Hols</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Ratio</th>
                <th className="px-2 py-2 text-right">Gross ₹</th>
                <th className="px-2 py-2 text-right">PF</th>
                <th className="px-2 py-2 text-right">ESI</th>
                <th className="px-2 py-2 text-right">TDS</th>
                <th className="px-2 py-2 text-right bg-amber-50">Incentive</th>
                <th className="px-2 py-2 text-right bg-amber-50">Diwali Bonus</th>
                <th className="px-2 py-2 text-right bg-amber-50">Other Ded</th>
                <th className="px-2 py-2 text-right">Net ₹</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const locked = ['finalized', 'paid'].includes(r.status)
                const allowedNext = ALLOWED_MOVES[r.status] || []
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1.5 font-mono text-xs">{r.employee_code}</td>
                    <td className="px-2 py-1.5 font-medium">{r.name || '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-500">{r.headquarters || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.days_given}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.sundays_paid}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.gazetted_holidays_paid}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.total_days}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">{(r.earned_ratio || 0).toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtINR(r.gross_earned)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtINR(r.pf_employee)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtINR(r.esi_employee)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtINR(r.tds)}</td>
                    <td className="px-2 py-1.5 text-right bg-amber-50">
                      <EditRowCell
                        value={r.incentive_amount}
                        disabled={locked}
                        onSave={(n) => salaryMut.mutate({ id: r.id, data: { incentive_amount: n } })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right bg-amber-50">
                      <EditRowCell
                        value={r.diwali_bonus}
                        disabled={locked}
                        onSave={(n) => salaryMut.mutate({ id: r.id, data: { diwali_bonus: n } })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right bg-amber-50">
                      <EditRowCell
                        value={r.other_deductions}
                        disabled={locked}
                        onSave={(n) => salaryMut.mutate({ id: r.id, data: { other_deductions: n } })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmtINR(r.net_salary)}</td>
                    <td className="px-2 py-1.5"><StatusBadge s={r.status} /></td>
                    <td className="px-2 py-1.5 text-xs">
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => navigate(`/sales/payslip/${encodeURIComponent(r.employee_code)}?month=${selectedMonth}&year=${selectedYear}&company=${encodeURIComponent(selectedCompany)}`)}
                          className="text-blue-600 hover:text-blue-800 text-left">
                          Payslip
                        </button>
                        {allowedNext.length > 0 && (
                          <select
                            value=""
                            onChange={e => {
                              if (!e.target.value) return
                              setConfirmStatusChange({ id: r.id, from: r.status, to: e.target.value, code: r.employee_code })
                            }}
                            className="border border-slate-200 rounded px-1 py-0.5 text-xs"
                          >
                            <option value="">Change status…</option>
                            {allowedNext.map(s => <option key={s} value={s}>→ {s}</option>)}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-100 font-semibold">
              <tr>
                <td colSpan={8} className="px-2 py-2 text-right">Totals:</td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(totals.gross_earned)}</td>
                <td colSpan={3}></td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(totals.incentive_amount)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(totals.diwali_bonus)}</td>
                <td></td>
                <td className="px-2 py-2 text-right font-mono text-green-700">{fmtINR(totals.net_salary)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!regLoading && !monthYearReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Please select a company, month, and year to view or compute the sales salary register.
        </div>
      )}

      {confirmStatusChange && (
        <ConfirmDialog
          title={`Change status ${confirmStatusChange.from} → ${confirmStatusChange.to}?`}
          message={`Employee ${confirmStatusChange.code}: ${confirmStatusChange.from} → ${confirmStatusChange.to}. Once ${confirmStatusChange.to === 'finalized' ? 'finalized, the row is locked from editing until un-finalized via hold' : 'changed, status transitions must follow the allowed-move table'}.`}
          confirmText={`Move to ${confirmStatusChange.to}`}
          cancelText="Cancel"
          onCancel={() => setConfirmStatusChange(null)}
          onConfirm={() => statusMut.mutate({
            id: confirmStatusChange.id,
            data: { status: confirmStatusChange.to },
          })}
        />
      )}

      {confirmRecompute && (
        <ConfirmDialog
          title="Recompute will touch reviewed/finalized rows"
          message="Some rows are reviewed, finalized, or paid. Recompute re-runs base math (gross, PF, ESI, TDS) but preserves HR-entered fields (incentive, diwali bonus, other deductions, status). If any finalized row's net_salary drifts by more than ₹1, you'll see a warning in the response. Continue?"
          confirmText="Recompute"
          cancelText="Cancel"
          variant="warning"
          onCancel={() => setConfirmRecompute(false)}
          onConfirm={() => computeMut.mutate()}
        />
      )}
    </div>
  )
}
