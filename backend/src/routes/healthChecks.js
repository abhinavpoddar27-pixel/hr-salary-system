const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// Admin-only gate — applied to all routes in this file.
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
});

// GET /api/admin/health-checks?limit=50
// Returns the most recent system_health_checks rows, newest first.
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const raw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const rows = db.prepare(`
      SELECT id, check_name, status, severity, detected_at, details_json,
             acknowledged_at, acknowledged_by, acknowledged_reason
      FROM system_health_checks
      ORDER BY detected_at DESC, id DESC
      LIMIT ?
    `).all(limit);
    res.json({ rows });
  } catch (err) {
    console.error('health-checks list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
