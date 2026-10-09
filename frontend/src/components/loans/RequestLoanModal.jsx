// Loans PR-4 — request form (HR / finance). SPEC §7 screen 2.
// The eligibility panel and the schedule preview come from the engine
// (POST /api/loans/eligibility), never from a client-side formula.
import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../ui/Modal'
import { getEmployees, getLoanTypes, checkLoanEligibility, createLoan } from '../../utils/api'
import { LOAN_COMPANIES, rupees, errText } from './loanUi'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function RequestLoanModal({ onClose, onCreated }) {
  const [search, setSearch] = useState('')
  const [emp, setEmp] = useState(null)
  const [form, setForm] = useState({ company: '', loanType: '', principal: '', tenure: '', reason: '', remarks: '' })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const q = useDebounced(search.trim(), 300)

  const { data: empRes, isFetching: searching } = useQuery({
    queryKey: ['loan-emp-search', q],
    queryFn: () => getEmployees({ search: q, status: 'Active', page: 1, limit: 15 }),
    enabled: !emp && q.length >= 2,
    retry: 0,
  })
  const results = empRes?.data?.data || []

  const { data: typesRes } = useQuery({ queryKey: ['loan-types'], queryFn: getLoanTypes, retry: 0 })
  const loanTypes = typesRes?.data?.data || []
  useEffect(() => {
    if (!form.loanType && loanTypes.length) set('loanType', loanTypes[0])
  }, [loanTypes]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickEmployee = (e) => {
    setEmp(e)
    setSearch('')
    const c = String(e.company || '').trim()
    set('company', LOAN_COMPANIES.includes(c) ? c : '')
  }

  // ── live eligibility ────────────────────────────────────────────────────
  const eligInput = useMemo(() => ({
    borrowerType: 'plant',
    employeeCode: emp?.code || '',
    company: form.company,
    loanType: form.loanType,
    principal: form.principal === '' ? undefined : Number(form.principal),
    tenure: form.tenure === '' ? undefined : Number(form.tenure),
  }), [emp, form.company, form.loanType, form.principal, form.tenure])
  const eligKey = JSON.stringify(eligInput)
  const debouncedKey = useDebounced(eligKey, 400)
  const ready = !!emp && !!form.loanType && form.principal !== '' && form.tenure !== ''

  const { data: eligRes, isFetching: checking, error: eligErr } = useQuery({
    queryKey: ['loan-eligibility', debouncedKey],
    queryFn: () => checkLoanEligibility(JSON.parse(debouncedKey)),
    enabled: ready,
    retry: 0,
  })
  const verdict = ready && debouncedKey === eligKey ? eligRes?.data?.data : null
  const [serverRefusal, setServerRefusal] = useState(null)
  useEffect(() => { setServerRefusal(null) }, [eligKey])

  const create = useMutation({
    mutationFn: () => createLoan({ ...eligInput, reason: form.reason.trim(), remarks: form.remarks.trim() || undefined }),
    onSuccess: (res) => {
      const d = res?.data?.data || {}
      toast.success(`Loan #${d.loanId} raised — waiting for the admin${d.urgent ? ' (urgent)' : ''}`)
      onCreated?.(d.loanId)
    },
    onError: (err) => {
      const d = err?.response?.data
      if (d?.refusals) setServerRefusal(d)
      toast.error(errText(err, 'Could not raise the loan'))
    },
  })

  const schedTotal = verdict?.schedulePreview?.reduce((s, i) => s + Number(i.amount || 0), 0) || 0
  const canSubmit = ready && verdict?.eligible && !checking && form.reason.trim().length > 0 && !!form.company && !create.isPending

  return (
    <Modal title="Request a loan" onClose={onClose} size="xl">
      <div className="space-y-4" data-testid="request-loan-form">
        <div className="text-xs text-slate-500">
          Plant employees only. Loans for sales staff arrive with Loans PR-8. The admin approves every loan;
          finance records the payout once a signed agreement is on file.
        </div>

        {/* Employee */}
        <div>
          <label className="label">Employee (plant)</label>
          {emp ? (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-sm">
                <span className="font-semibold">{emp.name}</span>{' '}
                <span className="font-mono text-slate-500">{emp.code}</span>
                <span className="text-slate-500"> · {emp.department || '—'} · {emp.employment_type || 'type not set'} · master company: {emp.company || '—'}</span>
              </div>
              <button className="btn-ghost text-xs" onClick={() => { setEmp(null); set('company', '') }}>Change</button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" placeholder="Type a code or name (2+ characters)" value={search}
                onChange={(e) => setSearch(e.target.value)} autoFocus data-testid="loan-emp-search" />
              {q.length >= 2 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {searching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
                  {!searching && results.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No active plant employee matches</div>}
                  {results.map((e) => (
                    <button key={e.code} type="button" onClick={() => pickEmployee(e)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-50">
                      <span className="font-medium">{e.name}</span> <span className="font-mono text-xs text-slate-500">{e.code}</span>
                      <span className="text-xs text-slate-400"> · {e.department || '—'} · {e.employment_type || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Loan company</label>
            <select className="select" value={form.company} onChange={(e) => set('company', e.target.value)} data-testid="loan-company">
              <option value="">— pick the company that lends —</option>
              {LOAN_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="text-[11px] text-slate-400 mt-1">Picked explicitly; the employee master company is often blank.</div>
          </div>
          <div>
            <label className="label">Loan type</label>
            <select className="select" value={form.loanType} onChange={(e) => set('loanType', e.target.value)} data-testid="loan-type">
              {loanTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Principal (₹)</label>
            <input className="input" type="number" min="1" step="1" value={form.principal}
              onChange={(e) => set('principal', e.target.value)} placeholder="e.g. 20000" data-testid="loan-principal" />
          </div>
          <div>
            <label className="label">Tenure (months)</label>
            <input className="input" type="number" min="1" step="1" value={form.tenure}
              onChange={(e) => set('tenure', e.target.value)} placeholder="e.g. 6" data-testid="loan-tenure" />
          </div>
        </div>

        {/* Eligibility panel */}
        <div className={clsx('rounded-xl border p-3 text-sm', !ready ? 'bg-slate-50 border-slate-200'
          : verdict?.eligible ? 'bg-green-50 border-green-200' : verdict ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}
          data-testid="eligibility-panel">
          {!ready && <div className="text-slate-500">Pick an employee, type, amount and tenure to check eligibility.</div>}
          {ready && (checking || !verdict) && !eligErr && <div className="text-slate-500">Checking eligibility…</div>}
          {ready && eligErr && <div className="text-red-700">{errText(eligErr, 'Eligibility check failed')}</div>}
          {verdict && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={clsx('font-semibold', verdict.eligible ? 'text-green-700' : 'text-red-700')}>
                  {verdict.eligible ? '✓ Eligible' : '✗ Not eligible'}
                </span>
                {verdict.urgent && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-600 text-white">URGENT</span>}
                {verdict.emi !== null && <span className="text-slate-600">EMI <strong>{rupees(verdict.emi)}</strong>/month</span>}
              </div>
              {verdict.limits && (
                <div className="text-xs text-slate-600 flex gap-4 flex-wrap">
                  <span>Max amount: <strong>{rupees(verdict.limits.maxAmount)}</strong> ({verdict.limits.amountMultiple}× gross)</span>
                  <span>Max tenure: <strong>{verdict.limits.maxTenure} months</strong></span>
                  <span>Max EMI: <strong>{rupees(verdict.limits.maxEmi)}</strong></span>
                </div>
              )}
              {verdict.refusals?.length > 0 && (
                <ul className="list-disc ml-5 text-red-700 text-xs space-y-0.5">
                  {verdict.refusals.map((r) => <li key={r.code}><span className="font-mono">{r.code}</span> — {r.message}</li>)}
                </ul>
              )}
              {verdict.warnings?.length > 0 && (
                <ul className="list-disc ml-5 text-amber-700 text-xs space-y-0.5">
                  {verdict.warnings.map((w) => <li key={w.code}><span className="font-mono">{w.code}</span> — {w.message}</li>)}
                </ul>
              )}
              {verdict.schedulePreview?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Schedule preview (from the engine)</div>
                  <div className="flex flex-wrap gap-1">
                    {verdict.schedulePreview.map((i) => (
                      <span key={i.sequence} className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">
                        #{i.sequence} {rupees(i.amount)}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Total {rupees(schedTotal)}. The first EMI falls in the month after disbursement (finance may push it later, never earlier).
                  </div>
                </div>
              )}
            </div>
          )}
          {serverRefusal && (
            <div className="mt-2 text-xs text-red-700">Server refused: {serverRefusal.error}</div>
          )}
        </div>

        <div>
          <label className="label">Reason for the loan (required)</label>
          <textarea className="input min-h-[60px]" value={form.reason} onChange={(e) => set('reason', e.target.value)}
            placeholder="Why the employee needs it" data-testid="loan-reason" />
        </div>
        <div>
          <label className="label">Remarks (optional)</label>
          <input className="input" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSubmit} onClick={() => create.mutate()} data-testid="loan-submit"
            title={!canSubmit ? 'Needs an eligible result, a company and a reason' : ''}>
            {create.isPending ? 'Raising…' : 'Raise loan request'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
