const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

/**
 * GET /api/usage-logs
 * Admin only — view usage logs
 */
router.get('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const db = getDb();
  const { page = 1, limit = 50, username, action, dateFrom, dateTo } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (username) {
    where += ' AND ul.username = ?';
    params.push(username);
  }
  if (action) {
    where += ' AND ul.action LIKE ?';
    params.push(`%${action}%`);
  }
  if (dateFrom) {
    where += ' AND ul.created_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    where += " AND ul.created_at <= ? || ' 23:59:59'";
    params.push(dateTo);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM usage_logs ul WHERE ${where}`).get(...params);
  const logs = db.prepare(`
    SELECT ul.* FROM usage_logs ul
    WHERE ${where}
    ORDER BY ul.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Summary stats
  const stats = db.prepare(`
    SELECT username, role, COUNT(*) as total_actions,
      MAX(created_at) as last_active
    FROM usage_logs
    GROUP BY username
    ORDER BY total_actions DESC
  `).all();

  // Today's activity
  const today = new Date().toISOString().split('T')[0];
  const todayCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM usage_logs WHERE created_at >= ?
  `).get(today)?.cnt || 0;

  // Most active pages
  const topPages = db.prepare(`
    SELECT path, COUNT(*) as hits FROM usage_logs
    WHERE created_at >= date('now', '-7 days')
    GROUP BY path ORDER BY hits DESC LIMIT 10
  `).all();

  res.json({
    success: true,
    data: logs,
    total: total.cnt,
    page: parseInt(page),
    limit: parseInt(limit),
    stats,
    todayCount,
    topPages
  });
});

/**
 * GET /api/usage-logs/summary
 * Admin only — usage summary dashboard
 */
router.get('/summary', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const db = getDb();

  // Per-user summary
  const userSummary = db.prepare(`
    SELECT username, role,
      COUNT(*) as total_actions,
      COUNT(DISTINCT date(created_at)) as active_days,
      MAX(created_at) as last_active,
      MIN(created_at) as first_seen
    FROM usage_logs
    GROUP BY username
    ORDER BY last_active DESC
  `).all();

  // Activity by hour
  const hourly = db.prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as count
    FROM usage_logs
    WHERE created_at >= date('now', '-7 days')
    GROUP BY hour ORDER BY hour
  `).all();

  // Activity by day (last 30 days)
  const daily = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count, COUNT(DISTINCT username) as unique_users
    FROM usage_logs
    WHERE created_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();

  // Most used features
  const features = db.prepare(`
    SELECT
      CASE
        WHEN path LIKE '%/payroll%' THEN 'Salary Processing'
        WHEN path LIKE '%/attendance%' THEN 'Attendance'
        WHEN path LIKE '%/analytics%' THEN 'Analytics'
        WHEN path LIKE '%/advance%' THEN 'Salary Advance'
        WHEN path LIKE '%/employees%' THEN 'Employees'
        WHEN path LIKE '%/import%' THEN 'Import'
        WHEN path LIKE '%/reports%' THEN 'Reports'
        WHEN path LIKE '%/loans%' THEN 'Loans'
        WHEN path LIKE '%/leaves%' THEN 'Leaves'
        WHEN path LIKE '%/settings%' THEN 'Settings'
        WHEN path LIKE '%/auth%' THEN 'Authentication'
        ELSE 'Other'
      END as feature,
      COUNT(*) as count
    FROM usage_logs
    WHERE created_at >= date('now', '-30 days')
    GROUP BY feature
    ORDER BY count DESC
  `).all();

  res.json({
    success: true,
    data: { userSummary, hourly, daily, features }
  });
});

module.exports = router;
