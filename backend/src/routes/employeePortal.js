const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// All portal routes require authenticated user with employee_code set
function requireEmployee(req, res, next) {
  if (!req.user || !req.user.employee_code) {
    return res.status(403).json({ success: false, error: 'Employee portal access required' });
  }
  next();
}

// GET /api/portal/profile
router.get('/profile', requireEmployee, (req, res) => {
  const db = getDb();
  const emp = db.prepare(`SELECT code, name, father_name, dob, gender, department, designation, company,
    employment_type, date_of_joining, bank_account, bank_name, ifsc, phone, email, status
    FROM employees WHERE code = ?`).get(req.user.employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  res.json({ success: true, data: emp });
});

// GET /api/portal/attendance/:month/:year
router.get('/attendance/:month/:year', requireEmployee, (req, res) => {
  const db = getDb();
  const { month, year } = req.params;
  const records = db.prepare(`SELECT date, status_final, status_original, in_time_final, out_time_final,
    actual_hours, is_late_arrival, late_by_minutes, shift_detected
    FROM attendance_processed WHERE employee_code = ? AND month = ? AND year = ?
    ORDER BY date`).all(req.user.employee_code, month, year);
  const dayCalc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?')
    .get(req.user.employee_code, month, year);
  res.json({ success: true, data: { records, dayCalc } });
});

// GET /api/portal/payslip/:month/:year
router.get('/payslip/:month/:year', requireEmployee, (req, res) => {
  const db = getDb();
  const { month, year } = req.params;
  const comp = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?')
    .get(req.user.employee_code, month, year);
  if (!comp) return res.status(404).json({ success: false, error: 'Payslip not found' });
  res.json({ success: true, data: comp });
});

// GET /api/portal/leave-balance
router.get('/leave-balance', requireEmployee, (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(req.user.employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  const year = req.query.year || new Date().getFullYear();
  const balances = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
  res.json({ success: true, data: balances });
});

// POST /api/portal/leave-apply
router.post('/leave-apply', requireEmployee, (req, res) => {
  const db = getDb();
  const { leave_type, start_date, end_date, days, reason } = req.body;
  if (!leave_type || !start_date || !end_date || !days) {
    return res.status(400).json({ success: false, error: 'leave_type, start_date, end_date, and days are required' });
  }
  db.prepare(`INSERT INTO leave_applications (employee_code, leave_type, start_date, end_date, days, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, 'Pending')`).run(req.user.employee_code, leave_type, start_date, end_date, days, reason || '');
  res.json({ success: true, message: 'Leave application submitted' });
});

// GET /api/portal/leave-history
router.get('/leave-history', requireEmployee, (req, res) => {
  const db = getDb();
  const history = db.prepare('SELECT * FROM leave_applications WHERE employee_code = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.employee_code);
  res.json({ success: true, data: history });
});

// GET /api/portal/loans
router.get('/loans', requireEmployee, (req, res) => {
  const db = getDb();
  try {
    const loans = db.prepare(`SELECT * FROM loans WHERE employee_code = ? AND status != 'Closed' ORDER BY created_at DESC`)
      .all(req.user.employee_code);
    res.json({ success: true, data: loans });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// PATCH /api/portal/bank-details
router.patch('/bank-details', requireEmployee, (req, res) => {
  const db = getDb();
  const { bank_account, bank_name, ifsc } = req.body;
  db.prepare(`UPDATE employees SET bank_account = ?, bank_name = ?, ifsc = ?, updated_at = datetime('now') WHERE code = ?`)
    .run(bank_account, bank_name, ifsc, req.user.employee_code);
  res.json({ success: true, message: 'Bank details updated' });
});

module.exports = router;
