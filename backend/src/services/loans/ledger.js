/**
 * Loans engine — ledger building blocks (Loans PR-2, docs/loans/SPEC.md §5.1,
 * §5.2 r4–r8, D-5, D-19; coordinator ruling 1, 9 Oct 2026).
 *
 * BUILDING BLOCKS ONLY. PR-5 (Stage 7) and PR-6 (loan close, held sweep, cron)
 * own the loops, the salary reads, the loan_closes rows and notifications; they
 * call these functions per loan. Nothing here reads or writes a salary table.
 *
 *  recordProvisional   Stage 7 writes this month's deduction (one row per
 *                      loan + month + year + payroll; a re-run updates it, so
 *                      two runs give identical rows — the D1 fix shape)
 *  clearProvisional    Stage 7 re-run that no longer deducts (skipped employee,
 *                      K29) → the row becomes `reversed`, instalment back to scheduled
 *  postDeduction       the loan close: amount frozen, balance falls, a short
 *                      post adds the shortfall as a new last instalment (D-5)
 *  moveInstalmentToEnd no salary this month / held past the wait (K5, K6)
 *
 * The one rule (§5.1): only postDeduction (and receipts / write-offs) move a balance.
 */
const { parseAmount, toPaise, toRupees } = require('./money');
const { isValidMonth } = require('./months');
const { checkActor, LIVE_LOAN_STATES } = require('./states');
const { writeEvent } = require('./events');
const { fail, text, getLoan, inTxn, appendInstalment, moveBalance, autoComplete } = require('./common');

function getInstalment(db, id) {
  return db.prepare('SELECT * FROM loan_instalments WHERE id = ?').get(id) || null;
}

/**
 * @param {object} d {loanId, instalmentId, payroll, month, year, company, amount, runId}
 */
function recordProvisional(db, d, actor) {
  const gate = checkActor('post', actor);
  if (!gate.ok) return gate;
  const loan = getLoan(db, d.loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${d.loanId} not found`);
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}`);
  if (d.payroll !== loan.borrower_type) return fail('PAYROLL_MISMATCH', `a ${loan.borrower_type} loan is deducted only in the ${loan.borrower_type} payroll`);
  if (!isValidMonth({ month: d.month, year: d.year })) return fail('MONTH_INVALID', 'month/year invalid');
  const amt = parseAmount(d.amount, { allowZero: true, field: 'deduction' });
  if (!amt.ok) return amt;
  const ins = getInstalment(db, d.instalmentId);
  if (!ins || ins.loan_id !== loan.id) return fail('INSTALMENT_NOT_FOUND', 'instalment does not belong to this loan');
  if (amt.paise > toPaise(ins.amount_due)) return fail('DEDUCTION_ABOVE_DUE', `deduction ₹${toRupees(amt.paise)} is above the instalment due ₹${ins.amount_due}`);

  return inTxn(db, () => {
    const existing = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ?')
      .get(loan.id, d.month, d.year, d.payroll);
    if (existing && existing.state === 'posted') {
      return fail('POSTED_FROZEN', `month ${d.month}/${d.year} is already posted (₹${existing.amount}); a re-run must deduct exactly that`, { postedAmount: existing.amount, deductionId: existing.id });
    }
    if (!(ins.status === 'scheduled' || (ins.status === 'provisional' && existing && existing.instalment_id === ins.id))) {
      return fail('INSTALMENT_NOT_OPEN', `instalment ${ins.sequence} is ${ins.status}`);
    }
    // Same row, same values → nothing to do (idempotent re-run, no event).
    if (existing && existing.state === 'provisional' && existing.instalment_id === ins.id
        && toPaise(existing.amount) === amt.paise && (existing.company || null) === (text(d.company) || null)) {
      if (d.runId && existing.run_id !== d.runId) {
        db.prepare("UPDATE loan_deductions SET run_id = ?, updated_at = datetime('now') WHERE id = ?").run(d.runId, existing.id);
      }
      return { ok: true, deductionId: existing.id, changed: false, amount: toRupees(amt.paise) };
    }
    // The row moved to another instalment: put the old one back to scheduled.
    if (existing && existing.instalment_id && existing.instalment_id !== ins.id) {
      const prev = getInstalment(db, existing.instalment_id);
      if (prev && prev.status === 'provisional') {
        db.prepare("UPDATE loan_instalments SET status = 'scheduled', updated_at = datetime('now') WHERE id = ? AND status = 'provisional'").run(prev.id);
        writeEvent(db, { loan, instalmentId: prev.id, event: 'provisional_cleared', fromState: 'provisional', toState: 'scheduled', amountPaise: toPaise(prev.amount_due), actor: gate.actor, reason: 'deduction moved to another instalment', field: 'instalment_status' });
      }
    }
    let deductionId;
    if (existing) {
      db.prepare(`UPDATE loan_deductions SET instalment_id = ?, company = ?, employee_code = ?, amount = ?, state = 'provisional',
                         run_id = ?, reversed_at = NULL, reversed_by = NULL, reversal_reason = NULL, updated_at = datetime('now')
                   WHERE id = ? AND state != 'posted'`)
        .run(ins.id, text(d.company) || null, loan.employee_code, toRupees(amt.paise), d.runId || null, existing.id);
      deductionId = existing.id;
    } else {
      deductionId = db.prepare(`INSERT INTO loan_deductions (loan_id, instalment_id, payroll, month, year, company, employee_code, amount, state, run_id)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisional', ?)`)
        .run(loan.id, ins.id, d.payroll, d.month, d.year, text(d.company) || null, loan.employee_code, toRupees(amt.paise), d.runId || null).lastInsertRowid;
    }
    if (ins.status === 'scheduled') {
      db.prepare("UPDATE loan_instalments SET status = 'provisional', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(ins.id);
    }
    writeEvent(db, {
      loan, instalmentId: ins.id, event: existing ? 'provisional_updated' : 'provisional_recorded',
      fromState: existing ? existing.state : ins.status, toState: 'provisional', amountPaise: amt.paise, actor: gate.actor,
      reason: `${d.payroll} ${d.month}/${d.year}${existing ? ` (was ₹${existing.amount}, ${existing.state})` : ''}`, field: 'deduction',
    });
    return { ok: true, deductionId, changed: true, amount: toRupees(amt.paise) };
  });
}

/** A provisional row superseded before the close (PR-1 ruling: the only meaning of `reversed`). */
function clearProvisional(db, { loanId, month, year, payroll, reason }, actor) {
  const gate = checkActor('post', actor);
  if (!gate.ok) return gate;
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  return inTxn(db, () => {
    const row = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ?').get(loanId, month, year, payroll);
    if (!row || row.state === 'reversed') return { ok: true, changed: false };
    if (row.state === 'posted') return fail('POSTED_FROZEN', 'a posted deduction is never cleared; its correction is an opposite entry (PR-6)');
    reverseProvisionalRow(db, loan, row, gate.actor, reason || 'superseded by a Stage 7 re-run');
    return { ok: true, changed: true, deductionId: row.id };
  });
}

function reverseProvisionalRow(db, loan, row, actor, reason) {
  db.prepare(`UPDATE loan_deductions SET state = 'reversed', reversed_at = datetime('now'), reversed_by = ?, reversal_reason = ?, updated_at = datetime('now')
               WHERE id = ? AND state = 'provisional'`).run(actor.username, reason, row.id);
  const ins = row.instalment_id ? getInstalment(db, row.instalment_id) : null;
  if (ins && ins.status === 'provisional') {
    db.prepare("UPDATE loan_instalments SET status = 'scheduled', updated_at = datetime('now') WHERE id = ? AND status = 'provisional'").run(ins.id);
  }
  writeEvent(db, { loan, instalmentId: row.instalment_id, event: 'provisional_reversed', fromState: 'provisional', toState: 'reversed', amountPaise: toPaise(row.amount), actor, reason, field: 'deduction' });
}

/**
 * The loan close posts one provisional deduction (§5.2 r6). The instalment
 * becomes posted with its amount frozen and the balance falls by exactly that
 * amount. If less than the instalment was deducted (D-5):
 *   0 < amount < due → instalment posted (partial) + new last instalment for the rest
 *   amount = 0       → instalment deferred + new last instalment for the whole due
 * both with origin `shortfall`, subject to the extension limit (D-19).
 * @returns {{ok, posted, shortfall, added, alerts, loanStatus}}
 */
function postDeduction(db, { deductionId, closeId = null }, actor) {
  const gate = checkActor('post', actor);
  if (!gate.ok) return gate;
  const row = db.prepare('SELECT * FROM loan_deductions WHERE id = ?').get(deductionId);
  if (!row) return fail('DEDUCTION_NOT_FOUND', `deduction ${deductionId} not found`);
  if (row.state !== 'provisional') return fail('DEDUCTION_NOT_PROVISIONAL', `deduction is ${row.state}`);
  const loan = getLoan(db, row.loan_id);
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}`);
  const ins = row.instalment_id ? getInstalment(db, row.instalment_id) : null;
  if (!ins || ins.status !== 'provisional') return fail('INSTALMENT_NOT_PROVISIONAL', 'the deduction\'s instalment is not provisional');
  const amount = toPaise(row.amount);
  const due = toPaise(ins.amount_due);
  if (amount > due) return fail('DEDUCTION_ABOVE_DUE', 'deduction is above the instalment due');
  if (amount > toPaise(loan.remaining_balance)) return fail('BALANCE_NEGATIVE', 'deduction is above the remaining balance');

  return inTxn(db, () => {
    const d = db.prepare(`UPDATE loan_deductions SET state = 'posted', posted_at = datetime('now'), posted_close_id = ?, updated_at = datetime('now')
                           WHERE id = ? AND state = 'provisional'`).run(closeId, row.id);
    if (d.changes !== 1) return fail('CONCURRENT_CHANGE', 'the deduction changed underneath');
    const insTo = amount > 0 ? 'posted' : 'deferred';
    const i = db.prepare(`UPDATE loan_instalments SET status = ?, posted_amount = ?, posted_at = CASE WHEN ? = 'posted' THEN datetime('now') END,
                                 posted_close_id = ?, updated_at = datetime('now')
                           WHERE id = ? AND status = 'provisional'`).run(insTo, toRupees(amount), insTo, closeId, ins.id);
    if (i.changes !== 1) return fail('CONCURRENT_CHANGE', 'the instalment changed underneath');
    if (amount > 0) {
      const b = moveBalance(db, loan, -amount);
      if (!b.ok) return b;
    }
    writeEvent(db, {
      loan, instalmentId: ins.id, event: 'posted', fromState: 'provisional', toState: insTo, amountPaise: amount, actor: gate.actor,
      reason: `${row.payroll} ${row.month}/${row.year}${closeId ? ` close #${closeId}` : ''}; due ₹${toRupees(due)}`, field: 'instalment_status',
    });
    const alerts = [];
    let added = null;
    if (amount < due) {
      const a = appendInstalment(db, loan, { amountPaise: due - amount, origin: 'shortfall', sourceInstalmentId: ins.id, actor: gate.actor, reason: `${row.month}/${row.year} short by ₹${toRupees(due - amount)}` });
      added = a.added;
      if (a.alert) alerts.push(a.alert);
    }
    const completed = autoComplete(db, loan.id, gate.actor);
    return { ok: true, posted: toRupees(amount), shortfall: toRupees(due - amount), added, alerts, loanStatus: completed || getLoan(db, loan.id).status };
  });
}

/**
 * Moves one unposted instalment to the end without approval, for the system
 * reasons of SPEC §5.2 r6/r8: `no_salary` (no salary row in a computed payroll)
 * or `held` (still held the set days after close). A provisional deduction on it
 * is reversed and returned in staleDeductions (the salary row is then stale, K28).
 */
/**
 * reversal_reason of a provisional row reversed because its instalment, held
 * past the wait, moved to the end. It is the loan-side "salary row stale"
 * marker (Loans PR-6, K28): the salary row still shows the amount until Stage 7
 * is re-run, and the hold-release guard reads it (close.js loanHoldReleaseCheck).
 */
const HELD_MOVE_REVERSAL_REASON = 'instalment moved to the end (held)';

function moveInstalmentToEnd(db, { instalmentId, reason, note = null }, actor) {
  const gate = checkActor('post', actor);
  if (!gate.ok) return gate;
  if (!['no_salary', 'held'].includes(reason)) return fail('REASON_INVALID', 'reason must be no_salary or held');
  const ins = getInstalment(db, instalmentId);
  if (!ins) return fail('INSTALMENT_NOT_FOUND', `instalment ${instalmentId} not found`);
  const loan = getLoan(db, ins.loan_id);
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}`);
  if (!['scheduled', 'provisional'].includes(ins.status)) return fail('INSTALMENT_NOT_OPEN', `instalment is ${ins.status}`);
  return inTxn(db, () => {
    const stale = [];
    if (ins.status === 'provisional') {
      for (const row of db.prepare("SELECT * FROM loan_deductions WHERE instalment_id = ? AND state = 'provisional'").all(ins.id)) {
        reverseProvisionalRow(db, loan, row, gate.actor, reason === 'held' ? HELD_MOVE_REVERSAL_REASON : `instalment moved to the end (${reason})`);
        stale.push({ deductionId: row.id, payroll: row.payroll, month: row.month, year: row.year, employeeCode: row.employee_code, company: row.company });
      }
    }
    const r = db.prepare("UPDATE loan_instalments SET status = 'deferred', updated_at = datetime('now') WHERE id = ? AND status IN ('scheduled','provisional')").run(ins.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the instalment changed underneath');
    writeEvent(db, { loan, instalmentId: ins.id, event: 'moved_to_end', fromState: ins.status, toState: 'deferred', amountPaise: toPaise(ins.amount_due), actor: gate.actor, reason: note ? `${reason}: ${note}` : reason, field: 'instalment_status' });
    const a = appendInstalment(db, loan, { amountPaise: toPaise(ins.amount_due), origin: reason, sourceInstalmentId: ins.id, actor: gate.actor, reason: `${ins.due_month}/${ins.due_year}` });
    return { ok: true, added: a.added, alerts: a.alert ? [a.alert] : [], staleDeductions: stale };
  });
}

module.exports = { recordProvisional, clearProvisional, postDeduction, moveInstalmentToEnd, getInstalment, HELD_MOVE_REVERSAL_REASON };
