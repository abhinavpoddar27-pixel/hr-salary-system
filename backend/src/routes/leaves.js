const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');

/**
 * GET /api/leaves
 * List leave applications with optional filters
 */
router.get('/', (req, res) => {
  const db = getDb();
  const { status, employeeCode, month, year } = req.query;

  let query = `
    SELECT la.*, e.name as employee_name, e.department, e.designation
    FROM leave_applications la
    LEFT JOIN employees e ON la.employee_code = e.code
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND la.status = ?'; params.push(status); }
  if (employeeCode) { query += ' AND la.employee_code = ?'; params.push(employeeCode); }
  if (month && year) {
    const ms = String(month).padStart(2, '0');
    query += ` AND (la.start_date LIKE ? OR la.end_date LIKE ?)`;
    params.push(`${year}-${ms}-%`, `${year}-${ms}-%`);
  }

  query += ' ORDER BY la.applied_at DESC LIMIT 200';
  const records = db.prepare(query).all(...params);

  const stats = {
    total: records.length,
    pending: records.filter(r => r.status === 'Pending').length,
    approved: records.filter(r => r.status === 'Approved').length,
    rejected: records.filter(r => r.status === 'Rejected').length
  };

  res.json({ success: true, data: records, stats });
});

/**
 * POST /api/leaves
 * Submit a leave application
 */
router.post('/', (req, res) => {
  const db = getDb();
  const { employeeCode, leaveType, startDate, endDate, days, reason } = req.body;

  if (!employeeCode || !leaveType || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  // Calculate days if not provided
  const leaveDays = days || Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

  const result = db.prepare(`
    INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, employeeCode, leaveType, startDate, endDate, leaveDays, reason || '');

  // Create notification
  db.prepare(`
    INSERT INTO notifications (type, title, message, action_url)
    VALUES ('LEAVE_REQUEST', 'New Leave Request', ?, '/leave-management')
  `).run(`${emp.id}: ${employeeCode} requested ${leaveDays} day(s) ${leaveType} leave`);

  res.json({ success: true, id: result.lastInsertRowid, message: 'Leave application submitted' });
});

/**
 * PUT /api/leaves/:id/approve
 */
router.put('/:id/approve', (req, res) => {
  const db = getDb();
  const approvedBy = req.user?.username || 'admin';

  const leave = db.prepare('SELECT * FROM leave_applications WHERE id = ? AND status = ?').get(req.params.id, 'Pending');
  if (!leave) return res.status(404).json({ success: false, error: 'Leave not found or already processed' });

  // Check leave balance before approving
  let balanceWarning = null;
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(leave.employee_code);
  if (emp && ['CL', 'EL', 'SL'].includes(leave.leave_type)) {
    const year = new Date(leave.start_date).getFullYear();
    const bal = db.prepare('SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?').get(emp.id, year, leave.leave_type);
    const currentBalance = bal?.balance || 0;
    if (currentBalance < leave.days) {
      const newBalance = currentBalance - leave.days;
      balanceWarning = `Employee has only ${currentBalance} day(s) of ${leave.leave_type} remaining. Balance will go negative (${newBalance} days).`;
    }
  }

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE leave_applications SET status = 'Approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(approvedBy, req.params.id);

    if (emp && ['CL', 'EL', 'SL'].includes(leave.leave_type)) {
      const year = new Date(leave.start_date).getFullYear();
      db.prepare(`
        UPDATE leave_balances SET used = used + ?, balance = balance - ?
        WHERE employee_id = ? AND year = ? AND leave_type = ?
      `).run(leave.days, leave.days, emp.id, year, leave.leave_type);
    }
  });
  txn();

  const response = { success: true, message: 'Leave approved' };
  if (balanceWarning) response.warning = balanceWarning;
  res.json(response);
});

/**
 * PUT /api/leaves/:id/reject
 */
router.put('/:id/reject', (req, res) => {
  const db = getDb();
  const { reason } = req.body;

  db.prepare(`
    UPDATE leave_applications SET status = 'Rejected', approved_by = ?, approved_at = datetime('now'),
    rejection_reason = ?
    WHERE id = ? AND status = 'Pending'
  `).run(req.user?.username || 'admin', reason || '', req.params.id);

  res.json({ success: true, message: 'Leave rejected' });
});

/**
 * GET /api/leaves/summary
 * Get leave summary for the month
 */
router.get('/summary', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const ms = String(month).padStart(2, '0');
  const prefix = `${year}-${ms}`;

  const approved = db.prepare(`
    SELECT la.employee_code, la.leave_type, la.days, la.start_date, la.end_date,
           e.name as employee_name, e.department
    FROM leave_applications la
    LEFT JOIN employees e ON la.employee_code = e.code
    WHERE la.status = 'Approved'
    AND (la.start_date LIKE ? OR la.end_date LIKE ?)
  `).all(`${prefix}-%`, `${prefix}-%`);

  const byType = {};
  for (const l of approved) {
    byType[l.leave_type] = (byType[l.leave_type] || 0) + l.days;
  }

  res.json({
    success: true,
    data: approved,
    summary: {
      totalDays: approved.reduce((s, l) => s + l.days, 0),
      byType,
      employeesOnLeave: [...new Set(approved.map(l => l.employee_code))].length
    }
  });
});

/**
 * GET /api/leaves/balances
 * All employee leave balances
 */
router.get('/balances', (req, res) => {
  const db = getDb();
  const { company, year, department, search } = req.query;
  const currentYear = year || new Date().getFullYear();

  let query = `
    SELECT e.code as employee_code, e.name, e.department, e.company,
           MAX(CASE WHEN lb.leave_type = 'CL' THEN lb.balance ELSE 0 END) as CL,
           MAX(CASE WHEN lb.leave_type = 'EL' THEN lb.balance ELSE 0 END) as EL,
           MAX(CASE WHEN lb.leave_type = 'SL' THEN lb.balance ELSE 0 END) as SL
    FROM employees e
    LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.year = ?
    WHERE e.status = 'Active'
  `;
  const params = [currentYear];

  if (company) { query += ' AND e.company = ?'; params.push(company); }
  if (department) { query += ' AND e.department = ?'; params.push(department); }
  if (search) {
    query += ' AND (e.code LIKE ? OR e.name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' GROUP BY e.code ORDER BY e.name';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * GET /api/leaves/balances/:code
 * Single employee leave balances
 */
router.get('/balances/:code', (req, res) => {
  const db = getDb();
  const { year } = req.query;
  const currentYear = year || new Date().getFullYear();

  const rows = db.prepare(`
    SELECT lb.leave_type, lb.opening, lb.accrued, lb.used, lb.balance
    FROM leave_balances lb
    JOIN employees e ON lb.employee_id = e.id
    WHERE e.code = ? AND lb.year = ?
  `).all(req.params.code, currentYear);

  const balances = { CL: 0, EL: 0, SL: 0 };
  for (const r of rows) {
    balances[r.leave_type] = r.balance;
  }

  res.json({ success: true, data: balances, details: rows });
});

/**
 * POST /api/leaves/adjust
 * Manual leave adjustment
 */
router.post('/adjust', (req, res) => {
  const db = getDb();
  const { employee_code, leave_type, days, transaction_type, reason } = req.body;

  if (!employee_code || !leave_type || days == null || !transaction_type) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const validTypes = ['Credit', 'Debit', 'Manual Adjustment', 'Opening Balance', 'Carry Forward'];
  if (!validTypes.includes(transaction_type)) {
    return res.status(400).json({ success: false, error: `Invalid transaction_type. Must be one of: ${validTypes.join(', ')}` });
  }

  const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const currentYear = new Date().getFullYear();

  // Ensure leave_balances row exists
  db.prepare(`
    INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, 0, 0, 0, 0)
  `).run(emp.id, currentYear, leave_type);

  const bal = db.prepare(`
    SELECT * FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
  `).get(emp.id, currentYear, leave_type);

  const oldBalance = bal.balance;
  let newBalance = oldBalance;

  if (transaction_type === 'Debit') {
    newBalance = oldBalance - Math.abs(days);
    db.prepare(`
      UPDATE leave_balances SET used = used + ?, balance = ? WHERE id = ?
    `).run(Math.abs(days), newBalance, bal.id);
  } else {
    // Credit, Manual Adjustment, Opening Balance, Carry Forward all add
    newBalance = oldBalance + Math.abs(days);
    db.prepare(`
      UPDATE leave_balances SET balance = ? WHERE id = ?
    `).run(newBalance, bal.id);
  }

  // Insert leave transaction
  const now = new Date();
  db.prepare(`
    INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days, balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, employee_code, emp.company, leave_type, transaction_type, days, newBalance, now.getMonth() + 1, now.getFullYear(), reason || '', 'admin');

  logAudit('leave_balances', emp.id, leave_type, oldBalance, newBalance, 'leave_adjustment', reason || '');

  res.json({ success: true, message: 'Leave adjusted', oldBalance, newBalance });
});

/**
 * GET /api/leaves/transactions/:code
 * Leave transaction history for an employee
 */
router.get('/transactions/:code', (req, res) => {
  const db = getDb();
  const { year, leave_type } = req.query;

  let query = 'SELECT * FROM leave_transactions WHERE employee_code = ?';
  const params = [req.params.code];

  if (year) { query += ' AND reference_year = ?'; params.push(year); }
  if (leave_type) { query += ' AND leave_type = ?'; params.push(leave_type); }

  query += ' ORDER BY created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * GET /api/leaves/register
 * Monthly leave register — who took leave and what type
 */
router.get('/register', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year are required' });
  }

  let query = `
    SELECT lt.*, e.name as employee_name, e.department
    FROM leave_transactions lt
    JOIN employees e ON lt.employee_code = e.code
    WHERE lt.reference_month = ? AND lt.reference_year = ?
    AND lt.transaction_type = 'Debit'
  `;
  const params = [month, year];

  if (company) { query += ' AND lt.company = ?'; params.push(company); }

  query += ' ORDER BY e.name, lt.leave_type';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * POST /api/leaves/bulk-adjust
 * Bulk leave adjustment
 */
router.post('/bulk-adjust', (req, res) => {
  const db = getDb();
  const { adjustments } = req.body;

  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return res.status(400).json({ success: false, error: 'adjustments array is required' });
  }

  const errors = [];
  let processed = 0;

  const txn = db.transaction(() => {
    for (const adj of adjustments) {
      try {
        const { employee_code, leave_type, days, transaction_type, reason } = adj;

        if (!employee_code || !leave_type || days == null || !transaction_type) {
          errors.push({ employee_code, error: 'Missing required fields' });
          continue;
        }

        const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employee_code);
        if (!emp) {
          errors.push({ employee_code, error: 'Employee not found' });
          continue;
        }

        const currentYear = new Date().getFullYear();

        db.prepare(`
          INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
          VALUES (?, ?, ?, 0, 0, 0, 0)
        `).run(emp.id, currentYear, leave_type);

        const bal = db.prepare(`
          SELECT * FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
        `).get(emp.id, currentYear, leave_type);

        const oldBalance = bal.balance;
        let newBalance = oldBalance;

        if (transaction_type === 'Debit') {
          newBalance = oldBalance - Math.abs(days);
          db.prepare(`
            UPDATE leave_balances SET used = used + ?, balance = ? WHERE id = ?
          `).run(Math.abs(days), newBalance, bal.id);
        } else {
          newBalance = oldBalance + Math.abs(days);
          db.prepare(`
            UPDATE leave_balances SET balance = ? WHERE id = ?
          `).run(newBalance, bal.id);
        }

        const now = new Date();
        db.prepare(`
          INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days, balance_after, reference_month, reference_year, reason, approved_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(emp.id, employee_code, emp.company, leave_type, transaction_type, days, newBalance, now.getMonth() + 1, now.getFullYear(), reason || '', 'admin');

        logAudit('leave_balances', emp.id, leave_type, oldBalance, newBalance, 'leave_adjustment', reason || '');
        processed++;
      } catch (err) {
        errors.push({ employee_code: adj.employee_code, error: err.message });
      }
    }
  });

  txn();

  res.json({ success: true, processed, errors });
});

module.exports = router;
