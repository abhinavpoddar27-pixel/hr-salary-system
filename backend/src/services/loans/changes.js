/**
 * Loans engine — defer, restructure, write-off (Loans PR-2, docs/loans/SPEC.md
 * §5.2 r9–r11, D-3, D-7, D-15; fixes D8; coordinator rulings 6 and 10).
 *
 * Each change is RAISED by HR / finance / admin and APPROVED by the admin, who
 * may never approve a change they raised. Where the pending request is stored
 * is PR-3's decision (ruling 10); here each function takes both the requester
 * and the approver and enforces maker-checker when the change is applied.
 */
const { parseAmount, toPaise, toRupees } = require('./money');
const { parseDate, todayIst, compareMonth, addMonths, monthLabel } = require('./months');
const { readLoanPolicy } = require('./policy');
const { buildSchedule, buildScheduleByEmi } = require('./schedule');
const { evaluateEligibility, loadBorrowerFacts } = require('./eligibility');
const { checkActor } = require('./states');
const { writeEvent } = require('./events');
const { fail, text, getLoan, getInstalments, inTxn, appendInstalment, moveBalance, notBeforeOpen } = require('./common');

function gateChange(requestedBy, approver) {
  const req = checkActor('request_change', requestedBy);
  if (!req.ok) return { ...req, message: `requester: ${req.message}` };
  const app = checkActor('approve_change', approver, { requestedBy: req.actor.username });
  if (!app.ok) return app;
  return { ok: true, requester: req.actor, approver: app.actor };
}

/**
 * Defer replaces Skip (D8): one SCHEDULED instalment moves to the end of the
 * schedule. Admin-approved, so it does not count toward the extension limit.
 */
function deferInstalment(db, { instalmentId, reason, requestedBy }, approver) {
  const g = gateChange(requestedBy, approver);
  if (!g.ok) return g;
  if (!text(reason)) return fail('REASON_REQUIRED', 'a reason is required to defer an instalment');
  const ins = db.prepare('SELECT * FROM loan_instalments WHERE id = ?').get(instalmentId);
  if (!ins) return fail('INSTALMENT_NOT_FOUND', `instalment ${instalmentId} not found`);
  const loan = getLoan(db, ins.loan_id);
  if (loan.status !== 'active') return fail('LOAN_NOT_ACTIVE', `loan is ${loan.status}; only an active loan's instalment can be deferred`);
  if (ins.status !== 'scheduled') return fail('INSTALMENT_NOT_SCHEDULED', `instalment ${ins.sequence} is ${ins.status}; only a scheduled instalment can be deferred`);
  return inTxn(db, () => {
    const r = db.prepare("UPDATE loan_instalments SET status = 'deferred', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(ins.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the instalment changed underneath');
    const why = `requested by ${g.requester.username}, approved by ${g.approver.username}: ${text(reason)}`;
    writeEvent(db, { loan, instalmentId: ins.id, event: 'deferred', fromState: 'scheduled', toState: 'deferred', amountPaise: toPaise(ins.amount_due), actor: g.approver, reason: why, field: 'instalment_status' });
    const a = appendInstalment(db, loan, { amountPaise: toPaise(ins.amount_due), origin: 'deferred', sourceInstalmentId: ins.id, actor: g.approver, reason: `deferred from ${ins.due_month}/${ins.due_year}` });
    return { ok: true, added: a.added };
  });
}

/**
 * Restructure (§5.2 r9): a new tenure OR a new EMI for what is left, optionally
 * with a top-up. Only SCHEDULED instalments change; provisional and posted ones
 * stay. The new schedule covers balance + top-up − provisional instalments
 * (any "uncovered" amount is folded in) and starts at the earliest scheduled
 * month, never before the month after the latest provisional / posted one.
 * Eligibility is re-run on the new terms "like a new loan". Resets the
 * shortfall extension counter. Not allowed in recover-at-exit.
 *
 * Top-up (ruling 6): recorded at approval with its own mode / reference / date
 * and a fresh signed agreement; disbursed_amount and the balance rise by it;
 * principal_amount stays the original figure.
 *
 * @param {object} c {loanId, newTenure?, newEmi?, topup?:{amount, mode, reference, disbursedOn, agreementFilePath}, reason, requestedBy}
 */
function restructureLoan(db, c, approver, { asOf } = {}) {
  const g = gateChange(c.requestedBy, approver);
  if (!g.ok) return g;
  if (!text(c.reason)) return fail('REASON_REQUIRED', 'a reason is required to restructure');
  const loan = getLoan(db, c.loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${c.loanId} not found`);
  if (loan.status === 'recover_at_exit') return fail('RESTRUCTURE_AT_EXIT_NOT_ALLOWED', 'the outstanding falls due in the final payroll; settle by receipt or write-off');
  if (loan.status !== 'active') return fail('LOAN_NOT_ACTIVE', `loan is ${loan.status}`);
  const hasTenure = c.newTenure !== undefined && c.newTenure !== null;
  const hasEmi = c.newEmi !== undefined && c.newEmi !== null;
  if (hasTenure === hasEmi) return fail('RESTRUCTURE_TERMS_INVALID', 'give exactly one of a new tenure or a new EMI');

  const policy = readLoanPolicy(db);
  let topupPaise = 0;
  if (c.topup) {
    const t = parseAmount(c.topup.amount, { field: 'top-up' });
    if (!t.ok) return t;
    topupPaise = t.paise;
    if (!text(c.topup.mode)) return fail('MODE_REQUIRED', 'top-up disbursement mode is required');
    if (!text(c.topup.reference)) return fail('REFERENCE_REQUIRED', 'top-up disbursement reference is required');
    if (!parseDate(c.topup.disbursedOn)) return fail('DATE_INVALID', 'top-up disbursement date must be YYYY-MM-DD');
    if (c.topup.disbursedOn.slice(0, 10) > (asOf || todayIst())) return fail('DATE_IN_FUTURE', 'top-up date cannot be in the future');
    if (policy.agreementRequired && !text(c.topup.agreementFilePath)) return fail('AGREEMENT_REQUIRED', 'attach the signed agreement for the top-up');
  }

  const instalments = getInstalments(db, loan.id);
  const scheduled = instalments.filter((i) => i.status === 'scheduled');
  const provisionalPaise = instalments.filter((i) => i.status === 'provisional').reduce((s, i) => s + toPaise(i.amount_due), 0);
  const balancePaise = toPaise(loan.remaining_balance);
  const toSchedule = balancePaise + topupPaise - provisionalPaise;
  if (toSchedule <= 0) return fail('NOTHING_TO_RESTRUCTURE', 'nothing is left to reschedule');

  // Start month: earliest scheduled month, but after every provisional / posted / paid instalment.
  let floor = null;
  for (const i of instalments) {
    if (['provisional', 'posted', 'paid_in_cash'].includes(i.status)) {
      const m = { month: i.due_month, year: i.due_year };
      if (!floor || compareMonth(m, floor) > 0) floor = m;
    }
  }
  floor = floor ? addMonths(floor, 1) : { month: loan.first_emi_month, year: loan.first_emi_year };
  let start = scheduled.reduce((m, i) => {
    const x = { month: i.due_month, year: i.due_year };
    return !m || compareMonth(x, m) < 0 ? x : m;
  }, null) || floor;
  if (compareMonth(start, floor) < 0) start = floor;
  start = notBeforeOpen(db, loan.borrower_type, start);

  let sched;
  if (hasTenure) {
    sched = buildSchedule({ principalPaise: toSchedule, tenure: Number(c.newTenure), firstMonth: start });
  } else {
    const e = parseAmount(c.newEmi, { field: 'new EMI' });
    if (!e.ok) return e;
    sched = buildScheduleByEmi({ principalPaise: toSchedule, emiPaise: e.paise, firstMonth: start });
  }
  if (!sched.ok) return sched;
  const newTenure = sched.instalments.length;

  // "The admin approves it like a new loan": eligibility on the new exposure.
  const facts = loadBorrowerFacts(db, { borrowerType: loan.borrower_type, employeeCode: loan.employee_code, company: loan.company, excludeLoanId: loan.id });
  const verdict = evaluateEligibility(facts, {
    borrowerType: loan.borrower_type, company: loan.company, loanType: loan.loan_type,
    principal: toRupees(balancePaise + topupPaise), tenure: newTenure, asOf: asOf || todayIst(),
  }, policy);
  const refusals = verdict.refusals.filter((r) => r.code !== 'EMI_OVER_CEILING' && r.code !== 'TENURE_TOO_LONG_FOR_AMOUNT');
  const ceiling = Math.floor((facts.grossPaise || 0) * policy.emiCeilingPctGross / 100);
  if (sched.emiPaise > ceiling) refusals.push({ code: 'EMI_OVER_CEILING', message: `new EMI ₹${toRupees(sched.emiPaise)} is above ${policy.emiCeilingPctGross}% of monthly gross (₹${toRupees(ceiling)})` });
  if (refusals.length) return fail('NOT_ELIGIBLE', refusals.map((r) => r.message).join('; '), { refusals, warnings: verdict.warnings });

  return inTxn(db, () => {
    const why = `requested by ${g.requester.username}, approved by ${g.approver.username}: ${text(c.reason)}`;
    for (const i of scheduled) {
      const r = db.prepare("UPDATE loan_instalments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(i.id);
      if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the schedule changed underneath');
      writeEvent(db, { loan, instalmentId: i.id, event: 'instalment_cancelled', fromState: 'scheduled', toState: 'cancelled', amountPaise: toPaise(i.amount_due), actor: g.approver, reason: 'replaced by restructure', field: 'instalment_status' });
    }
    if (topupPaise > 0) {
      const b = moveBalance(db, loan, topupPaise);
      if (!b.ok) return b;
      db.prepare(`UPDATE loans SET disbursed_amount = ROUND(COALESCE(disbursed_amount, 0) + ?, 2), agreement_file_path = ?,
                         agreement_uploaded_by = ?, agreement_uploaded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(toRupees(topupPaise), text(c.topup.agreementFilePath) || loan.agreement_file_path, g.approver.username, loan.id);
      writeEvent(db, {
        loan, event: 'topup_disbursed', fromState: 'active', toState: 'active', amountPaise: topupPaise, actor: g.approver, field: 'disbursed_amount',
        reason: `${text(c.topup.mode)} ref ${text(c.topup.reference)} [disbursed_on=${c.topup.disbursedOn.slice(0, 10)}]; ${why}`,
      });
    }
    let seq = instalments.reduce((m, i) => Math.max(m, i.sequence), 0);
    const ins = db.prepare(`INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status, origin)
                            VALUES (?, ?, ?, ?, ?, 'scheduled', 'restructure')`);
    for (const i of sched.instalments) ins.run(loan.id, ++seq, i.month, i.year, toRupees(i.amountPaise));
    db.prepare("UPDATE loans SET emi_amount = ?, updated_at = datetime('now') WHERE id = ?").run(toRupees(sched.emiPaise), loan.id);
    writeEvent(db, {
      loan, event: 'restructured', fromState: 'active', toState: 'active', amountPaise: toSchedule, actor: g.approver, field: 'schedule',
      reason: `${newTenure} instalment(s) of ₹${toRupees(sched.emiPaise)} from ${monthLabel(start)}${topupPaise ? `, top-up ₹${toRupees(topupPaise)}` : ''}; ${why}`,
    });
    return {
      ok: true, emi: toRupees(sched.emiPaise), tenure: newTenure, start,
      schedule: sched.instalments.map((i) => ({ month: i.month, year: i.year, amount: toRupees(i.amountPaise) })),
      warnings: verdict.warnings,
    };
  });
}

/**
 * Write-off (D-7, D-15): the WHOLE remaining balance, with a reason, approved
 * by the admin. recover_at_exit → settled_at_exit (coordinator ruling 9 Oct);
 * active → written_off. Refused while an instalment is provisional (wait for the
 * loan close). Listed for TDS by writeOffsForTds().
 */
function writeOffLoan(db, { loanId, reason, requestedBy }, approver) {
  const g = gateChange(requestedBy, approver);
  if (!g.ok) return g;
  if (!text(reason)) return fail('REASON_REQUIRED', 'a reason is required to write off a balance');
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  if (!['active', 'recover_at_exit'].includes(loan.status)) return fail('ILLEGAL_TRANSITION', `loan is ${loan.status}`);
  const instalments = getInstalments(db, loan.id);
  if (instalments.some((i) => i.status === 'provisional')) return fail('WRITE_OFF_PROVISIONAL_PENDING', 'an instalment is in this month\'s Stage 7; write off after the loan close');
  const balance = toPaise(loan.remaining_balance);
  if (balance <= 0) return fail('NOTHING_TO_WRITE_OFF', 'the balance is already ₹0');
  const toState = loan.status === 'recover_at_exit' ? 'settled_at_exit' : 'written_off';
  return inTxn(db, () => {
    const why = `requested by ${g.requester.username}, approved by ${g.approver.username}: ${text(reason)}`;
    for (const i of instalments.filter((x) => x.status === 'scheduled')) {
      db.prepare("UPDATE loan_instalments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(i.id);
      writeEvent(db, { loan, instalmentId: i.id, event: 'instalment_cancelled', fromState: 'scheduled', toState: 'cancelled', amountPaise: toPaise(i.amount_due), actor: g.approver, reason: 'written off', field: 'instalment_status' });
    }
    const r = db.prepare(`UPDATE loans SET status = ?, written_off_amount = ROUND(written_off_amount + ?, 2), written_off_by = ?, written_off_at = datetime('now'),
                                 write_off_reason = ?, remaining_balance = 0, updated_at = datetime('now')
                           WHERE id = ? AND status = ? AND remaining_balance = ?`)
      .run(toState, toRupees(balance), g.approver.username, why, loan.id, loan.status, loan.remaining_balance);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the loan changed underneath');
    writeEvent(db, { loan, event: 'written_off', fromState: loan.status, toState, amountPaise: balance, actor: g.approver, reason: `${why} (reportable for TDS)` });
    return { ok: true, loanId: loan.id, status: toState, writtenOff: toRupees(balance) };
  });
}

module.exports = { deferInstalment, restructureLoan, writeOffLoan };
