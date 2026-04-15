/**
 * Shared shift metric calculator — single source of truth for late/early/OT/
 * left-late computations. Used by:
 *   - routes/import.js        (post-import metric calculation)
 *   - routes/attendance.js    (POST /recalculate-metrics)
 *   - services/missPunch.js   (resolveMissPunch re-derivation)
 *
 * This function is pure — no DB access, no side effects. All DB lookups
 * (shift row, OT threshold) happen in the caller. That keeps it trivially
 * testable and guarantees the three call sites produce identical numbers.
 *
 * Variant handling:
 *   Shifts with a `night_start_time` / `night_end_time` (e.g. 12HR, DAY,
 *   NIGHT, DUBLE) get a second time window for evening punches. Shifts
 *   without night variants (10HR, 9HR, HK7:30, GEN) are day-only — evening
 *   punches on those are interpreted as overtime against the day window,
 *   not as a shift change.
 *
 *   Key behaviour change vs the previous code: the employee's assigned
 *   shift is ALWAYS used. The old fallback to the global NIGHT shift for
 *   evening punches has been REMOVED. Night variant timings come from the
 *   shift row itself, not from a separate row in the shifts table.
 */

function calcShiftMetrics({ inTime, outTime, statusOriginal, shift, otThresholdHours = 12 }) {
  const result = {
    isNight: 0, isLate: 0, lateBy: 0,
    isEarly: 0, earlyBy: 0,
    isOT: 0, otMinutes: 0,
    isLeftLate: 0, leftLateMinutes: 0,
    actualHours: null,
    shiftId: shift?.id || null,
    shiftName: shift?.name || null
  };

  if (!inTime) return result;

  const PRESENT = ['P', 'WOP'];
  const isPresent = PRESENT.includes(statusOriginal);
  const [inH, inM] = inTime.split(':').map(Number);
  if (isNaN(inH)) return result;

  // ── Night detection: purely from punch time ──
  const isNight = (inH >= 18 || inH < 6);
  result.isNight = isNight ? 1 : 0;

  // ── Variant-aware shift timings ──
  //   - 12HR employee punching at 20:05 → uses night_start=20:00, night_end=08:00
  //   - 10HR employee punching at 21:00 → no night variant → uses day start=09:00
  //     (this is overtime, not a shift change — late/early calc against day times)
  let effectiveStart, effectiveEnd;
  if (isNight && shift && shift.night_start_time) {
    effectiveStart = shift.night_start_time;
    effectiveEnd = shift.night_end_time || shift.end_time;
  } else if (shift) {
    effectiveStart = shift.start_time;
    effectiveEnd = shift.end_time;
  } else {
    return result; // No shift to calculate against
  }

  const inMin = inH * 60 + (inM || 0);
  const grace = shift.grace_minutes || 9;

  // ── Actual hours ──
  if (inTime && outTime) {
    const [oh, om] = outTime.split(':').map(Number);
    if (!isNaN(oh)) {
      let hrs = (oh * 60 + (om || 0) - inMin) / 60;
      if (hrs < 0) hrs += 24;
      result.actualHours = Math.round(hrs * 100) / 100;
    }
  }

  // ── Late arrival ──
  if (effectiveStart && isPresent) {
    const [sh, sm] = effectiveStart.split(':').map(Number);
    if (!isNaN(sh)) {
      let diffMin = inMin - (sh * 60 + (sm || 0));
      // Night shift: if diff is very negative (e.g., 20:05 vs next-day-interpreted 08:00),
      // wrap by adding 1440
      if (isNight && diffMin < -600) diffMin += 1440;
      // Day shift: negative means early, clamp to 0
      if (!isNight && diffMin < 0) diffMin = 0;
      if (diffMin > grace) {
        result.isLate = 1;
        result.lateBy = diffMin;
      }
    }
  }

  // ── Early departure ──
  if (outTime && effectiveEnd && isPresent
      && statusOriginal !== '½P' && statusOriginal !== 'WO½P') {
    const [oh, om] = outTime.split(':').map(Number);
    const [eh, em] = effectiveEnd.split(':').map(Number);
    if (!isNaN(oh) && !isNaN(eh)) {
      let outMin = oh * 60 + (om || 0);
      let endMin = eh * 60 + (em || 0);
      if (isNight && endMin < 720) endMin += 1440;
      if (isNight && outMin < 720) outMin += 1440;
      const diff = endMin - outMin;
      if (diff > grace) {
        result.isEarly = 1;
        result.earlyBy = diff;
      }
    }
  }

  // ── Overtime ──
  if (result.actualHours && result.actualHours > otThresholdHours && isPresent) {
    result.isOT = 1;
    result.otMinutes = Math.round((result.actualHours - otThresholdHours) * 60);
  }

  // ── Left late (20+ min past shift end) ──
  if (outTime && effectiveEnd && isPresent) {
    const [oh, om] = outTime.split(':').map(Number);
    const [eh, em] = effectiveEnd.split(':').map(Number);
    if (!isNaN(oh) && !isNaN(eh)) {
      let outMin = oh * 60 + (om || 0);
      let endMin = eh * 60 + (em || 0);
      if (isNight) {
        if (endMin < 12 * 60) endMin += 24 * 60;
        if (outMin < 12 * 60) outMin += 24 * 60;
      }
      const diff = outMin - endMin;
      if (diff >= 20) {
        result.isLeftLate = 1;
        result.leftLateMinutes = diff;
      }
    }
  }

  return result;
}

module.exports = { calcShiftMetrics };
