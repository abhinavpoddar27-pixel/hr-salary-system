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
