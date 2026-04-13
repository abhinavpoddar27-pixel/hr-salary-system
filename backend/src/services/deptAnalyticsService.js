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

function isNightPunch(inTime) {
  if (!inTime) return false;
  const mins = parseMinutes(inTime);
  if (mins === null) return false;
  return mins >= 18 * 60 || mins < 6 * 60;
}

// Gini coefficient via mean absolute difference formula (O(n²) — acceptable for dept-level arrays)
function computeGini(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return r2(sumDiff / (2 * n * total));
}

// Convert 'YYYY-MM-DD' to YYYYMM integer for cheap range comparisons on day_calculations
function toYM(dateStr) {
  return parseInt(dateStr.substring(0, 7).replace('-', ''), 10);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * computeDepartmentAnalytics(db, startDate, endDate)
 * db        — better-sqlite3 Database instance
 * startDate — 'YYYY-MM-DD'
 * endDate   — 'YYYY-MM-DD'
 *
 * Returns { departments, otConcentration, nightShiftBurden, attendanceInequality, meta }
 */
function computeDepartmentAnalytics(db, startDate, endDate) {
  const meta = { startDate, endDate, computedAt: new Date().toISOString() };

  // ── 1. Collect departments and their employees ─────────────────────────
  const deptEmployees = {}; // dept → [{ code, isContractor }]

  try {
    const rows = db.prepare(`
      SELECT DISTINCT e.department, e.code, e.is_contractor
      FROM employees e
      WHERE e.status = 'Active'
        AND e.department IS NOT NULL
        AND e.department != ''
        AND EXISTS (
          SELECT 1 FROM attendance_processed ap
          WHERE ap.employee_code = e.code
            AND ap.date BETWEEN ? AND ?
        )
      ORDER BY e.department, e.code
    `).all(startDate, endDate);

    for (const row of rows) {
      if (!deptEmployees[row.department]) deptEmployees[row.department] = [];
      deptEmployees[row.department].push({
        code: row.code,
        isContractor: row.is_contractor ? 1 : 0
      });
    }
  } catch (e) {
    return {
      departments: [], otConcentration: [], nightShiftBurden: [],
      attendanceInequality: [], meta: { ...meta, error: e.message }
    };
  }

  const deptNames = Object.keys(deptEmployees);
  if (deptNames.length === 0) {
    return { departments: [], otConcentration: [], nightShiftBurden: [], attendanceInequality: [], meta };
  }

  // Reusable: fetch attendance rows for a list of codes (no night-out-only records)
  function getAttendance(codes) {
    const ph = codes.map(() => '?').join(',');
    return db.prepare(`
      SELECT
        employee_code,
        date,
        COALESCE(status_final, status_original)         AS status,
        COALESCE(in_time_final,  in_time_original)      AS in_time,
        COALESCE(out_time_final, out_time_original)     AS out_time,
        COALESCE(is_left_late, 0)                       AS is_late,
        COALESCE(is_early_departure, 0)                 AS is_early
      FROM attendance_processed
      WHERE employee_code IN (${ph})
        AND date BETWEEN ? AND ?
        AND COALESCE(is_night_out_only, 0) = 0
    `).all(...codes, startDate, endDate);
  }

  // ── 2. Per-department attendance stats ────────────────────────────────
  const departments = [];
  let orgTotalWorkdays = 0;
  let orgNightDays = 0;
  const midDate = new Date((new Date(startDate).getTime() + new Date(endDate).getTime()) / 2)
    .toISOString().split('T')[0];

  for (const dept of deptNames) {
    try {
      const employees  = deptEmployees[dept];
      const codes      = employees.map(e => e.code);
      const headcount  = codes.length;
      const contractorCount = employees.filter(e => e.isContractor).length;

      const records = getAttendance(codes);
      if (!records.length) continue;

      let totalWorkdays = 0, presentSum = 0, absentDays = 0;
      let lateDays = 0, earlyDays = 0, nightDays = 0;
      let hoursNumer = 0, hoursDenom = 0;
      let fhWork = 0, fhPresent = 0, shWork = 0, shPresent = 0;

      for (const r of records) {
        const st = r.status || '';
        if (st === 'WO' || st === 'NH') continue; // non-working days excluded

        totalWorkdays++;
        const isFirstHalf = r.date <= midDate;
        if (isFirstHalf) fhWork++; else shWork++;

        const isHalf   = st === 'HP' || st === '½P';
        const isPresent = ['P', 'WOP', 'HP', '½P'].includes(st);
        const pval     = isHalf ? 0.5 : isPresent ? 1 : 0;
        presentSum     += pval;
        if (isFirstHalf) fhPresent += pval; else shPresent += pval;

        if (st === 'A') absentDays++;
        if (r.is_late)  lateDays++;
        if (r.is_early) earlyDays++;

        if (isNightPunch(r.in_time)) nightDays++;

        // Hours from punch times
        if (r.in_time && r.out_time) {
          const inM  = parseMinutes(r.in_time);
          let   outM = parseMinutes(r.out_time);
          if (inM !== null && outM !== null) {
            if (outM < inM) outM += 1440; // overnight
            const hrs = (outM - inM) / 60;
            if (hrs > 0 && hrs < 24) { hoursNumer += hrs; hoursDenom++; }
          }
        }
      }

      orgTotalWorkdays += totalWorkdays;
      orgNightDays     += nightDays;

      const attRate      = totalWorkdays > 0 ? r1((presentSum   / totalWorkdays) * 100) : 0;
      const absRate      = totalWorkdays > 0 ? r1((absentDays   / totalWorkdays) * 100) : 0;
      const punctRate    = presentSum    > 0 ? r1(((presentSum - lateDays) / presentSum) * 100) : 0;
      const lateRate     = presentSum    > 0 ? r1((lateDays     / presentSum) * 100) : 0;
      const earlyExitRate= presentSum    > 0 ? r1((earlyDays    / presentSum) * 100) : 0;
      const nightRatio   = totalWorkdays > 0 ? r1((nightDays    / totalWorkdays) * 100) : 0;
      const avgHours     = hoursDenom    > 0 ? r2(hoursNumer    / hoursDenom) : 0;

      // Trend: first-half vs second-half attendance rate
      const fhRate = fhWork > 0 ? (fhPresent / fhWork) * 100 : 0;
      const shRate = shWork > 0 ? (shPresent / shWork) * 100 : 0;
      const diff   = shRate - fhRate;
      const trend  = diff > 3 ? 'improving' : diff < -3 ? 'declining' : 'stable';
      const trendFactor = trend === 'improving' ? 1 : trend === 'stable' ? 0.7 : 0.3;

      // Health score (0-100):
      //   30% attendance rate  + 20% punctuality  + 15% hours ratio (vs 9hr standard)
      //   + 15% (1 - absence)  + 10% trend factor + 10% base (0.7)
      const hoursRatio = avgHours > 0 ? Math.min(avgHours / 9, 1) : 0.7;
      const raw = (
        30 * (attRate   / 100) +
        20 * (punctRate / 100) +
        15 * hoursRatio +
        15 * (1 - absRate / 100) +
        10 * trendFactor +
        10 * 0.7
      );
      const healthScore = Math.min(100, Math.max(0, Math.round(raw)));

      departments.push({
        department: dept,
        headcount,
        contractorCount,
        attendanceRate:  attRate,
        absenceRate:     absRate,
        punctualityRate: punctRate,
        lateRate,
        earlyExitRate,
        avgHours,
        nightShiftDays:  nightDays,
        nightRatio,
        trend,
        healthScore,
        rank: 0 // filled after sort
      });
    } catch (_e) {
      // one department failure must not abort the rest
    }
  }

  departments.sort((a, b) => b.healthScore - a.healthScore);
  departments.forEach((d, i) => { d.rank = i + 1; });

  // ── 3. OT Gini coefficient per department ─────────────────────────────
  const otConcentration = [];
  const startYM = toYM(startDate);
  const endYM   = toYM(endDate);

  for (const dept of deptNames) {
    try {
      const codes = deptEmployees[dept].map(e => e.code);
      if (!codes.length) continue;

      const ph = codes.map(() => '?').join(',');
      const otRows = db.prepare(`
        SELECT employee_code,
               SUM(COALESCE(ot_hours, 0) + COALESCE(extra_duty_days, 0) * 8) AS total_ot
        FROM day_calculations
        WHERE employee_code IN (${ph})
          AND (year * 100 + month) >= ?
          AND (year * 100 + month) <= ?
        GROUP BY employee_code
      `).all(...codes, startYM, endYM);

      const otMap = {};
      for (const r of otRows) otMap[r.employee_code] = r.total_ot || 0;
      const otValues = codes.map(c => otMap[c] || 0);

      otConcentration.push({
        department:      dept,
        giniCoefficient: computeGini(otValues)
      });
    } catch (_e) {}
  }
  otConcentration.sort((a, b) => b.giniCoefficient - a.giniCoefficient);

  // ── 4. Night shift burden per department ──────────────────────────────
  const orgAvgNightRatio = orgTotalWorkdays > 0
    ? r1((orgNightDays / orgTotalWorkdays) * 100) : 0;

  const nightShiftBurden = departments.map(d => {
    try {
      const burden = orgAvgNightRatio > 0 ? r2(d.nightRatio / orgAvgNightRatio) : 0;
      return {
        department:       d.department,
        nightRatio:       d.nightRatio,
        orgAvgNightRatio,
        burden,
        flagged:          burden > 2
      };
    } catch (_e) {
      return { department: d.department, nightRatio: 0, orgAvgNightRatio, burden: 0, flagged: false };
    }
  });
  nightShiftBurden.sort((a, b) => b.burden - a.burden);

  // ── 5. Attendance inequality per department (CV of employee absence rates) ──
  const attendanceInequality = [];

  for (const dept of deptNames) {
    try {
      const codes = deptEmployees[dept].map(e => e.code);
      if (codes.length < 2) continue;

      const ph = codes.map(() => '?').join(',');
      const empRows = db.prepare(`
        SELECT
          employee_code,
          COUNT(*) AS total,
          SUM(CASE WHEN COALESCE(status_final, status_original) = 'A' THEN 1 ELSE 0 END) AS absent
        FROM attendance_processed
        WHERE employee_code IN (${ph})
          AND date BETWEEN ? AND ?
          AND COALESCE(status_final, status_original) NOT IN ('WO', 'NH')
          AND COALESCE(is_night_out_only, 0) = 0
        GROUP BY employee_code
      `).all(...codes, startDate, endDate);

      if (empRows.length < 2) continue;

      const absRates = empRows.map(r => r.total > 0 ? (r.absent / r.total) * 100 : 0);
      const mean     = absRates.reduce((s, v) => s + v, 0) / absRates.length;
      const variance = absRates.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / absRates.length;
      const std      = Math.sqrt(variance);
      const cv       = mean > 0 ? r2(std / mean) : 0;
      const range    = r1(Math.max(...absRates) - Math.min(...absRates));

      attendanceInequality.push({
        department:      dept,
        cv,
        range,
        meanAbsenceRate: r1(mean),
        flagged:         cv > 1.0 || range > 25
      });
    } catch (_e) {}
  }
  attendanceInequality.sort((a, b) => b.cv - a.cv);

  return { departments, otConcentration, nightShiftBurden, attendanceInequality, meta };
}

module.exports = { computeDepartmentAnalytics };
