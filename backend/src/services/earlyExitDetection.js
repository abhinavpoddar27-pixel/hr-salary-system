// Early Exit Detection Service — April 2026
//
// Detects employees who punched out before their assigned shift end time.
// Gate passes (short_leaves) provide exemption or reduce flagged minutes.
// Results are upserted into early_exit_detections and attendance_processed
// is updated with is_early_departure/early_by_minutes.

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Detect early exits for a given date.
 * @param {Object} db - better-sqlite3 database instance
 * @param {string} targetDate - YYYY-MM-DD
 * @returns {{ detected: number, exempted: number, skipped: number }}
 */
function detectEarlyExits(db, targetDate) {
  // 1. Query attendance_processed for the target date
  const records = db.prepare(`
    SELECT ap.id, ap.employee_id, ap.employee_code, ap.shift_id,
           COALESCE(ap.out_time_final, ap.out_time_original) as actual_out,
           COALESCE(ap.status_final, ap.status_original) as status,
           ap.is_night_out_only,
           e.name as employee_name, e.department, e.company
    FROM attendance_processed ap
    JOIN employees e ON e.id = ap.employee_id
    WHERE ap.date = ?
      AND ap.is_night_out_only = 0
      AND COALESCE(ap.status_final, ap.status_original) IN ('P', '½P', 'WOP')
      AND COALESCE(ap.out_time_final, ap.out_time_original) IS NOT NULL
      AND ap.shift_id IS NOT NULL
  `).all(targetDate);

  let detected = 0, exempted = 0, skipped = 0;

  for (const rec of records) {
    // 2. Get shift end_time
    const shift = db.prepare('SELECT code, end_time FROM shifts WHERE id = ?').get(rec.shift_id);
    if (!shift || !shift.end_time) { skipped++; continue; }

    const shiftEndMinutes = timeToMinutes(shift.end_time);
    const punchOutMinutes = timeToMinutes(rec.actual_out);

    // 3. minutes_early = shift_end - punch_out. Skip if <= 0 (left on time or late).
    const minutesEarly = shiftEndMinutes - punchOutMinutes;
    if (minutesEarly <= 0) { skipped++; continue; }

    // 4. Check for active gate pass
    const gatePass = db.prepare(`
      SELECT id, duration_hours, authorized_leave_until
      FROM short_leaves
      WHERE employee_code = ? AND date = ? AND cancelled_at IS NULL
    `).get(rec.employee_code, targetDate);

    let hasGatePass = 0, shortLeaveId = null, authorizedLeaveUntil = null;
    let gatePassOverageMinutes = 0, flaggedMinutes = minutesEarly;
    let detectionStatus = 'flagged';

    if (gatePass) {
      hasGatePass = 1;
      shortLeaveId = gatePass.id;
      authorizedLeaveUntil = gatePass.authorized_leave_until;
      const authorizedMinutes = timeToMinutes(authorizedLeaveUntil);

      if (punchOutMinutes >= authorizedMinutes) {
        // Fully exempted — left at or after authorized time
        detectionStatus = 'exempted';
        flaggedMinutes = 0;
        exempted++;
      } else {
        // Overage — left before the authorized time
        gatePassOverageMinutes = authorizedMinutes - punchOutMinutes;
        flaggedMinutes = gatePassOverageMinutes;
      }
    }

    // 5. Update attendance_processed
    db.prepare(`
      UPDATE attendance_processed
      SET is_early_departure = 1, early_by_minutes = ?
      WHERE id = ?
    `).run(flaggedMinutes, rec.id);

    // 6. Upsert early_exit_detections
    db.prepare(`
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
        detection_status = CASE
          WHEN early_exit_detections.detection_status = 'actioned' THEN 'actioned'
          ELSE excluded.detection_status
        END,
        updated_at = datetime('now')
    `).run(
      rec.employee_id, rec.employee_code, rec.employee_name,
      rec.department, rec.company, targetDate,
      shift.code, shift.end_time, rec.actual_out, minutesEarly,
      hasGatePass, shortLeaveId, authorizedLeaveUntil,
      gatePassOverageMinutes, flaggedMinutes, detectionStatus
    );

    if (detectionStatus !== 'exempted') detected++;
  }

  return { detected, exempted, skipped };
}

module.exports = { detectEarlyExits };
