const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

/**
 * GET /api/notifications
 * List notifications
 */
router.get('/', (req, res) => {
  const db = getDb();
  const { unread } = req.query;

  let query = 'SELECT * FROM notifications';
  const params = [];

  if (unread === 'true') { query += ' WHERE is_read = 0'; }
  query += ' ORDER BY created_at DESC LIMIT 50';

  const notifications = db.prepare(query).all(...params);
  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get().count;

  res.json({ success: true, data: notifications, unreadCount });
});

/**
 * PUT /api/notifications/:id/read
 */
router.put('/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/**
 * PUT /api/notifications/read-all
 */
router.put('/read-all', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
  res.json({ success: true });
});

/**
 * POST /api/notifications/generate
 * Auto-generate notifications based on current state
 */
router.post('/generate', (req, res) => {
  const db = getDb();
  const notifications = [];

  // Pending leave requests
  const pendingLeaves = db.prepare("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'Pending'").get();
  if (pendingLeaves.count > 0) {
    notifications.push({
      type: 'LEAVE_PENDING', title: 'Pending Leave Requests',
      message: `${pendingLeaves.count} leave request(s) awaiting approval`,
      action_url: '/leave-management'
    });
  }

  // Pending salary change requests
  const pendingSalary = db.prepare("SELECT COUNT(*) as count FROM salary_change_requests WHERE status = 'Pending'").get();
  if (pendingSalary.count > 0) {
    notifications.push({
      type: 'SALARY_CHANGE', title: 'Pending Salary Changes',
      message: `${pendingSalary.count} salary change request(s) pending`,
      action_url: '/salary-input'
    });
  }

  // Pending loan approvals
  const pendingLoans = db.prepare("SELECT COUNT(*) as count FROM loans WHERE status = 'Pending'").get();
  if (pendingLoans.count > 0) {
    notifications.push({
      type: 'LOAN_PENDING', title: 'Pending Loan Approvals',
      message: `${pendingLoans.count} loan(s) awaiting approval`,
      action_url: '/loans'
    });
  }

  // Insert notifications (avoid duplicates by type today)
  const today = new Date().toISOString().split('T')[0];
  const insertStmt = db.prepare(`
    INSERT INTO notifications (type, title, message, action_url)
    SELECT ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications WHERE type = ? AND date(created_at) = ?
    )
  `);

  for (const n of notifications) {
    insertStmt.run(n.type, n.title, n.message, n.action_url, n.type, today);
  }

  res.json({ success: true, generated: notifications.length });
});

module.exports = router;
