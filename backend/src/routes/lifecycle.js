const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

/**
 * GET /api/lifecycle/employee/:code
 * Get lifecycle events for an employee
 */
router.get('/employee/:code', (req, res) => {
  const db = getDb();
  const { code } = req.params;

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const events = db.prepare(`
    SELECT * FROM employee_lifecycle
    WHERE employee_code = ?
    ORDER BY event_date DESC, created_at DESC
  `).all(code);

  res.json({ success: true, data: events });
});

/**
 * POST /api/lifecycle
 * Add a lifecycle event
 */
router.post('/', (req, res) => {
  const db = getDb();
  const { employee_code, event_type, event_date, details, from_value, to_value, remarks } = req.body;

  if (!employee_code || !event_type || !event_date) {
    return res.status(400).json({ success: false, error: 'employee_code, event_type, and event_date are required' });
  }

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const processedBy = req.user?.username || 'admin';

  const result = db.prepare(`
    INSERT INTO employee_lifecycle (employee_id, employee_code, event_type, event_date, details, from_value, to_value, remarks, processed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, employee_code, event_type, event_date, details || null, from_value || null, to_value || null, remarks || null, processedBy);

  // Auto-generate notification for key events
  const notifyEvents = ['Promotion', 'Transfer', 'Increment', 'Warning', 'Resignation', 'Termination'];
  if (notifyEvents.includes(event_type)) {
    const empData = db.prepare('SELECT name FROM employees WHERE code = ?').get(employee_code);
    db.prepare(`
      INSERT INTO notifications (type, title, message, action_url)
      VALUES (?, ?, ?, ?)
    `).run(
      'LIFECYCLE_EVENT',
      `${event_type}: ${empData?.name || employee_code}`,
      `${event_type} recorded for ${empData?.name || employee_code}${details ? ': ' + details : ''}`,
      `/employees`
    );
  }

  res.json({ success: true, id: result.lastInsertRowid, message: 'Lifecycle event added' });
});

/**
 * GET /api/lifecycle/recent
 * Get recent lifecycle events across all employees
 */
router.get('/recent', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 20;

  const events = db.prepare(`
    SELECT el.*, e.name as employee_name, e.department
    FROM employee_lifecycle el
    LEFT JOIN employees e ON e.code = el.employee_code
    ORDER BY el.event_date DESC, el.created_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ success: true, data: events });
});

module.exports = router;
