/**
 * Loans engine — exit recovery (Loans PR-7, docs/loans/SPEC.md §5.2 r11, §5.4,
 * D-7, D-15, D-21; K9, K20, K32, K35; planner rulings 10 Oct 2026).
 *
 * When the borrower is marked Left, the WHOLE outstanding falls due in the
 * final monthly payroll — the payroll of the final month F, the month of the
 * loan's own exit date (common.js finalMonthOf). Stage 7 is not changed for
 * this: consolidateForExit puts the outstanding into ONE instalment due in F,
 * and Stage 7 deducts min(that instalment, headroom, balance) as for any loan,
 * still one provisional row keyed loan + month + payroll, loan EMI last.
 *
 * Whatever the final payroll cannot recover is the EXIT RESIDUAL — the
 * reconciliation's "uncovered" amount (balance − open instalments). It is
 * cleared by a numbered cash receipt (finance) or an admin-approved write-off;
 * at ₹0 the loan is Settled at exit automatically (common.js autoComplete).
 * Nothing is ever placed after F, and exit loans never use the 3-month
 * shortfall extension (D-19): see common.js appendInstalment's exit branch.
 */
const { toPaise, toRupees } = require('./money');
const { compareMonth, monthLabel } = require('./months');
const { writeEvent } = require('./events');
const {
  getLoan, getInstalments, inTxn, finalMonthOf, isFinalMonthPast, exitResidualPaise, exitResidualAlert,
} = require('./common');

const isOpen = (i) => i.status === 'scheduled' || i.status === 'provisional';
const monthOf = (i) => ({ month: i.due_month, year: i.due_year });

function cancel(db, loan, ins, actor, reason) {
  db.prepare("UPDATE loan_instalments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(ins.id);
  writeEvent(db, { loan, instalmentId: ins.id, event: 'instalment_cancelled', fromState: 'scheduled', toState: 'cancelled', amountPaise: toPaise(ins.amount_due), actor, reason, field: 'instalment_status' });
}

/**
 * Collapses a recover_at_exit loan's schedule into its final month. Called by
 * Mark Left (employees.js) and flagForExit, inside their transaction.
 *
 *  F still open: every SCHEDULED instalment due after F is cancelled; one open
 *    instalment in F (the provisional one if Stage 7 already ran, else the
 *    lowest sequence; any other scheduled one in F is cancelled) holds
 *    target = balance − Σ open instalments that stay where they are (due before
 *    F, or provisional after F). No open instalment in F → a new one, origin
 *    'exit'. Any "uncovered" amount (extension limit) is folded in. Amounts are
 *    conserved, so the reconciliation is unchanged.
 *  F past (Mark Left after the final month's close): every scheduled
 *    instalment due after F is cancelled; the amount stays in the balance as
 *    the exit residual and finance is alerted.
 *
 * Idempotent: a second call with nothing to change writes nothing.
 * @param {{username:string}|string} actor
 * @returns {{ok:true, changed:boolean, finalMonth, finalMonthPast:boolean, dueInFinalPayroll:number, residual:number, cancelled:number, alerts:Array}}
 */
function consolidateForExit(db, loanId, actor) {
  const loan = getLoan(db, loanId);
  const base = { ok: true, changed: false, finalMonth: null, finalMonthPast: false, dueInFinalPayroll: 0, residual: 0, cancelled: 0, alerts: [] };
  if (!loan || loan.status !== 'recover_at_exit') return base;
  const F = finalMonthOf(loan);
  const past = isFinalMonthPast(db, loan);
  return inTxn(db, () => {
    const all = getInstalments(db, loan.id);
    const label = monthLabel(F);
    let cancelled = 0;
    let movedPaise = 0;
    if (past) {
      for (const i of all.filter((x) => x.status === 'scheduled' && compareMonth(monthOf(x), F) > 0)) {
        cancel(db, loan, i, actor, `exit: the final payroll ${label} is closed — amount stays in the balance as exit residual`);
        cancelled += 1; movedPaise += toPaise(i.amount_due);
      }
      const residual = exitResidualPaise(db, loan.id);
      if (cancelled) {
        writeEvent(db, {
          loan, event: 'exit_consolidated', fromState: loan.status, toState: loan.status, amountPaise: movedPaise, actor, field: 'schedule',
          reason: `final payroll ${label} already closed: ${cancelled} instalment(s) cancelled; exit residual ₹${toRupees(residual)}`,
        });
      }
      const alerts = residual > 0 ? [exitResidualAlert(db, loan, { amountPaise: movedPaise || residual, origin: 'exit' })] : [];
      return { ...base, changed: cancelled > 0, finalMonth: F, finalMonthPast: true, residual: toRupees(residual), cancelled, alerts };
    }

    const inF = all.filter((i) => isOpen(i) && compareMonth(monthOf(i), F) === 0)
      .sort((a, b) => (a.status === 'provisional' ? 0 : 1) - (b.status === 'provisional' ? 0 : 1) || a.sequence - b.sequence);
    const keeper = inF[0] || null;
    const toCancel = all.filter((i) => i.status === 'scheduled' && i !== keeper && compareMonth(monthOf(i), F) >= 0);
    const staysPaise = all.filter((i) => isOpen(i) && i !== keeper && !toCancel.includes(i)).reduce((s, i) => s + toPaise(i.amount_due), 0);
    const targetPaise = Math.max(0, toPaise(loan.remaining_balance) - staysPaise);

    for (const i of toCancel) {
      cancel(db, loan, i, actor, `exit: falls due in the final payroll ${label}`);
      cancelled += 1; movedPaise += toPaise(i.amount_due);
    }
    let changed = cancelled > 0;
    if (keeper) {
      if (toPaise(keeper.amount_due) !== targetPaise) {
        db.prepare("UPDATE loan_instalments SET amount_due = ?, updated_at = datetime('now') WHERE id = ?").run(toRupees(targetPaise), keeper.id);
        writeEvent(db, {
          loan, instalmentId: keeper.id, event: 'instalment_increased', fromState: keeper.status, toState: keeper.status,
          amountPaise: targetPaise - toPaise(keeper.amount_due), actor, field: 'amount_due',
          reason: `exit: the whole outstanding falls due in the final payroll ${label} (₹${keeper.amount_due} → ₹${toRupees(targetPaise)})`,
        });
        changed = true;
      }
    } else if (targetPaise > 0) {
      const sequence = all.reduce((m, i) => Math.max(m, i.sequence), 0) + 1;
      const info = db.prepare(`INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status, origin)
                               VALUES (?, ?, ?, ?, ?, 'scheduled', 'exit')`).run(loan.id, sequence, F.month, F.year, toRupees(targetPaise));
      writeEvent(db, {
        loan, instalmentId: info.lastInsertRowid, event: 'instalment_added', fromState: null, toState: 'scheduled', amountPaise: targetPaise, actor, field: 'schedule',
        reason: `exit: the whole outstanding falls due in the final payroll ${label}`,
      });
      changed = true;
    }
    if (changed) {
      writeEvent(db, {
        loan, event: 'exit_consolidated', fromState: loan.status, toState: loan.status, amountPaise: targetPaise, actor, field: 'schedule',
        reason: `₹${toRupees(targetPaise)} falls due in the final payroll ${label}; ${cancelled} later instalment(s) cancelled`,
      });
    }
    return { ...base, changed, finalMonth: F, finalMonthPast: false, dueInFinalPayroll: toRupees(targetPaise), residual: toRupees(exitResidualPaise(db, loan.id)), cancelled };
  });
}

/** recover_at_exit loans of a payroll whose final month is m. */
function exitLoansForMonth(db, payroll, m) {
  return db.prepare("SELECT * FROM loans WHERE borrower_type = ? AND status = 'recover_at_exit' ORDER BY id").all(payroll)
    .filter((l) => compareMonth(finalMonthOf(l), m) === 0);
}

/** Σ provisional deductions of a loan (paise): a held salary waiting to post. */
function heldPendingPaise(db, loanId) {
  return db.prepare("SELECT amount FROM loan_deductions WHERE loan_id = ? AND state = 'provisional'").all(loanId)
    .reduce((s, r) => s + toPaise(r.amount), 0);
}

/**
 * Close readiness (non-blocking, planner ruling): exit loans whose final payroll
 * is month m and whose final-month deduction is below the outstanding due in
 * it. `computedBeforeExit`: Stage 7 for m last wrote the row before the
 * borrower was marked Left — re-run Stage 7 for the employee before the close
 * if the final salary has not been paid yet.
 */
function exitFinalPayrollWarnings(db, payroll, m) {
  const out = [];
  for (const loan of exitLoansForMonth(db, payroll, m)) {
    const ins = db.prepare(`SELECT * FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ? AND status IN ('scheduled','provisional')
                             ORDER BY CASE status WHEN 'provisional' THEN 0 ELSE 1 END, sequence LIMIT 1`).get(loan.id, m.month, m.year);
    if (!ins) continue;
    const ded = db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ? AND state = 'provisional'")
      .get(loan.id, m.month, m.year, payroll);
    const deducted = ded ? toPaise(ded.amount) : 0;
    const due = toPaise(ins.amount_due);
    if (deducted >= due) continue;
    const computedBeforeExit = !!(ded && loan.exit_flagged_at && String(ded.updated_at) < String(loan.exit_flagged_at));
    out.push({
      code: 'EXIT_FINAL_PAYROLL_SHORT', loanId: loan.id, employeeCode: loan.employee_code, finalMonth: m,
      deducted: toRupees(deducted), dueInFinalPayroll: toRupees(due), expectedResidual: toRupees(due - deducted), computedBeforeExit,
      message: `${loan.employee_code} loan ${loan.id}: the final payroll ${monthLabel(m)} recovers ₹${toRupees(deducted)} of ₹${toRupees(due)}; ₹${toRupees(due - deducted)} will be an exit residual`
        + (computedBeforeExit ? ` — Stage 7 for ${monthLabel(m)} ran before the borrower was marked Left: re-run Stage 7 for ${loan.employee_code} before the close if the final salary has not been paid yet` : ''),
    });
  }
  return out;
}

/**
 * Finance's exit list (GET /api/loans/exit-residuals).
 *  residuals: recover_at_exit, final payroll past, balance > 0 — residual
 *    (receipt / write-off) and heldPending (a held final salary still waiting
 *    for release or the D-14 days); stage 'held_pending' while anything is held.
 *  awaitingFinalPayroll: recover_at_exit, final payroll still open.
 * @param {{companies?: string[]|null}} opts
 */
function listExitResiduals(db, { companies = null } = {}) {
  const loans = db.prepare("SELECT * FROM loans WHERE status = 'recover_at_exit' ORDER BY company, employee_code, id").all()
    .filter((l) => !companies || companies.includes(l.company));
  const nameOf = db.prepare('SELECT name, department FROM employees WHERE code = ?');
  const pending = db.prepare("SELECT kind FROM loan_requests WHERE loan_id = ? AND status = 'pending'");
  const out = { residuals: [], awaitingFinalPayroll: [] };
  for (const l of loans) {
    const who = l.borrower_type === 'plant' ? (nameOf.get(l.employee_code) || {}) : {};
    const F = finalMonthOf(l);
    const balance = toPaise(l.remaining_balance);
    const row = {
      loanId: l.id, borrowerType: l.borrower_type, employeeCode: l.employee_code, employeeName: who.name || null, department: who.department || null,
      company: l.company, loanType: l.loan_type, exitDate: l.exit_date || null, finalMonth: F, balance: toRupees(balance),
      pendingRequest: (pending.get(l.id) || {}).kind || null,
    };
    if (isFinalMonthPast(db, l)) {
      if (balance <= 0) continue;
      const held = heldPendingPaise(db, l.id);
      out.residuals.push({ ...row, residual: toRupees(exitResidualPaise(db, l.id)), heldPending: toRupees(held), stage: held > 0 ? 'held_pending' : 'residual' });
    } else {
      const ins = db.prepare(`SELECT COALESCE(SUM(amount_due), 0) AS v FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ?
                                AND status IN ('scheduled','provisional')`).get(l.id, F.month, F.year).v;
      out.awaitingFinalPayroll.push({ ...row, dueInFinalPayroll: toRupees(toPaise(ins)), residual: toRupees(exitResidualPaise(db, l.id)) });
    }
  }
  return out;
}

module.exports = {
  listExitResiduals,
  consolidateForExit, finalMonthOf, isFinalMonthPast, exitLoansForMonth, heldPendingPaise, exitFinalPayrollWarnings,
};
