/**
 * Day Calculation Service
 *
 * Implements the EXACT Sunday granting rules from the project specification:
 *
 * For each Mon-Sat work week + its Sunday:
 *   working_days = P_count + WOP_count + (½P_count × 0.5)
 *
 *   if working_days >= 6:
 *     → Paid Sunday. No leave deduction.
 *
 *   elif working_days >= 4:
 *     shortage = 6 - working_days
 *     if CL_balance >= shortage:
 *       → Paid Sunday. Deduct shortage from CL.
 *     elif CL_balance + EL_balance >= shortage:
 *       → Paid Sunday. Deduct CL first, then EL.
 *     elif shortage <= 1.5:
 *       → Paid Sunday. Mark shortage as LOP.
 *     else:
 *       → Unpaid Sunday.
 *
 *   else (working_days < 4):
 *     → Unpaid Sunday.
 */

const { parseHoursToDecimal } = require('./parser');
const { isContractor } = require('../utils/employeeClassification');

/**
 * Get all dates in a month as YYYY-MM-DD strings
 */
function getMonthDates(month, year) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }
  return dates;
}

/**
 * Get day of week (0=Sunday, 1=Monday, ... 6=Saturday) for a date string
 */
function getDayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay();
}

/**
 * Parse HH:MM to decimal hours
 */
function timeToHours(timeStr) {
  return parseHoursToDecimal(timeStr);
}

/**
 * Count working days from a list of day records
 * P = 1.0, WOP = 1.0, ½P = 0.5, WO½P = 0.5, A/WO = 0
 */
function countWorkingDays(dayRecords) {
  let days = 0;
  for (const r of dayRecords) {
    const status = r.status_final || r.status_original || '';
    if (status === 'P' || status === 'WOP') days += 1;
    else if (status === '½P' || status === 'HP' || status === 'WO½P') days += 0.5;
  }
  return days;
}

/**
 * Main day calculation function.
 *
 * @param {string} employeeCode
 * @param {number} month
 * @param {number} year
 * @param {string} company
 * @param {Array} attendanceRecords - attendance_processed records for this employee this month
 * @param {Object} leaveBalances - { CL: number, EL: number, SL: number }
 * @param {Array} holidays - holiday records { date: 'YYYY-MM-DD' } for this month
 * @returns {Object} day calculation result
 */
function calculateDays(employeeCode, month, year, company, attendanceRecords, leaveBalances, holidays, options = {}) {
  const contractorMode = options.isContractor || false;
  const allDates = getMonthDates(month, year);
  const daysInMonth = allDates.length;

  // Build a map of date → attendance record
  const recordByDate = {};
  for (const r of attendanceRecords) {
    // Skip night-shift OUT-only records (the OUT portion is counted on the IN date)
    if (r.is_night_out_only) continue;
    recordByDate[r.date] = r;
  }

  // Build holiday set
  const holidayDates = new Set((holidays || []).map(h => h.date));

  // Count Sundays in the month
  const sundayDates = allDates.filter(d => getDayOfWeek(d) === 0);
  const totalSundays = sundayDates.length;

  // Count holidays that are NOT Sundays
  let holidayCount = 0;
  const holidayNonSunday = [];
  for (const hDate of holidayDates) {
    if (allDates.includes(hDate) && getDayOfWeek(hDate) !== 0) {
      holidayCount++;
      holidayNonSunday.push(hDate);
    }
  }

  // Total working days available = calendar days - sundays - holidays
  const totalWorkingDays = daysInMonth - totalSundays - holidayCount;

  // Count attendance
  let daysPresent = 0;
  let daysHalfPresent = 0;
  let daysWOP = 0;
  let holidayDutyDays = 0;
  let daysAbsent = 0;
  let otHours = 0;
  let lateCount = 0;

  for (const dateStr of allDates) {
    const isSunday = getDayOfWeek(dateStr) === 0;
    const isHoliday = holidayDates.has(dateStr);

    const rec = recordByDate[dateStr];
    if (!rec) {
      // Only count as absent if it's a regular working day (not Sunday, not holiday)
      if (!isHoliday && !isSunday) daysAbsent++;
      continue;
    }

    const status = rec.status_final || rec.status_original || '';

    if (status === 'P') daysPresent += 1;
    else if (status === 'WOP') daysWOP += 1;                           // WOP counted ONLY in daysWOP, not daysPresent
    else if (status === '½P' || status === 'HP') daysHalfPresent += 0.5;  // Handle both '½P' and 'HP' status codes
    else if (status === 'WO½P') daysWOP += 0.5;
    else if (status === 'A') {
      // Sundays and holidays should NEVER be counted as absent days
      // They are weekly offs / public holidays, not absent days
      if (!isSunday && !isHoliday) daysAbsent++;
    }
    // WO status on Sunday/weekly off is expected — don't count as absent

    // Track holiday duty — employee worked on a declared holiday
    if (isHoliday && !isSunday) {
      if (status === 'P' || status === 'WOP') holidayDutyDays += 1;
      else if (status === '½P' || status === 'HP' || status === 'WO½P') holidayDutyDays += 0.5;
    }

    // Count late arrivals
    if (rec.is_late_arrival) lateCount++;

    // OT hours
    if (rec.overtime_minutes) otHours += rec.overtime_minutes / 60;
  }

  // ─────────────────────────────────────────────────────────────
  // CONTRACTOR SHORTCUT — daily wage, no paid Sundays/holidays
  // ─────────────────────────────────────────────────────────────
  if (contractorMode) {
    // Contractor payable = present + half + WOP (they worked those days)
    const finalPayable = Math.round((daysPresent + daysHalfPresent + daysWOP) * 100) / 100;
    // Build a minimal weekBreakdown so the UI can still render something sane
    const cWeekBreakdown = sundayDates.map(sundayDate => ({
      sundayDate,
      weekDays: [],
      availableDays: 0,
      workedDays: 0,
      requiredDays: 0,
      sundayPaid: false,
      clUsed: 0,
      elUsed: 0,
      lop: 0,
      note: 'Contractor — no Sunday pay'
    }));
    return {
      employeeCode, month, year, company,
      totalCalendarDays: daysInMonth, totalSundays, totalHolidays: holidayCount, totalWorkingDays,
      daysPresent: Math.round(daysPresent * 100) / 100,
      daysHalfPresent: Math.round(daysHalfPresent * 100) / 100,
      daysWOP: Math.round(daysWOP * 100) / 100,
      daysAbsent,
      paidSundays: 0, unpaidSundays: totalSundays, paidHolidays: 0,
      clUsed: 0, elUsed: 0, slUsed: 0, lopDays: 0,
      totalPayableDays: finalPayable,
      extraDutyDays: 0,
      holidayDutyDays: Math.round(holidayDutyDays * 100) / 100,
      otHours: Math.round(otHours * 100) / 100,
      otDays: 0, lateCount,
      weekBreakdown: JSON.stringify(cWeekBreakdown),
      isContractor: 1,
      employmentType: 'Contractor',
      sundayLeniency: null,
      sundayThreshold: null,
      sundayNote: 'Contractor — no Sunday pay'
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PERMANENT STAFF — Monthly Leniency Model (April 2026 overhaul)
  // ─────────────────────────────────────────────────────────────
  // Old model: week-by-week Sunday granting with CL/EL fallback + LOP shortage.
  // New model: ONE monthly check. If effectivePresent >= (workingDays - leniency),
  // ALL Sundays are paid. Otherwise, first N Sundays are paid where
  // N = totalSundays - sundaysLost. No CL/EL deductions from Sunday logic;
  // CL/EL are managed separately through the leave system.

  const SUNDAY_LENIENCY = 2; // hardcoded — forgive up to 2 absent working days
  const clUsed = 0; // leave deductions no longer tied to Sunday logic
  const elUsed = 0;
  const lopDays = 0;

  // paidHolidays (non-Sunday holidays) is computed unconditionally for permanent
  const paidHolidays = holidayNonSunday.length;

  // workingDays = Mon-Sat days that are NOT holidays
  const workingDays = daysInMonth - totalSundays - paidHolidays;
  // effectivePresent = actual work + holidays (holidays already accrue as "free" days)
  const effectivePresent = daysPresent + daysHalfPresent + paidHolidays;
  const sundayThreshold = workingDays - SUNDAY_LENIENCY;

  let paidSundays = 0;
  let unpaidSundays = 0;
  let sundayNote = '';

  if (effectivePresent >= sundayThreshold) {
    paidSundays = totalSundays;
    unpaidSundays = 0;
    sundayNote = `Present ${effectivePresent}/${workingDays} (threshold ${sundayThreshold}) → All ${totalSundays} Sundays paid`;
  } else {
    const sundaysLost = Math.min(totalSundays, sundayThreshold - effectivePresent);
    paidSundays = Math.max(0, totalSundays - sundaysLost);
    unpaidSundays = totalSundays - paidSundays;
    sundayNote = `Present ${effectivePresent}/${workingDays} (threshold ${sundayThreshold}) → ${sundaysLost} Sunday(s) lost, ${paidSundays} paid`;
  }

  // Build weekBreakdown for the UI: one entry per Sunday, first N paid, rest not
  const weekBreakdown = sundayDates.map((sundayDate, i) => ({
    sundayDate,
    weekDays: [],
    availableDays: workingDays,
    workedDays: effectivePresent,
    requiredDays: sundayThreshold,
    sundayPaid: i < paidSundays,
    clUsed: 0,
    elUsed: 0,
    lop: 0,
    note: i < paidSundays
      ? `Paid (monthly leniency: ${effectivePresent} ≥ ${sundayThreshold})`
      : `Unpaid (monthly leniency: ${effectivePresent} < ${sundayThreshold}, Sunday #${i+1} of ${totalSundays})`
  }));
  // daysPresent = regular working day attendance (P status only, excludes WOP)
  // daysWOP = weekly off worked (WOP status, Sundays/holidays worked)
  // Gross earned = all working/attendance days + paid offs
  const grossEarned = daysPresent + daysWOP + daysHalfPresent + paidSundays + paidHolidays;
  const netPayable = grossEarned - lopDays;

  // Extra Duty: days worked beyond the regular working schedule (before LOP)
  // = WOP days + any excess working-day attendance over scheduled working days
  const extraWorkingDays = Math.max(0, daysPresent + daysHalfPresent - totalWorkingDays);
  const manualGrantDays = options.manualExtraDutyDays || 0;
  const extraDutyDays = Math.round((daysWOP + extraWorkingDays + manualGrantDays) * 100) / 100;

  // Payable: capped at calendar days (extra duty is paid separately)
  const finalPayable = Math.max(0, Math.min(daysInMonth, netPayable));

  return {
    employeeCode,
    month,
    year,
    company,
    totalCalendarDays: daysInMonth,
    totalSundays,
    totalHolidays: holidayCount,
    totalWorkingDays,
    daysPresent: Math.round(daysPresent * 100) / 100,
    daysHalfPresent: Math.round(daysHalfPresent * 100) / 100,
    daysWOP: Math.round(daysWOP * 100) / 100,
    daysAbsent,
    paidSundays: Math.round(paidSundays * 100) / 100,
    unpaidSundays,
    paidHolidays,
    clUsed: Math.round(clUsed * 100) / 100,
    elUsed: Math.round(elUsed * 100) / 100,
    slUsed: 0, // SL handled separately
    lopDays: Math.round(lopDays * 100) / 100,
    totalPayableDays: Math.round(finalPayable * 100) / 100,
    extraDutyDays,
    otHours: Math.round(otHours * 100) / 100,
    otDays: Math.round(otHours / 12 * 100) / 100,
    lateCount,
    holidayDutyDays: Math.round(holidayDutyDays * 100) / 100,
    weekBreakdown: JSON.stringify(weekBreakdown),
    // ── Monthly leniency model fields (permanent employees) ──
    isContractor: 0,
    employmentType: 'Permanent',
    sundayLeniency: SUNDAY_LENIENCY,
    sundayThreshold,
    sundayNote
  };
}

/**
 * Save day calculation to database
 */
function saveDayCalculation(db, calcResult) {
  const stmt = db.prepare(`
    INSERT INTO day_calculations (
      employee_code, month, year, company,
      total_calendar_days, total_sundays, total_holidays, total_working_days,
      days_present, days_half_present, days_wop, days_absent,
      paid_sundays, unpaid_sundays, paid_holidays,
      cl_used, el_used, sl_used, lop_days,
      total_payable_days, extra_duty_days, ot_hours, ot_days, late_count, holiday_duty_days, week_breakdown,
      is_contractor, sunday_threshold, sunday_note
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(employee_code, month, year, company) DO UPDATE SET
      total_calendar_days = excluded.total_calendar_days,
      total_sundays = excluded.total_sundays,
      total_holidays = excluded.total_holidays,
      total_working_days = excluded.total_working_days,
      days_present = excluded.days_present,
      days_half_present = excluded.days_half_present,
      days_wop = excluded.days_wop,
      days_absent = excluded.days_absent,
      paid_sundays = excluded.paid_sundays,
      unpaid_sundays = excluded.unpaid_sundays,
      paid_holidays = excluded.paid_holidays,
      cl_used = excluded.cl_used,
      el_used = excluded.el_used,
      sl_used = excluded.sl_used,
      lop_days = excluded.lop_days,
      total_payable_days = excluded.total_payable_days,
      extra_duty_days = excluded.extra_duty_days,
      ot_hours = excluded.ot_hours,
      ot_days = excluded.ot_days,
      late_count = excluded.late_count,
      holiday_duty_days = excluded.holiday_duty_days,
      week_breakdown = excluded.week_breakdown,
      is_contractor = excluded.is_contractor,
      sunday_threshold = excluded.sunday_threshold,
      sunday_note = excluded.sunday_note,
      is_approved = 0
  `);

  stmt.run(
    calcResult.employeeCode, calcResult.month, calcResult.year, calcResult.company,
    calcResult.totalCalendarDays, calcResult.totalSundays, calcResult.totalHolidays, calcResult.totalWorkingDays,
    calcResult.daysPresent, calcResult.daysHalfPresent, calcResult.daysWOP, calcResult.daysAbsent,
    calcResult.paidSundays, calcResult.unpaidSundays, calcResult.paidHolidays,
    calcResult.clUsed, calcResult.elUsed, calcResult.slUsed, calcResult.lopDays,
    calcResult.totalPayableDays, calcResult.extraDutyDays || 0, calcResult.otHours, calcResult.otDays,
    calcResult.lateCount, calcResult.holidayDutyDays || 0,
    calcResult.weekBreakdown,
    calcResult.isContractor ? 1 : 0,
    calcResult.sundayThreshold !== undefined && calcResult.sundayThreshold !== null ? calcResult.sundayThreshold : null,
    calcResult.sundayNote || ''
  );

  return calcResult;
}

module.exports = { calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek };
