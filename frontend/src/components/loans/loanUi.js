// Loans PR-4 — shared helpers for the loan screens.
// The server enforces every rule (backend/src/routes/loans.js). Everything
// here only decides what to SHOW: a button the server would refuse for this
// role is hidden; a button the role may use but the loan's state forbids is
// shown disabled with the reason.
import { normalizeRole } from '../../utils/role'

/** Mirrors backend/src/services/loans/policy.js VALID_COMPANIES (K7). Keep in step. */
export const LOAN_COMPANIES = ['Indriyan Beverages Pvt Ltd', 'Asian Lakto Ind Ltd']

export const DISBURSE_MODES = ['Bank transfer', 'Cheque', 'Cash']
export const RECEIPT_MODES = ['Cash', 'Bank transfer', 'Cheque', 'UPI']

export const LOAN_STATE = {
  requested: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-sky-100 text-sky-800' },
  active: { label: 'Active', cls: 'bg-green-100 text-green-800' },
  recover_at_exit: { label: 'Recover at exit', cls: 'bg-orange-100 text-orange-800' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-800' },
  settled_at_exit: { label: 'Settled at exit', cls: 'bg-indigo-100 text-indigo-800' },
  written_off: { label: 'Written off', cls: 'bg-slate-200 text-slate-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
}

export const INSTALMENT_STATE = {
  scheduled: { label: 'Scheduled', cls: 'bg-slate-100 text-slate-700' },
  provisional: { label: 'Provisional', cls: 'bg-amber-100 text-amber-800' },
  posted: { label: 'Posted', cls: 'bg-green-100 text-green-800' },
  paid_in_cash: { label: 'Paid in cash', cls: 'bg-teal-100 text-teal-800' },
  deferred: { label: 'Deferred', cls: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400 line-through' },
}

export const REQUEST_STATE = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-600' },
}

export const KIND_LABEL = { defer: 'Defer', restructure: 'Restructure', write_off: 'Write-off' }

export const ORIGIN_LABEL = {
  schedule: 'Schedule', shortfall: 'Shortfall', no_salary: 'No salary', held: 'Held',
  deferred: 'Deferred', restructure: 'Restructure', reversal: 'Reversal',
}

/** Loans PR-6: opposite entries for a posted deduction (loan_adjustments.kind). */
export const ADJUSTMENT_KIND = { reversal: 'Admin reversal', unborne: 'Pay could not bear it' }

const TRIGGER_LABEL = { manual: 'Manual', auto: 'Automatic', catch_up: 'Catch-up at start-up' }
export const triggerLabel = (t) => TRIGGER_LABEL[t] || t || '—'

/**
 * Loan close readiness codes (services/loans/close.js closeReadiness) in plain
 * English. `m` = the month label, `r` = the readiness object.
 */
export function closeReadinessText(r, m) {
  if (!r) return ''
  switch (r.code) {
    case 'NOT_NEEDED': return `Nothing to close for ${m}: no loan deduction or instalment falls in this month.`
    case 'STAGE7_NOT_COMPUTED': return `Plant salary (Stage 7) for ${m} is not computed yet. The close waits for it.`
    case 'EARLIER_MONTH_OPEN': return 'An earlier month is still open. Months close oldest first.'
    case 'MONTH_NOT_ENDED': return `${m} has not ended yet (IST). A month can be closed once it is over.`
    case 'ALREADY_CLOSED': return `${m} is already closed.`
    case 'SALES_CLOSE_NOT_WIRED': return 'The sales loan close arrives with Loans PR-8.'
    default: return r.message || r.code || ''
  }
}

/** A user limited to some companies (auth returns ['*'] for all companies). */
export function companyRestricted(user) {
  const ac = user?.allowedCompanies
  return Array.isArray(ac) && ac.length > 0 && !ac.includes('*')
}

export const LIVE_STATES = ['active', 'recover_at_exit']
export const CLOSED_STATES = ['completed', 'settled_at_exit', 'written_off']

export const stateLabel = (map, s) => (map[s] && map[s].label) || s || '—'
export const stateCls = (map, s) => (map[s] && map[s].cls) || 'bg-slate-100 text-slate-600'

/** Who may do what — mirrors READ/RAISE/DECIDE/PAY_ROLES in routes/loans.js. */
export function loanCaps(user) {
  const role = normalizeRole(user?.role)
  return {
    role,
    username: String(user?.username || '').trim(),
    canRead: ['admin', 'hr', 'finance', 'viewer'].includes(role),
    canRaise: ['hr', 'finance'].includes(role),          // admin: ADMIN_CANNOT_RAISE
    canDecide: role === 'admin',
    canPay: ['finance', 'admin'].includes(role),
    canClose: ['finance', 'admin'].includes(role),       // run the loan close early (SPEC §7)
    canReverse: role === 'admin',                        // reverse a posted deduction (SPEC §7)
  }
}

export const sameUser = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })
export const rupees = (v) => (v === null || v === undefined || v === '' ? '—' : INR0.format(Number(v) || 0))
/** The engine reports deduction history in paise. */
export const paiseToRupees = (p) => Math.round(Number(p || 0)) / 100

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (m, y) => (m && y ? `${MON[m]} ${y}` : '—')

/** 'YYYY-MM-DD HH:MM:SS' (UTC, SQLite datetime('now')) → IST display. */
export function istDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(`${String(ts).replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function todayIst() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10)
}

/** Server error → one readable line (with refusal list when present). */
export function errText(err, fallback = 'Request failed') {
  const d = err?.response?.data
  if (!d) return err?.message || fallback
  if (Array.isArray(d.refusals) && d.refusals.length) return d.refusals.map((r) => r.message).join('; ')
  return d.error || d.message || d.code || fallback
}

export const GATE_OFF_TEXT = 'Disbursement is switched off until payroll recovery (Loans PR-5/PR-6) is live. Loans can be raised, approved, rejected and cancelled, but no money can be recorded as paid out.'

/** Short summary of a change request payload. */
export function requestSummary(r, instalments = []) {
  const p = r.payload || {}
  if (r.kind === 'defer') {
    const ins = instalments.find((i) => i.id === p.instalmentId)
    return ins ? `Move instalment #${ins.sequence} (${monthLabel(ins.due_month, ins.due_year)}, ${rupees(ins.amount_due)}) to the end` : `Move instalment id ${p.instalmentId} to the end`
  }
  if (r.kind === 'restructure') {
    const parts = []
    if (p.newTenure) parts.push(`new tenure ${p.newTenure} months`)
    if (p.newEmi) parts.push(`new EMI ${rupees(p.newEmi)}`)
    if (p.topupAmount) parts.push(`top-up ${rupees(p.topupAmount)}`)
    return parts.join(', ') || 'restructure'
  }
  return `write off the balance${r.remaining_balance !== undefined ? ` (${rupees(r.remaining_balance)})` : ''}`
}
