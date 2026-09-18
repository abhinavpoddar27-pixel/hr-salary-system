const cron = require('node-cron');
const { getDb } = require('../database/db');

function initNotificationsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      role_target TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function createNotification(roleTarget, type, message, link) {
  const db = getDb();
  // Avoid duplicates within the same day
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare("SELECT id FROM notifications WHERE type = ? AND message = ? AND created_at LIKE ?").get(type, message, `${today}%`);
  if (existing) return;
  try {
    db.prepare('INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)').run(roleTarget, type, message, message, link || null, link || null);
  } catch {
    // Fallback for old schema
    try { db.prepare('INSERT INTO notifications (type, title, message, action_url) VALUES (?, ?, ?, ?)').run(type, message, message, link || null); } catch {}
  }
}

function checkPipelineStatus() {
  const db = getDb();
  const now = new Date();
  const dayOfMonth = now.getDate();

  // Determine which month to check
  let checkMonth, checkYear;
  if (dayOfMonth <= 10) {
    // Check previous month
    checkMonth = now.getMonth(); // 0-indexed, so this is prev month
    checkYear = now.getFullYear();
    if (checkMonth === 0) { checkMonth = 12; checkYear--; }
  } else {
    checkMonth = now.getMonth() + 1;
    checkYear = now.getFullYear();
  }

  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const period = `${MONTHS[checkMonth]} ${checkYear}`;

  // Check attendance import
  // attendance_raw has no month/year columns — join via import_id → monthly_imports
  const importCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM attendance_raw
    WHERE import_id IN (SELECT id FROM monthly_imports WHERE month = ? AND year = ?)
  `).get(checkMonth, checkYear);
  if (!importCount || importCount.cnt === 0) {
    if (dayOfMonth >= 1) {
      createNotification('hr', 'IMPORT_PENDING', `Attendance import for ${period} is pending`, '/pipeline/import');
    }
    return; // Can't check further stages without import
  }

  // Check miss punches
  const unresolvedMP = db.prepare("SELECT COUNT(*) as cnt FROM attendance_processed WHERE month = ? AND year = ? AND is_miss_punch = 1 AND miss_punch_status NOT IN ('resolved', 'supervisor_resolved')").get(checkMonth, checkYear);
  if (unresolvedMP && unresolvedMP.cnt > 0 && dayOfMonth >= 3) {
    createNotification('hr', 'MISS_PUNCH_PENDING', `${unresolvedMP.cnt} miss punches still unresolved for ${period}`, '/pipeline/miss-punch');
  }

  // Check day calculation
  const dcCount = db.prepare('SELECT COUNT(*) as cnt FROM day_calculations WHERE month = ? AND year = ?').get(checkMonth, checkYear);
  if (!dcCount || dcCount.cnt === 0) {
    if (dayOfMonth >= 5) {
      createNotification('hr', 'DAY_CALC_PENDING', `Day calculation not yet completed for ${period}`, '/pipeline/day-calc');
    }
    return;
  }

  // Check salary computation
  const scCount = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ?').get(checkMonth, checkYear);
  if (!scCount || scCount.cnt === 0) {
    if (dayOfMonth >= 7) {
      createNotification('hr', 'SALARY_PENDING', `Salary not yet computed for ${period}`, '/pipeline/salary');
    }
    return;
  }

  // Check finalization
  const finalized = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ? AND is_finalised = 1').get(checkMonth, checkYear);
  if ((!finalized || finalized.cnt === 0) && dayOfMonth >= 10) {
    createNotification('hr', 'FINALIZE_URGENT', `URGENT: Salary not finalized for ${period}. PF/ESI filing deadline approaching.`, '/pipeline/salary');
  }
}

/**
 * Server clock is UTC; the plant runs on IST (UTC+05:30). Every cron string in
 * this file is UTC — the IST time it corresponds to is named beside it.
 */
function istParts() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Nightly leave sweep. Queues one `leave_nightly` job rather than doing the work
 * on the cron thread, so a long sweep can never block the scheduler. The job
 * refreshes Stage 6 for every non-finalized month of the current year, recomputes
 * the year's leave, and logs any salary drift it finds.
 */
function runNightlyLeaveSweep() {
  const db = getDb();
  const { year } = istParts();
  const { ensureJobsTable } = require('./jobQueue');
  const { getPolicyBool } = require('./leaveEngine');

  if (!getPolicyBool(db, 'leave_automation_enabled', false)) {
    db.prepare(`
      INSERT INTO leave_recompute_runs (scope, year, employee_count, started_at, finished_at, status, message)
      VALUES ('nightly', ?, 0, datetime('now'), datetime('now'), 'skipped_disabled', 'leave_automation_enabled is false')
    `).run(year);
    console.log('[Scheduler] Nightly leave sweep skipped — automation is off');
    return;
  }

  ensureJobsTable(db);
  // One pending sweep at a time.
  const existing = db.prepare(
    "SELECT id FROM jobs WHERE type = 'leave_nightly' AND status = 'pending' LIMIT 1"
  ).get();
  if (existing) {
    console.log(`[Scheduler] Nightly leave sweep already queued as job ${existing.id}`);
    return;
  }
  const jobId = db.prepare("INSERT INTO jobs (type, params) VALUES ('leave_nightly', ?)")
    .run(JSON.stringify({ year, reason: 'nightly' })).lastInsertRowid;
  console.log(`[Scheduler] Nightly leave sweep queued as job ${jobId} for ${year}`);
}

/**
 * Year boundary. Seeds next year's CL openings on 1 Jan and lapses CL + EL on
 * 31 Dec (no carry-forward, no encashment). Both sides are guarded by a
 * policy_config key so a restart on the same day cannot run them twice.
 */
function runYearBoundaryCheck() {
  const db = getDb();
  const { year, month, day } = istParts();
  const { seedYearOpenings, runYearEndLapse } = require('./leaveEngine');

  const guardDone = (key) => !!db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  const stampGuard = (key, note) => db.prepare(
    'INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, ?)'
  ).run(key, '1', note);

  try {
    if (month === 1 && day === 1) {
      const key = `leave_year_open_${year}_done`;
      if (!guardDone(key)) {
        const out = seedYearOpenings(db, year);
        stampGuard(key, `CL/EL openings seeded for ${year}`);
        console.log(`[Scheduler] Seeded ${out.seeded} leave opening rows for ${year}`);
      }
    }
    if (month === 12 && day === 31) {
      const key = `leave_year_lapse_${year}_done`;
      if (!guardDone(key)) {
        const out = runYearEndLapse(db, year, { dryRun: false, actor: 'scheduler' });
        stampGuard(key, `CL/EL lapsed for ${year}`);
        console.log(`[Scheduler] Year-end lapse ${year}: ${out.totals.rows} rows, CL ${out.totals.cl_days}d, EL ${out.totals.el_days}d`);
        createNotification('hr', 'LEAVE_YEAR_END_LAPSE',
          `Year-end lapse complete for ${year} — ${out.totals.rows} balance(s) zeroed`,
          '/leave-management');
      }
    }
  } catch (e) {
    console.error('[Scheduler] Year-boundary check failed:', e.message);
  }
}

function startScheduler() {
  initNotificationsTable();
  // 09:00 IST (03:30 UTC) — pipeline status, then the nightly leave sweep.
  cron.schedule('30 3 * * *', () => {
    try { checkPipelineStatus(); } catch (e) { console.error('[Scheduler] Error:', e.message); }
    try { runNightlyLeaveSweep(); } catch (e) { console.error('[Scheduler] Leave sweep error:', e.message); }
  });
  // 00:05 IST (18:35 UTC the previous day) — year-boundary seed / lapse.
  cron.schedule('35 18 * * *', () => {
    try { runYearBoundaryCheck(); } catch (e) { console.error('[Scheduler] Year-boundary error:', e.message); }
  });
  // Also run on startup
  try { checkPipelineStatus(); } catch {}
  console.log('📅 Month-end scheduler started');
}

module.exports = {
  startScheduler,
  createNotification,
  initNotificationsTable,
  runNightlyLeaveSweep,
  runYearBoundaryCheck,
  istParts,
};
