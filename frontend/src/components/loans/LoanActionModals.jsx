// Loans PR-4 — action modals. Each sends exactly the fields routes/loans.js reads.
import React, { useState } from 'react'
import Modal from '../ui/Modal'
import { MONTH_OPTIONS } from '../../utils/formatters'
import { DISBURSE_MODES, RECEIPT_MODES, rupees, monthLabel, todayIst } from './loanUi'

const agreementOk = (s) => { const t = String(s || '').trim(); return t.length >= 3 && t.length <= 200 }

/** Approve / reject / cancel / decide — a reason box, required or optional. */
export function ReasonModal({ title, message, label = 'Reason', required = true, confirmText = 'Confirm', danger = false, busy, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const ok = !required || reason.trim().length > 0
  return (
    <Modal title={title} onClose={onClose} size="md">
      <div className="space-y-3" data-testid="reason-modal">
        {message && <div className="text-sm text-slate-600">{message}</div>}
        <div>
          <label className="label">{label}{required ? ' (required)' : ' (optional)'}</label>
          <textarea className="input min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Back</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={!ok || busy} onClick={() => onSubmit(reason.trim())} data-testid="reason-confirm">
            {busy ? 'Saving…' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function PayoutFields({ v, set, modes, amountReadOnly }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Mode</label>
          <select className="select" value={v.mode} onChange={(e) => set('mode', e.target.value)} data-testid="payout-mode">
            <option value="">— choose —</option>
            {modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Reference (UTR / cheque no. / voucher)</label>
          <input className="input" value={v.reference} onChange={(e) => set('reference', e.target.value)} data-testid="payout-reference" />
        </div>
        <div>
          <label className="label">Date paid</label>
          <input className="input" type="date" max={todayIst()} value={v.date} onChange={(e) => set('date', e.target.value)} data-testid="payout-date" />
        </div>
        {amountReadOnly !== undefined && (
          <div>
            <label className="label">Amount</label>
            <input className="input bg-slate-50" readOnly value={rupees(amountReadOnly)} />
          </div>
        )}
      </div>
      <div>
        <label className="label">Signed agreement reference (DMS no. or physical file no.)</label>
        <input className="input" value={v.agreementRef} onChange={(e) => set('agreementRef', e.target.value)}
          placeholder="3–200 characters" data-testid="payout-agreement" />
        {v.agreementRef && !agreementOk(v.agreementRef) && <div className="text-[11px] text-red-600 mt-1">3–200 characters</div>}
      </div>
    </>
  )
}

/** Finance / admin record the payout of an approved loan. */
export function DisburseModal({ loan, busy, onSubmit, onClose }) {
  const [v, setV] = useState({ mode: '', reference: '', date: todayIst(), agreementRef: '', firstMonth: '', firstYear: '' })
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))
  const ok = v.mode && v.reference.trim() && v.date && v.date <= todayIst() && agreementOk(v.agreementRef)
    && (!v.firstMonth === !v.firstYear)
  const thisYear = new Date().getFullYear()
  return (
    <Modal title={`Record disbursement — loan #${loan.id}`} onClose={onClose} size="lg">
      <div className="space-y-3" data-testid="disburse-modal">
        <div className="text-sm text-slate-600">
          {loan.employee_name || loan.employee_code} · {loan.loan_type} · {rupees(loan.principal_amount)} over {loan.tenure_months} months.
          The schedule is written now; the money must equal the principal.
        </div>
        <PayoutFields v={v} set={set} modes={DISBURSE_MODES} amountReadOnly={loan.principal_amount} />
        <div>
          <label className="label">First EMI month (optional — blank = the month after disbursement)</label>
          <div className="flex gap-2">
            <select className="select" value={v.firstMonth} onChange={(e) => set('firstMonth', e.target.value)}>
              <option value="">Automatic</option>
              {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select className="select" value={v.firstYear} onChange={(e) => set('firstYear', e.target.value)}>
              <option value="">—</option>
              {[thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Later only, never earlier than the automatic month.</div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Back</button>
          <button className="btn-primary" disabled={!ok || busy} data-testid="disburse-confirm"
            onClick={() => onSubmit({
              mode: v.mode, reference: v.reference.trim(), disbursedOn: v.date, amount: loan.principal_amount,
              agreementRef: v.agreementRef.trim(),
              ...(v.firstMonth && v.firstYear ? { firstEmiMonth: { month: Number(v.firstMonth), year: Number(v.firstYear) } } : {}),
            })}>
            {busy ? 'Saving…' : 'Record disbursement'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Admin approves a restructure that carries a top-up: the top-up is a payout. */
export function TopupApproveModal({ request, busy, onSubmit, onClose }) {
  const [v, setV] = useState({ mode: '', reference: '', date: todayIst(), agreementRef: '', reason: '' })
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))
  const ok = v.mode && v.reference.trim() && v.date && agreementOk(v.agreementRef)
  return (
    <Modal title={`Approve restructure #${request.id} with top-up`} onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="text-sm text-slate-600">Top-up {rupees(request.payload?.topupAmount)} is paid out on approval. Give the payout details and a fresh signed agreement.</div>
        <PayoutFields v={v} set={set} modes={DISBURSE_MODES} />
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={v.reason} onChange={(e) => set('reason', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Back</button>
          <button className="btn-primary" disabled={!ok || busy}
            onClick={() => onSubmit({ mode: v.mode, reference: v.reference.trim(), disbursedOn: v.date, agreementRef: v.agreementRef.trim(), reason: v.reason.trim() || undefined })}>
            {busy ? 'Saving…' : 'Approve and record top-up'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Finance / admin record a numbered cash receipt. */
export function ReceiptModal({ loan, busy, onSubmit, onClose }) {
  const [v, setV] = useState({ amount: '', mode: '', reference: '', date: todayIst(), remarks: '' })
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))
  const amt = Number(v.amount)
  const over = amt > Number(loan.remaining_balance || 0)
  const ok = amt > 0 && !over && v.mode && v.date && v.date <= todayIst()
  return (
    <Modal title={`Record a receipt — loan #${loan.id}`} onClose={onClose} size="md">
      <div className="space-y-3" data-testid="receipt-modal">
        <div className="text-sm text-slate-600">Balance {rupees(loan.remaining_balance)}. A receipt removes instalments from the end of the schedule and gets a number (LR/FY/serial).</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (₹)</label>
            <input className="input" type="number" min="1" step="0.01" value={v.amount} onChange={(e) => set('amount', e.target.value)} data-testid="receipt-amount" />
            {over && <div className="text-[11px] text-red-600 mt-1">Above the balance</div>}
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="select" value={v.mode} onChange={(e) => set('mode', e.target.value)} data-testid="receipt-mode">
              <option value="">— choose —</option>
              {RECEIPT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reference (optional)</label>
            <input className="input" value={v.reference} onChange={(e) => set('reference', e.target.value)} />
          </div>
          <div>
            <label className="label">Date received</label>
            <input className="input" type="date" max={todayIst()} value={v.date} onChange={(e) => set('date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Remarks (optional)</label>
          <input className="input" value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Back</button>
          <button className="btn-primary" disabled={!ok || busy} data-testid="receipt-confirm"
            onClick={() => onSubmit({ amount: amt, mode: v.mode, reference: v.reference.trim() || undefined, receiptDate: v.date, remarks: v.remarks.trim() || undefined })}>
            {busy ? 'Saving…' : 'Record receipt'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** HR / finance raise a defer, restructure or write-off; the admin decides. */
export function ChangeRequestModal({ loan, instalments, busy, onSubmit, onClose }) {
  const [kind, setKind] = useState('defer')
  const [instalmentId, setInstalmentId] = useState('')
  const [by, setBy] = useState('tenure')
  const [newTenure, setNewTenure] = useState('')
  const [newEmi, setNewEmi] = useState('')
  const [topup, setTopup] = useState('')
  const [reason, setReason] = useState('')
  const scheduled = (instalments || []).filter((i) => i.status === 'scheduled')
  let ok = reason.trim().length > 0
  if (kind === 'defer') ok = ok && !!instalmentId
  if (kind === 'restructure') ok = ok && (by === 'tenure' ? Number(newTenure) >= 1 : Number(newEmi) > 0)
  const submit = () => {
    const body = { kind, reason: reason.trim() }
    if (kind === 'defer') body.instalmentId = Number(instalmentId)
    if (kind === 'restructure') {
      if (by === 'tenure') body.newTenure = Number(newTenure); else body.newEmi = Number(newEmi)
      if (Number(topup) > 0) body.topupAmount = Number(topup)
    }
    onSubmit(body)
  }
  return (
    <Modal title={`Request a change — loan #${loan.id}`} onClose={onClose} size="lg">
      <div className="space-y-3" data-testid="change-modal">
        <div className="flex gap-1">
          {[['defer', 'Defer an EMI'], ['restructure', 'Restructure'], ['write_off', 'Write off']].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} data-testid={`change-kind-${k}`}
              className={`px-3 py-1.5 rounded-lg text-sm ${kind === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {kind === 'defer' && (
          <div>
            <label className="label">Instalment to move to the end of the schedule</label>
            <select className="select" value={instalmentId} onChange={(e) => setInstalmentId(e.target.value)} data-testid="change-instalment">
              <option value="">— choose a scheduled instalment —</option>
              {scheduled.map((i) => <option key={i.id} value={i.id}>#{i.sequence} · {monthLabel(i.due_month, i.due_year)} · {rupees(i.amount_due)}</option>)}
            </select>
          </div>
        )}
        {kind === 'restructure' && (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Changes only unposted instalments. Give exactly one of a new tenure or a new EMI.</div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="radio" checked={by === 'tenure'} onChange={() => setBy('tenure')} /> New tenure</label>
              <label className="flex items-center gap-1"><input type="radio" checked={by === 'emi'} onChange={() => setBy('emi')} /> New EMI</label>
            </div>
            {by === 'tenure'
              ? <input className="input" type="number" min="1" placeholder="Months for the remaining balance" value={newTenure} onChange={(e) => setNewTenure(e.target.value)} data-testid="change-tenure" />
              : <input className="input" type="number" min="1" placeholder="New monthly EMI (₹)" value={newEmi} onChange={(e) => setNewEmi(e.target.value)} />}
            <div>
              <label className="label">Top-up (optional, ₹) — paid out when the admin approves</label>
              <input className="input" type="number" min="0" value={topup} onChange={(e) => setTopup(e.target.value)} />
            </div>
          </div>
        )}
        {kind === 'write_off' && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Writes off the remaining balance of {rupees(loan.remaining_balance)}. A write-off is reported for TDS.
          </div>
        )}
        <div>
          <label className="label">Reason (required)</label>
          <textarea className="input min-h-[60px]" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="change-reason" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Back</button>
          <button className="btn-primary" disabled={!ok || busy} onClick={submit} data-testid="change-submit">
            {busy ? 'Checking…' : 'Send to the admin'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
