// Test-only: PUT /api/employees/bulk-shift and PUT /:code/mark-left as they were on origin/main b2badcab (verbatim
// handlers), used by bulkMasterEdit.test.js to prove the setShift() / markLeft() extraction changed nothing.
// Only the require() paths were adjusted for this folder.
const express = require('express');
const router = express.Router();
const { getDb } = require('../../database/db');
const { requireHrOrAdmin } = require('../../middleware/roles');

router.put('/bulk-shift', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'hr') {
    return res.status(403).json({ success: false, error: 'HR or admin access required' });
  }
  const db = getDb();
  const { employeeCodes, shiftId, shiftCode } = req.body;
  if (!Array.isArray(employeeCodes) || !employeeCodes.length) {
    return res.status(400).json({ success: false, error: 'employeeCodes array required' });
  }
  if (!shiftId) {
    return res.status(400).json({ success: false, error: 'shiftId required' });
  }

  const shift = db.prepare('SELECT id, code FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

  const effectiveShiftCode = shiftCode || shift.code;
  const selectEmp = db.prepare('SELECT id, code, default_shift_id, shift_code FROM employees WHERE code = ?');
  const updateStmt = db.prepare(
    "UPDATE employees SET default_shift_id = ?, shift_code = ?, updated_at = datetime('now') WHERE code = ?"
  );
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let updated = 0;
  const username = req.user?.username || 'unknown';
  const txn = db.transaction(() => {
    for (const code of employeeCodes) {
      const emp = selectEmp.get(code);
      if (!emp) continue;
      const prevCode = emp.shift_code || '';
      updateStmt.run(shift.id, effectiveShiftCode, code);
      updated++;
      try {
        auditStmt.run(
          'employees', emp.id, 'shift_assignment',
          prevCode, effectiveShiftCode,
          username,
          'employee_master',
          `Bulk shift change from ${prevCode || '(none)'} to ${effectiveShiftCode}`,
          code,
          'shift_change'
        );
      } catch (e) { /* audit should not block bulk update */ }
    }
  });
  txn();

  res.json({ success: true, updated });
});

router.put('/:code/mark-left', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { date_of_leaving, reason } = req.body;
  const markedBy = req.user?.username || 'admin';

  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  if (emp.status === 'Left') return res.status(400).json({ success: false, error: 'Employee already marked as Left' });

  const { logAudit } = require('../../database/db');

  // Loans PR-1: the loan block below needs the rebuilt loan schema. If that
  // migration refused (old loan tables not empty), skip the loan block rather
  // than fail Mark Left for everyone; the audit remark records the skip.
  const loansSchemaReady = !!db.prepare(
    "SELECT 1 FROM policy_config WHERE key = 'migration_loans_schema_v2_done' AND value = '1'"
  ).get();

  const { consolidateForExit } = require('../../services/loans/exit');
  const { notifyAlerts } = require('../../services/loans/notify');
  const exitAlerts = [];
  const loanSummary = [];   // Loans PR-7: what each flagged loan now owes (the Mark Left dialog, PR-6b)

  const txn = db.transaction(() => {
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
        `Borrower ${code} marked Left; loan flagged for exit recovery`, req.user?.username);
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
    logAudit('employees', emp.id, 'status', emp.status, 'Left', 'employee_master', `Marked as Left by ${markedBy}. Reason: ${reason || 'Not specified'}. ${loansSchemaReady ? `${exitLoans.length} loan(s) flagged for exit recovery.` : 'loan schema not migrated — loans not flagged.'}`, req.user?.username);
  });

  txn();
  notifyAlerts(db, exitAlerts);   // after the commit, best effort (never throws)
  res.json({ success: true, message: `Employee ${code} marked as Left. ${emp.name} removed from active roster.`, loans: loanSummary });
});

module.exports = router;
