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
  db.prepare('INSERT INTO notifications (role_target, type, message, link) VALUES (?, ?, ?, ?)').run(roleTarget, type, message, link || null);
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
  const importCount = db.prepare('SELECT COUNT(*) as cnt FROM attendance_raw WHERE month = ? AND year = ?').get(checkMonth, checkYear);
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

function startScheduler() {
  initNotificationsTable();
  // Run daily at 9:00 AM IST (3:30 AM UTC)
  cron.schedule('30 3 * * *', () => {
    try { checkPipelineStatus(); } catch (e) { console.error('[Scheduler] Error:', e.message); }
  });
  // Also run on startup
  try { checkPipelineStatus(); } catch {}
  console.log('📅 Month-end scheduler started');
}

module.exports = { startScheduler, createNotification, initNotificationsTable };
