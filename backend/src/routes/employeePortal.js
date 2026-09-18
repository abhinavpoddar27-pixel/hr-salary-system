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

  const VALID_TYPES = ['CL', 'EL', 'LWP'];
  if (!VALID_TYPES.includes(leave_type)) {
    return res.status(400).json({ success: false, error: 'Invalid leave_type. Must be CL or EL. SL is no longer supported.' });
  }

  const requested = Number(days);
  if (!Number.isFinite(requested) || requested <= 0) {
    return res.status(400).json({ success: false, error: 'days must be a positive number' });
  }
  if (new Date(end_date) < new Date(start_date)) {
    return res.status(400).json({ success: false, error: 'end_date cannot be before start_date' });
  }

  const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(req.user.employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const month = new Date(start_date).getMonth() + 1;
  const year = new Date(start_date).getFullYear();
  const finalized = db.prepare(
    'SELECT 1 FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1 LIMIT 1'
  ).get(month, year);
  if (finalized) {
    return res.status(400).json({ success: false, error: `Cannot apply for leave in a finalized month (${month}/${year})` });
  }

  if (leave_type !== 'LWP') {
    const bal = db.prepare(
      'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
    ).get(emp.id, year, leave_type);
    const balance = Number(bal?.balance) || 0;
    if (balance < requested) {
      return res.status(400).json({
        success: false,
        error: `Insufficient ${leave_type} balance (you have ${balance}, requested ${requested})`
      });
    }
  }

  // employee_id was never set before, so the portal's applications did not join
  // back to the employee anywhere that reads by id.
  db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`).run(emp.id, req.user.employee_code, leave_type, start_date, end_date, requested, reason || '');
  res.json({ success: true, message: 'Leave application submitted' });
});

// GET /api/portal/leave-history
router.get('/leave-history', requireEmployee, (req, res) => {
  const db = getDb();
  // leave_applications has no created_at column — ordering by it 500'd the page.
  const history = db.prepare('SELECT * FROM leave_applications WHERE employee_code = ? ORDER BY applied_at DESC, id DESC LIMIT 50')
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
