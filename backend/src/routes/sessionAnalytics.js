/**
 * Session Analytics Routes
 *
 * Ingests client-side tracking events and provides admin-only dashboards.
 * Architecturally isolated from HR/salary code — errors here never affect core app.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// ─────────────────────────────────────────────────────────
// POST /api/session-analytics/events
// Ingest a batch of tracking events from the client
// Available to all authenticated users (they generate their own events)
// ─────────────────────────────────────────────────────────
router.post('/events', (req, res) => {
  try {
    const db = getDb();
    const { events } = req.body;
    const username = req.user?.username || 'Unknown';
    const userId = req.user?.id || null;

    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.json({ success: true, ingested: 0 });
    }

    // Cap at 100 events per batch to prevent abuse
    const batch = events.slice(0, 100);

    const insert = db.prepare(`
      INSERT INTO session_events (user_id, username, session_id, event_type, page,
        element_id, element_type, label, data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction((evts) => {
      for (const e of evts) {
        insert.run(
          userId, username,
          e.sessionId || 'unknown',
          e.type || 'unknown',
          e.page || null,
          e.elementId || null,
          e.elementType || null,
          e.label || null,
          e.data ? JSON.stringify(e.data) : null,
          e.timestamp || new Date().toISOString()
        );
      }
    });
    txn(batch);

    res.json({ success: true, ingested: batch.length });
  } catch (err) {
    // Never let tracking errors return 500 — always succeed silently
    console.error('Session event ingest error:', err.message);
    res.json({ success: true, ingested: 0, error: 'ingest_failed' });
  }
});

// ═══════════════════════════════════════════════════════════
// ADMIN-ONLY ENDPOINTS BELOW
// ═══════════════════════════════════════════════════════════

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/overview
// Usage overview: sessions, duration, top pages, peak hours
// ─────────────────────────────────────────────────────────
router.get('/overview', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    // Total sessions and unique users
    const sessions = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as total_sessions,
             COUNT(DISTINCT username) as unique_users,
             COUNT(*) as total_events
      FROM session_events WHERE timestamp >= ?
    `).get(since);

    // Page views ranked by count
    const topPages = db.prepare(`
      SELECT page, COUNT(*) as views, COUNT(DISTINCT username) as unique_users
      FROM session_events
      WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
      GROUP BY page ORDER BY views DESC LIMIT 20
    `).all(since);

    // Peak hours (hour of day distribution)
    const peakHours = db.prepare(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as events
      FROM session_events WHERE timestamp >= ?
      GROUP BY hour ORDER BY hour
    `).all(since);

    // Feature usage
    const features = db.prepare(`
      SELECT label, COUNT(*) as uses, COUNT(DISTINCT username) as unique_users
      FROM session_events
      WHERE event_type = 'feature_use' AND timestamp >= ?
      GROUP BY label ORDER BY uses DESC LIMIT 15
    `).all(since);

    // Daily activity trend
    const dailyTrend = db.prepare(`
      SELECT DATE(timestamp) as date,
             COUNT(*) as events,
             COUNT(DISTINCT username) as users,
             COUNT(DISTINCT session_id) as sessions
      FROM session_events WHERE timestamp >= ?
      GROUP BY DATE(timestamp) ORDER BY date
    `).all(since);

    // Error count
    const errors = db.prepare(`
      SELECT COUNT(*) as count FROM session_events
      WHERE event_type = 'error' AND timestamp >= ?
    `).get(since);

    res.json({
      success: true,
      data: {
        totalSessions: sessions.total_sessions,
        uniqueUsers: sessions.unique_users,
        totalEvents: sessions.total_events,
        errorCount: errors.count,
        topPages, peakHours, features, dailyTrend
      }
    });
  } catch (err) {
    console.error('Session overview error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute session overview: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/users
// Per-user activity summary
// ─────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const users = db.prepare(`
      SELECT username,
             COUNT(*) as total_events,
             COUNT(DISTINCT session_id) as sessions,
             COUNT(DISTINCT page) as unique_pages,
             COUNT(DISTINCT DATE(timestamp)) as active_days,
             MIN(timestamp) as first_seen,
             MAX(timestamp) as last_seen,
             SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors
      FROM session_events WHERE timestamp >= ?
      GROUP BY username ORDER BY total_events DESC
    `).all(since);

    // Get top pages per user
    const userPages = {};
    for (const u of users) {
      userPages[u.username] = db.prepare(`
        SELECT page, COUNT(*) as views
        FROM session_events
        WHERE username = ? AND event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
        GROUP BY page ORDER BY views DESC LIMIT 5
      `).all(u.username, since);
    }

    res.json({
      success: true,
      data: users.map(u => ({
        ...u,
        topPages: userPages[u.username] || []
      }))
    });
  } catch (err) {
    console.error('Session users error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute user activity: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/pages
// Per-page analytics
// ─────────────────────────────────────────────────────────
router.get('/pages', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const pages = db.prepare(`
      SELECT page,
             COUNT(*) as total_views,
             COUNT(DISTINCT username) as unique_users,
             COUNT(DISTINCT session_id) as unique_sessions
      FROM session_events
      WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
      GROUP BY page ORDER BY total_views DESC
    `).all(since);

    // Get click events per page
    const pageClicks = {};
    for (const p of pages) {
      pageClicks[p.page] = db.prepare(`
        SELECT element_type, label, COUNT(*) as clicks
        FROM session_events
        WHERE page = ? AND event_type = 'click' AND timestamp >= ?
        GROUP BY element_type, label ORDER BY clicks DESC LIMIT 10
      `).all(p.page, since);
    }

    res.json({
      success: true,
      data: pages.map(p => ({
        ...p,
        topClicks: pageClicks[p.page] || []
      }))
    });
  } catch (err) {
    console.error('Session pages error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute page analytics: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/errors
// Recent error events
// ─────────────────────────────────────────────────────────
router.get('/errors', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const errors = db.prepare(`
      SELECT username, page, label as message, data, timestamp
      FROM session_events
      WHERE event_type = 'error' AND timestamp >= ?
      ORDER BY timestamp DESC LIMIT 100
    `).all(since);

    res.json({ success: true, data: errors });
  } catch (err) {
    console.error('Session errors error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch errors: ' + err.message });
  }
});

module.exports = router;
