const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
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

module.exports = router;
