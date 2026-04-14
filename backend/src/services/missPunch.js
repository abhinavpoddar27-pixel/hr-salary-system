/**
 * Miss Punch Detection Service
 *
 * Runs AFTER night shift pairing to avoid false positives.
 * ~145 miss punch cases per month expected from actual data.
 */

const PRESENT_STATUSES = ['P', 'WOP', '½P', 'WO½P'];

/**
 * Detect miss punches in processed attendance records.
 * Must be called after night shift pairing is complete.
 *
 * @param {Array} records - attendance_processed records
 * @returns {Array} missPunchList - records flagged as miss punches with issue type
 */
function detectMissPunches(records) {
  const missPunches = [];

  for (const rec of records) {
    const status = rec.status_final || rec.status_original;
    const inTime = rec.in_time_final || rec.in_time_original;
    const outTime = rec.out_time_final || rec.out_time_original;

    // Skip if already paired as night shift (handled)
    if (rec.is_night_shift && rec.is_night_out_only) continue;
    // Night shift IN record already has its OUT paired
    if (rec.is_night_shift && !rec.is_night_out_only) continue;

    if (!PRESENT_STATUSES.includes(status)) continue;

    let issueType = null;

    if (!inTime && !outTime) {
      issueType = 'NO_PUNCH'; // Status says present but no punches at all
    } else if (!inTime && outTime) {
      issueType = 'MISSING_IN';
    } else if (inTime && !outTime) {
      // Check if night shift candidate (IN ≥ 18:00)
      const inHour = parseInt(inTime.split(':')[0]);
      if (inHour >= 18) {
        issueType = 'NIGHT_UNPAIRED'; // Unresolved night shift
      } else {
        issueType = 'MISSING_OUT';
      }
    }

    if (issueType) {
      missPunches.push({
        id: rec.id,
        employee_code: rec.employee_code,
        date: rec.date,
        status,
        in_time: inTime,
        out_time: outTime,
        issue_type: issueType,
        department: rec.department,
        company: rec.company
      });
    }
  }

  return missPunches;
}

/**
 * Apply miss punch flags to database
 */
function applyMissPunchFlags(db, missPunches) {
  const updateStmt = db.prepare(`
    UPDATE attendance_processed
    SET is_miss_punch = 1, miss_punch_type = ?, stage_2_done = 0
    WHERE id = ?
  `);

  const txn = db.transaction(() => {
    for (const mp of missPunches) {
      updateStmt.run(mp.issue_type, mp.id);
    }
  });

  txn();

  return {
    total: missPunches.length,
    byType: missPunches.reduce((acc, mp) => {
      acc[mp.issue_type] = (acc[mp.issue_type] || 0) + 1;
      return acc;
    }, {}),
    byDepartment: missPunches.reduce((acc, mp) => {
      acc[mp.department || 'Unknown'] = (acc[mp.department || 'Unknown'] || 0) + 1;
      return acc;
    }, {})
  };
}

/**
 * Recalculate shift-derived metrics for a single attendance record using the
 * corrected in/out times. Mirrors the canonical post-import calculation block
 * in `routes/import.js`. Called by `resolveMissPunch()` so that HR corrections
 * don't leave `is_late_arrival` / `is_early_departure` / `is_overtime` /
 * `is_left_late` frozen at their pre-correction values.
 *
 * Private — not exported.
 */
function recalcShiftMetrics(db, recordId, inTime, outTime, statusOriginal) {
  if (!inTime) return; // Can't calculate without IN time

  // 1. Look up the employee's shift
  const rec = db.prepare(`
    SELECT ap.employee_code, ap.is_night_shift, e.default_shift_id
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.id = ?
  `).get(recordId);
  if (!rec) return;

  const allShifts = db.prepare('SELECT * FROM shifts').all();
  const shiftById = {};
  const shiftByCode = {};
  for (const s of allShifts) { shiftById[s.id] = s; shiftByCode[s.code] = s; }
  const defaultDayShift = shiftByCode['DAY'] || allShifts[0];
  const defaultNightShift = shiftByCode['NIGHT'];

  const [inH, inM_] = inTime.split(':').map(Number);
  const isNight = (!isNaN(inH) && (inH >= 19 || inH < 6)) || rec.is_night_shift === 1;
  const empShift = rec.default_shift_id ? shiftById[rec.default_shift_id] : null;
  const shift = isNight ? (defaultNightShift || empShift || defaultDayShift) : (empShift || defaultDayShift);

  const isPresent = statusOriginal === 'P' || statusOriginal === 'WOP';
  const inMin = inH * 60 + (parseInt(inTime.split(':')[1]) || 0);

  // 2. Late arrival
  let isLate = 0, lateBy = 0;
  if (inTime && shift && shift.start_time && isPresent) {
    const [sh, sm] = shift.start_time.split(':').map(Number);
    if (!isNaN(inH) && !isNaN(sh)) {
      let diffMin = inMin - (sh * 60 + sm);
      if (isNight && diffMin < -600) diffMin += 1440;
      if (!isNight && diffMin < 0) diffMin = 0;
      const grace = shift.grace_minutes || 9;
      if (diffMin > grace) { isLate = 1; lateBy = diffMin; }
    }
  }

  // 3. Early departure
  let isEarly = 0, earlyBy = 0;
  if (outTime && shift && shift.end_time && isPresent
      && statusOriginal !== '½P' && statusOriginal !== 'WO½P') {
    const [oh, om] = outTime.split(':').map(Number);
    const [eh, em] = shift.end_time.split(':').map(Number);
    if (!isNaN(oh) && !isNaN(eh)) {
      let outMin = oh * 60 + om;
      let endMin = eh * 60 + em;
      if (isNight && endMin < 720) endMin += 1440;
      if (isNight && outMin < 720) outMin += 1440;
      const diffMin = endMin - outMin;
      const grace = shift.grace_minutes || 9;
      if (diffMin > grace) { isEarly = 1; earlyBy = diffMin; }
    }
  }

  // 4. Overtime
  let isOT = 0, otMinutes = 0;
  if (inTime && outTime && isPresent) {
    const [ih2, im2] = inTime.split(':').map(Number);
    const [oh2, om2] = outTime.split(':').map(Number);
    let hrs = (oh2 * 60 + om2 - (ih2 * 60 + im2)) / 60;
    if (hrs < 0) hrs += 24;
    const otThresholdRow = db.prepare(
      "SELECT value FROM policy_config WHERE key = 'ot_threshold_hours'"
    ).get();
    const otThreshold = parseFloat(otThresholdRow?.value || '12');
    if (hrs > otThreshold) { isOT = 1; otMinutes = Math.round((hrs - otThreshold) * 60); }
  }

  // 5. Left late (20+ min past shift end)
  let isLeftLate = 0, leftLateMinutes = 0;
  if (outTime && shift && shift.end_time && isPresent) {
    const [oh3, om3] = outTime.split(':').map(Number);
    const [eh3, em3] = shift.end_time.split(':').map(Number);
    if (!isNaN(oh3) && !isNaN(eh3)) {
      let outMin = oh3 * 60 + (om3 || 0);
      let endMin = eh3 * 60 + (em3 || 0);
      if (isNight) {
        if (endMin < 12 * 60) endMin += 24 * 60;
        if (outMin < 12 * 60) outMin += 24 * 60;
      }
      const diff = outMin - endMin;
      if (diff >= 20) { isLeftLate = 1; leftLateMinutes = diff; }
    }
  }

  // 6. Write all 6 metric pairs + shift assignment in one UPDATE
  db.prepare(`
    UPDATE attendance_processed SET
      is_late_arrival = ?, late_by_minutes = ?,
      is_early_departure = ?, early_by_minutes = ?,
      is_overtime = ?, overtime_minutes = ?,
      is_left_late = ?, left_late_minutes = ?,
      is_night_shift = CASE WHEN ? = 1 THEN 1 ELSE is_night_shift END,
      shift_id = COALESCE(shift_id, ?),
      shift_detected = COALESCE(shift_detected, ?)
    WHERE id = ?
  `).run(
    isLate, lateBy,
    isEarly, earlyBy,
    isOT, otMinutes,
    isLeftLate, leftLateMinutes,
    isNight ? 1 : 0,
    shift?.id || null,
    shift?.name || null,
    recordId
  );
}

/**
 * Resolve a miss punch correction
 *
 * April 2026: Every HR resolution now enters a "pending" finance-verification
 * state. Finance must approve/reject before the month can be finalised. This
 * closes the loophole where HR could silently fabricate in/out times without
 * any second-pair-of-eyes review.
 */
function resolveMissPunch(db, recordId, { inTime, outTime, source, remark, convertToLeave, leaveType }) {
  const { logAudit } = require('../database/db');

  const existing = db.prepare('SELECT * FROM attendance_processed WHERE id = ?').get(recordId);
  if (!existing) throw new Error('Record not found');

  const updates = {
    miss_punch_resolved: 1,
    stage_2_done: 1,
    correction_source: source,
    correction_remark: remark,
    // New: every resolution goes into "pending finance review"
    miss_punch_finance_status: 'pending',
    miss_punch_finance_reviewed_by: null,
    miss_punch_finance_reviewed_at: null,
    miss_punch_finance_notes: null
  };

  if (convertToLeave) {
    updates.status_final = leaveType || 'A';
  } else {
    if (inTime) updates.in_time_final = inTime;
    if (outTime) updates.out_time_final = outTime;
  }

  // Calculate actual hours if both times available
  if (updates.in_time_final && updates.out_time_final) {
    const [inH, inM] = updates.in_time_final.split(':').map(Number);
    const [outH, outM] = updates.out_time_final.split(':').map(Number);
    let hours = (outH * 60 + outM - (inH * 60 + inM)) / 60;
    if (hours < 0) hours += 24; // Overnight
    updates.actual_hours = Math.round(hours * 100) / 100;
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  db.prepare(`UPDATE attendance_processed SET ${setClauses} WHERE id = ?`).run(...values, recordId);

  // ── Recalculate shift metrics using corrected times ──
  // Without this, is_late_arrival / is_early_departure / is_overtime / is_left_late
  // remain frozen from the original import-time calculation, producing stale data
  // in day_calculations.late_count, late-coming analytics, and potential salary
  // deductions. See: Nandini 60131 Apr 2026 — 163-min stale late flag after
  // correcting IN from 10:43 → 07:55.
  if (!convertToLeave) {
    const finalIn = updates.in_time_final || existing.in_time_final || existing.in_time_original;
    const finalOut = updates.out_time_final || existing.out_time_final || existing.out_time_original;
    recalcShiftMetrics(db, recordId, finalIn, finalOut, existing.status_original);
  }

  // Audit log
  if (inTime && existing.in_time_original !== inTime) {
    logAudit('attendance_processed', recordId, 'in_time', existing.in_time_original, inTime, 'Stage 2', `${source}: ${remark}`);
  }
  if (outTime && existing.out_time_original !== outTime) {
    logAudit('attendance_processed', recordId, 'out_time', existing.out_time_original, outTime, 'Stage 2', `${source}: ${remark}`);
  }

  return { success: true };
}

/**
 * Bulk resolve miss punches
 */
function bulkResolveMissPunches(db, recordIds, { inTime, outTime, source, remark }) {
  const results = { success: 0, failed: 0, errors: [] };

  const txn = db.transaction(() => {
    for (const id of recordIds) {
      try {
        resolveMissPunch(db, id, { inTime, outTime, source, remark });
        results.success++;
      } catch (e) {
        results.failed++;
        results.errors.push({ id, error: e.message });
      }
    }
  });

  txn();
  return results;
}

module.exports = { detectMissPunches, applyMissPunchFlags, resolveMissPunch, bulkResolveMissPunches };
