/**
 * Miss Punch Detection Service
 *
 * Runs AFTER night shift pairing to avoid false positives.
 * ~145 miss punch cases per month expected from actual data.
 */

const { calcShiftMetrics } = require('../utils/shiftMetrics');

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
  //
  // Uses the shared calcShiftMetrics utility — same formula as import.js and
  // attendance.js recalculate-metrics. Variant-aware: employees on shifts with
  // night_start_time use those timings for evening punches.
  //
  // Gap 1+2 fix: shift_id / is_night_shift are now DIRECTLY assigned (no
  // COALESCE / one-way CASE). When a correction flips an evening punch to a
  // day-time punch, is_night_shift goes back to 0 and the day shift is
  // recorded — previously both stayed frozen to the original detection.
  //
  // Gap 3 fix: if this record was part of a night_shift_pairs row and the
  // corrected times are no longer a night shift, dissolve the pair and
  // re-flag the OTHER half of the pair as a miss-punch.
  if (!convertToLeave) {
    const finalIn = updates.in_time_final || existing.in_time_final || existing.in_time_original;
    const finalOut = updates.out_time_final || existing.out_time_final || existing.out_time_original;

    if (finalIn) {
      // Look up employee's assigned shift (no NIGHT fallback — variant-aware)
      const empRow = db.prepare(`
        SELECT e.default_shift_id
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.id = ?
      `).get(recordId);

      const allShifts = db.prepare('SELECT * FROM shifts').all();
      const shiftById = {};
      const shiftByCode = {};
      for (const s of allShifts) { shiftById[s.id] = s; shiftByCode[s.code] = s; }
      const defaultDayShift = shiftByCode['DAY'] || allShifts[0];
      const empShift = empRow?.default_shift_id ? shiftById[empRow.default_shift_id] : null;
      const shift = empShift || defaultDayShift;

      const otThresholdRow = db.prepare(
        "SELECT value FROM policy_config WHERE key = 'ot_threshold_hours'"
      ).get();
      const otThreshold = parseFloat(otThresholdRow?.value || '12');

      const m = calcShiftMetrics({
        inTime: finalIn,
        outTime: finalOut,
        statusOriginal: existing.status_original,
        shift,
        otThresholdHours: otThreshold
      });

      // DIRECT assignment — corrections can flip night→day, shift can change
      db.prepare(`
        UPDATE attendance_processed SET
          is_late_arrival = ?, late_by_minutes = ?,
          is_early_departure = ?, early_by_minutes = ?,
          is_overtime = ?, overtime_minutes = ?,
          is_left_late = ?, left_late_minutes = ?,
          is_night_shift = ?,
          shift_id = ?,
          shift_detected = ?
        WHERE id = ?
      `).run(
        m.isLate, m.lateBy,
        m.isEarly, m.earlyBy,
        m.isOT, m.otMinutes,
        m.isLeftLate, m.leftLateMinutes,
        m.isNight,
        m.shiftId,
        m.shiftName,
        recordId
      );

      // ── Gap 3: Night pair dissolution ──
      // If this record was paired as a night shift and the corrected punch is
      // no longer a night punch, dissolve the pair so the OTHER record is no
      // longer suppressed from Stage 6.
      if (m.isNight === 0) {
        const pair = db.prepare(`
          SELECT * FROM night_shift_pairs
          WHERE (in_record_id = ? OR out_record_id = ?)
            AND is_rejected = 0
          ORDER BY id DESC LIMIT 1
        `).get(recordId, recordId);

        if (pair) {
          db.prepare(`
            UPDATE night_shift_pairs
            SET is_rejected = 1, is_confirmed = 0
            WHERE id = ?
          `).run(pair.id);

          const otherId = pair.in_record_id === recordId ? pair.out_record_id : pair.in_record_id;
          if (otherId) {
            // Clear night-pair flags on the other record
            db.prepare(`
              UPDATE attendance_processed
              SET is_night_out_only = 0,
                  night_pair_date = NULL,
                  night_pair_confidence = NULL
              WHERE id = ?
            `).run(otherId);

            // Re-flag the other record as a miss punch if its IN/OUT is incomplete
            const other = db.prepare('SELECT * FROM attendance_processed WHERE id = ?').get(otherId);
            if (other && PRESENT_STATUSES.includes(other.status_final || other.status_original)) {
              const oIn = other.in_time_final || other.in_time_original;
              const oOut = other.out_time_final || other.out_time_original;
              let otherIssue = null;
              if (!oIn && !oOut) otherIssue = 'NO_PUNCH';
              else if (!oIn && oOut) otherIssue = 'MISSING_IN';
              else if (oIn && !oOut) {
                const h = parseInt(oIn.split(':')[0]);
                otherIssue = h >= 18 ? 'NIGHT_UNPAIRED' : 'MISSING_OUT';
              }
              if (otherIssue) {
                db.prepare(`
                  UPDATE attendance_processed
                  SET is_miss_punch = 1, miss_punch_type = ?, stage_2_done = 0
                  WHERE id = ?
                `).run(otherIssue, otherId);
              }
            }

            logAudit('night_shift_pairs', pair.id, 'is_rejected', '0', '1', 'Stage 2',
              `Pair dissolved: record ${recordId} corrected to non-night`);
          }
        }
      }
    }
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
