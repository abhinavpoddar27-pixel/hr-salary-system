/**
 * Leave triggers (Sept 2026)
 * ────────────────────────────────────────────────────────────────────────────
 * The glue between "something changed" and "leave gets recomputed".
 *
 * Every caller is expected to fire these AFTER its own transaction has
 * committed, and to wrap the call so a trigger failure can never fail the
 * request that caused it — `safeTrigger()` does that wrapping.
 *
 * Three rules shape everything here:
 *   • A finalized month is never recalculated. A change that would have hit one
 *     raises a leave_change_flags row for HR instead (ruling 4).
 *   • Salary never recomputes on its own. Stage 6 may run automatically; Stage 7
 *     only ever runs because a human clicked Compute (ruling 5).
 *   • Stage 6's first automatic run waits until every miss punch for the
 *     company-month is resolved by HR AND decided by finance, because
 *     effectiveStatusForDay() ignores an HR fix finance has not ruled on
 *     (ruling 6).
 */

const { ensureJobsTable } = require('./jobQueue');
const { getPolicyBool, getPolicyNumber } = require('./leaveEngine');

/** Runs `fn`, swallows anything it throws. Never let a trigger break its caller. */
function safeTrigger(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[leaveTrigger] ${label} failed: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Same shape and same-day dedupe as monthEndScheduler.createNotification, but
 * writing through the handle the caller passed instead of reaching for getDb().
 * Best-effort: a notification failure must never surface to the user.
 */
function notify(db, roleTarget, type, message, link) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const seen = db.prepare(
      'SELECT id FROM notifications WHERE type = ? AND message = ? AND created_at LIKE ?'
    ).get(type, message, `${today}%`);
    if (seen) return;
    db.prepare(
      'INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(roleTarget, type, message, message, link || null, link || null);
  } catch (err) {
    console.error(`[leaveTrigger] notification failed: ${err.message}`);
  }
}

function isMonthFinalized(db, company, month, year) {
  if (!month || !year) return false;
  const args = [parseInt(month, 10), parseInt(year, 10)];
  let sql = 'SELECT 1 AS x FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1';
  if (company) { sql += ' AND company = ?'; args.push(company); }
  return !!db.prepare(`${sql} LIMIT 1`).get(...args);
}

/** Record a change that landed on a finalized month so HR can decide what to do. */
function flagFinalizedChange(db, { employeeCode = null, company = null, month, year, reason, detail = null }) {
  const info = db.prepare(`
    INSERT INTO leave_change_flags (employee_code, company, month, year, reason, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employeeCode, company, parseInt(month, 10), parseInt(year, 10), reason, detail);
  return info.lastInsertRowid;
}

function recordSkippedRun(db, { scope, company, month, year, status, message }) {
  return db.prepare(`
    INSERT INTO leave_recompute_runs
      (scope, company, month, year, employee_count, started_at, finished_at, status, message)
    VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'), ?, ?)
  `).run(scope, company || null, month || null, year || null, status, message || null).lastInsertRowid;
}

/**
 * Queue a leave recompute for a company-month.
 *
 * Repeat triggers inside `leave_recompute_debounce_seconds` merge into the
 * pending job rather than piling up — bulk-resolving fifty miss punches must
 * queue one job, not fifty.
 *
 * @returns {{queued:boolean, jobId?:number, merged?:boolean, reason?:string, flagId?:number, runId?:number}}
 */
function queueLeaveRecalc(db, { company = null, month, year, employeeCodes = null, reason = 'change', actor = 'system' } = {}) {
  month = month ? parseInt(month, 10) : null;
  year = year ? parseInt(year, 10) : null;
  if (!year) throw new Error('queueLeaveRecalc: year is required');

  if (month && isMonthFinalized(db, company, month, year)) {
    const flagId = flagFinalizedChange(db, {
      employeeCode: Array.isArray(employeeCodes) && employeeCodes.length === 1 ? employeeCodes[0] : null,
      company, month, year,
      reason,
      detail: `${actor} made a change that affects a finalized month; nothing was recalculated`,
    });
    return { queued: false, reason: 'month_finalized', flagId };
  }

  if (!getPolicyBool(db, 'leave_automation_enabled', false)) {
    const runId = recordSkippedRun(db, {
      scope: 'trigger', company, month, year, status: 'skipped_disabled',
      message: `${reason} by ${actor} — leave_automation_enabled is false`,
    });
    return { queued: false, reason: 'automation_disabled', runId };
  }

  ensureJobsTable(db);
  const debounce = getPolicyNumber(db, 'leave_recompute_debounce_seconds', 45);

  // CAST matters: strftime('%s', …) returns TEXT, and in SQLite every INTEGER
  // sorts before every TEXT, so an uncast comparison is always true and the
  // debounce window would silently be infinite.
  const pending = db.prepare(`
    SELECT id, params FROM jobs
    WHERE type = 'leave_recalc' AND status = 'pending'
      AND CAST(strftime('%s', created_at) AS INTEGER)
          >= CAST(strftime('%s', 'now') AS INTEGER) - ?
    ORDER BY id DESC
  `).all(debounce);

  const codes = Array.isArray(employeeCodes) && employeeCodes.length ? employeeCodes.slice() : null;

  for (const job of pending) {
    let p = {};
    try { p = JSON.parse(job.params || '{}'); } catch { p = {}; }
    if ((p.company || null) !== company || p.month !== month || p.year !== year) continue;
    // A null employeeCodes means "the whole month" and always wins.
    let merged;
    if (!p.employeeCodes || !codes) merged = null;
    else merged = Array.from(new Set([...p.employeeCodes, ...codes]));
    const reasons = Array.from(new Set([...(p.reasons || [p.reason].filter(Boolean)), reason]));
    db.prepare('UPDATE jobs SET params = ? WHERE id = ?')
      .run(JSON.stringify({ ...p, employeeCodes: merged, reasons, reason: p.reason || reason }), job.id);
    return { queued: false, merged: true, jobId: job.id, reason: 'merged_into_pending' };
  }

  const params = { company, month, year, employeeCodes: codes, reason, reasons: [reason], actor };
  const jobId = db.prepare("INSERT INTO jobs (type, params) VALUES ('leave_recalc', ?)")
    .run(JSON.stringify(params)).lastInsertRowid;
  return { queued: true, jobId };
}

/**
 * Ruling 6: Stage 6's FIRST run for a company-month goes automatically once
 * every miss punch is resolved by HR and decided by finance.
 *
 * "Decided" means finance said approved or rejected. A pending or missing
 * finance status still counts as outstanding, because effectiveStatusForDay()
 * falls back to status_original until finance rules — running Stage 6 early
 * would compute against attendance HR has already corrected.
 */
function missPunchBacklog(db, company, month, year) {
  const args = [parseInt(month, 10), parseInt(year, 10)];
  let scope = 'month = ? AND year = ?';
  if (company) { scope += ' AND company = ?'; args.push(company); }
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN COALESCE(miss_punch_resolved, 0) = 0 THEN 1 ELSE 0 END) AS awaiting_hr,
      SUM(CASE WHEN COALESCE(miss_punch_resolved, 0) = 1
                AND (miss_punch_finance_status IS NULL
                  OR TRIM(miss_punch_finance_status) = ''
                  OR LOWER(miss_punch_finance_status) = 'pending')
               THEN 1 ELSE 0 END) AS awaiting_finance
    FROM attendance_processed
    WHERE is_miss_punch = 1 AND ${scope}
  `).get(...args);
  return {
    awaitingHr: row?.awaiting_hr || 0,
    awaitingFinance: row?.awaiting_finance || 0,
    total: (row?.awaiting_hr || 0) + (row?.awaiting_finance || 0),
  };
}

function checkAutoStage6(db, company, month, year, { actor = 'system' } = {}) {
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!month || !year) return { fired: false, reason: 'missing_period' };

  if (!getPolicyBool(db, 'leave_auto_stage6_enabled', true)) {
    return { fired: false, reason: 'auto_stage6_disabled' };
  }
  if (isMonthFinalized(db, company, month, year)) {
    return { fired: false, reason: 'month_finalized' };
  }

  const args = [month, year];
  let sql = 'SELECT id, stage_6_done, stage_6_auto_at FROM monthly_imports WHERE month = ? AND year = ?';
  if (company) { sql += ' AND company = ?'; args.push(company); }
  const mi = db.prepare(`${sql} LIMIT 1`).get(...args);
  if (!mi) return { fired: false, reason: 'no_import' };
  // Only the FIRST run is automatic; after that Stage 6 is HR's to trigger.
  if (mi.stage_6_done) return { fired: false, reason: 'stage_6_already_done' };

  const backlog = missPunchBacklog(db, company, month, year);
  if (backlog.total > 0) {
    return { fired: false, reason: 'miss_punches_outstanding', backlog };
  }

  ensureJobsTable(db);
  const dayJobId = db.prepare("INSERT INTO jobs (type, params) VALUES ('day_calculate', ?)")
    .run(JSON.stringify({ company, month, year, reason: 'auto_stage6', actor })).lastInsertRowid;
  const leaveJobId = db.prepare("INSERT INTO jobs (type, params) VALUES ('leave_recalc', ?)")
    .run(JSON.stringify({
      company, month, year, employeeCodes: null,
      reason: 'auto_stage6', reasons: ['auto_stage6'], actor, skipDays: true,
    })).lastInsertRowid;

  db.prepare('UPDATE monthly_imports SET stage_6_auto_at = datetime(\'now\') WHERE id = ?').run(mi.id);

  notify(db, 'hr', 'AUTO_STAGE6_QUEUED',
    `All miss punches are cleared for ${month}/${year}${company ? ` (${company})` : ''} — day calculation is running automatically`,
    '/pipeline/day-calc');

  return { fired: true, dayJobId, leaveJobId, backlog };
}

/** What the Miss Punch and Import screens show. */
function autoStage6Status(db, company, month, year) {
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!month || !year) return null;
  const args = [month, year];
  let sql = 'SELECT stage_6_done, stage_6_auto_at, is_finalised FROM monthly_imports WHERE month = ? AND year = ?';
  if (company) { sql += ' AND company = ?'; args.push(company); }
  const mi = db.prepare(`${sql} LIMIT 1`).get(...args);
  const backlog = missPunchBacklog(db, company, month, year);
  return {
    enabled: getPolicyBool(db, 'leave_auto_stage6_enabled', true),
    hasImport: !!mi,
    stageSixDone: !!mi?.stage_6_done,
    autoRanAt: mi?.stage_6_auto_at || null,
    finalized: !!mi?.is_finalised,
    awaitingHr: backlog.awaitingHr,
    awaitingFinance: backlog.awaitingFinance,
  };
}

module.exports = {
  safeTrigger,
  notify,
  queueLeaveRecalc,
  isMonthFinalized,
  flagFinalizedChange,
  checkAutoStage6,
  autoStage6Status,
  missPunchBacklog,
};
