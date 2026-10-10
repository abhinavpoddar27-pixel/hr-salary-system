/**
 * Loans engine — request, approve, reject, disburse, exit flag (Loans PR-2,
 * docs/loans/SPEC.md §5.2 r1–r3, §5.4, §7, D-3, D-18, D-25, K11, K35).
 *
 * Every function returns a plain object — {ok:true, …} or
 * {ok:false, code, message, …} — and never throws for a business refusal.
 * Every state move is guarded in the UPDATE's WHERE clause (changes === 1).
 * Instalment rows are written at DISBURSEMENT, when the first EMI month is
 * known (coordinator ruling 11); approval stores the EMI and returns a preview.
 */
const { parseAmount, toPaise, toRupees } = require('./money');
const { parseDate, todayIst, monthLabel } = require('./months');
const { readLoanPolicy, EMERGENCY_LOAN_TYPE } = require('./policy');
const { buildSchedule, closedMonths, firstEmiMonth } = require('./schedule');
const { evaluateEligibility, loadBorrowerFacts } = require('./eligibility');
const { checkActor } = require('./states');
const { writeEvent } = require('./events');

const { fail, text, getLoan, inTxn } = require('./common');
const { consolidateForExit } = require('./exit');

/**
 * HR (or finance / admin) raises a loan. Eligibility must pass.
 * @param {object} input {borrowerType, employeeCode, company, loanType, principal, tenure, reason, remarks}
 */
function requestLoan(db, input, actor, { asOf } = {}) {
  const gate = checkActor('request', actor);
  if (!gate.ok) return gate;
  const reason = text(input.reason);
  if (!reason) return fail('REASON_REQUIRED', 'a reason for the loan is required');
  const policy = readLoanPolicy(db);
  const req = {
    borrowerType: input.borrowerType, company: text(input.company), loanType: input.loanType,
    principal: input.principal, tenure: input.tenure, asOf: asOf || todayIst(),
  };
  const facts = loadBorrowerFacts(db, { borrowerType: input.borrowerType, employeeCode: input.employeeCode, company: req.company, asOf: req.asOf });
  const verdict = evaluateEligibility(facts, req, policy);
  if (!verdict.eligible) {
    return fail('NOT_ELIGIBLE', verdict.refusals.map((r) => r.message).join('; '), { refusals: verdict.refusals, warnings: verdict.warnings, limits: verdict.limits });
  }
  return inTxn(db, () => {
    const principalPaise = toPaise(input.principal);
    const info = db.prepare(`
      INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, interest_rate,
                         tenure_months, emi_amount, status, requested_by, request_reason, remarks)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'requested', ?, ?, ?)
    `).run(input.borrowerType, text(input.employeeCode), req.company, input.loanType, toRupees(principalPaise),
      Number(input.tenure), verdict.emi, gate.actor.username, reason, text(input.remarks) || null);
    const loan = getLoan(db, info.lastInsertRowid);
    writeEvent(db, { loan, event: 'requested', fromState: null, toState: 'requested', amountPaise: principalPaise, actor: gate.actor, reason });
    return {
      ok: true, loanId: loan.id, status: 'requested', emi: verdict.emi,
      schedulePreview: verdict.schedulePreview, warnings: verdict.warnings, limits: verdict.limits,
      urgent: input.loanType === EMERGENCY_LOAN_TYPE,
    };
  });
}

/** Admin approves (never their own request). Eligibility is re-checked. */
function approveLoan(db, loanId, actor, { reason, asOf } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('approve', actor, { requestedBy: loan.requested_by });
  if (!gate.ok) return gate;
  if (loan.status !== 'requested') return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}, not requested`);
  if (loan.exit_flag === 1) return fail('LOAN_EXIT_FLAGGED', 'the borrower has been marked Left; this loan cannot be approved');
  const policy = readLoanPolicy(db);
  const facts = loadBorrowerFacts(db, { borrowerType: loan.borrower_type, employeeCode: loan.employee_code, company: loan.company, excludeLoanId: loan.id, asOf: asOf || todayIst() });
  const verdict = evaluateEligibility(facts, {
    borrowerType: loan.borrower_type, company: loan.company, loanType: loan.loan_type,
    principal: loan.principal_amount, tenure: loan.tenure_months, asOf: asOf || todayIst(),
  }, policy);
  if (!verdict.eligible) {
    return fail('NOT_ELIGIBLE', verdict.refusals.map((r) => r.message).join('; '), { refusals: verdict.refusals, warnings: verdict.warnings });
  }
  return inTxn(db, () => {
    const r = db.prepare(`
      UPDATE loans SET status = 'approved', decided_by = ?, decided_at = datetime('now'), decision_reason = ?,
             emi_amount = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'requested' AND exit_flag = 0
    `).run(gate.actor.username, text(reason) || null, verdict.emi, loan.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed while it was being approved');
    writeEvent(db, { loan, event: 'approved', fromState: 'requested', toState: 'approved', amountPaise: toPaise(loan.principal_amount), actor: gate.actor, reason: text(reason) || null });
    return { ok: true, loanId: loan.id, status: 'approved', emi: verdict.emi, schedulePreview: verdict.schedulePreview, warnings: verdict.warnings };
  });
}

/** Admin rejects (never their own request), with a reason. */
function rejectLoan(db, loanId, actor, { reason } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('reject', actor, { requestedBy: loan.requested_by });
  if (!gate.ok) return gate;
  if (!text(reason)) return fail('REASON_REQUIRED', 'a reason is required to reject a loan');
  if (loan.status !== 'requested') return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}, not requested`);
  return inTxn(db, () => {
    const r = db.prepare(`
      UPDATE loans SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_reason = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'requested'
    `).run(gate.actor.username, text(reason), loan.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed while it was being rejected');
    writeEvent(db, { loan, event: 'rejected', fromState: 'requested', toState: 'rejected', actor: gate.actor, reason: text(reason) });
    return { ok: true, loanId: loan.id, status: 'rejected' };
  });
}

/**
 * Finance (or admin) records the payout. The money must equal the principal,
 * the signed agreement must be attached (D-25), and the recorder cannot be the
 * requester (K35, coordinator ruling 8). Writes the schedule.
 * @param {object} d {mode, reference, disbursedOn:'YYYY-MM-DD', amount?, agreementFilePath?, firstEmiMonth?:{month,year}}
 */
function disburseLoan(db, loanId, actor, d = {}, { asOf } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('disburse', actor, { requestedBy: loan.requested_by });
  if (!gate.ok) return gate;
  if (loan.status !== 'approved') return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}, not approved`);
  if (loan.exit_flag === 1) return fail('LOAN_EXIT_FLAGGED', 'the borrower has been marked Left; this loan cannot be disbursed');
  if (!text(d.mode)) return fail('MODE_REQUIRED', 'disbursement mode is required');
  if (!text(d.reference)) return fail('REFERENCE_REQUIRED', 'disbursement reference is required');
  if (!parseDate(d.disbursedOn)) return fail('DATE_INVALID', 'disbursement date must be YYYY-MM-DD');
  const today = asOf || todayIst();
  if (d.disbursedOn.slice(0, 10) > today) return fail('DATE_IN_FUTURE', 'disbursement date cannot be in the future');
  const principalPaise = toPaise(loan.principal_amount);
  if (d.amount !== undefined && d.amount !== null) {
    const a = parseAmount(d.amount, { field: 'disbursed amount' });
    if (!a.ok) return a;
    if (a.paise !== principalPaise) return fail('DISBURSED_AMOUNT_MISMATCH', `disbursed amount must equal the principal (₹${toRupees(principalPaise)})`);
  }
  const policy = readLoanPolicy(db);
  const agreement = text(d.agreementFilePath) || text(loan.agreement_file_path);
  if (policy.agreementRequired && !agreement) return fail('AGREEMENT_REQUIRED', 'attach the scanned signed agreement before disbursement');

  const first = firstEmiMonth({ disbursedOn: d.disbursedOn, closed: closedMonths(db, loan.borrower_type), requested: d.firstEmiMonth || null, payroll: loan.borrower_type });
  if (!first.ok) return first;
  const sched = buildSchedule({ principalPaise, tenure: loan.tenure_months, firstMonth: first.month });
  if (!sched.ok) return sched;

  return inTxn(db, () => {
    const r = db.prepare(`
      UPDATE loans SET status = 'active', disbursed_amount = ?, disbursement_mode = ?, disbursement_reference = ?,
             disbursed_on = ?, disbursed_by = ?, disbursed_at = datetime('now'),
             agreement_file_path = ?,
             agreement_uploaded_by = CASE WHEN ? THEN ? ELSE agreement_uploaded_by END,
             agreement_uploaded_at = CASE WHEN ? THEN datetime('now') ELSE agreement_uploaded_at END,
             first_emi_month = ?, first_emi_year = ?, emi_amount = ?, remaining_balance = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'approved' AND exit_flag = 0
    `).run(toRupees(principalPaise), text(d.mode), text(d.reference), d.disbursedOn.slice(0, 10), gate.actor.username,
      agreement || null, text(d.agreementFilePath) ? 1 : 0, gate.actor.username, text(d.agreementFilePath) ? 1 : 0,
      first.month.month, first.month.year, toRupees(sched.emiPaise), toRupees(principalPaise), loan.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed while it was being disbursed');
    const ins = db.prepare(`
      INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status, origin)
      VALUES (?, ?, ?, ?, ?, 'scheduled', 'schedule')
    `);
    for (const i of sched.instalments) ins.run(loan.id, i.sequence, i.month, i.year, toRupees(i.amountPaise));
    writeEvent(db, {
      loan, event: 'disbursed', fromState: 'approved', toState: 'active', amountPaise: principalPaise, actor: gate.actor,
      reason: `${text(d.mode)} ref ${text(d.reference)} on ${d.disbursedOn.slice(0, 10)}; first EMI ${monthLabel(first.month)}`,
    });
    return {
      ok: true, loanId: loan.id, status: 'active', firstEmiMonth: first.month,
      emi: toRupees(sched.emiPaise),
      schedule: sched.instalments.map((i) => ({ sequence: i.sequence, month: i.month, year: i.year, amount: toRupees(i.amountPaise) })),
    };
  });
}

/**
 * Admin cancels an approved loan before any money is paid (Loans PR-3,
 * coordinator ruling Q3). `loans.status` has no 'cancelled' value (a CHECK
 * constraint), so the loan ends `rejected`; the `cancelled` event and the
 * "Cancelled after approval:" decision reason tell it apart from a rejection.
 * Allowed on an exit-flagged loan — that is the way out for one.
 */
function cancelLoan(db, loanId, actor, { reason } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('cancel', actor);
  if (!gate.ok) return gate;
  if (!text(reason)) return fail('REASON_REQUIRED', 'a reason is required to cancel a loan');
  if (loan.status !== 'approved') return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}; only an approved loan that is not yet disbursed can be cancelled`);
  return inTxn(db, () => {
    const r = db.prepare(`
      UPDATE loans SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_reason = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'approved' AND disbursed_amount IS NULL
    `).run(gate.actor.username, `Cancelled after approval: ${text(reason)}`, loan.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed while it was being cancelled');
    writeEvent(db, { loan, event: 'cancelled', fromState: 'approved', toState: 'rejected', amountPaise: toPaise(loan.principal_amount), actor: gate.actor, reason: text(reason) });
    return { ok: true, loanId: loan.id, status: 'rejected', cancelled: true };
  });
}

/**
 * Exit flag (SPEC §5.2 r11). Same semantics as PR-1's Mark Left block in
 * employees.js: active → recover_at_exit; requested / approved keep their
 * status and only get the flag. No balance moves; an active loan's schedule
 * collapses into its final month (Loans PR-7, exit.js consolidateForExit).
 */
function flagForExit(db, loanId, actor, { exitDate, reason } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('flag_exit', actor);
  if (!gate.ok) return gate;
  if (loan.exit_flag === 1) return { ok: true, loanId: loan.id, status: loan.status, alreadyFlagged: true };
  if (!['requested', 'approved', 'active'].includes(loan.status)) return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}`);
  const toState = loan.status === 'active' ? 'recover_at_exit' : loan.status;
  return inTxn(db, () => {
    const r = db.prepare(`
      UPDATE loans SET status = ?, exit_flag = 1, exit_flagged_at = datetime('now'), exit_flagged_by = ?, exit_date = ?, updated_at = datetime('now')
       WHERE id = ? AND status = ? AND exit_flag = 0
    `).run(toState, gate.actor.username, exitDate || null, loan.id, loan.status);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed while it was being flagged');
    writeEvent(db, { loan, event: 'borrower_left', fromState: loan.status, toState, amountPaise: toPaise(loan.remaining_balance), actor: gate.actor, reason: text(reason) || `exit ${exitDate || 'date not given'}` });
    // Loans PR-7: the whole outstanding falls due in the final payroll.
    const exit = consolidateForExit(db, loan.id, gate.actor);
    return { ok: true, loanId: loan.id, status: toState, exit, alerts: exit.alerts };
  });
}

/**
 * Sales exit (Loans PR-8, ruling Q6): flags every open sales loan of one sales
 * person (code + company) — the same as the plant Mark Left block. Called by the
 * sales mark-left route and by the sales employee edit when status becomes Left
 * or Exited, INSIDE their transaction; throws on a refusal so the status change
 * rolls back with it. The final payroll is the sales cycle containing the exit
 * date (common.js finalMonthOf, ruling Q4). Loan schema not migrated → skipped.
 * @returns {{skipped:boolean, loans:Array, alerts:Array}}
 */
function flagSalesBorrowerForExit(db, { employeeCode, company, exitDate, reason }, actor) {
  if (!db.prepare("SELECT 1 FROM policy_config WHERE key = 'migration_loans_schema_v2_done' AND value = '1'").get()) {
    console.warn(`[sales mark-left] ${employeeCode}: loan schema not migrated — sales loans not flagged`);
    return { skipped: true, loans: [], alerts: [] };
  }
  const open = db.prepare(`SELECT id FROM loans WHERE borrower_type = 'sales' AND employee_code = ? AND company = ?
                              AND status IN ('requested','approved','active') AND exit_flag = 0 ORDER BY id`)
    .all(String(employeeCode), String(company || '').trim());
  const loans = [];
  const alerts = [];
  for (const { id } of open) {
    const r = flagForExit(db, id, actor, { exitDate, reason: `Marked Left (exit ${exitDate}). ${text(reason) || 'No reason given'}` });
    if (!r.ok) throw new Error(`sales exit: loan ${id} could not be flagged: ${r.code} — ${r.message}`);
    const after = getLoan(db, id);
    const x = r.exit || {};
    loans.push({
      loanId: id, status: r.status, outstanding: r.status === 'recover_at_exit' ? after.remaining_balance : 0,
      finalMonth: x.finalMonth || null, finalMonthPast: r.status === 'recover_at_exit' ? !!x.finalMonthPast : null,
      dueInFinalPayroll: x.dueInFinalPayroll || 0, residual: x.residual || 0,
    });
    alerts.push(...(r.alerts || []));
  }
  return { skipped: false, loans, alerts };
}

module.exports = { getLoan, inTxn, requestLoan, approveLoan, rejectLoan, cancelLoan, disburseLoan, flagForExit, flagSalesBorrowerForExit };
