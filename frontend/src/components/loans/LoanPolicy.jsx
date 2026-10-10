// Loans PR-4 — loan settings (SPEC §4, §7 screen 7). Admin edits; everyone
// else reads. The disbursement switch is never editable here (ruling A).
import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getLoanPolicy, updateLoanPolicy } from '../../utils/api'
import { errText } from './loanUi'

const META = {
  loan_close_day: ['Loan close day of next month', 'day (1–28), after payroll is computed', 'D-10'],
  loan_deduction_cap_pct: ['Deduction cap, % of earned base pay', '%', 'D-11 · pending consultant'],
  loan_max_multiple_gross: ['Maximum loan, multiple of monthly gross', '×', 'D-4'],
  loan_max_multiple_gross_emergency: ['Maximum loan for Emergency / medical, multiple of gross', '×', 'D-24'],
  loan_max_tenure_months: ['Maximum tenure', 'months', 'D-4'],
  loan_min_service_months: ['Minimum service', 'months', 'D-4'],
  loan_max_active_per_person: ['Open loans per person', 'loans', 'D-4'],
  loan_emi_ceiling_pct_gross: ['EMI ceiling, % of monthly gross', '%', 'D-4'],
  loan_deduction_load_warning_pct: ['Deduction-load warning, % of earned pay (3-month average)', '%', 'D-13'],
  loan_held_emi_wait_days: ['Days a held month\'s EMI waits after close', 'days', 'D-14'],
  loan_max_shortfall_extension_months: ['Maximum extension from shortfalls', 'months', 'D-19'],
  loan_eligible_employment_types: ['Eligible employment types', 'comma-separated', 'D-17'],
  loan_types: ['Loan types', 'comma-separated', 'D-23'],
  loan_agreement_required: ['Signed agreement before disbursement', 'true / false', 'D-25'],
  loan_interest_rate: ['Interest rate', '0 only (interest-free, D-2)', 'D-2'],
  loan_perquisite_threshold: ['Perquisite reporting threshold (₹)', '₹', 'pending CA'],
  loan_emi_net_flag_pct: ['Finance red flag: loan EMI above this % of net salary (plant)', '%', 'PR-9'],
}
const LIST_KEYS = ['loan_eligible_employment_types', 'loan_types']
const READ_ONLY_KEYS = ['loan_interest_rate']

function display(key, raw) {
  if (raw === undefined || raw === null) return ''
  if (LIST_KEYS.includes(key)) {
    try { const a = JSON.parse(raw); if (Array.isArray(a)) return a.join(', ') } catch { /* show raw */ }
  }
  return String(raw)
}

export default function LoanPolicy({ caps }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['loan-policy'], queryFn: getLoanPolicy, retry: 0 })
  const p = data?.data?.data
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [reason, setReason] = useState('')

  const keys = p?.editableKeys || []
  const changed = useMemo(() => keys.filter((k) => draft[k] !== undefined && draft[k].trim() !== display(k, p?.raw?.[k])), [draft, keys, p])

  const save = useMutation({
    mutationFn: () => {
      const values = {}
      for (const k of changed) {
        values[k] = LIST_KEYS.includes(k) ? draft[k].split(',').map((s) => s.trim()).filter(Boolean) : draft[k].trim()
      }
      return updateLoanPolicy(values, reason.trim())
    },
    onSuccess: (res) => {
      const n = res?.data?.data?.changed?.length || 0
      toast.success(`${n} setting${n === 1 ? '' : 's'} changed`)
      setEditing(false); setDraft({}); setReason('')
      qc.invalidateQueries({ queryKey: ['loan-policy'] })
      qc.invalidateQueries({ queryKey: ['loan-types'] })
    },
    onError: (err) => toast.error(errText(err, 'Could not save the settings')),
  })

  if (isLoading || !p) return <div className="text-slate-400 text-sm py-8 text-center">Loading settings…</div>

  return (
    <div className="space-y-3" data-testid="loan-policy">
      <div className={`rounded-xl border p-3 text-sm ${p.disbursementEnabled ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
        data-testid="gate-readonly">
        <strong>Disbursement: {p.disbursementEnabled ? 'ON' : 'OFF'}</strong> (<span className="font-mono">loans_disbursement_enabled</span>) —
        switched on once, at cutover after Loans PR-6, through the SQL Console write flow. It is not editable on this screen.
      </div>
      {p.warnings?.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {p.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-sm text-slate-700">Loan policy (policy_config)</div>
          {caps.canDecide && !editing && <button className="btn-secondary btn-sm" onClick={() => setEditing(true)} data-testid="policy-edit">Edit</button>}
          {!caps.canDecide && <span className="text-xs text-slate-400">Only the admin changes loan policy</span>}
        </div>
        <table className="table-compact w-full">
          <thead><tr><th>Setting</th><th>Value</th><th>Unit / rule</th><th>Source</th></tr></thead>
          <tbody>
            {keys.map((k) => {
              const [label, unit, src] = META[k] || [k, '', '']
              const ro = READ_ONLY_KEYS.includes(k)
              return (
                <tr key={k}>
                  <td className="text-sm">{label}<div className="text-[10px] font-mono text-slate-400">{k}</div></td>
                  <td>
                    {editing && !ro ? (
                      <input className="input text-sm py-1" data-testid={`policy-input-${k}`}
                        value={draft[k] !== undefined ? draft[k] : display(k, p.raw?.[k])}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                    ) : <span className="font-mono text-sm">{display(k, p.raw?.[k]) || '—'}</span>}
                  </td>
                  <td className="text-xs text-slate-500">{unit}</td>
                  <td className="text-xs text-slate-500">{src}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {editing && (
          <div className="p-4 border-t border-slate-100 space-y-2">
            <label className="label">Reason for the change (required; written to the audit log)</label>
            <input className="input max-w-xl" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="policy-reason" />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => { setEditing(false); setDraft({}); setReason('') }}>Cancel</button>
              <button className="btn-primary" disabled={!changed.length || !reason.trim() || save.isPending} onClick={() => save.mutate()} data-testid="policy-save">
                {save.isPending ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
