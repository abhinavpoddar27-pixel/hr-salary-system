'use strict';
/**
 * Phase 2a — Individual Behavioral Pattern Detectors (1.1 – 1.8)
 *
 * Interface: detectXxx(records, context) → result | null
 * records: enriched attendance_processed rows (with .status and .dow fields added)
 * context: { db, employee, employeeCode, startDate, endDate,
 *             monthsInRange, kpis, shift, monthlyBreakdown, regularityScore }
 */

const { parseTimeToMinutes } = require('../employeeProfileService');

const PRESENT      = ['P', 'WOP', '½P', 'WO½P'];
const FULL_PRESENT = ['P', 'WOP'];
const HALF_PRESENT = ['½P', 'WO½P'];

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

// ── 1.1 Sandwich Leave ──────────────────────────────────────────────────────
function detectSandwichLeave(records, context) {
  const { db, employee } = context;
  const weeklyOffDay = employee.weekly_off_day ?? 0; // default Sunday

  const absenceDates = records
    .filter(r => ['A', 'CL', 'SL', 'EL', 'L'].includes(r.status))
    .map(r => r.date);

  if (absenceDates.length < 3) return null;

  const dateSet = new Set(records.map(r => r.date));

  function isWeekendOrHoliday(dateStr) {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    if (dow === weeklyOffDay) return true;
    try {
      const h = db.prepare('SELECT date FROM holidays WHERE date = ?').get(dateStr);
      if (h) return true;
    } catch (_) {}
    return false;
  }

  function prevDay(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  function nextDay(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  let sandwichCount = 0;
  const evidence = [];
  for (const date of absenceDates) {
    const prev = prevDay(date);
    const next = nextDay(date);
    if (isWeekendOrHoliday(prev) || isWeekendOrHoliday(next)) {
      sandwichCount++;
      evidence.push(date);
    }
  }

  const sandwichRatio = sandwichCount / absenceDates.length;
  if (sandwichRatio <= 0.50 || sandwichCount < 3) return null;

  return {
    id: 'SANDWICH_LEAVE',
    detected: true,
    severity: sandwichRatio > 0.70 ? 'High' : 'Medium',
    score: clamp(Math.round(sandwichRatio * 100)),
    category: 'individual',
    label: 'Sandwich Leave Pattern',
    detail: `${sandwichCount} of ${absenceDates.length} leave days adjacent to weekends/holidays (${Math.round(sandwichRatio * 100)}%)`,
    evidence,
    hrAction: 'Review leave patterns — employee may be extending breaks by placing leave next to weekends/holidays',
    value: Math.round(sandwichRatio * 100)
  };
}

// ── 1.2 Ghost Hours ─────────────────────────────────────────────────────────
function detectGhostHours(records, context) {
  const presentWithTimes = records.filter(r =>
    PRESENT.includes(r.status) &&
    (r.in_time_final || r.in_time_original) &&
    (r.out_time_final || r.out_time_original) &&
    r.actual_hours > 0
  );

  if (presentWithTimes.length < 4) return null;

  const flagged = [];
  for (const r of presentWithTimes) {
    let inMins  = parseTimeToMinutes(r.in_time_final  || r.in_time_original);
    let outMins = parseTimeToMinutes(r.out_time_final || r.out_time_original);
    if (inMins === null || outMins === null) continue;
    // Restore values (parseTimeToMinutes does night-shift normalization)
    if (inMins < 0)  inMins  += 1440;
    if (outMins < 0) outMins += 1440;
    if (outMins < inMins) outMins += 1440; // overnight span
    const punchSpan = (outMins - inMins) / 60;
    if (punchSpan <= 0) continue;
    const ratio = r.actual_hours / punchSpan;
    if (ratio < 0.75) {
      flagged.push({ date: r.date, actualHours: r.actual_hours, punchSpan: Math.round(punchSpan * 100) / 100, ratio: Math.round(ratio * 100) / 100 });
    }
  }

  const ghostRate = flagged.length / presentWithTimes.length;
  if (ghostRate <= 0.25 || flagged.length < 4) return null;

  return {
    id: 'GHOST_HOURS',
    detected: true,
    severity: ghostRate > 0.40 ? 'High' : 'Medium',
    score: clamp(Math.round(ghostRate * 150)),
    category: 'individual',
    label: 'Ghost Hours',
    detail: `${flagged.length} of ${presentWithTimes.length} days: actual hours < 75% of punch span (${Math.round(ghostRate * 100)}%)`,
    evidence: flagged.slice(0, 10),
    hrAction: 'Cross-reference with production logs — significant gap between punch span and actual hours',
    value: Math.round(ghostRate * 100)
  };
}

// ── 1.3 Absence Clustering ──────────────────────────────────────────────────
function detectAbsenceClustering(records, context) {
  const absences = records.filter(r => r.status === 'A' && r.dow !== 0);
  if (absences.length < 5) return null;

  // Day-of-week distribution (Mon=1..Sat=6)
  const dowCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dowTotals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const r of records) {
    if (r.dow >= 1 && r.dow <= 6) {
      dowTotals[r.dow]++;
      if (r.status === 'A') dowCounts[r.dow]++;
    }
  }
  const activeDOWs = Object.keys(dowTotals).filter(d => dowTotals[d] > 0);
  const expected = absences.length / activeDOWs.length;

  let chiSq = 0;
  let maxDOW = null, maxCount = 0;
  for (const d of activeDOWs) {
    const obs = dowCounts[d] || 0;
    chiSq += Math.pow(obs - expected, 2) / Math.max(expected, 0.01);
    if (obs > maxCount) { maxCount = obs; maxDOW = d; }
  }

  // Payday proximity (within 2 days of 1st or last of month)
  let paydayAbsences = 0;
  for (const r of absences) {
    const day = parseInt(r.date.split('-')[2], 10);
    const year = parseInt(r.date.split('-')[0], 10);
    const month = parseInt(r.date.split('-')[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day <= 2 || day >= daysInMonth - 1) paydayAbsences++;
  }
  const paydayRate = paydayAbsences / absences.length;

  const chiDetected  = chiSq > 9.49;
  const paydayDetected = paydayRate > 0.30;
  if (!chiDetected && !paydayDetected) return null;

  const DOW_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
  let detail = '';
  if (chiDetected && maxDOW) detail += `Highest concentration on ${DOW_NAMES[maxDOW]} (${maxCount} absences). `;
  if (paydayDetected) detail += `${Math.round(paydayRate * 100)}% of absences within 2 days of month start/end.`;

  const score = Math.max(
    chiDetected    ? clamp(Math.round(chiSq * 5)) : 0,
    paydayDetected ? clamp(Math.round(paydayRate * 150)) : 0
  );

  return {
    id: 'ABSENCE_CLUSTERING',
    detected: true,
    severity: (chiSq > 15 || paydayRate > 0.50) ? 'High' : 'Medium',
    score,
    category: 'individual',
    label: 'Absence Clustering',
    detail: detail.trim(),
    evidence: { chiSquared: Math.round(chiSq * 10) / 10, paydayAbsenceRate: r1(paydayRate), dowCounts },
    hrAction: 'Absences show non-random pattern — investigate potential moonlighting or recurring external obligations',
    value: Math.round(chiSq * 10) / 10
  };
}

// ── 1.4 Break Pattern Drift ─────────────────────────────────────────────────
function detectBreakPatternDrift(records, context) {
  const { monthlyBreakdown, shift } = context;
  const mths = (monthlyBreakdown || []).filter(m => m.avgHours !== null);
  if (mths.length < 3) return null;

  // Expected hours from shift
  let shiftHours = 10;
  if (shift && shift.startTime && shift.endTime) {
    let s = parseTimeToMinutes(shift.startTime) || 0;
    let e = parseTimeToMinutes(shift.endTime)   || 0;
    if (s < 0) s += 1440;
    if (e < 0) e += 1440;
    if (e < s) e += 1440;
    shiftHours = (e - s) / 60;
  }

  const n = mths.length;
  const xs = mths.map((_, i) => i);
  const ys = mths.map(m => m.avgHours);
  const sumX = xs.reduce((s, v) => s + v, 0);
  const sumY = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sumXX = xs.reduce((s, v) => s + v * v, 0);
  const slope = (n * sumXY - sumX * sumY) / Math.max(n * sumXX - sumX * sumX, 0.001);
  const latestAvg = ys[n - 1];

  if (slope >= -0.15 || latestAvg >= shiftHours - 0.5) return null;

  return {
    id: 'BREAK_DRIFT',
    detected: true,
    severity: slope < -0.30 ? 'High' : 'Medium',
    score: clamp(Math.round(Math.abs(slope) * 200)),
    category: 'individual',
    label: 'Working Hours Declining',
    detail: `Average hours dropping ~${Math.abs(Math.round(slope * 60))} min/month. Latest month avg: ${latestAvg}h vs shift expectation ${Math.round(shiftHours * 10) / 10}h`,
    evidence: mths.map(m => ({ month: m.month, year: m.year, avgHours: m.avgHours })),
    hrAction: 'Working hours declining month-over-month — early warning for burnout or disengagement',
    value: Math.round(slope * 100) / 100
  };
}

// ── 1.5 Miss Punch Escalation ───────────────────────────────────────────────
function detectMissPunchEscalation(records, context) {
  const { monthlyBreakdown } = context;
  const mths = monthlyBreakdown || [];
  if (mths.length < 3) return null;

  const counts = mths.map(m => m.missPunches || 0);
  const latest = counts[counts.length - 1];
  const prior  = counts.slice(0, -1);
  const rollingAvg = prior.reduce((s, v) => s + v, 0) / prior.length;

  if (!(latest > rollingAvg * 2 && latest >= 4)) return null;

  return {
    id: 'MISS_PUNCH_ESCALATION',
    detected: true,
    severity: latest >= 8 ? 'High' : 'Medium',
    score: clamp(Math.round((latest / Math.max(rollingAvg, 1)) * 30)),
    category: 'individual',
    label: 'Miss Punch Escalation',
    detail: `Latest month: ${latest} miss punches vs prior avg ${Math.round(rollingAvg * 10) / 10}`,
    evidence: mths.map(m => ({ month: m.month, year: m.year, missPunchCount: m.missPunches })),
    hrAction: 'Sharply rising miss-punches — remind employee of biometric policy, check if paired with other patterns',
    value: latest
  };
}

// ── 1.6 Half-Day Addiction ──────────────────────────────────────────────────
function detectHalfDayAddiction(records, context) {
  const halfDays = records.filter(r => r.status === '½P' || r.status === 'WO½P').length;
  const allPartial = records.filter(r =>
    ['½P', 'WO½P', 'A', 'CL', 'SL', 'EL', 'L'].includes(r.status)
  ).length;

  if (allPartial < 3) return null;
  const ratio = halfDays / allPartial;
  if (ratio <= 0.60 || halfDays < 4) return null;

  return {
    id: 'HALF_DAY_ADDICTION',
    detected: true,
    severity: 'Low',
    score: clamp(Math.round(ratio * 100)),
    category: 'individual',
    label: 'Disproportionate Half-Day Usage',
    detail: `${halfDays} half-days = ${Math.round(ratio * 100)}% of all leave/absence days`,
    evidence: records.filter(r => r.status === '½P' || r.status === 'WO½P').map(r => r.date),
    hrAction: 'Disproportionate half-day usage — may indicate recurring partial obligations. Consider offering flexible schedule.',
    value: Math.round(ratio * 100)
  };
}

// ── 1.7 LIFO (Last-In First-Out) ───────────────────────────────────────────
function detectLIFO(records, context) {
  const { db, employee, employeeCode } = context;
  const dept = employee.department;
  if (!dept) return null;

  // Check dept size with a quick count
  let deptSize = 0;
  try {
    const ds = db.prepare(`
      SELECT COUNT(*) AS c FROM employees
      WHERE department = ? AND status = 'Active'
    `).get(dept);
    deptSize = ds ? ds.c : 0;
  } catch (_) {}
  if (deptSize < 3) return null;

  const workingPresent = records.filter(r =>
    r.dow !== 0 && FULL_PRESENT.includes(r.status) &&
    (r.in_time_final || r.in_time_original) &&
    (r.out_time_final || r.out_time_original)
  );

  if (workingPresent.length < 15) return null;

  // Sample at most 30 dates
  const sampled = workingPresent.length > 30
    ? workingPresent.filter((_, i) => i % Math.ceil(workingPresent.length / 30) === 0).slice(0, 30)
    : workingPresent;

  let totalArrivalPct = 0, totalDeparturePct = 0, validDays = 0;

  for (const r of sampled) {
    try {
      const deptPresent = db.prepare(`
        SELECT ap.employee_code,
               COALESCE(ap.in_time_final,  ap.in_time_original)  AS in_t,
               COALESCE(ap.out_time_final, ap.out_time_original) AS out_t
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date = ? AND ap.is_night_out_only = 0
          AND e.department = ?
          AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP')
      `).all(r.date, dept);

      if (deptPresent.length < 3) continue;

      const empIn  = parseTimeToMinutes(r.in_time_final  || r.in_time_original);
      const empOut = parseTimeToMinutes(r.out_time_final || r.out_time_original);
      if (empIn === null || empOut === null) continue;

      const arrivals   = deptPresent.map(d => parseTimeToMinutes(d.in_t)).filter(v => v !== null).sort((a, b) => a - b);
      const departures = deptPresent.map(d => parseTimeToMinutes(d.out_t)).filter(v => v !== null).sort((a, b) => a - b);

      if (arrivals.length < 2 || departures.length < 2) continue;

      // Rank: higher = later arrival, lower = earlier departure
      const arrivalRank   = arrivals.findIndex(v => v >= empIn) + 1;
      const departureRank = departures.length - departures.findIndex(v => v >= empOut);

      totalArrivalPct   += arrivalRank   / arrivals.length;
      totalDeparturePct += departureRank / departures.length;
      validDays++;
    } catch (_) {}
  }

  if (validDays < 15) return null;

  const lifoScore = (totalArrivalPct + totalDeparturePct) / (2 * validDays);
  if (lifoScore <= 0.80) return null;

  return {
    id: 'LIFO',
    detected: true,
    severity: lifoScore > 0.90 ? 'High' : 'Medium',
    score: clamp(Math.round(lifoScore * 100)),
    category: 'individual',
    label: 'Last-In First-Out Pattern',
    detail: `Consistently arrives late and leaves early relative to ${dept} peers (LIFO score: ${Math.round(lifoScore * 100)}%)`,
    evidence: { lifoScore: Math.round(lifoScore * 100) / 100, sampledDays: validDays },
    hrAction: 'Consistently arrives last and leaves first in department — minimum-effort engagement signal',
    value: Math.round(lifoScore * 100)
  };
}

// ── 1.8 Post-Leave Slump ────────────────────────────────────────────────────
function detectPostLeaveSlump(records, context) {
  const { kpis } = context;
  const baselineLateRate  = (kpis.lateRate || 0) / 100;
  const baselineAvgHours  = kpis.avgHoursWorked || 0;

  // Find leave blocks: ≥3 consecutive working days absent
  const workingRecs = records.filter(r => r.dow !== 0);
  const leaveStatuses = ['A', 'CL', 'SL', 'EL', 'L'];

  const blocks = [];
  let blockStart = null, blockLen = 0;
  for (const r of workingRecs) {
    if (leaveStatuses.includes(r.status)) {
      if (!blockStart) blockStart = r.date;
      blockLen++;
    } else {
      if (blockStart && blockLen >= 3) blocks.push({ start: blockStart, end: workingRecs[workingRecs.indexOf(r) - 1]?.date, len: blockLen, returnIdx: workingRecs.indexOf(r) });
      blockStart = null; blockLen = 0;
    }
  }

  if (blocks.length === 0) return null;

  const evidence = [];
  let detected = false;

  for (const block of blocks) {
    const afterRecs = workingRecs.slice(block.returnIdx, block.returnIdx + 7);
    if (afterRecs.length < 3) continue;
    const presentAfter = afterRecs.filter(r => PRESENT.includes(r.status));
    const postLateCount = presentAfter.filter(r => r.is_late_arrival).length;
    const postLateRate  = presentAfter.length > 0 ? postLateCount / presentAfter.length : 0;
    const postAvgHours  = presentAfter.length > 0
      ? presentAfter.reduce((s, r) => s + (r.actual_hours || 0), 0) / presentAfter.length
      : 0;

    const slump = (baselineLateRate > 0 && postLateRate > baselineLateRate * 2)
                || (baselineAvgHours > 0 && postAvgHours < baselineAvgHours - 0.75);
    if (slump) {
      detected = true;
      evidence.push({
        leaveStart: block.start, leaveEnd: block.end, leaveDays: block.len,
        postLateRate: r1(postLateRate * 100),
        postAvgHours: Math.round(postAvgHours * 100) / 100
      });
    }
  }

  if (!detected) return null;

  return {
    id: 'POST_LEAVE_SLUMP',
    detected: true,
    severity: 'Low',
    score: clamp(evidence.length * 25),
    category: 'individual',
    label: 'Post-Leave Re-engagement Slump',
    detail: `${evidence.length} leave block(s) followed by measurable performance dip`,
    evidence,
    hrAction: 'Shows re-engagement difficulty after extended leave — supervisors should expect adjustment period',
    value: evidence.length
  };
}

module.exports = {
  detectSandwichLeave,
  detectGhostHours,
  detectAbsenceClustering,
  detectBreakPatternDrift,
  detectMissPunchEscalation,
  detectHalfDayAddiction,
  detectLIFO,
  detectPostLeaveSlump
};
