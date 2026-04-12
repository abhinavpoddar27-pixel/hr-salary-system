'use strict';
const { detectPatterns } = require('./behavioralPatterns');
// isContractorForPayroll imported for downstream consumers (patternEngine)
const { isContractorForPayroll } = require('../utils/employeeClassification');
// Lazy-require to avoid circular: patternEngine → employeeProfileService → patternEngine
let _analyzeEmployeePatterns = null;
function getPatternEngine() {
  if (!_analyzeEmployeePatterns) {
    ({ analyzeEmployeePatterns: _analyzeEmployeePatterns } = require('./patternEngine'));
  }
  return _analyzeEmployeePatterns;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse 'HH:MM' to integer minutes since midnight.
 * Night-shift normalization: values > 18:00 (1080 min) are shifted negative
 * so arrival/departure averages cluster correctly.
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  let mins = h * 60 + m;
  if (mins > 1080) mins -= 1440; // night-shift normalization
  return mins;
}

/** Convert integer minutes (possibly negative) back to 'HH:MM'. */
function minutesToTimeStr(mins) {
  if (mins === null || mins === undefined) return null;
  if (mins < 0) mins += 1440;
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Return [{month, year}] for every calendar month covered by [startDate, endDate].
 * Both dates are 'YYYY-MM-DD'.
 */
function getMonthsInRange(startDate, endDate) {
  const result = [];
  let [y, m] = startDate.split('-').map(Number);
  const [ey, em] = endDate.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    result.push({ month: m, year: y });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

/** Compact integer key for (year, month) range comparisons. */
function yearMonthKey(year, month) {
  return year * 100 + month;
}

// ── Status sets ────────────────────────────────────────────────────────────
const PRESENT      = ['P', 'WOP', '½P', 'WO½P'];
const FULL_PRESENT = ['P', 'WOP'];
const HALF_PRESENT = ['½P', 'WO½P'];

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Compute a full multi-section employee profile across a date range.
 * Returns null if the employee code is not found (caller sends 404).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} employeeCode
 * @param {string} startDate  'YYYY-MM-DD' inclusive
 * @param {string} endDate    'YYYY-MM-DD' inclusive
 */
function computeProfileRange(db, employeeCode, startDate, endDate) {

  // ── Section A: Employee identity ──────────────────────────────────────────
  const employee = db.prepare(`
    SELECT code, name, father_name, department, designation, company,
           employment_type, contractor_group, shift_code, weekly_off_day,
           date_of_joining, date_of_exit, gross_salary, status,
           pf_applicable, esi_applicable, pt_applicable,
           phone, email, bank_name, pf_number, uan, esi_number
    FROM employees WHERE code = ?
  `).get(employeeCode);

  if (!employee) return null;

  // Tenure months
  if (employee.date_of_joining) {
    const doj = new Date(employee.date_of_joining + 'T00:00:00');
    const endRef = employee.date_of_exit
      ? new Date(employee.date_of_exit + 'T00:00:00')
      : new Date();
    employee.tenureMonths =
      (endRef.getFullYear() - doj.getFullYear()) * 12 +
      (endRef.getMonth() - doj.getMonth());
  } else {
    employee.tenureMonths = null;
  }

  // Shift info
  const shiftRow = db.prepare(
    'SELECT start_time, end_time, is_overnight FROM shifts WHERE code = ?'
  ).get(employee.shift_code || 'DAY') || {};
  employee.shift = {
    startTime:  shiftRow.start_time  || null,
    endTime:    shiftRow.end_time    || null,
    isOvernight: !!shiftRow.is_overnight
  };

  // ── Section B: KPIs ───────────────────────────────────────────────────────
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

  // Enrich each record with derived status + day-of-week
  const records = rawRecords.map(r => ({
    ...r,
    status: r.status_final || r.status_original || '',
    dow: new Date(r.date + 'T12:00:00').getDay()   // 0=Sun
  }));

  let workingDays = 0, presentDays = 0, totalAbsences = 0;
  let lateCount = 0, lateMinsSum = 0;
  let earlyExitCount = 0, earlyMinsSum = 0;
  let hoursSum = 0, hoursCount = 0;
  let otDays = 0, totalOTMinutes = 0;
  let wopDays = 0, halfDayCount = 0;
  let missPunchCount = 0, missPunchResolved = 0;
  let nightShiftDays = 0;

  for (const r of records) {
    if (r.dow !== 0) {
      workingDays++;
      if      (FULL_PRESENT.includes(r.status)) presentDays += 1.0;
      else if (HALF_PRESENT.includes(r.status)) presentDays += 0.5;
      if (r.status === 'A') totalAbsences++;
    }
    if (r.is_late_arrival)    { lateCount++;      lateMinsSum  += (r.late_by_minutes  || 0); }
    if (r.is_early_departure) { earlyExitCount++; earlyMinsSum += (r.early_by_minutes || 0); }
    if (r.actual_hours > 0 && PRESENT.includes(r.status)) { hoursSum += r.actual_hours; hoursCount++; }
    if (r.is_overtime)  { otDays++;        totalOTMinutes += (r.overtime_minutes || 0); }
    if (r.status === 'WOP' || r.status === 'WO½P') wopDays++;
    if (r.status === '½P'  || r.status === 'WO½P') halfDayCount++;
    if (r.is_miss_punch) { missPunchCount++; if (r.miss_punch_resolved) missPunchResolved++; }
    if (r.is_night_shift) nightShiftDays++;
  }

  const r1 = x => Math.round(x * 10)  / 10;
  const r2 = x => Math.round(x * 100) / 100;

  // YM bounds used for multiple later sections
  const startYM = yearMonthKey(
    parseInt(startDate.slice(0, 4), 10),
    parseInt(startDate.slice(5, 7), 10)
  );
  const endYM = yearMonthKey(
    parseInt(endDate.slice(0, 4), 10),
    parseInt(endDate.slice(5, 7), 10)
  );

  let holidayDutyDays = 0;
  try {
    const hdd = db.prepare(`
      SELECT COALESCE(SUM(holiday_duty_days), 0) AS hdd
      FROM day_calculations
      WHERE employee_code = ? AND (year * 100 + month) BETWEEN ? AND ?
    `).get(employeeCode, startYM, endYM);
    holidayDutyDays = hdd ? (hdd.hdd || 0) : 0;
  } catch (_) { /* column may not exist on older DB */ }

  let edDaysApproved = 0;
  try {
    const edq = db.prepare(`
      SELECT COUNT(*) AS cnt FROM extra_duty_grants
      WHERE employee_code = ? AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'
        AND grant_date BETWEEN ? AND ?
    `).get(employeeCode, startDate, endDate);
    edDaysApproved = edq ? (edq.cnt || 0) : 0;
  } catch (_) { /* table may not exist on older DB */ }

  const kpis = {
    totalRecords:    records.length,
    workingDays,
    presentDays:     r2(presentDays),
    attendanceRate:  workingDays > 0 ? r1(presentDays / workingDays * 100) : 0,
    totalAbsences,
    absenteeismRate: workingDays > 0 ? r1(totalAbsences / workingDays * 100) : 0,
    lateCount,
    lateRate:        presentDays > 0 ? r1(lateCount / presentDays * 100) : 0,
    avgLateMinutes:  lateCount > 0   ? Math.round(lateMinsSum  / lateCount)  : null,
    earlyExitCount,
    earlyExitRate:   presentDays > 0 ? r1(earlyExitCount / presentDays * 100) : 0,
    avgEarlyMinutes: earlyExitCount > 0 ? Math.round(earlyMinsSum / earlyExitCount) : null,
    avgHoursWorked:  hoursCount > 0  ? r2(hoursSum / hoursCount) : null,
    otDays,
    totalOTMinutes,
    wopDays,
    halfDayCount,
    missPunchCount,
    missPunchResolved,
    missPunchResolutionRate: missPunchCount > 0
      ? r1(missPunchResolved / missPunchCount * 100) : null,
    nightShiftDays,
    holidayDutyDays: r2(holidayDutyDays),
    edDaysApproved
  };

  // ── Section C: Streaks ────────────────────────────────────────────────────
  let maxPresentStreak = 0, maxAbsentStreak = 0;
  let curType = null, curLen = 0;

  for (const r of records) {
    if (r.dow === 0) continue;
    if (PRESENT.includes(r.status)) {
      if (curType === 'present') curLen++;
      else { curType = 'present'; curLen = 1; }
      maxPresentStreak = Math.max(maxPresentStreak, curLen);
    } else if (r.status === 'A') {
      if (curType === 'absent') curLen++;
      else { curType = 'absent'; curLen = 1; }
      maxAbsentStreak = Math.max(maxAbsentStreak, curLen);
    }
    // WO, H, etc. — don't break streak, just continue
  }

  const streaks = {
    maxPresentStreak,
    maxAbsentStreak,
    currentStreak: { type: curType, days: curLen }
  };

  // ── Section D: Arrival / Departure ───────────────────────────────────────
  const arrivalMins = [], departureMins = [], dailyTimes = [];

  for (const r of records) {
    if (!PRESENT.includes(r.status)) continue;
    const inTime  = r.in_time_final  || r.in_time_original;
    const outTime = r.out_time_final || r.out_time_original;
    const am = parseTimeToMinutes(inTime);
    const dm = parseTimeToMinutes(outTime);
    if (am !== null) arrivalMins.push(am);
    if (dm !== null) departureMins.push(dm);
    if (dailyTimes.length < 500) {
      dailyTimes.push({
        date:   r.date,
        inTime, outTime,
        hours:  r.actual_hours,
        isLate: !!r.is_late_arrival,  lateBy:  r.late_by_minutes  || 0,
        isEarly: !!r.is_early_departure, earlyBy: r.early_by_minutes || 0,
        isNight: !!r.is_night_shift
      });
    }
  }

  const avgInMin  = arrivalMins.length   ? arrivalMins.reduce((s, v) => s + v, 0)   / arrivalMins.length   : null;
  const avgOutMin = departureMins.length ? departureMins.reduce((s, v) => s + v, 0) / departureMins.length : null;

  const arrivalDeparture = {
    avgInTime:   avgInMin  !== null ? minutesToTimeStr(Math.round(avgInMin))  : null,
    avgOutTime:  avgOutMin !== null ? minutesToTimeStr(Math.round(avgOutMin)) : null,
    dailyTimes
  };

  // ── Section E: Regularity Score ───────────────────────────────────────────
  let regularityScore = null;
  if (arrivalMins.length >= 5) {
    const mean     = arrivalMins.reduce((s, v) => s + v, 0) / arrivalMins.length;
    const variance = arrivalMins.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arrivalMins.length;
    regularityScore = Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(variance) * 2)));
  }

  // ── Section F: Behavioral Patterns ───────────────────────────────────────
  const monthsInRange = getMonthsInRange(startDate, endDate);
  const patternsByMonth = [];
  let decliningCount = 0, improvingCount = 0;

  for (const { month, year } of monthsInRange) {
    const result = detectPatterns(db, employeeCode, month, year);
    if (!result) continue;
    patternsByMonth.push({ month, year, patterns: result.patterns, stats: result.stats });
    if (result.stats && result.stats.trend === 'declining') decliningCount++;
    else if (result.stats && result.stats.trend === 'improving') improvingCount++;
  }

  const severityRank = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const patternMap = {};
  for (const mp of patternsByMonth) {
    for (const p of mp.patterns) {
      if (!patternMap[p.type]) {
        patternMap[p.type] = {
          type: p.type, severity: p.severity, label: p.label,
          occurrenceCount: 0, latestDetail: p.detail,
          valueSum: 0, valueCount: 0
        };
      }
      const e = patternMap[p.type];
      e.occurrenceCount++;
      e.latestDetail = p.detail;
      if ((severityRank[p.severity] || 0) > (severityRank[e.severity] || 0)) e.severity = p.severity;
      if (p.value !== undefined && p.value !== null) { e.valueSum += p.value; e.valueCount++; }
    }
  }

  const behavioralPatterns = {
    patternsByMonth,
    aggregatedPatterns: Object.values(patternMap).map(e => ({
      type: e.type, severity: e.severity, label: e.label,
      occurrenceCount: e.occurrenceCount, latestDetail: e.latestDetail,
      avgValue: e.valueCount > 0 ? r1(e.valueSum / e.valueCount) : null
    })),
    overallTrend: decliningCount > improvingCount ? 'declining'
                : improvingCount > decliningCount ? 'improving' : 'stable'
  };

  // ── Section G: Monthly Breakdown ─────────────────────────────────────────
  const monthlyMap = {};
  for (const r of records) {
    const [y, mo] = r.date.split('-').map(Number);
    const key = yearMonthKey(y, mo);
    if (!monthlyMap[key]) {
      monthlyMap[key] = {
        month: mo, year: y,
        presentDays: 0, workingDays: 0, lateCount: 0,
        hoursSum: 0, hoursCount: 0, otDays: 0,
        earlyExitCount: 0, absences: 0, wopDays: 0, halfDays: 0, missPunches: 0
      };
    }
    const g = monthlyMap[key];
    if (r.dow !== 0) {
      g.workingDays++;
      if      (FULL_PRESENT.includes(r.status)) g.presentDays += 1.0;
      else if (HALF_PRESENT.includes(r.status)) g.presentDays += 0.5;
      if (r.status === 'A') g.absences++;
    }
    if (r.is_late_arrival)    g.lateCount++;
    if (r.actual_hours > 0 && PRESENT.includes(r.status)) { g.hoursSum += r.actual_hours; g.hoursCount++; }
    if (r.is_overtime)         g.otDays++;
    if (r.is_early_departure)  g.earlyExitCount++;
    if (r.status === 'WOP' || r.status === 'WO½P') g.wopDays++;
    if (r.status === '½P'  || r.status === 'WO½P') g.halfDays++;
    if (r.is_miss_punch) g.missPunches++;
  }

  const monthlyBreakdown = Object.values(monthlyMap)
    .map(g => ({
      month: g.month, year: g.year,
      presentDays: r2(g.presentDays),
      workingDays: g.workingDays,
      attendanceRate: g.workingDays > 0 ? r1(g.presentDays / g.workingDays * 100) : 0,
      lateCount: g.lateCount,
      lateRate:  g.presentDays > 0 ? r1(g.lateCount / g.presentDays * 100) : 0,
      avgHours:  g.hoursCount > 0 ? r2(g.hoursSum / g.hoursCount) : null,
      otDays: g.otDays, earlyExitCount: g.earlyExitCount,
      absences: g.absences, wopDays: g.wopDays,
      halfDays: g.halfDays, missPunches: g.missPunches
    }))
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  // ── Section H: Department Comparison ─────────────────────────────────────
  const baseDeptSQL = `
    SELECT
      COUNT(CASE WHEN strftime('%w', ap.date) != '0' THEN 1 END) AS working_days,
      SUM(CASE
        WHEN strftime('%w', ap.date) != '0'
         AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP')   THEN 1.0
        WHEN strftime('%w', ap.date) != '0'
         AND COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P') THEN 0.5
        ELSE 0 END) AS present_days,
      SUM(CASE WHEN ap.is_late_arrival    = 1 THEN 1 ELSE 0 END) AS late_days,
      SUM(CASE WHEN ap.is_early_departure = 1 THEN 1 ELSE 0 END) AS early_days,
      SUM(CASE WHEN ap.is_overtime        = 1 THEN 1 ELSE 0 END) AS ot_days,
      AVG(CASE WHEN ap.actual_hours > 0
           AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP','½P','WO½P')
           THEN ap.actual_hours END) AS avg_hours,
      COUNT(DISTINCT ap.employee_code) AS employee_count
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `;

  function rateStats(row) {
    if (!row || !(row.working_days > 0)) {
      return { attendanceRate: 0, lateRate: 0, earlyExitRate: 0, avgHours: null, otRate: 0 };
    }
    const pd = row.present_days || 0;
    const wd = row.working_days;
    return {
      attendanceRate: r1(pd / wd * 100),
      lateRate:       pd > 0 ? r1(row.late_days  / pd * 100) : 0,
      earlyExitRate:  pd > 0 ? r1(row.early_days / pd * 100) : 0,
      avgHours:       row.avg_hours != null ? r2(row.avg_hours) : null,
      otRate:         pd > 0 ? r1(row.ot_days    / pd * 100) : 0
    };
  }

  const dept    = employee.department || null;
  const deptRow = dept
    ? db.prepare(baseDeptSQL + ' AND e.department = ?').get(startDate, endDate, dept)
    : null;
  const orgRow  = db.prepare(baseDeptSQL).get(startDate, endDate);

  const departmentComparison = {
    departmentName:     dept,
    employeeCountInDept: deptRow ? (deptRow.employee_count || 0) : 0,
    employee: {
      attendanceRate: kpis.attendanceRate,
      lateRate:       kpis.lateRate,
      earlyExitRate:  kpis.earlyExitRate,
      avgHours:       kpis.avgHoursWorked,
      otRate:         workingDays > 0 ? r1(otDays / workingDays * 100) : 0
    },
    department: rateStats(deptRow),
    org:        rateStats(orgRow)
  };

  // ── Section I: Salary History ─────────────────────────────────────────────
  let salaryMonths = [];
  try {
    salaryMonths = db.prepare(`
      SELECT month, year, gross_salary, gross_earned, basic_earned, da_earned, hra_earned,
             conveyance_earned, other_allowances_earned, net_salary, total_payable,
             take_home, total_deductions, pf_employee, esi_employee, professional_tax,
             tds, advance_recovery, loan_recovery, lop_deduction, late_coming_deduction,
             other_deductions, ot_pay, ed_pay, holiday_duty_pay, ot_days, ed_days,
             payable_days, salary_held, hold_reason, gross_changed, is_contractor
      FROM salary_computations
      WHERE employee_code = ? AND (year * 100 + month) BETWEEN ? AND ?
      ORDER BY year, month
    `).all(employeeCode, startYM, endYM);
  } catch (_) {
    // Fallback: older DB missing newer columns
    try {
      salaryMonths = db.prepare(`
        SELECT month, year, gross_salary, gross_earned, net_salary, total_deductions,
               pf_employee, esi_employee, professional_tax, tds, advance_recovery,
               loan_recovery, lop_deduction, other_deductions, ot_pay, payable_days,
               salary_held, hold_reason, gross_changed
        FROM salary_computations
        WHERE employee_code = ? AND (year * 100 + month) BETWEEN ? AND ?
        ORDER BY year, month
      `).all(employeeCode, startYM, endYM);
    } catch (_2) { salaryMonths = []; }
  }

  const salTotals = salaryMonths.reduce((acc, row) => {
    acc.totalGrossEarned  += row.gross_earned    || 0;
    acc.totalNetSalary    += row.net_salary      || 0;
    acc.totalTakeHome     += row.take_home       || 0;
    acc.totalDeductions   += row.total_deductions || 0;
    acc.totalOTPay        += row.ot_pay          || 0;
    acc.totalEDPay        += row.ed_pay          || 0;
    acc.totalHolidayDutyPay += row.holiday_duty_pay || 0;
    return acc;
  }, {
    totalGrossEarned: 0, totalNetSalary: 0, totalTakeHome: 0,
    totalDeductions: 0, totalOTPay: 0, totalEDPay: 0, totalHolidayDutyPay: 0
  });
  Object.keys(salTotals).forEach(k => { salTotals[k] = r2(salTotals[k]); });

  const salaryHistory = { months: salaryMonths, totals: salTotals };

  // ── Section J: Corrections ────────────────────────────────────────────────
  let dayCorrections = [];
  try {
    dayCorrections = db.prepare(`
      SELECT id, employee_code, month, year, company, original_system_days,
             corrected_days, correction_delta, correction_reason, correction_notes,
             corrected_by, corrected_at, correction_type, finance_verified
      FROM day_corrections
      WHERE employee_code = ? AND (year * 100 + month) BETWEEN ? AND ?
      ORDER BY corrected_at DESC
    `).all(employeeCode, startYM, endYM);
  } catch (_) { dayCorrections = []; }

  let punchCorrections = [];
  try {
    // Actual schema uses: date, reason, added_by, added_at — aliased for consistency
    punchCorrections = db.prepare(`
      SELECT id, employee_code,
             date            AS correction_date,
             original_in_time, corrected_in_time,
             original_out_time, corrected_out_time,
             reason          AS correction_reason,
             added_by        AS corrected_by,
             added_at        AS created_at
      FROM punch_corrections
      WHERE employee_code = ? AND date BETWEEN ? AND ?
      ORDER BY added_at DESC
    `).all(employeeCode, startDate, endDate);
  } catch (_) { punchCorrections = []; }

  let lateDeductions = [];
  try {
    lateDeductions = db.prepare(`
      SELECT id, employee_code, month, year, company, late_count, deduction_days,
             remark, applied_by, applied_at, finance_status, finance_reviewed_by,
             finance_reviewed_at, finance_remark, is_applied_to_salary
      FROM late_coming_deductions
      WHERE employee_code = ? AND (year * 100 + month) BETWEEN ? AND ?
      ORDER BY applied_at DESC
    `).all(employeeCode, startYM, endYM);
  } catch (_) { lateDeductions = []; }

  const corrections = { dayCorrections, punchCorrections, lateDeductions };

  // ── Section K: Leave Usage ────────────────────────────────────────────────
  const empRow = db.prepare('SELECT id FROM employees WHERE code = ?').get(employeeCode);
  const empId  = empRow ? empRow.id : null;

  let leaveBalances = [];
  if (empId) {
    leaveBalances = db.prepare(
      'SELECT * FROM leave_balances WHERE employee_id = ? ORDER BY year DESC'
    ).all(empId);
  }

  let leaveApplications = [];
  try {
    // Overlap condition: application's [start, end] intersects query [startDate, endDate]
    leaveApplications = db.prepare(`
      SELECT * FROM leave_applications
      WHERE employee_code = ? AND start_date <= ? AND end_date >= ?
      ORDER BY start_date
    `).all(employeeCode, endDate, startDate);
  } catch (_) { leaveApplications = []; }

  const leaveUsage = { balances: leaveBalances, applications: leaveApplications };

  // ── Section L: Pattern Analysis ───────────────────────────────────────────
  let patternAnalysis = null;
  try {
    const analyzeEmployeePatterns = getPatternEngine();
    patternAnalysis = analyzeEmployeePatterns(db, employeeCode, startDate, endDate, {
      employee, kpis, monthlyBreakdown, behavioralPatterns, regularityScore
    });
  } catch (err) {
    console.warn('[profileService] patternEngine failed:', err.message);
    patternAnalysis = { patterns: [], compositeScores: { flightRisk: 0, engagement: 100, reliability: 0 }, summary: { totalPatternsDetected: 0 }, generatedAt: new Date().toISOString() };
  }

  // ── Final Assembly ────────────────────────────────────────────────────────
  return {
    employee,
    kpis,
    streaks,
    arrivalDeparture,
    regularityScore,
    behavioralPatterns,
    monthlyBreakdown,
    departmentComparison,
    salaryHistory,
    corrections,
    leaveUsage,
    patternAnalysis,
    meta: {
      rangeStart:     startDate,
      rangeEnd:       endDate,
      monthsCovered:  monthsInRange.length,
      generatedAt:    new Date().toISOString()
    }
  };
}

module.exports = {
  computeProfileRange,
  // Exported so patternEngine can import without circular deps
  parseTimeToMinutes,
  minutesToTimeStr,
  getMonthsInRange,
  yearMonthKey
};
