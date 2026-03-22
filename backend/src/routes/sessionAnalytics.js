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

// ═══════════════════════════════════════════════════════════
// PHASE 6: ADVANCED ANALYTICS ENDPOINTS
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/user-sessions
// All sessions for a specific user with per-session summary
// ─────────────────────────────────────────────────────────
router.get('/user-sessions', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { username, days = 30 } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'username is required' });
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const sessions = db.prepare(`
      SELECT session_id,
             MIN(timestamp) as start_time,
             MAX(timestamp) as end_time,
             COUNT(*) as event_count,
             COUNT(DISTINCT page) as pages_visited,
             SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks,
             SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors
      FROM session_events
      WHERE username = ? AND timestamp >= ?
      GROUP BY session_id
      ORDER BY start_time DESC
      LIMIT 100
    `).all(username, since);

    const result = sessions.map(s => {
      const pages = db.prepare(`
        SELECT DISTINCT page FROM session_events
        WHERE session_id = ? AND event_type = 'page_view' AND page IS NOT NULL
      `).all(s.session_id).map(p => p.page);

      const startMs = new Date(s.start_time).getTime();
      const endMs = new Date(s.end_time).getTime();
      return {
        ...s,
        duration_minutes: Math.round((endMs - startMs) / 60000),
        pages
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('User sessions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/session-replay
// Full event stream for one session
// ─────────────────────────────────────────────────────────
router.get('/session-replay', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId is required' });

    const events = db.prepare(`
      SELECT id, event_type, page, element_id, element_type, label, data, timestamp, username
      FROM session_events
      WHERE session_id = ?
      ORDER BY timestamp ASC
      LIMIT 1000
    `).all(sessionId);

    if (events.length === 0) {
      return res.json({ success: true, data: { session_id: sessionId, username: null, events: [] } });
    }

    const firstTs = new Date(events[0].timestamp).getTime();
    const username = events[0].username;

    res.json({
      success: true,
      data: {
        session_id: sessionId,
        username,
        events: events.map(e => ({
          ...e,
          data: e.data ? (() => { try { return JSON.parse(e.data); } catch { return e.data; } })() : null,
          time_offset_ms: new Date(e.timestamp).getTime() - firstTs
        }))
      }
    });
  } catch (err) {
    console.error('Session replay error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/user-journeys
// Page-to-page transition aggregates
// ─────────────────────────────────────────────────────────
router.get('/user-journeys', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    // Page transitions using ROW_NUMBER window function
    const flows = db.prepare(`
      WITH page_views AS (
        SELECT session_id, page, timestamp,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp) as rn
        FROM session_events
        WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
      )
      SELECT a.page as from_page, b.page as to_page, COUNT(*) as count
      FROM page_views a
      JOIN page_views b ON a.session_id = b.session_id AND b.rn = a.rn + 1
      WHERE a.page != b.page
      GROUP BY a.page, b.page
      ORDER BY count DESC
      LIMIT 50
    `).all(since);

    // Entry pages: first page_view per session
    const entryPages = db.prepare(`
      WITH first_pages AS (
        SELECT session_id, page,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp ASC) as rn
        FROM session_events
        WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
      )
      SELECT page, COUNT(*) as count
      FROM first_pages WHERE rn = 1
      GROUP BY page ORDER BY count DESC LIMIT 20
    `).all(since);

    // Exit pages: last page_view per session
    const exitPages = db.prepare(`
      WITH last_pages AS (
        SELECT session_id, page,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) as rn
        FROM session_events
        WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
      )
      SELECT page, COUNT(*) as count
      FROM last_pages WHERE rn = 1
      GROUP BY page ORDER BY count DESC LIMIT 20
    `).all(since);

    res.json({ success: true, data: { flows, entry_pages: entryPages, exit_pages: exitPages } });
  } catch (err) {
    console.error('User journeys error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/time-on-page
// Average/median/max time per page from page_exit events
// ─────────────────────────────────────────────────────────
router.get('/time-on-page', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    // Get raw durations per page
    const raw = db.prepare(`
      SELECT page, json_extract(data, '$.durationMs') as duration_ms
      FROM session_events
      WHERE event_type = 'page_exit' AND timestamp >= ? AND data IS NOT NULL AND page IS NOT NULL
    `).all(since);

    // Group by page and compute stats
    const byPage = {};
    for (const r of raw) {
      const ms = parseFloat(r.duration_ms);
      if (!ms || ms <= 0 || ms > 3600000) continue; // Cap at 1 hour
      if (!byPage[r.page]) byPage[r.page] = [];
      byPage[r.page].push(ms / 1000);
    }

    // Bounce counts: sessions with only 1 unique page
    const bounces = db.prepare(`
      WITH session_pages AS (
        SELECT session_id, COUNT(DISTINCT page) as page_count, MIN(page) as only_page
        FROM session_events
        WHERE event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
        GROUP BY session_id
      )
      SELECT only_page as page, COUNT(*) as bounce_count
      FROM session_pages WHERE page_count = 1
      GROUP BY only_page
    `).all(since);
    const bounceMap = {};
    for (const b of bounces) bounceMap[b.page] = b.bounce_count;

    const result = Object.entries(byPage).map(([page, durations]) => {
      durations.sort((a, b) => a - b);
      const mid = Math.floor(durations.length / 2);
      const median = durations.length % 2 === 0
        ? (durations[mid - 1] + durations[mid]) / 2
        : durations[mid];

      return {
        page,
        avg_duration_sec: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        median_duration_sec: Math.round(median),
        max_duration_sec: Math.round(durations[durations.length - 1]),
        min_duration_sec: Math.round(durations[0]),
        total_visits: durations.length,
        bounce_count: bounceMap[page] || 0
      };
    }).sort((a, b) => b.total_visits - a.total_visits);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Time on page error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/feature-matrix
// User × Feature adoption grid
// ─────────────────────────────────────────────────────────
router.get('/feature-matrix', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const features = db.prepare(`
      SELECT DISTINCT label FROM session_events
      WHERE event_type = 'feature_use' AND timestamp >= ? AND label IS NOT NULL
      ORDER BY label
    `).all(since).map(f => f.label);

    const usernames = db.prepare(`
      SELECT DISTINCT username FROM session_events
      WHERE timestamp >= ? ORDER BY username
    `).all(since).map(u => u.username);

    const usage = db.prepare(`
      SELECT username, label, COUNT(*) as uses
      FROM session_events
      WHERE event_type = 'feature_use' AND timestamp >= ? AND label IS NOT NULL
      GROUP BY username, label
    `).all(since);

    const usageMap = {};
    for (const u of usage) {
      if (!usageMap[u.username]) usageMap[u.username] = {};
      usageMap[u.username][u.label] = u.uses;
    }

    const users = usernames.map(username => {
      const adopted = features.filter(f => usageMap[username]?.[f]);
      const neverUsed = features.filter(f => !usageMap[username]?.[f]);
      return {
        username,
        adopted,
        never_used: neverUsed,
        adoption_pct: features.length > 0 ? Math.round(adopted.length / features.length * 100) : 0,
        usage_counts: usageMap[username] || {}
      };
    });

    res.json({ success: true, data: { features, users } });
  } catch (err) {
    console.error('Feature matrix error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/heatmap
// Day-of-week × hour-of-day activity grid
// ─────────────────────────────────────────────────────────
router.get('/heatmap', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const data = db.prepare(`
      SELECT CAST(strftime('%w', timestamp) AS INTEGER) as day_of_week,
             CAST(strftime('%H', timestamp) AS INTEGER) as hour,
             COUNT(*) as events
      FROM session_events WHERE timestamp >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(since);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Heatmap error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/live-activity
// Users active in last 5 minutes
// ─────────────────────────────────────────────────────────
router.get('/live-activity', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();

    const active = db.prepare(`
      SELECT username,
             MAX(page) as current_page,
             MAX(event_type) as last_event,
             MAX(timestamp) as last_seen
      FROM session_events
      WHERE timestamp >= ?
      GROUP BY username
      ORDER BY last_seen DESC
    `).all(fiveMinAgo);

    // Get more accurate current_page: last page_view per user
    const result = active.map(u => {
      const lastPage = db.prepare(`
        SELECT page FROM session_events
        WHERE username = ? AND event_type = 'page_view' AND timestamp >= ? AND page IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
      `).get(u.username, fiveMinAgo);

      const lastEvent = db.prepare(`
        SELECT event_type, label FROM session_events
        WHERE username = ? AND timestamp >= ?
        ORDER BY timestamp DESC LIMIT 1
      `).get(u.username, fiveMinAgo);

      return {
        username: u.username,
        current_page: lastPage?.page || u.current_page,
        last_event: lastEvent?.event_type || u.last_event,
        last_label: lastEvent?.label || null,
        last_seen: u.last_seen,
        seconds_ago: Math.round((Date.now() - new Date(u.last_seen).getTime()) / 1000)
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Live activity error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/click-details
// Full click breakdown for a specific page
// ─────────────────────────────────────────────────────────
router.get('/click-details', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { page, days = 30 } = req.query;
    if (!page) return res.status(400).json({ success: false, error: 'page is required' });
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const summary = db.prepare(`
      SELECT COUNT(*) as total_clicks, COUNT(DISTINCT username) as unique_clickers
      FROM session_events
      WHERE page = ? AND event_type = 'click' AND timestamp >= ?
    `).get(page, since);

    const elements = db.prepare(`
      SELECT element_id, element_type, label,
             COUNT(*) as clicks,
             COUNT(DISTINCT username) as unique_users,
             MAX(timestamp) as last_clicked
      FROM session_events
      WHERE page = ? AND event_type = 'click' AND timestamp >= ?
      GROUP BY COALESCE(element_id, ''), element_type, label
      ORDER BY clicks DESC
      LIMIT 50
    `).all(page, since);

    res.json({
      success: true,
      data: {
        page,
        total_clicks: summary.total_clicks,
        unique_clickers: summary.unique_clickers,
        elements
      }
    });
  } catch (err) {
    console.error('Click details error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/session-analytics/user-engagement
// Engagement score per user (0-100)
// ─────────────────────────────────────────────────────────
router.get('/user-engagement', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const daysInt = parseInt(days);
    const since = new Date(Date.now() - daysInt * 86400000).toISOString();

    // Total available pages in the system
    const allPages = db.prepare(`
      SELECT COUNT(DISTINCT page) as cnt FROM session_events
      WHERE event_type = 'page_view' AND page IS NOT NULL
    `).get().cnt || 1;

    const users = db.prepare(`
      SELECT username,
             COUNT(DISTINCT DATE(timestamp)) as active_days,
             COUNT(DISTINCT session_id) as sessions,
             COUNT(*) as total_events,
             COUNT(DISTINCT page) as unique_pages,
             MAX(timestamp) as last_seen
      FROM session_events WHERE timestamp >= ?
      GROUP BY username
    `).all(since);

    const result = users.map(u => {
      // Frequency: active days / total days (max 30 → weight 30)
      const frequencyRaw = Math.min(u.active_days / Math.min(daysInt, 30), 1);
      const frequency_score = Math.round(frequencyRaw * 30);

      // Recency: days since last session (0 days → 20, 7+ → 0)
      const daysSinceLastSession = Math.max(0, Math.round((Date.now() - new Date(u.last_seen).getTime()) / 86400000));
      const recency_score = Math.round(Math.max(0, 20 - (daysSinceLastSession * 20 / 7)));

      // Breadth: unique pages / total available pages (max → 25)
      const breadth_score = Math.round(Math.min(u.unique_pages / allPages, 1) * 25);

      // Depth: avg events per session (50+ → 25, <5 → 0)
      const avgEventsPerSession = u.sessions > 0 ? u.total_events / u.sessions : 0;
      const depth_score = Math.round(Math.min(avgEventsPerSession / 50, 1) * 25);

      const score = frequency_score + recency_score + breadth_score + depth_score;

      return {
        username: u.username,
        score: Math.min(score, 100),
        frequency_score,
        recency_score,
        breadth_score,
        depth_score,
        breakdown: {
          active_days: u.active_days,
          total_pages: u.unique_pages,
          avg_events_per_session: Math.round(avgEventsPerSession),
          sessions: u.sessions,
          last_seen: u.last_seen
        }
      };
    }).sort((a, b) => b.score - a.score);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('User engagement error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
