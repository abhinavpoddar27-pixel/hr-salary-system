#!/usr/bin/env node
/**
 * Seed script: generate 1000+ synthetic session_events for analytics testing.
 * Idempotent — deletes all seed- prefixed sessions before inserting.
 *
 * Run:  node backend/src/scripts/seedSessionData.js
 */
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const { getDb } = require('../database/db');

const USERS = [
  { username: 'admin',        role: 'admin', weight: 1.0,   pages: ['/', '/dashboard', '/import', '/attendance', '/salary', '/salary-advance', '/employees', '/finance-audit', '/reports', '/session-analytics', '/settings', '/loans', '/leave-management', '/compliance', '/workforce-analytics'], offHours: true },
  { username: 'hr_manager',   role: 'hr',    weight: 0.65,  pages: ['/', '/dashboard', '/import', '/attendance', '/miss-punch', '/shift-check', '/night-shift', '/corrections', '/day-calculation', '/employees', '/leave-management'], offHours: false },
  { username: 'payroll_user', role: 'hr',    weight: 0.5,   pages: ['/', '/dashboard', '/salary', '/salary-input', '/salary-advance', '/day-calculation', '/reports', '/loans'], offHours: false },
  { username: 'viewer',       role: 'hr',    weight: 0.2,   pages: ['/', '/dashboard'], offHours: false }
];

const FEATURES = [
  'Import Attendance', 'Upload EESL File', 'Export CSV', 'Compute Salary',
  'Generate Payslips', 'Submit Correction', 'Approve Leave', 'Calculate Advances',
  'Download PDF', 'Bulk Export', 'Mark Present', 'Apply Leave Correction'
];

const CLICK_TARGETS = [
  { id: 'export-btn',    type: 'button', label: 'Export CSV' },
  { id: 'compute-btn',   type: 'button', label: 'Compute Salary' },
  { id: 'import-btn',    type: 'button', label: 'Upload File' },
  { id: 'save-btn',      type: 'button', label: 'Save Changes' },
  { id: 'refresh-btn',   type: 'button', label: 'Refresh Data' },
  { id: 'filter-dept',   type: 'select', label: 'Department Filter' },
  { id: 'search-input',  type: 'input',  label: 'Search' },
  { id: 'next-page',     type: 'button', label: 'Next Page' },
  { id: 'prev-page',     type: 'button', label: 'Previous Page' },
  { id: 'download-pdf',  type: 'button', label: 'Download PDF' },
  { id: 'approve-btn',   type: 'button', label: 'Approve' },
  { id: 'reject-btn',    type: 'button', label: 'Reject' },
];

const ERRORS = [
  'Failed to fetch attendance data',
  'Network timeout on /api/payroll/compute-salary',
  'Cannot read properties of undefined (reading "map")',
  'API returned 500 for /api/import/upload',
  'ChunkLoadError: Loading chunk Import failed',
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }
function uuid() { return 'seed-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36).slice(-4); }

function generateEvents() {
  const events = [];
  const now = Date.now();
  const THIRTY_DAYS = 30 * 86400000;

  for (const user of USERS) {
    // Decide how many sessions this user gets over 30 days
    const sessionCount = Math.round(rand(20, 60) * user.weight);

    for (let s = 0; s < sessionCount; s++) {
      const sessionId = uuid();
      // Random start time in the last 30 days
      let dayOffset = rand(0, 29);
      let hour, minute;

      // One off-hours session for admin (anomaly)
      if (user.offHours && s === 0) {
        hour = rand(1, 4); // 1-4 AM
        minute = rand(0, 59);
      } else {
        hour = rand(8, 18); // Normal working hours
        minute = rand(0, 59);
      }

      const sessionStart = new Date(now - (dayOffset * 86400000));
      sessionStart.setHours(hour, minute, 0, 0);
      let ts = sessionStart.getTime();

      // How many events in this session? viewer gets few, admin gets many
      const eventCount = Math.round(rand(3, 40) * user.weight);
      const pages = [...user.pages];
      let currentPage = pick(pages);

      // Determine if this is a "bounce" session (viewer often bounces)
      const isBounce = user.username === 'viewer' && Math.random() < 0.6;

      for (let e = 0; e < eventCount; e++) {
        ts += rand(2000, 60000); // 2-60 seconds between events

        if (e === 0) {
          // First event is always page_view
          events.push({ username: user.username, session_id: sessionId, event_type: 'page_view', page: currentPage, timestamp: new Date(ts).toISOString() });
        } else {
          const roll = Math.random();

          if (roll < 0.3 && !isBounce) {
            // Navigate to new page
            const prevPage = currentPage;
            // page_exit for current
            const duration = rand(5000, 300000);
            events.push({ username: user.username, session_id: sessionId, event_type: 'page_exit', page: currentPage, data: JSON.stringify({ durationMs: duration }), timestamp: new Date(ts).toISOString() });
            ts += 500;
            currentPage = pick(pages);
            events.push({ username: user.username, session_id: sessionId, event_type: 'page_view', page: currentPage, timestamp: new Date(ts).toISOString() });
          } else if (roll < 0.6) {
            // Click something
            const target = pick(CLICK_TARGETS);
            events.push({ username: user.username, session_id: sessionId, event_type: 'click', page: currentPage, element_id: target.id, element_type: target.type, label: target.label, timestamp: new Date(ts).toISOString() });
          } else if (roll < 0.75 && user.weight > 0.3) {
            // Feature use
            events.push({ username: user.username, session_id: sessionId, event_type: 'feature_use', page: currentPage, label: pick(FEATURES), timestamp: new Date(ts).toISOString() });
          } else if (roll < 0.8 && Math.random() < 0.1) {
            // Error (rare)
            events.push({ username: user.username, session_id: sessionId, event_type: 'error', page: currentPage, label: pick(ERRORS), timestamp: new Date(ts).toISOString() });
          } else if (roll < 0.9) {
            // Idle start/end pair
            events.push({ username: user.username, session_id: sessionId, event_type: 'idle_start', page: currentPage, timestamp: new Date(ts).toISOString() });
            const idleDuration = rand(60000, 600000); // 1-10 min idle
            ts += idleDuration;
            events.push({ username: user.username, session_id: sessionId, event_type: 'idle_end', page: currentPage, data: JSON.stringify({ idleDurationMs: idleDuration }), timestamp: new Date(ts).toISOString() });
          } else {
            // Search event
            const searches = ['10001', 'Rahul', 'Production', '2026-02', 'absent', 'overtime'];
            events.push({ username: user.username, session_id: sessionId, event_type: 'search', page: currentPage, label: pick(searches), data: JSON.stringify({ query: pick(searches), context: currentPage.replace('/', '') || 'dashboard' }), timestamp: new Date(ts).toISOString() });
          }
        }
      }

      // End with page_exit
      const lastDuration = rand(5000, 180000);
      ts += rand(1000, 5000);
      events.push({ username: user.username, session_id: sessionId, event_type: 'page_exit', page: currentPage, data: JSON.stringify({ durationMs: lastDuration }), timestamp: new Date(ts).toISOString() });
    }

    // Anomaly: one day with 3x volume for hr_manager
    if (user.username === 'hr_manager') {
      const anomalyDay = new Date(now - 3 * 86400000);
      anomalyDay.setHours(9, 0, 0, 0);
      const anomalySessionId = uuid();
      for (let i = 0; i < 150; i++) {
        const ats = anomalyDay.getTime() + i * rand(5000, 30000);
        events.push({
          username: user.username, session_id: anomalySessionId,
          event_type: pick(['click', 'page_view', 'feature_use']),
          page: pick(user.pages), label: pick([...FEATURES, ...CLICK_TARGETS.map(c => c.label)]),
          timestamp: new Date(ats).toISOString()
        });
      }
    }
  }

  return events;
}

function main() {
  const db = getDb();

  // Delete previous seed data
  const deleted = db.prepare("DELETE FROM session_events WHERE session_id LIKE 'seed-%'").run();
  console.log(`Deleted ${deleted.changes} previous seed events`);

  const events = generateEvents();
  console.log(`Generated ${events.length} synthetic events`);

  const insert = db.prepare(`
    INSERT INTO session_events (user_id, username, session_id, event_type, page, element_id, element_type, label, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((evts) => {
    for (const e of evts) {
      insert.run(
        null, e.username, e.session_id, e.event_type,
        e.page || null, e.element_id || null, e.element_type || null,
        e.label || null, e.data || null, e.timestamp
      );
    }
  });

  txn(events);
  console.log(`Inserted ${events.length} events successfully`);

  // Stats
  const total = db.prepare('SELECT COUNT(*) as cnt FROM session_events').get().cnt;
  const users = db.prepare('SELECT COUNT(DISTINCT username) as cnt FROM session_events').get().cnt;
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) as cnt FROM session_events').get().cnt;
  console.log(`Database now has: ${total} events, ${users} users, ${sessions} sessions`);
}

main();
