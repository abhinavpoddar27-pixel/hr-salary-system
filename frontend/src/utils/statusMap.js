/**
 * statusMap — one vocabulary for workflow states (P2-04).
 *
 * STATUS_MAP[domain][status] = { label, tone }. <StatusBadge domain status /> renders it.
 * Unknown status → label = the raw status (or '—'), tone gray, so nothing ever renders blank.
 *
 * Only the Extra Duty page uses this map today (P2-ED). The other domains are a MAP ONLY:
 * their labels are copied from the screen that shows them now (source noted per domain), so a
 * later adopter changes no wording. ED labels are the raw upper-case words the ED page has
 * always shown (planner ruling Q1, 11 Oct 2026) — do not "prettify" them without a ruling.
 */

export const TONE_CLASSES = {
  gray: 'bg-slate-100 text-slate-600',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-700',
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  sky: 'bg-sky-100 text-sky-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  purple: 'bg-purple-100 text-purple-800',
  teal: 'bg-teal-100 text-teal-800',
  muted: 'bg-slate-100 text-slate-400 line-through',
}

export const STATUS_MAP = {
  // pages/ExtraDutyGrants.jsx — extra_duty_grants.status
  ed_hr: {
    PENDING: { label: 'PENDING', tone: 'amber' },
    APPROVED: { label: 'APPROVED', tone: 'green' },
    REJECTED: { label: 'REJECTED', tone: 'red' },
  },
  // pages/ExtraDutyGrants.jsx — extra_duty_grants.finance_status (label drops "FINANCE_")
  ed_finance: {
    UNREVIEWED: { label: 'UNREVIEWED', tone: 'gray' },
    FINANCE_APPROVED: { label: 'APPROVED', tone: 'green' },
    FINANCE_FLAGGED: { label: 'FLAGGED', tone: 'amber' },
    FINANCE_REJECTED: { label: 'REJECTED', tone: 'red' },
  },
  // pages/MissPunch.jsx — attendance_processed.miss_punch_finance_status (status chips)
  miss_punch: {
    hr_pending: { label: 'HR Pending', tone: 'amber' },
    pending: { label: 'Finance Pending', tone: 'blue' },
    approved: { label: 'Approved', tone: 'green' },
    rejected: { label: 'Rejected', tone: 'red' },
  },
  // pages/LeaveManagement.jsx STATUS_COLORS — leave_applications.status
  leave: {
    Pending: { label: 'Pending', tone: 'amber' },
    'Pending Finance': { label: 'Pending Finance', tone: 'orange' },
    Approved: { label: 'Approved', tone: 'green' },
    Rejected: { label: 'Rejected', tone: 'red' },
  },
  // pages/SalaryInput.jsx — salary_change_requests.status
  salary_change: {
    Pending: { label: 'Pending', tone: 'amber' },
    Approved: { label: 'Approved', tone: 'green' },
    Rejected: { label: 'Rejected', tone: 'red' },
  },
  // components/loans/loanUi.js LOAN_STATE — loans.status
  loan: {
    requested: { label: 'Requested', tone: 'amber' },
    approved: { label: 'Approved', tone: 'sky' },
    active: { label: 'Active', tone: 'green' },
    recover_at_exit: { label: 'Recover at exit', tone: 'orange' },
    completed: { label: 'Completed', tone: 'blue' },
    settled_at_exit: { label: 'Settled at exit', tone: 'indigo' },
    written_off: { label: 'Written off', tone: 'gray' },
    rejected: { label: 'Rejected', tone: 'red' },
  },
  // components/loans/loanUi.js INSTALMENT_STATE — loan_instalments.status
  loan_instalment: {
    scheduled: { label: 'Scheduled', tone: 'gray' },
    provisional: { label: 'Provisional', tone: 'amber' },
    posted: { label: 'Posted', tone: 'green' },
    paid_in_cash: { label: 'Paid in cash', tone: 'teal' },
    deferred: { label: 'Deferred', tone: 'purple' },
    cancelled: { label: 'Cancelled', tone: 'muted' },
  },
  // pages/DailyWageRecords.jsx STATUS_LABELS — dw_entries.status
  dw: {
    hr_entered: { label: 'Draft', tone: 'gray' },
    pending_finance: { label: 'Pending Finance', tone: 'amber' },
    needs_correction: { label: 'Needs Correction', tone: 'red' },
    approved: { label: 'Approved', tone: 'green' },
    flagged: { label: 'Flagged', tone: 'orange' },
    paid: { label: 'Paid', tone: 'blue' },
    rejected: { label: 'Rejected', tone: 'red' },
  },
  // Bulk engine (P3-01, not built yet) — proposed batch states; adjust with P3-01's plan.
  bulk_batch: {
    draft: { label: 'Draft', tone: 'gray' },
    previewed: { label: 'Previewed', tone: 'blue' },
    pending_approval: { label: 'Pending approval', tone: 'amber' },
    applied: { label: 'Applied', tone: 'green' },
    partially_applied: { label: 'Partly applied', tone: 'orange' },
    failed: { label: 'Failed', tone: 'red' },
    undone: { label: 'Undone', tone: 'muted' },
  },
}

/** { label, tone, className } for a status; never throws, never blank. */
export function statusInfo(domain, status) {
  const hit = STATUS_MAP[domain]?.[status]
  const label = hit?.label ?? (status === null || status === undefined || status === '' ? '—' : String(status))
  const tone = hit?.tone ?? 'gray'
  return { label, tone, className: TONE_CLASSES[tone] || TONE_CLASSES.gray }
}
