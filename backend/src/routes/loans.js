const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const {
  LOAN_TYPES, createLoan, approveLoan, getLoans, getLoanDetails,
  getEmployeeLoans, getPendingDeductions, getLoanStats
} = require('../services/loanService');

/**
 * GET /api/loans
 * List all loans with optional filters
 */
router.get('/', (req, res) => {
  const db = getDb();
  const { status, employeeCode } = req.query;
  const loans = getLoans(db, { status, employeeCode });
  const stats = getLoanStats(db);
  res.json({ success: true, data: loans, stats });
});

/**
 * GET /api/loans/types
 * Get available loan types
 */
router.get('/types', (req, res) => {
  res.json({ success: true, data: LOAN_TYPES });
});

/**
 * GET /api/loans/stats
 * Get loan summary statistics
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = getLoanStats(db);
  res.json({ success: true, data: stats });
});

/**
 * GET /api/loans/deductions
 * Get pending deductions for a month
 */
router.get('/deductions', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
  const deductions = getPendingDeductions(db, parseInt(month), parseInt(year));
  const totalAmount = deductions.reduce((s, d) => s + d.emi_amount, 0);
  res.json({ success: true, data: deductions, totalAmount: Math.round(totalAmount * 100) / 100 });
});

/**
 * POST /api/loans
 * Create a new loan
 */
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const loan = createLoan(db, req.body);
    res.json({ success: true, data: loan, message: 'Loan created successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/loans/monthly-recovery/:month/:year
 * All installments due for a given month/year with employee details
 */
router.get('/monthly-recovery/:month/:year', (req, res) => {
  const db = getDb();
  const month = parseInt(req.params.month);
  const year = parseInt(req.params.year);

  const repayments = db.prepare(`
    SELECT lr.*, l.loan_type, l.principal_amount, l.emi_amount as loan_emi,
           l.status as loan_status, e.name as employee_name, e.department, e.designation
    FROM loan_repayments lr
    JOIN loans l ON lr.loan_id = l.id
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE lr.month = ? AND lr.year = ? AND lr.status = 'Pending'
    AND l.status = 'Active'
    ORDER BY e.department, e.name
  `).all(month, year);

  const totalAmount = repayments.reduce((s, r) => s + r.emi_amount, 0);
  res.json({ success: true, data: repayments, totalAmount: Math.round(totalAmount * 100) / 100 });
});

/**
 * GET /api/loans/:id
 * Get loan details with repayment schedule
 */
router.get('/:id', (req, res) => {
  const db = getDb();
  const loan = getLoanDetails(db, parseInt(req.params.id));
  if (!loan) return res.status(404).json({ success: false, error: 'Loan not found' });
  res.json({ success: true, data: loan });
});

/**
 * PUT /api/loans/:id/approve
 * Approve a loan and generate repayment schedule
 */
router.put('/:id/approve', (req, res) => {
  try {
    const db = getDb();
    const { startMonth, startYear } = req.body;
    const approvedBy = req.user?.username || 'admin';
    const result = approveLoan(db, parseInt(req.params.id), approvedBy, startMonth, startYear);
    res.json({ success: true, data: result, message: 'Loan approved and schedule generated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/loans/:id/reject
 * Reject a loan
 */
router.put('/:id/reject', (req, res) => {
  const db = getDb();
  const { reason } = req.body;
  db.prepare(`
    UPDATE loans SET status = 'Rejected', remarks = COALESCE(remarks, '') || ' | Rejected: ' || ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'Pending'
  `).run(reason || 'No reason', req.params.id);
  res.json({ success: true, message: 'Loan rejected' });
});

/**
 * PUT /api/loans/:id/close
 * Close a loan (early closure or write-off)
 */
router.put('/:id/close', (req, res) => {
  const db = getDb();
  const { reason } = req.body;

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE loans SET status = 'Closed', remaining_balance = 0,
        remarks = COALESCE(remarks, '') || ' | Closed: ' || ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reason || 'Manual closure', req.params.id);

    // Cancel remaining pending repayments
    db.prepare(`
      UPDATE loan_repayments SET status = 'Cancelled'
      WHERE loan_id = ? AND status = 'Pending'
    `).run(req.params.id);
  });
  txn();

  res.json({ success: true, message: 'Loan closed' });
});

/**
 * GET /api/loans/employee/:code
 * Get all loans for an employee
 */
router.get('/employee/:code', (req, res) => {
  const db = getDb();
  const loans = getEmployeeLoans(db, req.params.code);
  res.json({ success: true, data: loans });
});

/**
 * POST /api/loans/process-deductions
 * Batch process monthly deductions (marks repayments as deducted)
 */
router.post('/process-deductions', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const pending = getPendingDeductions(db, parseInt(month), parseInt(year));

  const txn = db.transaction(() => {
    for (const rep of pending) {
      // Mark repayment as deducted
      db.prepare(`
        UPDATE loan_repayments SET deducted_from_salary = 1, deduction_date = datetime('now'), status = 'Deducted'
        WHERE id = ?
      `).run(rep.id);

      // Update loan totals
      db.prepare(`
        UPDATE loans SET
          total_recovered = total_recovered + ?,
          remaining_balance = remaining_balance - ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(rep.emi_amount, rep.principal_component, rep.loan_id);

      // Check if loan is fully repaid
      const remaining = db.prepare(`
        SELECT COUNT(*) as count FROM loan_repayments
        WHERE loan_id = ? AND status = 'Pending'
      `).get(rep.loan_id);

      if (remaining.count === 0) {
        db.prepare(`
          UPDATE loans SET status = 'Completed', remaining_balance = 0, updated_at = datetime('now')
          WHERE id = ?
        `).run(rep.loan_id);
      }
    }
  });
  txn();

  res.json({
    success: true,
    processed: pending.length,
    totalDeducted: Math.round(pending.reduce((s, p) => s + p.emi_amount, 0) * 100) / 100,
    message: `${pending.length} loan deductions processed`
  });
});

/**
 * POST /api/loans/:id/recover
 * Record manual recovery for a loan installment
 * Body: { amount, month, year, remarks }
 */
router.post('/:id/recover', (req, res) => {
  try {
    const db = getDb();
    const loanId = parseInt(req.params.id);
    const { amount, month, year, remarks } = req.body;

    if (!amount || !month || !year) {
      return res.status(400).json({ success: false, error: 'amount, month and year are required' });
    }

    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
    if (!loan) return res.status(404).json({ success: false, error: 'Loan not found' });

    const txn = db.transaction(() => {
      // Find the pending repayment for that month/year, or create one
      let repayment = db.prepare(`
        SELECT * FROM loan_repayments
        WHERE loan_id = ? AND month = ? AND year = ? AND status = 'Pending'
      `).get(loanId, month, year);

      if (!repayment) {
        // Create an ad-hoc repayment entry
        const insertResult = db.prepare(`
          INSERT INTO loan_repayments (loan_id, employee_code, month, year, emi_amount, principal_component, interest_component, status)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'Pending')
        `).run(loanId, loan.employee_code, month, year, amount, amount);
        repayment = { id: insertResult.lastInsertRowid };
      }

      // Update repayment: mark as Recovered
      db.prepare(`
        UPDATE loan_repayments
        SET amount_recovered = ?, status = 'Recovered', recovery_date = datetime('now'),
            remarks = ?
        WHERE id = ?
      `).run(amount, remarks || '', repayment.id);

      // Update loan totals
      db.prepare(`
        UPDATE loans SET
          total_recovered = total_recovered + ?,
          remaining_balance = remaining_balance - ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(amount, amount, loanId);

      // Check if loan is fully repaid
      const updated = db.prepare('SELECT remaining_balance FROM loans WHERE id = ?').get(loanId);
      if (updated.remaining_balance <= 0) {
        db.prepare(`
          UPDATE loans SET status = 'Closed', remaining_balance = 0, updated_at = datetime('now')
          WHERE id = ?
        `).run(loanId);
      }

      logAudit('loan_repayments', repayment.id, 'status', 'Pending', 'Recovered', 'loan_recovery',
        `Manual recovery ₹${amount} for ${month}/${year}. ${remarks || ''}`);
    });
    txn();

    res.json({ success: true, message: `Recovery of ₹${amount} recorded successfully` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/loans/:id/skip
 * Skip a monthly installment
 * Body: { month, year, reason }
 */
router.post('/:id/skip', (req, res) => {
  try {
    const db = getDb();
    const loanId = parseInt(req.params.id);
    const { month, year, reason } = req.body;

    if (!month || !year) {
      return res.status(400).json({ success: false, error: 'month and year are required' });
    }

    const repayment = db.prepare(`
      SELECT * FROM loan_repayments
      WHERE loan_id = ? AND month = ? AND year = ? AND status = 'Pending'
    `).get(loanId, month, year);

    if (!repayment) {
      return res.status(404).json({ success: false, error: 'No pending repayment found for that month/year' });
    }

    db.prepare(`
      UPDATE loan_repayments SET status = 'Skipped', remarks = ?
      WHERE id = ?
    `).run(reason || '', repayment.id);

    logAudit('loan_repayments', repayment.id, 'status', 'Pending', 'Skipped', 'loan_skip',
      `Installment skipped for ${month}/${year}. Reason: ${reason || 'Not specified'}`);

    res.json({ success: true, message: `Installment for ${month}/${year} skipped` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
