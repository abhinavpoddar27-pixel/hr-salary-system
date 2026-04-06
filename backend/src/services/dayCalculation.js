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
      weekBreakdown: '[]',
      isContractor: 1
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SUNDAY CALCULATION — Week by week (permanent employees only)
  // ─────────────────────────────────────────────────────────────

  // Running leave balances (will be deducted as we go)
  let clBalance = (leaveBalances.CL || 0);
  let elBalance = (leaveBalances.EL || 0);

  let paidSundays = 0;
  let unpaidSundays = 0;
  let clUsed = 0;
  let elUsed = 0;
  let lopDays = 0;

  const weekBreakdown = [];

  // Group Sundays with their preceding Mon-Sat week
  for (const sundayDate of sundayDates) {
    // Find the Mon-Sat days preceding this Sunday
    const sundayJS = new Date(sundayDate + 'T12:00:00');

    // Get Mon-Sat of the week ending on this Sunday
    const weekDays = [];
    for (let d = 6; d >= 1; d--) {
      const weekDate = new Date(sundayJS);
      weekDate.setDate(sundayJS.getDate() - d);
      const dateStr = weekDate.toISOString().split('T')[0];
      if (allDates.includes(dateStr)) {
        weekDays.push(dateStr);
      }
    }

    // Count working days for Mon-Sat of this week
    // Exclude holiday days from the working day requirement
    const weekWorkingDays = weekDays.filter(d => !holidayDates.has(d) && getDayOfWeek(d) !== 0);
    const maxWorkingDays = weekWorkingDays.length; // Could be < 6 for partial first week

    let weekActualWorkingDays = 0;
    for (const d of weekWorkingDays) {
      const rec = recordByDate[d];
      if (!rec) {
        // No record → absent
        continue;
      }
      const status = rec.status_final || rec.status_original || '';
      if (status === 'P' || status === 'WOP') weekActualWorkingDays += 1;
      else if (status === '½P' || status === 'HP' || status === 'WO½P') weekActualWorkingDays += 0.5;
    }

    // Normalize: if week has < 6 available working days (month start/end),
    // scale the requirement proportionally
    const requiredDays = Math.min(6, maxWorkingDays);

    let weekClUsed = 0;
    let weekElUsed = 0;
    let weekLOP = 0;
    let sundayPaid = false;
    let sundayNote = '';

    // If the employee actually worked on this Sunday (WOP), it's always paid
    // — you can't mark a day unpaid when the person came to work
    const sundayRec = recordByDate[sundayDate];
    const sundayStatus = sundayRec ? (sundayRec.status_final || sundayRec.status_original || '') : '';
    const workedOnSunday = sundayStatus === 'WOP' || sundayStatus === 'P' || sundayStatus === 'WO½P';

    if (workedOnSunday) {
      sundayPaid = true;
      sundayNote = `Worked on Sunday (${sundayStatus}) → Paid Sunday`;

    } else if (weekActualWorkingDays >= requiredDays) {
      // Full week worked — paid Sunday, no deductions
      sundayPaid = true;
      sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} days → Paid Sunday`;

    } else if (weekActualWorkingDays >= 4 || (requiredDays < 6 && weekActualWorkingDays >= Math.max(2, requiredDays - 2))) {
      const shortage = requiredDays - weekActualWorkingDays;

      if (clBalance >= shortage) {
        // Use CL
        weekClUsed = shortage;
        clBalance -= shortage;
        clUsed += shortage;
        sundayPaid = true;
        sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} → Paid Sunday. CL deducted: ${shortage.toFixed(1)}`;

      } else if (clBalance + elBalance >= shortage) {
        // Use CL first, then EL
        const clDeduct = Math.min(clBalance, shortage);
        const elDeduct = shortage - clDeduct;
        weekClUsed = clDeduct;
        weekElUsed = elDeduct;
        clBalance -= clDeduct;
        elBalance -= elDeduct;
        clUsed += clDeduct;
        elUsed += elDeduct;
        sundayPaid = true;
        sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} → Paid Sunday. CL: ${clDeduct.toFixed(1)}, EL: ${elDeduct.toFixed(1)} deducted`;

      } else if (shortage <= 1.5) {
        // Grant Sunday but mark LOP
        weekLOP = shortage - clBalance - elBalance;
        const clDeduct = Math.min(clBalance, shortage);
        const elDeduct = Math.min(elBalance, shortage - clDeduct);
        weekClUsed = clDeduct;
        weekElUsed = elDeduct;
        clBalance -= clDeduct;
        elBalance -= elDeduct;
        clUsed += clDeduct;
        elUsed += elDeduct;
        lopDays += weekLOP;
        sundayPaid = true;
        sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} → Paid Sunday. LOP: ${weekLOP.toFixed(1)} day(s)`;

      } else {
        // Unpaid Sunday
        sundayPaid = false;
        sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} → Unpaid Sunday (shortage ${shortage.toFixed(1)} > 1.5, no leave balance)`;
      }
    } else {
      // Less than 4 days — unpaid Sunday
      sundayPaid = false;
      sundayNote = `Worked ${weekActualWorkingDays}/${requiredDays} days → Unpaid Sunday`;
    }

    if (sundayPaid) paidSundays++;
    else unpaidSundays++;

    weekBreakdown.push({
      sundayDate,
      weekDays: weekWorkingDays,
      availableDays: maxWorkingDays,
      workedDays: weekActualWorkingDays,
      requiredDays,
      sundayPaid,
      clUsed: weekClUsed,
      elUsed: weekElUsed,
      lop: weekLOP,
      note: sundayNote
    });
  }

  // ── Shift swap / make-up day adjustment ──────────────────────
  // In 24/7 operations, employees swap shifts/offs with each other.
  // If total attendance (P + WOP + ½P) for the month meets or exceeds
  // the required working days, waive ALL per-week LOP — the employee
  // made up the days in other weeks or on weekly offs.
  // Also waive if the resulting payable days would equal or exceed the month days.
  const totalWorkedDays = daysPresent + daysWOP + daysHalfPresent;
  const projectedPayable = totalWorkedDays + paidSundays + (holidayNonSunday.length) - lopDays;
  if (lopDays > 0 && (totalWorkedDays >= totalWorkingDays || projectedPayable + lopDays >= daysInMonth)) {
    lopDays = 0;
    // Also clear per-week LOP entries in breakdown
    for (const wb of weekBreakdown) {
      if (wb.lop > 0) {
        wb.lop = 0;
        wb.note = wb.note.replace(/LOP:.*day\(s\)/, 'LOP waived (monthly attendance met)');
      }
    }
  }

  // Paid holidays
  const paidHolidays = holidayNonSunday.length;

  // ── Payable & Extra Duty Calculation ───────────────────────
  // daysPresent = regular working day attendance (P status only, excludes WOP)
  // daysWOP = weekly off worked (WOP status, Sundays/holidays worked)
  // Gross earned = all working/attendance days + paid offs
  const grossEarned = daysPresent + daysWOP + daysHalfPresent + paidSundays + paidHolidays;
  const netPayable = grossEarned - lopDays;

  // Extra Duty: days worked beyond the regular working schedule (before LOP)
  // = WOP days + any excess working-day attendance over scheduled working days
  const extraWorkingDays = Math.max(0, daysPresent + daysHalfPresent - totalWorkingDays);
  const extraDutyDays = Math.round((daysWOP + extraWorkingDays) * 100) / 100;

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
    weekBreakdown: JSON.stringify(weekBreakdown)
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
      total_payable_days, extra_duty_days, ot_hours, ot_days, late_count, holiday_duty_days, week_breakdown
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
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
    calcResult.weekBreakdown
  );

  return calcResult;
}

module.exports = { calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek };
