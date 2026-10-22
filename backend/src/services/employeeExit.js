/**
 * P5-02: Mark Left, as one function. Moved verbatim from PUT /api/employees/:code/mark-left (employees.js) so the
 * single route and the bulk master-edit kind ("exit" rows, finance-approved) run the SAME code. Extracted, not copied:
 * bulkMasterEdit.test.js compares the route against the verbatim b2badcab handler on twin databases.
 *
 * markLeft runs NO transaction of its own — the caller wraps it (the route in db.transaction, the bulk kind inside
 * the engine's IMMEDIATE approve transaction). Loan alerts are RETURNED; the caller sends them with notifyAlerts.
 *
 * @param {object} db
 * @param {object} emp      the employees row read before the call (SELECT *)
 * @param {object} p        { date_of_leaving, reason, markedBy, username }
 *                          markedBy = who the loan rows name (route: req.user?.username || 'admin');
 *                          username = logAudit's changed_by (route: req.user?.username, may be undefined)
 * @returns {{ exitDate: string, loanSummary: object[], exitAlerts: object[], loansSchemaReady: boolean, flaggedLoans: number }}
 */
const { logAudit } = require('../database/db');

function markLeft(db, emp, { date_of_leaving, reason, markedBy, username }) {
  const code = emp.code;

  // Loans PR-1: the loan block below needs the rebuilt loan schema. If that
  // migration refused (old loan tables not empty), skip the loan block rather
  // than fail Mark Left for everyone; the audit remark records the skip.
  const loansSchemaReady = !!db.prepare(
    "SELECT 1 FROM policy_config WHERE key = 'migration_loans_schema_v2_done' AND value = '1'"
  ).get();

  const { consolidateForExit } = require('./loans/exit');
  const exitAlerts = [];
  const loanSummary = [];   // Loans PR-7: what each flagged loan now owes (the Mark Left dialog, PR-6b)

  // 1. Set status = 'Left', is_active = 0, date_of_exit
  // Also set inactive_since (for reactivation cutoff) and auto_inactive = 0
  // so the import auto-detector treats this as a MANUAL mark, not a system guess.
  const exitDate = date_of_leaving || new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE employees SET
      status = 'Left',
      is_data_complete = 0,
      date_of_exit = ?,
      exit_reason = ?,
      inactive_since = ?,
      auto_inactive = 0,
      updated_at = datetime('now')
    WHERE code = ?`)
    .run(exitDate, reason || '', exitDate, code);

  // 2. Flag the leaver's open plant loans for exit recovery (Loans PR-1, SPEC §5.2
  //    rule 11). Nothing is closed or written off and no balance moves: an
  //    active loan becomes recover_at_exit (its schedule collapses into the
  //    final month, Loans PR-7, below); a requested / approved
  //    loan keeps its status and only gets the exit flag (the admin decides it).
  //    The flag lives on the loan, so a later Stage 6 reactivation cannot undo
  //    it. borrower_type = 'plant' keeps a sales loan with the same code untouched.
  const exitLoans = loansSchemaReady ? db.prepare(`
    SELECT id, status, remaining_balance FROM loans
     WHERE borrower_type = 'plant' AND employee_code = ?
       AND status IN ('requested', 'approved', 'active') AND exit_flag = 0
  `).all(code) : [];
  if (!loansSchemaReady) {
    console.warn(`[mark-left] ${code}: loan schema not migrated (migration_loans_schema_v2_done unset) — loans not flagged`);
  }
  for (const loan of exitLoans) {
    const toState = loan.status === 'active' ? 'recover_at_exit' : loan.status;
    db.prepare(`
      UPDATE loans SET status = ?, exit_flag = 1, exit_flagged_at = datetime('now'),
             exit_flagged_by = ?, exit_date = ?, updated_at = datetime('now')
       WHERE id = ? AND status = ? AND exit_flag = 0
    `).run(toState, markedBy, exitDate, loan.id, loan.status);
    db.prepare(`
      INSERT INTO loan_events (loan_id, event, from_state, to_state, amount, actor, reason)
      VALUES (?, 'borrower_left', ?, ?, ?, ?, ?)
    `).run(loan.id, loan.status, toState, loan.remaining_balance, markedBy,
      `Marked Left (exit ${exitDate}). ${reason || 'No reason given'}`);
    logAudit('loans', loan.id, 'status', loan.status, toState, 'loan_exit',
      `Borrower ${code} marked Left; loan flagged for exit recovery`, username);
    // Loans PR-7: the whole outstanding falls due in the final payroll (the
    // month of the exit date); if that month's loan close has already run,
    // the outstanding is the exit residual (receipt or write-off) at once.
    const exit = toState === 'recover_at_exit' ? consolidateForExit(db, loan.id, { username: markedBy }) : null;
    if (exit) exitAlerts.push(...exit.alerts);
    loanSummary.push({
      loanId: loan.id, status: toState, outstanding: toState === 'recover_at_exit' ? loan.remaining_balance : 0,
      finalMonth: exit ? exit.finalMonth : null, finalMonthPast: exit ? exit.finalMonthPast : null,
      dueInFinalPayroll: exit ? exit.dueInFinalPayroll : 0, residual: exit ? exit.residual : 0,
    });
  }

  // 3. Audit log
  logAudit('employees', emp.id, 'status', emp.status, 'Left', 'employee_master', `Marked as Left by ${markedBy}. Reason: ${reason || 'Not specified'}. ${loansSchemaReady ? `${exitLoans.length} loan(s) flagged for exit recovery.` : 'loan schema not migrated — loans not flagged.'}`, username);

  return { exitDate, loanSummary, exitAlerts, loansSchemaReady, flaggedLoans: exitLoans.length };
}

module.exports = { markLeft };
