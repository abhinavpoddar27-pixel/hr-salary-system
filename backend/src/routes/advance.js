const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { calculateAdvances } = require('../services/advanceCalculation');

/**
 * POST /api/advance/calculate
 * Calculate advance eligibility for all employees
 */
router.post('/calculate', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const results = calculateAdvances(db, parseInt(month), parseInt(year));
  const eligible = results.filter(r => r.isEligible);
  const totalAdvance = eligible.reduce((s, r) => s + r.advanceAmount, 0);

  res.json({
    success: true,
    total: results.length,
    eligible: eligible.length,
    ineligible: results.length - eligible.length,
    totalAdvanceAmount: totalAdvance,
    data: results
  });
});

/**
 * GET /api/advance/list
 * Get advance list for a month
 */
router.get('/list', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const records = db.prepare(`
    SELECT sa.*, e.name as employee_name, e.department, e.designation
    FROM salary_advances sa
    LEFT JOIN employees e ON sa.employee_code = e.code
    WHERE sa.month = ? AND sa.year = ?
    ORDER BY e.department, e.name
  `).all(month, year);

  const totals = {
    total: records.length,
    eligible: records.filter(r => r.is_eligible).length,
    paid: records.filter(r => r.paid).length,
    recovered: records.filter(r => r.recovered).length,
    totalAmount: records.filter(r => r.is_eligible).reduce((s, r) => s + (r.advance_amount || 0), 0),
    paidAmount: records.filter(r => r.paid).reduce((s, r) => s + (r.advance_amount || 0), 0)
  };

  res.json({ success: true, data: records, totals });
});

/**
 * PUT /api/advance/:id/mark-paid
 * Mark an advance as paid
 */
router.put('/:id/mark-paid', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { paymentMode } = req.body;

  db.prepare(`
    UPDATE salary_advances SET paid = 1, paid_date = date('now'), payment_mode = ?
    WHERE id = ? AND is_eligible = 1
  `).run(paymentMode || 'Bank Transfer', id);

  res.json({ success: true, message: 'Advance marked as paid' });
});

/**
 * PUT /api/advance/batch-mark-paid
 * Mark multiple advances as paid
 */
router.put('/batch-mark-paid', (req, res) => {
  const db = getDb();
  const { ids, paymentMode } = req.body;

  const stmt = db.prepare(`
    UPDATE salary_advances SET paid = 1, paid_date = date('now'), payment_mode = ?
    WHERE id = ? AND is_eligible = 1
  `);

  const txn = db.transaction(() => {
    for (const id of ids) {
      stmt.run(paymentMode || 'Bank Transfer', id);
    }
  });
  txn();

  res.json({ success: true, message: `${ids.length} advances marked as paid` });
});

/**
 * GET /api/advance/recovery
 * Get advances pending recovery for salary deduction
 */
router.get('/recovery', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const records = db.prepare(`
    SELECT sa.*, e.name as employee_name, e.department
    FROM salary_advances sa
    LEFT JOIN employees e ON sa.employee_code = e.code
    WHERE sa.recovery_month = ? AND sa.recovery_year = ?
    AND sa.paid = 1 AND sa.recovered = 0
  `).all(month, year);

  res.json({ success: true, data: records });
});

module.exports = router;
