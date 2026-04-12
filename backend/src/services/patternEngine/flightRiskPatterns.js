'use strict';
/**
 * Phase 2a — Flight Risk Pattern Detectors (2.1 – 2.4)
 *
 * Interface: detectXxx(records, context) → result | null
 */

const { parseTimeToMinutes } = require('../employeeProfileService');

const PRESENT = ['P', 'WOP', '½P', 'WO½P'];

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

// ── 2.1 Disengagement Cascade (composite flight-risk score) ────────────────
function detectDisengagementCascade(records, context) {
  const { kpis, monthlyBreakdown, behavioralPatterns, regularityScore } = context;
  const mb = monthlyBreakdown || [];
  if (mb.length < 2) return null;

  const latest = mb[mb.length - 1];
  const prior3 = mb.slice(Math.max(0, mb.length - 4), mb.length - 1);

  function avg(arr, fn) {
    const vals = arr.map(fn).filter(v => v !== null && !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  let score = 0;
  const fired = [];

  // signal_declining_trend: +20
  if (behavioralPatterns && behavioralPatterns.overallTrend === 'declining') {
    score += 20; fired.push('overall_trend_declining');
  }

  // signal_rising_absence: +15 if absence rate increased >50% in latest vs 3-month avg
  const avgAbsRate = avg(prior3, m => m.workingDays > 0 ? m.absences / m.workingDays : null);
  const latestAbsRate = latest.workingDays > 0 ? latest.absences / latest.workingDays : 0;
  if (avgAbsRate !== null && avgAbsRate > 0 && latestAbsRate > avgAbsRate * 1.50) {
    score += 15; fired.push('rising_absence');
  }

  // signal_declining_hours: +15 if avg hours declined >30 min in latest vs 3-month avg
  const avgHrs = avg(prior3, m => m.avgHours);
  if (avgHrs !== null && latest.avgHours !== null && latest.avgHours < avgHrs - 0.50) {
    score += 15; fired.push('declining_hours');
  }

  // signal_miss_punch_spike: +10 if miss punch count doubled vs 3-month avg
  const avgMP = avg(prior3, m => m.missPunches);
  if (avgMP !== null && avgMP > 0 && (latest.missPunches || 0) >= avgMP * 2) {
    score += 10; fired.push('miss_punch_spike');
  }

  // signal_sandwich: +10 — check via simple ratio computation
  const absenceDates = records.filter(r => ['A', 'CL', 'SL', 'EL', 'L'].includes(r.status));
  if (absenceDates.length >= 3) {
    const weeklyOff = context.employee.weekly_off_day ?? 0;
    let sandwichCount = 0;
    for (const r of absenceDates) {
      const prev = new Date(r.date + 'T12:00:00'); prev.setDate(prev.getDate() - 1);
      const next = new Date(r.date + 'T12:00:00'); next.setDate(next.getDate() + 1);
      if (prev.getDay() === weeklyOff || next.getDay() === weeklyOff) sandwichCount++;
    }
    if (sandwichCount / absenceDates.length > 0.40) {
      score += 10; fired.push('sandwich_leave');
    }
  }

  // signal_ot_drop: +10 if OT days dropped to ≤1 after being ≥5 avg in prior months
  const avgOT = avg(prior3, m => m.otDays);
  if (avgOT !== null && avgOT >= 5 && (latest.otDays || 0) <= 1) {
    score += 10; fired.push('ot_drop');
  }

  // signal_regularity_score: +10 if regularityScore is very low (< 40)
  if (regularityScore !== null && regularityScore < 40) {
    score += 10; fired.push('low_regularity');
  }

  score = clamp(score);
  if (score < 30) return null;

  let hrAction;
  if (score >= 60) hrAction = 'URGENT: High attrition probability within 60 days. Initiate retention conversation immediately.';
  else if (score >= 45) hrAction = 'Elevated flight risk — multiple disengagement signals. Schedule 1:1 with supervisor.';
  else hrAction = 'Early disengagement signals detected. Monitor closely over next 30 days.';

  return {
    id: 'DISENGAGEMENT_CASCADE',
    detected: true,
    severity: score >= 60 ? 'Critical' : score >= 45 ? 'High' : 'Medium',
    score,
    category: 'flight_risk',
    label: 'Flight Risk — Disengagement Cascade',
    detail: `${fired.length} signals fired: ${fired.join(', ')}`,
    evidence: { signalsFired: fired, rawScore: score },
    hrAction,
    value: score
  };
}

// ── 2.2 Sudden Leave Burn ───────────────────────────────────────────────────
function detectSuddenLeaveBurn(records, context) {
  const { db, employee, employeeCode, startDate, endDate, monthsInRange } = context;
  if (!employee || !employee.id) return null;
  if (monthsInRange.length < 3) return null;

  let balances = [];
  try {
    balances = db.prepare(
      'SELECT leave_type, balance FROM leave_balances WHERE employee_id = ? AND year = ?'
    ).all(employee.id, new Date().getFullYear());
  } catch (_) { return null; }

  if (!balances.length) return null;
  const totalBalance = balances.reduce((s, b) => s + (b.balance || 0), 0);

  let leaveApps = [];
  try {
    leaveApps = db.prepare(`
      SELECT leave_type, days, start_date FROM leave_applications
      WHERE employee_code = ? AND status IN ('Approved', 'Pending')
        AND start_date BETWEEN ? AND ?
    `).all(employeeCode, startDate, endDate);
  } catch (_) { return null; }

  if (!leaveApps.length) return null;

  // Group by month
  const byMonth = {};
  for (const app of leaveApps) {
    const [y, m] = app.start_date.split('-').map(Number);
    const key = y * 100 + m;
    byMonth[key] = (byMonth[key] || 0) + (app.days || 0);
  }

  const monthKeys = Object.keys(byMonth).sort();
  if (monthKeys.length < 2) return null;

  const latest = byMonth[monthKeys[monthKeys.length - 1]];
  const priorVals = monthKeys.slice(0, -1).map(k => byMonth[k]);
  const historicalAvg = priorVals.reduce((s, v) => s + v, 0) / priorVals.length;

  const currentBurnRate    = totalBalance > 0 ? latest / totalBalance : 0;
  const historicalBurnRate = historicalAvg > 0 ? historicalAvg / Math.max(totalBalance, 1) : 0;

  if (!(currentBurnRate > historicalBurnRate * 3 && totalBalance < 3)) return null;

  return {
    id: 'SUDDEN_LEAVE_BURN',
    detected: true,
    severity: 'High',
    score: clamp(Math.round(currentBurnRate / Math.max(historicalBurnRate, 0.01) * 20)),
    category: 'flight_risk',
    label: 'Sudden Leave Burn',
    detail: `Latest month: ${latest} leave days, ${totalBalance} remaining balance. Burn rate 3x historical avg.`,
    evidence: { leaveDaysByMonth: byMonth, totalBalance, latestMonthDays: latest, historicalAvg: Math.round(historicalAvg * 10) / 10 },
    hrAction: 'Employee burning through leave at unusual rate — possible resignation indicator. Immediate 1:1 recommended.',
    value: Math.round(currentBurnRate * 100)
  };
}

// ── 2.3 Overtime Cliff ──────────────────────────────────────────────────────
function detectOvertimeCliff(records, context) {
  const { monthlyBreakdown } = context;
  const mb = monthlyBreakdown || [];
  if (mb.length < 4) return null;

  const priorMonths = mb.slice(0, -1);
  const latestMonth = mb[mb.length - 1];
  const avgPriorOT  = priorMonths.reduce((s, m) => s + (m.otDays || 0), 0) / priorMonths.length;
  const latestOT    = latestMonth.otDays || 0;

  if (!(avgPriorOT >= 5 && latestOT <= 1)) return null;

  const dropPct = Math.round((1 - latestOT / Math.max(avgPriorOT, 1)) * 100);

  return {
    id: 'OVERTIME_CLIFF',
    detected: true,
    severity: (avgPriorOT >= 8 && latestOT === 0) ? 'High' : 'Medium',
    score: clamp(Math.round((1 - latestOT / Math.max(avgPriorOT, 1)) * 100)),
    category: 'flight_risk',
    label: 'Overtime Cliff',
    detail: `OT dropped from avg ${Math.round(avgPriorOT * 10) / 10} days/month to ${latestOT} in latest month (${dropPct}% drop)`,
    evidence: { priorAvgOT: Math.round(avgPriorOT * 10) / 10, latestOT, dropPct },
    hrAction: 'Abrupt overtime cessation from a previously committed worker — check if disengaging or has personal reasons',
    value: dropPct
  };
}

// ── 2.4 Attendance Entropy ─────────────────────────────────────────────────
function detectAttendanceEntropy(records, context) {
  const { monthlyBreakdown } = context;
  const mb = monthlyBreakdown || [];
  if (mb.length < 3) return null;

  function shannonEntropy(probs) {
    return -probs.filter(p => p > 0).reduce((s, p) => s + p * Math.log2(p), 0);
  }

  function statusEntropy(m, records) {
    // Build status distribution for this month
    const monthRecs = records.filter(r => {
      const [y, mo] = r.date.split('-').map(Number);
      return y === m.year && mo === m.month && r.dow !== 0;
    });
    if (!monthRecs.length) return 0;
    const counts = { present: 0, absent: 0, leave: 0, halfday: 0, wop: 0 };
    for (const r of monthRecs) {
      if (['P'].includes(r.status)) counts.present++;
      else if (r.status === 'A') counts.absent++;
      else if (['CL', 'SL', 'EL', 'L'].includes(r.status)) counts.leave++;
      else if (['½P', 'WO½P'].includes(r.status)) counts.halfday++;
      else if (r.status === 'WOP') counts.wop++;
    }
    const total = monthRecs.length;
    return shannonEntropy(Object.values(counts).map(c => c / total));
  }

  function arrivalEntropy(m, records) {
    const arrivals = records
      .filter(r => {
        const [y, mo] = r.date.split('-').map(Number);
        return y === m.year && mo === m.month && ['P', 'WOP'].includes(r.status);
      })
      .map(r => parseTimeToMinutes(r.in_time_final || r.in_time_original))
      .filter(v => v !== null);
    if (arrivals.length < 3) return 0;
    // Bin into 15-min buckets
    const buckets = {};
    for (const a of arrivals) {
      const bucket = Math.floor((a + 1440) / 15) * 15; // handle negative (night-shift normalized)
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    return shannonEntropy(Object.values(buckets).map(c => c / arrivals.length));
  }

  const entropyByMonth = mb.map(m => {
    const se = statusEntropy(m, records);
    const ae = arrivalEntropy(m, records);
    return { month: m.month, year: m.year, statusEntropy: Math.round(se * 100) / 100, arrivalEntropy: Math.round(ae * 100) / 100, combined: Math.round((0.5 * se + 0.5 * ae) * 100) / 100 };
  });

  const latest = entropyByMonth[entropyByMonth.length - 1].combined;
  const prior  = entropyByMonth.slice(0, -1);
  const priorAvg = prior.reduce((s, m) => s + m.combined, 0) / prior.length;

  if (!(priorAvg > 0.01 && latest > priorAvg * 1.40)) return null;

  const increase = (latest / Math.max(priorAvg, 0.01) - 1) * 100;

  return {
    id: 'ATTENDANCE_ENTROPY',
    detected: true,
    severity: increase > 60 ? 'High' : 'Medium',
    score: clamp(Math.round(increase)),
    category: 'flight_risk',
    label: 'Attendance Entropy Rising',
    detail: `Attendance pattern becoming unpredictable — entropy up ${Math.round(increase)}% vs prior months`,
    evidence: { entropyByMonth, priorAvg: Math.round(priorAvg * 100) / 100, latestEntropy: latest },
    hrAction: 'Attendance becoming unpredictable — behavioral instability detected',
    value: Math.round(increase)
  };
}

module.exports = {
  detectDisengagementCascade,
  detectSuddenLeaveBurn,
  detectOvertimeCliff,
  detectAttendanceEntropy
};
