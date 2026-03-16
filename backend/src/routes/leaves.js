const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

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

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE leave_applications SET status = 'Approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(approvedBy, req.params.id);

    // Deduct from leave balance (CL/EL/SL)
    const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(leave.employee_code);
    if (emp && ['CL', 'EL', 'SL'].includes(leave.leave_type)) {
      const year = new Date(leave.start_date).getFullYear();
      db.prepare(`
        UPDATE leave_balances SET used = used + ?, balance = balance - ?
        WHERE employee_id = ? AND year = ? AND leave_type = ?
      `).run(leave.days, leave.days, emp.id, year, leave.leave_type);
    }
  });
  txn();

  res.json({ success: true, message: 'Leave approved' });
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

module.exports = router;
