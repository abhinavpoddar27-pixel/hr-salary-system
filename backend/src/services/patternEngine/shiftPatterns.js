'use strict';
/**
 * Phase 2b — Shift Pattern Detectors (7.1 – 7.2)
 */

const { parseTimeToMinutes } = require('../employeeProfileService');

const PRESENT = ['P', 'WOP', '½P', 'WO½P'];

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

// Linear regression helper: returns slope
function linRegSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const sumX  = xs.reduce((s, v) => s + v, 0);
  const sumY  = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sumXX = xs.reduce((s, v) => s + v * v, 0);
  const denom = n * sumXX - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

// ── 7.1 Night Shift Fatigue ────────────────────────────────────────────────
function detectNightShiftFatigue(records, context) {
  const { startDate } = context;
  const nightPresent = records.filter(r =>
    r.is_night_shift && PRESENT.includes(r.status) && r.actual_hours > 0
  );

  if (nightPresent.length < 15) return null;

  // Group by week
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const weeklyHours = {};
  for (const r of nightPresent) {
    const weekNum = Math.floor((new Date(r.date + 'T12:00:00').getTime() - startMs) / (7 * 86400000));
    if (!weeklyHours[weekNum]) weeklyHours[weekNum] = { sum: 0, count: 0 };
    weeklyHours[weekNum].sum += r.actual_hours;
    weeklyHours[weekNum].count++;
  }

  const weeks = Object.entries(weeklyHours)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([wk, d]) => ({ week: Number(wk), avgHours: d.sum / d.count }));

  if (weeks.length < 3) return null;

  const xs = weeks.map(w => w.week);
  const ys = weeks.map(w => w.avgHours);
  const slope = linRegSlope(xs, ys);

  // Night vs day miss-punch comparison
  const nightRecs = records.filter(r => r.is_night_shift);
  const dayRecs   = records.filter(r => !r.is_night_shift);
  const nightMP   = nightRecs.filter(r => r.is_miss_punch).length;
  const dayMP     = dayRecs.filter(r => r.is_miss_punch).length;
  const nightMissRate = nightRecs.length > 0 ? nightMP / nightRecs.length : 0;
  const dayMissRate   = dayRecs.length   > 0 ? dayMP   / dayRecs.length   : 0;

  const fatigueBySlope = slope < -0.30;
  const fatigueByMP    = nightMissRate > 2 * dayMissRate && nightMP >= 3;

  if (!fatigueBySlope && !fatigueByMP) return null;

  const details = [];
  if (fatigueBySlope) details.push(`hours declining ${Math.abs(Math.round(slope * 60))} min/week`);
  if (fatigueByMP)    details.push(`night miss-punch rate ${Math.round(nightMissRate * 100)}% vs day ${Math.round(dayMissRate * 100)}%`);

  return {
    id: 'NIGHT_SHIFT_FATIGUE',
    detected: true,
    severity: 'High',
    score: clamp(Math.round(Math.abs(slope) * 150)),
    category: 'shift',
    label: 'Night Shift Fatigue',
    detail: details.join('; '),
    evidence: { weeklyHours: weeks, slope: Math.round(slope * 100) / 100, nightMissRate: r1(nightMissRate), dayMissRate: r1(dayMissRate) },
    hrAction: 'SAFETY: Night shift fatigue detected — declining hours and/or rising miss-punches on nights. Recommend mandatory rotation off night shift.',
    value: Math.round(Math.abs(slope) * 100)
  };
}

// ── 7.2 Shift Transition Shock ─────────────────────────────────────────────
function detectShiftTransitionShock(records, context) {
  const { kpis } = context;
  if (!records.length) return null;

  // Find shift transitions (is_night_shift changes between consecutive records)
  const transitions = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    if (!!prev.is_night_shift !== !!curr.is_night_shift) {
      transitions.push({ transitionDate: curr.date, fromNight: !!prev.is_night_shift, returnIdx: i });
    }
  }

  if (!transitions.length) return null;

  // Baselines
  const baselineLateRate  = (kpis.lateRate || 0) / 100;
  const baselineAvgHours  = kpis.avgHoursWorked || 0;

  const evidence = [];
  let worstDetected = false;

  for (const t of transitions) {
    const afterRecs = records
      .slice(t.returnIdx, t.returnIdx + 10)
      .filter(r => r.dow !== 0 && PRESENT.includes(r.status))
      .slice(0, 7);

    if (afterRecs.length < 3) continue;

    const postLateCount = afterRecs.filter(r => r.is_late_arrival).length;
    const postLateRate  = postLateCount / afterRecs.length;
    const postAvgHours  = afterRecs.reduce((s, r) => s + (r.actual_hours || 0), 0) / afterRecs.length;

    const shock = (baselineLateRate > 0 && postLateRate > baselineLateRate * 2)
               || (baselineAvgHours > 0 && postAvgHours < baselineAvgHours - 0.75);

    if (shock) {
      worstDetected = true;
      evidence.push({
        transitionDate:   t.transitionDate,
        fromNight:        t.fromNight,
        postLateRate:     r1(postLateRate * 100),
        baselineLateRate: r1(baselineLateRate * 100),
        postAvgHours:     Math.round(postAvgHours * 100) / 100
      });
    }
  }

  if (!worstDetected) return null;

  return {
    id: 'SHIFT_TRANSITION_SHOCK',
    detected: true,
    severity: 'Medium',
    score: clamp(evidence.length * 30),
    category: 'shift',
    label: 'Shift Transition Adjustment Difficulty',
    detail: `${evidence.length} shift rotation(s) followed by measurable lateness or hour dip`,
    evidence,
    hrAction: 'Circadian disruption after shift rotation — build 1-2 day buffer into rotation schedules',
    value: evidence.length
  };
}

module.exports = { detectNightShiftFatigue, detectShiftTransitionShock };
