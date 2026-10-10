/**
 * Loans engine — state machine and maker-checker (Loans PR-2,
 * docs/loans/SPEC.md §5.4, §5.5, §7, D-3).
 *
 * The tables below are the ONLY moves the engine performs. Who may do what:
 * HR raises, the admin decides, finance pays out and records receipts, and
 * nobody approves their own request. There is no backup approver.
 *
 * Roles arrive already normalised by the caller (PR-3 passes
 * normalizeRole(req.user.role)); this module only trims and lower-cases. It
 * deliberately does not require routes/auth.js, which loads middleware/auth.js
 * and throws at require time without JWT_SECRET.
 */

const LOAN_STATES = Object.freeze(['requested', 'approved', 'rejected', 'active', 'recover_at_exit',
  'completed', 'settled_at_exit', 'written_off']);

const LOAN_TRANSITIONS = Object.freeze({
  requested: ['approved', 'rejected'],
  approved: ['active', 'rejected'],   // rejected = admin cancel before disbursement (Loans PR-3)
  active: ['completed', 'recover_at_exit', 'written_off'],
  recover_at_exit: ['settled_at_exit'],
  rejected: [],
  completed: [],
  settled_at_exit: [],
  written_off: [],
});

/** Loans that count against "1 active loan per person" (D-4). */
const OPEN_LOAN_STATES = Object.freeze(['requested', 'approved', 'active', 'recover_at_exit']);
/** Loans that carry a live schedule and a balance. */
const LIVE_LOAN_STATES = Object.freeze(['active', 'recover_at_exit']);

const INSTALMENT_STATES = Object.freeze(['scheduled', 'provisional', 'posted', 'paid_in_cash', 'deferred', 'cancelled']);

const INSTALMENT_TRANSITIONS = Object.freeze({
  scheduled: ['provisional', 'paid_in_cash', 'cancelled', 'deferred'],
  provisional: ['posted', 'scheduled', 'deferred', 'paid_in_cash'],
  posted: [],
  paid_in_cash: [],
  deferred: [],
  cancelled: [],
});

/** Instalment origins added automatically at the end; these count toward the extension limit (D-19). */
const AUTO_EXTENSION_ORIGINS = Object.freeze(['shortfall', 'no_salary', 'held']);
// 'reversal' (Loans PR-6): an admin reversal returns a posted amount to the schedule; not an automatic extension.
const INSTALMENT_ORIGINS = Object.freeze(['schedule', 'shortfall', 'no_salary', 'held', 'deferred', 'restructure', 'reversal']);

function canTransition(kind, from, to) {
  const table = kind === 'instalment' ? INSTALMENT_TRANSITIONS : LOAN_TRANSITIONS;
  return Array.isArray(table[from]) && table[from].includes(to);
}

function assertTransition(kind, from, to) {
  if (canTransition(kind, from, to)) return { ok: true };
  return { ok: false, code: 'ILLEGAL_TRANSITION', message: `${kind} cannot move from ${from} to ${to}` };
}

/** Roles allowed per action (SPEC §7). `system` = the engine's own automatic moves (close, sweep). */
const ACTION_ROLES = Object.freeze({
  request: ['hr', 'finance', 'admin'],
  approve: ['admin'],
  reject: ['admin'],
  cancel: ['admin'],                          // approved-not-disbursed → rejected (Loans PR-3)
  disburse: ['finance', 'admin'],
  receipt: ['finance', 'admin'],
  request_change: ['hr', 'finance', 'admin'], // defer, restructure, write-off requests
  approve_change: ['admin'],
  post: ['finance', 'admin', 'system'],       // ledger primitives (PR-5 / PR-6 callers)
  flag_exit: ['hr', 'admin', 'system'],
  close: ['finance', 'admin', 'system'],      // monthly loan close + held sweep (Loans PR-6)
  reverse_posted: ['admin'],                  // opposite entry for a posted deduction (Loans PR-6)
  // Loans PR-10: import of the loans run outside the app (SPEC §7 last row).
  import_upload: ['hr', 'finance'],
  import_confirm_match: ['hr'],
  import_confirm_balance: ['finance'],
  import_approve: ['admin'],
  import_discard: ['hr', 'finance', 'admin'],
  import_remap: ['hr', 'finance', 'admin'],     // re-choose the outstanding / EMI columns (uploader or admin)
});

/** Actions where the actor may never be the person who raised the request. */
const NOT_OWN_REQUEST = Object.freeze(['approve', 'reject', 'approve_change', 'disburse']);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

function normaliseActor(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const username = String(actor.username == null ? '' : actor.username).trim();
  const role = norm(actor.role);
  if (!username || !role) return null;
  return { username, role };
}

/**
 * Maker-checker gate.
 * @param {string} action key of ACTION_ROLES
 * @param {{username, role}} actor
 * @param {{requestedBy?: string}} ctx — the username that raised the thing being decided
 */
function checkActor(action, actor, ctx = {}) {
  const a = normaliseActor(actor);
  if (!a) return { ok: false, code: 'ACTOR_REQUIRED', message: 'a user with a role is required' };
  const allowed = ACTION_ROLES[action];
  if (!allowed) return { ok: false, code: 'UNKNOWN_ACTION', message: `unknown action ${action}` };
  if (!allowed.includes(a.role)) {
    return { ok: false, code: 'ROLE_NOT_ALLOWED', message: `${a.role} cannot ${action.replace('_', ' ')}` };
  }
  if (NOT_OWN_REQUEST.includes(action) && ctx.requestedBy && norm(ctx.requestedBy) === norm(a.username)) {
    return {
      ok: false,
      code: action === 'disburse' ? 'SELF_DISBURSEMENT' : 'SELF_APPROVAL',
      message: action === 'disburse'
        ? 'the person who requested the loan cannot record its disbursement'
        : 'nobody can decide a request they raised',
    };
  }
  return { ok: true, actor: a };
}

module.exports = {
  LOAN_STATES, LOAN_TRANSITIONS, OPEN_LOAN_STATES, LIVE_LOAN_STATES,
  INSTALMENT_STATES, INSTALMENT_TRANSITIONS, AUTO_EXTENSION_ORIGINS, INSTALMENT_ORIGINS,
  ACTION_ROLES, NOT_OWN_REQUEST,
  canTransition, assertTransition, checkActor, normaliseActor,
};
