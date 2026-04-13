'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────

function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }

function parseMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const parts = t.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function toYM(dateStr) {
  return parseInt(dateStr.substring(0, 7).replace('-', ''), 10);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * computeOrgMetrics(db, startDate, endDate)
 * db        — better-sqlite3 Database instance
 * startDate — 'YYYY-MM-DD'
 * endDate   — 'YYYY-MM-DD'
 *
 * Returns {
 *   workforceUtilization, punctualityCurve, absenteeismCost,
 *   contractorPermanentGap, coordinatedAbsenceAlerts, stabilityIndex, meta
 * }
 */
function computeOrgMetrics(db, startDate, endDate) {
  const meta = { startDate, endDate, computedAt: new Date().toISOString() };
  const result = {
    workforceUtilization:    null,
    punctualityCurve:        null,
    absenteeismCost:         null,
    contractorPermanentGap:  null,
    coordinatedAbsenceAlerts: [],
    stabilityIndex:          null,
    meta
  };

  // ── A. Workforce utilization ───────────────────────────────────────────
  try {
    const rows = db.prepare(`
      SELECT
        ap.employee_code,
        COALESCE(ap.status_final, ap.status_original)         AS status,
        COALESCE(ap.in_time_final,  ap.in_time_original)      AS in_time,
        COALESCE(ap.out_time_final, ap.out_time_original)     AS out_time,
        COALESCE(ap.is_left_late, 0)                          AS is_late,
        COALESCE(ap.left_late_minutes, 0)                     AS late_mins,
        COALESCE(ap.is_early_departure, 0)                    AS is_early,
        COALESCE(ap.early_by_minutes, 0)                      AS early_mins
      FROM attendance_processed ap
      WHERE ap.date BETWEEN ? AND ?
        AND COALESCE(ap.is_night_out_only, 0) = 0
    `).all(startDate, endDate);

    const activeSet = new Set();
    let expectedHours = 0, actualHours = 0;
    let absenceLoss = 0, lateLoss = 0, earlyLoss = 0;

    for (const r of rows) {
      const st = r.status || '';
      if (st === 'WO' || st === 'NH') continue;

      activeSet.add(r.employee_code);
      expectedHours += 10; // standard 10h working day

      if (st === 'A') {
        absenceLoss += 10;
        continue;
      }

      // Compute actual hours from punch times
      let workedHours = 0;
      if (r.in_time && r.out_time) {
        const inM  = parseMinutes(r.in_time);
        let   outM = parseMinutes(r.out_time);
        if (inM !== null && outM !== null) {
          if (outM < inM) outM += 1440;
          const hrs = (outM - inM) / 60;
          if (hrs > 0 && hrs < 24) workedHours = hrs;
        }
      }
      if (workedHours === 0) workedHours = st === 'HP' || st === '½P' ? 5 : 9; // fallback estimate

      actualHours += workedHours;

      // Late arrival loss
      if (r.is_late && r.late_mins > 0) {
        const loss = r.late_mins / 60;
        lateLoss  += loss;
      }

      // Early exit loss
      if (r.is_early && r.early_mins > 0) {
        const loss = r.early_mins / 60;
        earlyLoss += loss;
      }
    }

    const otherLoss = Math.max(0, expectedHours - actualHours - absenceLoss - lateLoss - earlyLoss);
    const utilizationRate = expectedHours > 0 ? r1((actualHours / expectedHours) * 100) : 0;

    result.workforceUtilization = {
      utilizationRate,
      expectedHours: r2(expectedHours),
      actualHours:   r2(actualHours),
      absenceLoss:   r2(absenceLoss),
      lateLoss:      r2(lateLoss),
      earlyLoss:     r2(earlyLoss),
      otherLoss:     r2(Math.max(0, otherLoss)),
      activeEmployees: activeSet.size
    };
  } catch (e) {
    result.workforceUtilization = { error: e.message };
  }

  // ── B. Punctuality curve ───────────────────────────────────────────────
  try {
    // Get shift start times — join attendance to employees to shifts
    const presRows = db.prepare(`
      SELECT
        ap.employee_code,
        COALESCE(ap.in_time_final, ap.in_time_original) AS in_time,
        e.shift_id,
        s.start_time
      FROM attendance_processed ap
      JOIN employees e ON e.code = ap.employee_code
      LEFT JOIN shifts s ON s.id = e.shift_id
      WHERE ap.date BETWEEN ? AND ?
        AND COALESCE(ap.status_final, ap.status_original) IN ('P', 'WOP', 'HP', '½P')
        AND COALESCE(ap.in_time_final, ap.in_time_original) IS NOT NULL
        AND COALESCE(ap.is_night_out_only, 0) = 0
    `).all(startDate, endDate);

    const offsets = [];
    for (const r of presRows) {
      const inM    = parseMinutes(r.in_time);
      const startM = parseMinutes(r.start_time || '09:00'); // default 09:00 if no shift
      if (inM === null || startM === null) continue;
      // Normalize: if arrival looks like night shift (< 6h), shift +24h to align
      let offset = inM - startM;
      if (offset > 720)  offset -= 1440; // wrapped night
      if (offset < -720) offset += 1440;
      offsets.push(Math.round(offset));
    }

    if (offsets.length > 0) {
      // Build 5-min bins from -30 to +60
      const BIN_MIN = -30, BIN_MAX = 60, BIN_STEP = 5;
      const bins = [];
      for (let lo = BIN_MIN; lo < BIN_MAX; lo += BIN_STEP) {
        const hi  = lo + BIN_STEP;
        const count = offsets.filter(o => o >= lo && o < hi).length;
        bins.push({ offset: lo, label: `${lo >= 0 ? '+' : ''}${lo}`, count });
      }
      // Overflow bucket for very late (>= 60 min)
      const overflow = offsets.filter(o => o >= BIN_MAX).length;
      if (overflow > 0) bins.push({ offset: BIN_MAX, label: `+${BIN_MAX}+`, count: overflow });

      const sorted = [...offsets].sort((a, b) => a - b);
      const med    = Math.round(median(sorted));
      const onTime = offsets.filter(o => o >= -5 && o <= 5).length;
      const late15 = offsets.filter(o => o > 15).length;

      result.punctualityCurve = {
        bins,
        medianOffset:  med,
        pctOnTime:     r1((onTime  / offsets.length) * 100),
        pctLate15Plus: r1((late15  / offsets.length) * 100),
        totalRecords:  offsets.length
      };
    } else {
      result.punctualityCurve = { bins: [], medianOffset: 0, pctOnTime: 0, pctLate15Plus: 0, totalRecords: 0 };
    }
  } catch (e) {
    result.punctualityCurve = { bins: [], error: e.message };
  }

  // ── C. Absenteeism cost ────────────────────────────────────────────────
  try {
    const absRows = db.prepare(`
      SELECT
        ap.employee_code,
        ap.date,
        e.department,
        COALESCE(e.gross_salary, 0) AS gross,
        COALESCE(ap.is_left_late, 0) AS is_late,
        COALESCE(ap.left_late_minutes, 0) AS late_mins,
        COALESCE(ap.status_final, ap.status_original) AS status
      FROM attendance_processed ap
      JOIN employees e ON e.code = ap.employee_code
      WHERE ap.date BETWEEN ? AND ?
        AND COALESCE(ap.is_night_out_only, 0) = 0
        AND e.status = 'Active'
    `).all(startDate, endDate);

    let totalAbsent = 0, directCost = 0, latenessCost = 0;
    const deptCost = {};

    for (const r of absRows) {
      const dailyCost = r.gross > 0 ? r2(r.gross / 30) : 0;

      if (r.status === 'A') {
        totalAbsent++;
        directCost += dailyCost;
        if (!deptCost[r.department]) deptCost[r.department] = { cost: 0, absentDays: 0 };
        deptCost[r.department].cost       += dailyCost;
        deptCost[r.department].absentDays += 1;
      }

      if (r.is_late && r.late_mins > 0 && dailyCost > 0) {
        // Late cost proxy: fraction of day lost × daily wage (using 600 min = 10h day)
        const lc = r2((r.late_mins / 600) * dailyCost);
        latenessCost += lc;
        if (!deptCost[r.department]) deptCost[r.department] = { cost: 0, absentDays: 0 };
        deptCost[r.department].cost += lc;
      }
    }

    const totalCost = r2(directCost + latenessCost);
    const topDepts  = Object.entries(deptCost)
      .map(([department, v]) => ({
        department,
        cost:       r2(v.cost),
        absentDays: v.absentDays
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    result.absenteeismCost = {
      totalAbsenteeismCost:               totalCost,
      directAbsenceCost:                  r2(directCost),
      latenessCost:                       r2(latenessCost),
      totalAbsentDays:                    totalAbsent,
      avgCostPerAbsentDay:                totalAbsent > 0 ? r2(directCost / totalAbsent) : 0,
      topDepartmentsByAbsenteeismCost:    topDepts
    };
  } catch (e) {
    result.absenteeismCost = { error: e.message };
  }

  // ── D. Contractor vs permanent gap (monthly) ──────────────────────────
  try {
    const startYM = toYM(startDate);
    const endYM   = toYM(endDate);

    // Get all distinct year-month combos in range from attendance_processed
    const months = db.prepare(`
      SELECT DISTINCT
        CAST(strftime('%Y', date) AS INTEGER) AS yr,
        CAST(strftime('%m', date) AS INTEGER) AS mo
      FROM attendance_processed
      WHERE date BETWEEN ? AND ?
      ORDER BY yr, mo
    `).all(startDate, endDate);

    const monthly = [];
    let totalGap = 0, gapCount = 0;

    for (const { yr, mo } of months) {
      try {
        const mStr = `${yr}-${String(mo).padStart(2, '0')}`;
        const mStart = mStr + '-01';
        const mEnd   = new Date(yr, mo, 0).toISOString().split('T')[0]; // last day of month

        const mRows = db.prepare(`
          SELECT
            e.is_contractor,
            COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(ap.status_final, ap.status_original) IN ('P','WOP','HP','½P') THEN 1 ELSE 0 END) AS present
          FROM attendance_processed ap
          JOIN employees e ON e.code = ap.employee_code
          WHERE ap.date BETWEEN ? AND ?
            AND COALESCE(ap.status_final, ap.status_original) NOT IN ('WO','NH')
            AND COALESCE(ap.is_night_out_only, 0) = 0
          GROUP BY e.is_contractor
        `).all(mStart, mEnd);

        let permRate = null, contractorRate = null;
        for (const row of mRows) {
          const rate = row.total > 0 ? r1((row.present / row.total) * 100) : null;
          if (row.is_contractor) contractorRate = rate;
          else                   permRate       = rate;
        }

        monthly.push({ year: yr, month: mo, permRate, contractorRate });

        if (permRate !== null && contractorRate !== null) {
          totalGap += Math.abs(permRate - contractorRate);
          gapCount++;
        }
      } catch (_e) { /* skip bad month */ }
    }

    const avgGap = gapCount > 0 ? r1(totalGap / gapCount) : 0;
    result.contractorPermanentGap = {
      monthly,
      avgGap,
      flagged: avgGap > 10
    };
  } catch (e) {
    result.contractorPermanentGap = { monthly: [], avgGap: 0, flagged: false, error: e.message };
  }

  // ── E. Coordinated absence alerts ─────────────────────────────────────
  try {
    // Per (date, department): count workdays vs absent
    const dailyDept = db.prepare(`
      SELECT
        ap.date,
        e.department,
        COUNT(*) AS dept_size,
        SUM(CASE WHEN COALESCE(ap.status_final, ap.status_original) = 'A' THEN 1 ELSE 0 END) AS absent_count
      FROM attendance_processed ap
      JOIN employees e ON e.code = ap.employee_code
      WHERE ap.date BETWEEN ? AND ?
        AND COALESCE(ap.status_final, ap.status_original) NOT IN ('WO','NH')
        AND COALESCE(ap.is_night_out_only, 0) = 0
        AND e.status = 'Active'
        AND e.department IS NOT NULL AND e.department != ''
      GROUP BY ap.date, e.department
      HAVING dept_size >= 3
        AND CAST(absent_count AS REAL) / dept_size > 0.4
      ORDER BY ap.date DESC, absent_count DESC
    `).all(startDate, endDate);

    result.coordinatedAbsenceAlerts = dailyDept.map(r => ({
      date:        r.date,
      department:  r.department,
      absentCount: r.absent_count,
      deptSize:    r.dept_size,
      rate:        r1((r.absent_count / r.dept_size) * 100)
    }));
  } catch (e) {
    result.coordinatedAbsenceAlerts = [];
  }

  // ── F. Stability index ────────────────────────────────────────────────
  try {
    // Pull org-level absence rate and late rate from workforceUtilization data
    const wu = result.workforceUtilization;
    const absenceScore = wu && wu.expectedHours > 0
      ? Math.max(0, 100 - (wu.absenceLoss / wu.expectedHours) * 100 * 3) // 3x penalty
      : 50;

    const lateScore = wu && wu.expectedHours > 0
      ? Math.max(0, 100 - (wu.lateLoss / wu.expectedHours) * 100 * 5) // 5x penalty
      : 50;

    const alertPenalty = Math.min(30, result.coordinatedAbsenceAlerts.length * 10);
    const alertScore   = 100 - alertPenalty;

    const gapScore = result.contractorPermanentGap
      ? Math.max(0, 100 - result.contractorPermanentGap.avgGap * 2)
      : 80;

    // Weighted composite: 35% absence, 25% lateness, 25% alert-free, 15% contractor gap
    const raw = (
      0.35 * absenceScore +
      0.25 * lateScore    +
      0.25 * alertScore   +
      0.15 * gapScore
    );
    const index = Math.min(100, Math.max(0, Math.round(raw)));

    result.stabilityIndex = {
      stabilityIndex: index,
      interpretation: index >= 80 ? 'Strong' : index >= 60 ? 'Moderate' : index >= 40 ? 'Fragile' : 'Critical'
    };
  } catch (e) {
    result.stabilityIndex = { stabilityIndex: 0, interpretation: 'Unknown', error: e.message };
  }

  return result;
}

module.exports = { computeOrgMetrics };
