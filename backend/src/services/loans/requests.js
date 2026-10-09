/**
 * Loans engine — pending change requests (Loans PR-3, docs/loans/SPEC.md §5.2
 * r9–r12, §7, D-3; PR-2 ruling 10 left the storage to PR-3).
 *
 * Defer, restructure and write-off are RAISED by HR or finance and wait in
 * `loan_requests` until the admin approves or rejects them. Approval runs the
 * PR-2 change function (deferInstalment / restructureLoan / writeOffLoan) on
 * the loan's CURRENT state, inside the same transaction that marks the request
 * approved, so a refusal leaves the request pending and nothing half-written.
 *
 * Coordinator rulings (9 Oct 2026):
 *  - B: the admin cannot raise a change (ADMIN_CANNOT_RAISE) — with one admin
 *    and no backup approver, an admin-raised item could never be approved.
 *  - A: a restructure top-up is a disbursement, so it is refused while
 *    policy_config.loans_disbursement_enabled is not '1' (DISBURSEMENT_DISABLED).
 *
 * Plain-object returns, never a thrown class. Does not require routes/auth.js.
 */
const { parseAmount, toRupees } = require('./money');
const { todayIst } = require('./months');
const { disbursementEnabled } = require('./policy');
const { checkActor, LIVE_LOAN_STATES } = require('./states');
const { writeEvent } = require('./events');
const { deferInstalment, restructureLoan, writeOffLoan } = require('./changes');
const { fail, text, getLoan, inTxn } = require('./common');

const CHANGE_KINDS = Object.freeze(['defer', 'restructure', 'write_off']);
const KIND_LABEL = Object.freeze({ defer: 'Defer', restructure: 'Restructure', write_off: 'Write-off' });

/** Placeholder checker for the dry run; never persisted (the dry run always rolls back). */
const DRY_RUN_CHECKER = Object.freeze({ username: '__dry_run_checker__', role: 'admin' });
const DRY_RUN = Object.freeze({ loansRequestDryRun: true });

const parseJson = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };

function getRequest(db, requestId) {
  const r = db.prepare('SELECT * FROM loan_requests WHERE id = ?').get(requestId);
  if (!r) return null;
  return { ...r, payload: parseJson(r.payload), result: r.result ? parseJson(r.result) : null };
}

/** Normalises the request body into the stored payload, or a refusal. */
function buildPayload(kind, input) {
  if (kind === 'defer') {
    const id = Number(input.instalmentId);
    if (!Number.isInteger(id) || id <= 0) return fail('INSTALMENT_REQUIRED', 'choose the instalment to defer');
    return { ok: true, payload: { instalmentId: id } };
  }
  if (kind === 'restructure') {
    const hasTenure = input.newTenure !== undefined && input.newTenure !== null && input.newTenure !== '';
    const hasEmi = input.newEmi !== undefined && input.newEmi !== null && input.newEmi !== '';
    if (hasTenure === hasEmi) return fail('RESTRUCTURE_TERMS_INVALID', 'give exactly one of a new tenure or a new EMI');
    const payload = {};
    if (hasTenure) {
      const n = Number(input.newTenure);
      if (!Number.isInteger(n) || n < 1) return fail('TENURE_INVALID', 'new tenure must be a whole number of months');
      payload.newTenure = n;
    } else {
      const e = parseAmount(input.newEmi, { field: 'new EMI' });
      if (!e.ok) return e;
      payload.newEmi = toRupees(e.paise);
    }
    if (input.topupAmount !== undefined && input.topupAmount !== null && input.topupAmount !== '' && Number(input.topupAmount) !== 0) {
      const t = parseAmount(input.topupAmount, { field: 'top-up' });
      if (!t.ok) return t;
      payload.topupAmount = toRupees(t.paise);
    }
    return { ok: true, payload };
  }
  return { ok: true, payload: {} };
}

/** Calls the PR-2 change function for a request. */
function applyChange(db, kind, loanId, payload, reason, requestedBy, approver, { topup = null, asOf } = {}) {
  if (kind === 'defer') return deferInstalment(db, { instalmentId: payload.instalmentId, reason, requestedBy }, approver);
  if (kind === 'write_off') return writeOffLoan(db, { loanId, reason, requestedBy }, approver);
  return restructureLoan(db, {
    loanId, reason, requestedBy,
    newTenure: payload.newTenure, newEmi: payload.newEmi,
    topup: payload.topupAmount ? { amount: payload.topupAmount, ...topup } : undefined,
  }, approver, { asOf });
}

/**
 * HR / finance raise a change. The engine is run once in a transaction that is
 * always rolled back (the "dry run"), so an impossible request is refused at
 * once with the engine's own code, and the reply carries its preview.
 * @param {object} input {loanId, kind, reason, instalmentId? | newTenure?/newEmi?/topupAmount?}
 */
function requestChange(db, input, actor, { asOf } = {}) {
  const gate = checkActor('request_change', actor);
  if (!gate.ok) return gate;
  if (gate.actor.role === 'admin') return fail('ADMIN_CANNOT_RAISE', 'HR raises loans; admin approves');
  const kind = text(input.kind);
  if (!CHANGE_KINDS.includes(kind)) return fail('KIND_INVALID', `kind must be one of ${CHANGE_KINDS.join(', ')}`);
  const reason = text(input.reason);
  if (!reason) return fail('REASON_REQUIRED', 'a reason is required');
  const loan = getLoan(db, input.loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${input.loanId} not found`);
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}; changes apply to active or recover-at-exit loans`);
  const built = buildPayload(kind, input);
  if (!built.ok) return built;
  const payload = built.payload;
  if (kind === 'defer') {
    const ins = db.prepare('SELECT loan_id FROM loan_instalments WHERE id = ?').get(payload.instalmentId);
    if (!ins || ins.loan_id !== loan.id) return fail('INSTALMENT_NOT_FOUND', `instalment ${payload.instalmentId} is not on loan ${loan.id}`);
  }
  if (db.prepare("SELECT 1 FROM loan_requests WHERE loan_id = ? AND status = 'pending'").get(loan.id)) {
    return fail('REQUEST_ALREADY_PENDING', 'this loan already has a change request waiting for the admin');
  }

  // Dry run — always rolled back.
  const day = asOf || todayIst();
  const dryTopup = { mode: 'dry-run', reference: 'dry-run', disbursedOn: day, agreementFilePath: 'dry-run' };
  let preview;
  try {
    db.transaction(() => {
      preview = applyChange(db, kind, loan.id, payload, reason, gate.actor, DRY_RUN_CHECKER, { topup: dryTopup, asOf: day });
      throw DRY_RUN;
    })();
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  if (!preview || !preview.ok) return preview || fail('DRY_RUN_FAILED', 'the change could not be checked');
  const { ok: _ok, ...previewBody } = preview;

  return inTxn(db, () => {
    let info;
    try {
      info = db.prepare(`
        INSERT INTO loan_requests (loan_id, kind, status, payload, reason, requested_by, requested_by_role)
        VALUES (?, ?, 'pending', ?, ?, ?, ?)
      `).run(loan.id, kind, JSON.stringify(payload), reason, gate.actor.username, gate.actor.role);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return fail('REQUEST_ALREADY_PENDING', 'this loan already has a change request waiting for the admin');
      throw e;
    }
    writeEvent(db, {
      loan, event: 'change_requested', fromState: loan.status, toState: loan.status, actor: gate.actor, field: 'change_request',
      amountPaise: null, reason: `${KIND_LABEL[kind]} request #${info.lastInsertRowid}: ${reason}`,
    });
    return { ok: true, requestId: info.lastInsertRowid, loanId: loan.id, kind, status: 'pending', payload, preview: previewBody };
  });
}

/**
 * Admin approves (never their own). Restructure top-up payout details come in
 * `topup` {mode, reference, disbursedOn, agreementFilePath} (PR-2 ruling 6).
 */
function approveChange(db, requestId, approver, { topup = null, reason = null, asOf } = {}) {
  const req = getRequest(db, requestId);
  if (!req) return fail('REQUEST_NOT_FOUND', `request ${requestId} not found`);
  const requestedBy = { username: req.requested_by, role: req.requested_by_role };
  const gate = checkActor('approve_change', approver, { requestedBy: req.requested_by });
  if (!gate.ok) return gate;
  if (req.status !== 'pending') return fail('REQUEST_NOT_PENDING', `request is ${req.status}`);
  if (req.kind === 'restructure' && req.payload.topupAmount && !disbursementEnabled(db)) {
    return fail('DISBURSEMENT_DISABLED', 'loan disbursement is switched off until payroll recovery (Loans PR-5/PR-6) is live; a top-up cannot be paid');
  }
  const loan = getLoan(db, req.loan_id);
  return inTxn(db, () => {
    const u = db.prepare(`UPDATE loan_requests SET status = 'approved', decided_by = ?, decided_at = datetime('now'),
                                 decision_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(gate.actor.username, text(reason) || null, req.id);
    if (u.changes !== 1) return fail('CONCURRENT_CHANGE', 'the request changed while it was being approved');
    const r = applyChange(db, req.kind, req.loan_id, req.payload, req.reason, requestedBy, gate.actor, { topup, asOf });
    if (!r.ok) return r;
    const { ok: _ok, ...result } = r;
    db.prepare('UPDATE loan_requests SET result = ? WHERE id = ?').run(JSON.stringify(result), req.id);
    writeEvent(db, {
      loan, event: 'change_approved', fromState: loan.status, toState: getLoan(db, loan.id).status, actor: gate.actor, field: 'change_request',
      reason: `${KIND_LABEL[req.kind]} request #${req.id} raised by ${req.requested_by}${text(reason) ? ': ' + text(reason) : ''}`,
    });
    return { ok: true, requestId: req.id, loanId: req.loan_id, kind: req.kind, status: 'approved', requestedBy: req.requested_by, result };
  });
}

/** Admin rejects (never their own), with a reason. */
function rejectChange(db, requestId, approver, { reason } = {}) {
  const req = getRequest(db, requestId);
  if (!req) return fail('REQUEST_NOT_FOUND', `request ${requestId} not found`);
  const gate = checkActor('approve_change', approver, { requestedBy: req.requested_by });
  if (!gate.ok) return gate;
  if (!text(reason)) return fail('REASON_REQUIRED', 'a reason is required to reject a request');
  if (req.status !== 'pending') return fail('REQUEST_NOT_PENDING', `request is ${req.status}`);
  const loan = getLoan(db, req.loan_id);
  return inTxn(db, () => {
    const u = db.prepare(`UPDATE loan_requests SET status = 'rejected', decided_by = ?, decided_at = datetime('now'),
                                 decision_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(gate.actor.username, text(reason), req.id);
    if (u.changes !== 1) return fail('CONCURRENT_CHANGE', 'the request changed while it was being rejected');
    writeEvent(db, {
      loan, event: 'change_rejected', fromState: loan.status, toState: loan.status, actor: gate.actor, field: 'change_request',
      reason: `${KIND_LABEL[req.kind]} request #${req.id} raised by ${req.requested_by}: ${text(reason)}`,
    });
    return { ok: true, requestId: req.id, loanId: req.loan_id, kind: req.kind, status: 'rejected', requestedBy: req.requested_by };
  });
}

/** The requester (and only the requester) withdraws a pending request. */
function withdrawChange(db, requestId, actor, { reason } = {}) {
  const req = getRequest(db, requestId);
  if (!req) return fail('REQUEST_NOT_FOUND', `request ${requestId} not found`);
  const gate = checkActor('request_change', actor);
  if (!gate.ok) return gate;
  if (gate.actor.username.toLowerCase() !== String(req.requested_by).trim().toLowerCase()) {
    return fail('NOT_REQUESTER', 'only the person who raised the request can withdraw it');
  }
  if (req.status !== 'pending') return fail('REQUEST_NOT_PENDING', `request is ${req.status}`);
  const loan = getLoan(db, req.loan_id);
  return inTxn(db, () => {
    const u = db.prepare(`UPDATE loan_requests SET status = 'withdrawn', decided_by = ?, decided_at = datetime('now'),
                                 decision_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(gate.actor.username, text(reason) || 'withdrawn by the requester', req.id);
    if (u.changes !== 1) return fail('CONCURRENT_CHANGE', 'the request changed while it was being withdrawn');
    writeEvent(db, {
      loan, event: 'change_withdrawn', fromState: loan.status, toState: loan.status, actor: gate.actor, field: 'change_request',
      reason: `${KIND_LABEL[req.kind]} request #${req.id}${text(reason) ? ': ' + text(reason) : ''}`,
    });
    return { ok: true, requestId: req.id, loanId: req.loan_id, status: 'withdrawn' };
  });
}

function listRequests(db, { status = null, loanId = null } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('r.status = ?'); args.push(status); }
  if (loanId) { where.push('r.loan_id = ?'); args.push(loanId); }
  return db.prepare(`
    SELECT r.*, l.employee_code, l.borrower_type, l.company, l.loan_type, l.status AS loan_status, l.remaining_balance
      FROM loan_requests r JOIN loans l ON l.id = r.loan_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.requested_at, r.id
  `).all(...args).map((r) => ({ ...r, payload: parseJson(r.payload), result: r.result ? parseJson(r.result) : null }));
}

module.exports = {
  CHANGE_KINDS, getRequest, requestChange, approveChange, rejectChange, withdrawChange, listRequests,
};
