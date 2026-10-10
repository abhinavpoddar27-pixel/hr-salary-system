// Early Exit Detection Service
//
// Works out, per attendance day, whether the person left before the end of
// their shift and by how much, AFTER allowing for any gate pass (short_leaves).
//
// Rebuilt Oct 2026 (gate pass PR-2):
//   • The raw early minutes come from utils/shiftMetrics.calcShiftMetrics with
//     exactly the inputs import.js uses — so night shifts are measured against
//     the night window (the old code compared a 08:00 night punch-out with a
//     20:00 day end and recorded ~700 "minutes early" for every night worker).
//   • A gate pass then reduces it: left at or after the pass time → not an
//     early exit; left before the pass time → only the minutes beyond the pass.
//     The pass time is the effective shift end minus the pass's duration, so a
//     night worker's pass is measured against the night end too.
//   • The adjusted result is written to attendance_processed.is_early_departure
//     / early_by_minutes — the columns Attendance Review, analytics and profiles
//     read — and to early_exit_detections (the Early Exit list HR works from;
//     minutes_early keeps the raw figure, flagged_minutes the adjusted one).
//
// Every writer of the raw metrics (import, recalculate-metrics, miss-punch
// resolution) calls refreshEarlyExits afterwards, gate pass create/cancel does
// too, and a nightly + boot sweep covers the current and previous month — so a
// gate pass is applied wherever the early-exit flag is read.
//
// Never touches salary / day-calculation tables.

const { calcShiftMetrics } = require('../utils/shiftMetrics');

const WORKED_FINAL = new Set(['P', '½P', 'WOP', 'WO½P']);

function toMin(t) {
  if (!t || typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hhmm(min) {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function loadContext(db) {
  const allShifts = db.prepare('SELECT * FROM shifts').all();
  const shiftById = {}; const shiftByCode = {};
  for (const s of allShifts) { shiftById[s.id] = s; shiftByCode[s.code] = s; }
  const otRow = db.prepare("SELECT value FROM policy_config WHERE key = 'ot_threshold_hours'").get();
  return {
    shiftById, shiftByCode,
    defaultDayShift: shiftByCode.DAY || allShifts[0],
    otThresholdHours: parseFloat(otRow?.value || '12'),
  };
}

/**
 * Pure: the early-exit result for one attendance row (+ its gate pass, if any).
 * Returns null when the row is not measured (no IN punch / no shift) — the
 * caller then leaves the row's early columns alone, as import does.
 */
function evaluateRow(rec, pass, ctx) {
  const inTime = rec.in_time_final || rec.in_time_original;
  const outTime = rec.out_time_final || rec.out_time_original;
  if (!inTime) return null;
  // Same shift resolution as import.js post-processing
  const empShift = rec.default_shift_id ? ctx.shiftById[rec.default_shift_id]
                 : (rec.shift_code ? ctx.shiftByCode[rec.shift_code] : null);
  const shift = empShift || ctx.defaultDayShift;
  if (!shift) return null;

  const m = calcShiftMetrics({ inTime, outTime, statusOriginal: rec.status_original, shift, otThresholdHours: ctx.otThresholdHours });
  const isNight = m.isNight === 1;
  const effEnd = isNight && shift.night_start_time ? (shift.night_end_time || shift.end_time) : shift.end_time;
  const rawEarly = m.isEarly ? m.earlyBy : 0;

  const out = {
    shift, isNight, effEnd, outTime, rawEarly,
    flagged: rawEarly, hasPass: 0, passId: null, passUntil: null, overage: 0, status: rawEarly > 0 ? 'flagged' : null,
  };
  if (rawEarly > 0 && pass) {
    out.hasPass = 1; out.passId = pass.id;
    let endMin = toMin(effEnd); let outMin = toMin(outTime);
    if (isNight) { if (endMin < 720) endMin += 1440; if (outMin < 720) outMin += 1440; }
    const untilMin = endMin - Math.round(Number(pass.duration_hours || 0) * 60);
    out.passUntil = hhmm(untilMin);
    if (outMin >= untilMin) { out.flagged = 0; out.status = 'exempted'; }
    else { out.overage = untilMin - outMin; out.flagged = Math.min(rawEarly, out.overage); }
  }
  return out;
}

/**
 * Re-work the early exits for one date. Idempotent.
 * @returns {{ detected, exempted, skipped }}
 */
function detectForDate(db, targetDate, ctx) {
  const records = db.prepare(`
    SELECT ap.id, ap.employee_id, ap.employee_code, ap.in_time_original, ap.out_time_original,
           ap.in_time_final, ap.out_time_final, ap.status_original,
           COALESCE(ap.status_final, ap.status_original) AS status,
           ap.is_early_departure, ap.early_by_minutes,
           e.id AS emp_id, e.name AS employee_name, e.department, e.company, e.default_shift_id, e.shift_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON e.code = ap.employee_code
    WHERE ap.date = ? AND COALESCE(ap.is_night_out_only, 0) = 0
  `).all(targetDate);

  const passes = {};
  for (const p of db.prepare(`SELECT id, employee_code, duration_hours FROM short_leaves
                              WHERE date = ? AND cancelled_at IS NULL ORDER BY id`).all(targetDate)) {
    if (!passes[p.employee_code]) passes[p.employee_code] = p;
  }

  const setAp = db.prepare('UPDATE attendance_processed SET is_early_departure = ?, early_by_minutes = ? WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO early_exit_detections
      (employee_id, employee_code, employee_name, department, company, date,
       shift_code, shift_end_time, actual_punch_out_time, minutes_early,
       has_gate_pass, short_leave_id, authorized_leave_until,
       gate_pass_overage_minutes, flagged_minutes, detection_status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(employee_code, date) DO UPDATE SET
      shift_code = excluded.shift_code,
      shift_end_time = excluded.shift_end_time,
      actual_punch_out_time = excluded.actual_punch_out_time,
      minutes_early = excluded.minutes_early,
      has_gate_pass = excluded.has_gate_pass,
      short_leave_id = excluded.short_leave_id,
      authorized_leave_until = excluded.authorized_leave_until,
      gate_pass_overage_minutes = excluded.gate_pass_overage_minutes,
      flagged_minutes = excluded.flagged_minutes,
      detection_status = CASE WHEN early_exit_detections.detection_status = 'actioned' THEN 'actioned'
                              ELSE excluded.detection_status END,
      updated_at = datetime('now')`);

  let detected = 0, exempted = 0, skipped = 0;
  const keep = new Set();

  for (const rec of records) {
    const r = evaluateRow(rec, passes[rec.employee_code], ctx);
    if (!r) { skipped++; continue; }
    const ed = r.flagged > 0 ? 1 : 0;
    if ((rec.is_early_departure || 0) !== ed || (rec.early_by_minutes || 0) !== r.flagged) setAp.run(ed, r.flagged, rec.id);

    if (!r.status || !WORKED_FINAL.has(rec.status)) { skipped++; continue; }
    keep.add(rec.employee_code);
    upsert.run(rec.employee_id || rec.emp_id, rec.employee_code, rec.employee_name, rec.department, rec.company, targetDate,
      r.shift.code, r.effEnd, r.outTime, r.rawEarly, r.hasPass, r.passId, r.passUntil, r.overage, r.flagged, r.status);
    if (r.status === 'exempted') exempted++; else detected++;
  }

  // Drop rows that are no longer early exits — never an actioned one, never one a
  // deduction points at (FK; a cancelled deduction keeps its row too).
  const stale = db.prepare(`
    SELECT d.id, d.employee_code FROM early_exit_detections d
    WHERE d.date = ? AND d.detection_status != 'actioned'
      AND NOT EXISTS (SELECT 1 FROM early_exit_deductions x WHERE x.early_exit_detection_id = d.id)`).all(targetDate);
  const del = db.prepare('DELETE FROM early_exit_detections WHERE id = ?');
  for (const s of stale) if (!keep.has(s.employee_code)) del.run(s.id);

  return { detected, exempted, skipped };
}

/** Single date — kept for POST /api/early-exits/detect and /detect-range. */
function detectEarlyExits(db, targetDate) {
  const ctx = loadContext(db);
  return db.transaction(() => detectForDate(db, targetDate, ctx))();
}

/** Several dates in one transaction. Dates must be YYYY-MM-DD. */
function refreshEarlyExits(db, dates) {
  const list = [...new Set((dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))].sort();
  const totals = { dates: list.length, detected: 0, exempted: 0, skipped: 0 };
  if (!list.length) return totals;
  const ctx = loadContext(db);
  db.transaction(() => {
    for (const d of list) {
      const r = detectForDate(db, d, ctx);
      totals.detected += r.detected; totals.exempted += r.exempted; totals.skipped += r.skipped;
    }
  })();
  return totals;
}

/** Every date that has attendance in month/year (optionally one company label). */
function refreshEarlyExitsForMonth(db, month, year, company) {
  const dates = company
    ? db.prepare('SELECT DISTINCT date FROM attendance_processed WHERE month = ? AND year = ? AND company = ?').all(month, year, company)
    : db.prepare('SELECT DISTINCT date FROM attendance_processed WHERE month = ? AND year = ?').all(month, year);
  return refreshEarlyExits(db, dates.map((r) => r.date));
}

/** Post-write hook: never throws, so a detection problem can never fail the caller's request. */
function safeRefresh(label, fn) {
  try { return fn(); } catch (err) {
    console.error(`[early-exit-refresh] ${label} failed:`, err.message);
    return { error: err.message };
  }
}

/** Current + previous IST month — the nightly / boot sweep. */
function refreshRecentMonths(db, now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  const m = ist.getUTCMonth() + 1; const y = ist.getUTCFullYear();
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  const a = refreshEarlyExitsForMonth(db, pm, py);
  const b = refreshEarlyExitsForMonth(db, m, y);
  return { dates: a.dates + b.dates, detected: a.detected + b.detected, exempted: a.exempted + b.exempted };
}

function initEarlyExitScheduler(getDb) {
  const cron = require('node-cron');
  const run = (label) => {
    const t0 = Date.now();
    const r = safeRefresh(label, () => refreshRecentMonths(getDb()));
    console.log(`[early-exit-refresh] ${label}: ${JSON.stringify(r)} in ${Date.now() - t0}ms`);
  };
  // 22:15 UTC = 03:45 IST daily
  cron.schedule('15 22 * * *', () => run('nightly'), { timezone: 'UTC' });
  // once shortly after boot, so a deploy applies the current rules straight away
  setTimeout(() => run('boot'), 30000).unref();
}

module.exports = {
  detectEarlyExits, refreshEarlyExits, refreshEarlyExitsForMonth, refreshRecentMonths,
  safeRefresh, initEarlyExitScheduler, evaluateRow, loadContext,
};
