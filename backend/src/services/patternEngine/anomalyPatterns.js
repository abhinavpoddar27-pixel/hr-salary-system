'use strict';
/**
 * Phase 2b — Anomaly Pattern Detectors (8.1 – 8.4)
 */

const { parseTimeToMinutes } = require('../employeeProfileService');

const PRESENT = ['P', 'WOP', '½P', 'WO½P'];

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

// ── 8.1 Buddy Punching (phantom presence) ─────────────────────────────────
function detectBuddyPunching(records, context) {
  // Present but actual_hours < 1 AND > 0, no miss-punch flag
  const phantom = records.filter(r =>
    PRESENT.includes(r.status) &&
    r.actual_hours > 0 && r.actual_hours < 1 &&
    !r.is_miss_punch
  );

  if (phantom.length < 2) return null;

  return {
    id: 'BUDDY_PUNCHING',
    detected: true,
    severity: phantom.length >= 4 ? 'Critical' : 'High',
    score: clamp(phantom.length * 25),
    category: 'anomaly',
    label: 'Possible Buddy Punching',
    detail: `${phantom.length} day(s) marked Present but worked <1 hour without miss-punch flag`,
    evidence: phantom.map(r => ({
      date: r.date,
      actualHours: r.actual_hours,
      inTime:  r.in_time_final  || r.in_time_original,
      outTime: r.out_time_final || r.out_time_original
    })),
    hrAction: 'Possible buddy punching detected — employee marked Present but worked <1 hour on multiple days without miss-punch flag. Investigate with security team.',
    value: phantom.length
  };
}

// ── 8.2 Overtime Gaming ────────────────────────────────────────────────────
function detectOvertimeGaming(records, context) {
  const { shift } = context;
  let shiftHours = 10;
  if (shift && shift.startTime && shift.endTime) {
    let s = parseTimeToMinutes(shift.startTime) || 0;
    let e = parseTimeToMinutes(shift.endTime)   || 0;
    if (s < 0) s += 1440; if (e < 0) e += 1440;
    if (e < s) e += 1440;
    shiftHours = (e - s) / 60;
  }
  const otThresholdHours = shiftHours;

  const otRecords = records.filter(r => r.is_overtime && r.actual_hours > 0);
  if (otRecords.length < 5) return null;

  let barelyCount = 0;
  let overshootSum = 0;
  for (const r of otRecords) {
    const overshootMin = (r.actual_hours - otThresholdHours) * 60;
    if (overshootMin > 0 && overshootMin < 20) barelyCount++;
    overshootSum += Math.max(0, overshootMin);
  }

  const barelyRate = barelyCount / otRecords.length;
  if (barelyRate <= 0.70 || barelyCount < 5) return null;

  return {
    id: 'OVERTIME_GAMING',
    detected: true,
    severity: barelyRate > 0.85 ? 'High' : 'Medium',
    score: clamp(Math.round(barelyRate * 100)),
    category: 'anomaly',
    label: 'Overtime Gaming',
    detail: `${barelyCount} of ${otRecords.length} OT days cleared threshold by <20 min (${Math.round(barelyRate * 100)}%)`,
    evidence: { totalOTDays: otRecords.length, barelyDays: barelyCount, barelyRate: r1(barelyRate), avgOvershootMinutes: otRecords.length > 0 ? Math.round(overshootSum / otRecords.length) : 0 },
    hrAction: 'Employee consistently clears OT threshold by <20 minutes — potential OT gaming. Require supervisor sign-off on OT.',
    value: Math.round(barelyRate * 100)
  };
}

// ── 8.3 Coordinated Absence ────────────────────────────────────────────────
function detectCoordinatedAbsence(records, context) {
  const { db, employee } = context;
  const dept = employee.department;
  if (!dept) return null;

  const absentDates = records
    .filter(r => r.status === 'A')
    .map(r => r.date);

  if (!absentDates.length) return null;

  // Sample at most 20 dates
  const sampled = absentDates.length > 20
    ? absentDates.filter((_, i) => i % Math.ceil(absentDates.length / 20) === 0).slice(0, 20)
    : absentDates;

  const highRateDays = [];
  const maxRates = [];

  for (const date of sampled) {
    try {
      const absentRow = db.prepare(`
        SELECT COUNT(DISTINCT ap.employee_code) AS absent_count
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date = ? AND ap.is_night_out_only = 0
          AND e.department = ?
          AND COALESCE(ap.status_final, ap.status_original) = 'A'
      `).get(date, dept);

      const sizeRow = db.prepare(`
        SELECT COUNT(DISTINCT ap.employee_code) AS dept_size
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date = ? AND ap.is_night_out_only = 0 AND e.department = ?
      `).get(date, dept);

      const absentCount = absentRow ? (absentRow.absent_count || 0) : 0;
      const deptSize    = sizeRow   ? (sizeRow.dept_size || 1)    : 1;
      const rate = absentCount / deptSize;
      maxRates.push(rate);

      if (rate > 0.40) {
        highRateDays.push({ date, absentCount, deptSize, rate: r1(rate) });
      }
    } catch (_) {}
  }

  if (!highRateDays.length) return null;

  const maxRate = Math.max(...maxRates.filter(r => isFinite(r)), 0);

  return {
    id: 'COORDINATED_ABSENCE',
    detected: true,
    severity: maxRate > 0.50 ? 'Critical' : 'High',
    score: clamp(Math.round(maxRate * 100)),
    category: 'anomaly',
    label: 'Coordinated Absence',
    detail: `Employee absent on ${highRateDays.length} day(s) where >40% of ${dept} was also absent`,
    evidence: highRateDays,
    hrAction: 'Employee absent on days with unusually high department absence — possible coordinated action. Investigate for grievances.',
    value: Math.round(maxRate * 100)
  };
}

// ── 8.4 Clock Edge Punching ────────────────────────────────────────────────
function detectClockEdgePunching(records, context) {
  const { shift } = context;
  let shiftStartMin = 480; // default 08:00
  if (shift && shift.startTime) {
    const m = parseTimeToMinutes(shift.startTime);
    if (m !== null) shiftStartMin = m < 0 ? m + 1440 : m;
  }

  const presentWithIn = records.filter(r =>
    PRESENT.includes(r.status) && (r.in_time_final || r.in_time_original)
  );

  if (presentWithIn.length < 15) return null;

  let edgePunches = 0;
  for (const r of presentWithIn) {
    const am = parseTimeToMinutes(r.in_time_final || r.in_time_original);
    if (am === null) continue;
    const mins = am < 0 ? am + 1440 : am;
    let diff = Math.abs(mins - shiftStartMin);
    if (diff > 720) diff = 1440 - diff;
    if (diff <= 1) edgePunches++;
  }

  const exactRate = edgePunches / presentWithIn.length;
  if (exactRate <= 0.80) return null;

  return {
    id: 'CLOCK_EDGE_PUNCHING',
    detected: true,
    severity: 'Low',
    score: clamp(Math.round(exactRate * 100)),
    category: 'anomaly',
    label: 'Suspiciously Precise Punching',
    detail: `${edgePunches} of ${presentWithIn.length} days punched within ±1 minute of shift start (${Math.round(exactRate * 100)}%)`,
    evidence: { exactPunchDays: edgePunches, totalPresentDays: presentWithIn.length, rate: r1(exactRate) },
    hrAction: 'Statistically improbable arrival precision — worth a spot-check by security. May be innocent.',
    value: Math.round(exactRate * 100)
  };
}

module.exports = {
  detectBuddyPunching,
  detectOvertimeGaming,
  detectCoordinatedAbsence,
  detectClockEdgePunching
};
