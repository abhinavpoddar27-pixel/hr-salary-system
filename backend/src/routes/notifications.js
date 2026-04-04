const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

router.get('/', (req, res) => {
  const db = getDb();
  const userRole = req.user?.role || 'viewer';
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE role_target IS NULL OR role_target = ? OR role_target = 'all'
      ORDER BY created_at DESC LIMIT 50
    `).all(userRole);
    const unreadCount = notifications.filter(n => !n.is_read).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (e) {
    // Fallback if role_target column doesn't exist yet
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
    const unreadCount = notifications.filter(n => !n.is_read).length;
    res.json({ success: true, data: notifications, unreadCount });
  }
});

router.patch('/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/mark-all-read', (req, res) => {
  const db = getDb();
  const userRole = req.user?.role || 'viewer';
  db.prepare("UPDATE notifications SET is_read = 1 WHERE role_target IS NULL OR role_target = ? OR role_target = 'all'").run(userRole);
  res.json({ success: true });
});

module.exports = router;
