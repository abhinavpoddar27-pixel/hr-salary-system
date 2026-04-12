'use strict';
/**
 * Pattern Engine Orchestrator
 * Runs all detectors and returns composite scores + summary.
 *
 * Phase 2a: 12 detectors (8 individual + 4 flight-risk)
 * Phase 2b: +11 more wired in (anomaly, temporal, shift, contractor)
 */

const { getMonthsInRange } = require('../employeeProfileService');

const {
  detectSandwichLeave, detectGhostHours, detectAbsenceClustering,
  detectBreakPatternDrift, detectMissPunchEscalation, detectHalfDayAddiction,
  detectLIFO, detectPostLeaveSlump
} = require('./individualPatterns');

const {
  detectDisengagementCascade, detectSuddenLeaveBurn,
  detectOvertimeCliff, detectAttendanceEntropy
} = require('./flightRiskPatterns');

const PRESENT = ['P', 'WOP', '½P', 'WO½P'];

/**
 * Run the full pattern engine against a pre-computed profile.
 *
 * @param {object} db               better-sqlite3 database
 * @param {string} employeeCode
 * @param {string} startDate        'YYYY-MM-DD'
 * @param {string} endDate          'YYYY-MM-DD'
 * @param {object} profileData      result from computeProfileRange (sections only — no raw records)
 * @returns {{ patterns, compositeScores, summary, generatedAt }}
 */
function analyzeEmployeePatterns(db, employeeCode, startDate, endDate, profileData) {
  // Re-fetch raw records (profileData.arrivalDeparture.dailyTimes is capped at 500
  // and lacks status/dow — we need the full enriched set)
  const rawRecords = db.prepare(`
    SELECT date, status_final, status_original,
           in_time_final, out_time_final, in_time_original, out_time_original,
           actual_hours, is_late_arrival, late_by_minutes,
           is_early_departure, early_by_minutes,
           is_overtime, overtime_minutes, is_night_shift,
           is_miss_punch, miss_punch_resolved, miss_punch_type
    FROM attendance_processed
    WHERE employee_code = ? AND date BETWEEN ? AND ? AND is_night_out_only = 0
    ORDER BY date
  `).all(employeeCode, startDate, endDate);

  const records = rawRecords.map(r => ({
    ...r,
    status: r.status_final || r.status_original || '',
    dow: new Date(r.date + 'T12:00:00').getDay()
  }));

  const { employee, kpis, monthlyBreakdown, behavioralPatterns, regularityScore } = profileData;

  const context = {
    db,
    employee: employee || {},
    employeeCode,
    startDate,
    endDate,
    monthsInRange: getMonthsInRange(startDate, endDate),
    kpis:               kpis               || {},
    shift:              employee ? (employee.shift || {}) : {},
    monthlyBreakdown:   monthlyBreakdown    || [],
    behavioralPatterns: behavioralPatterns  || {},
    regularityScore:    regularityScore     ?? null
  };

  // ── Run all 12 detectors (Phase 2a) ────────────────────────────────────────
  const detectors = [
    // Individual
    detectSandwichLeave, detectGhostHours, detectAbsenceClustering,
    detectBreakPatternDrift, detectMissPunchEscalation, detectHalfDayAddiction,
    detectLIFO, detectPostLeaveSlump,
    // Flight Risk
    detectDisengagementCascade, detectSuddenLeaveBurn,
    detectOvertimeCliff, detectAttendanceEntropy
  ];

  const detected = [];
  for (const fn of detectors) {
    try {
      const result = fn(records, context);
      if (result && result.detected) detected.push(result);
    } catch (e) {
      console.warn(`[patternEngine] ${fn.name} failed: ${e.message}`);
    }
  }

  // ── Composite Scores ────────────────────────────────────────────────────────

  // Flight Risk: from DISENGAGEMENT_CASCADE result (or 0)
  const cascadeResult = detected.find(p => p.id === 'DISENGAGEMENT_CASCADE');
  const flightRiskScore = cascadeResult ? cascadeResult.score : 0;

  // Engagement score: weighted subtraction for negative patterns
  const engagementWeights = {
    CHRONIC_LATE:        10,  // from behavioralPatterns (legacy)
    LIFO:                15,
    BREAK_DRIFT:         15,
    GHOST_HOURS:         20,
    ABSENCE_CLUSTERING:  15,
    HALF_DAY_ADDICTION:   5,
    ATTENDANCE_ENTROPY:  20
  };
  let engagementPenalty = 0;
  for (const p of detected) {
    const w = engagementWeights[p.id];
    if (w) engagementPenalty += w * (p.score / 100);
  }
  const engagementScore = Math.max(0, Math.round(100 - engagementPenalty));

  // Reliability score: attendance rate + punctuality + miss-punch rate + regularity
  const attRate    = (kpis.attendanceRate  || 0) / 100;
  const lateRate   = (kpis.lateRate        || 0) / 100;
  const mpRate     = kpis.missPunchCount > 0
    ? (kpis.missPunchCount / Math.max(kpis.totalRecords, 1))
    : 0;
  const regScore   = (regularityScore ?? 50) / 100;
  const reliabilityScore = Math.round(
    attRate * 40 + (1 - lateRate) * 30 + (1 - mpRate) * 15 + regScore * 15
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = {
    totalPatternsDetected: detected.length,
    criticalCount: detected.filter(p => p.severity === 'Critical').length,
    highCount:     detected.filter(p => p.severity === 'High').length,
    mediumCount:   detected.filter(p => p.severity === 'Medium').length,
    lowCount:      detected.filter(p => p.severity === 'Low').length,
    categories:    [...new Set(detected.map(p => p.category))]
  };

  return {
    patterns: detected,
    compositeScores: {
      flightRisk:   flightRiskScore,
      engagement:   engagementScore,
      reliability:  reliabilityScore
    },
    summary,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { analyzeEmployeePatterns };
