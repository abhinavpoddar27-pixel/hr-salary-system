/**
 * Day Calculation Service — Baseline Model (April 2026 overhaul)
 *
 * For each employee, computes payable days for the month using the
 * baseline-minus-absences model (permanent) or daily-wage model (contractor).
 *
 * PERMANENT EMPLOYEE MODEL
 * ────────────────────────
 * Base entitlement is the full month. The employee's weekly off day and
 * public holidays are already INCLUDED in that base — they are not
 * "awarded" separately. Absences on working days SUBTRACT from the base.
 * Working on the weekly off day (WOP) is EXTRA work on top of the base,
 * which can push payable above daysInMonth and become OT.
 *
 *   baseEntitlement = workingDays + paidWeeklyOffs + paidHolidays
 *                   ( = daysInMonth when no weekly offs are stripped)
 *   totalAbsences   = daysAbsent + daysHalfPresent
 *                     (daysHalfPresent is the absent half of each ½P day)
 *   finalPayable    = max(0, baseEntitlement − totalAbsences + daysWOP)
 *   extraDutyDays   = max(0, finalPayable − daysInMonth)
 *
 * WEEKLY OFF GRANTING — three-tier proportional
 * ─────────────────────────────────────────────
 *   Tier 1  effectivePresent ≥ (workingDays − LENIENCY)   →  all WOs paid
 *   Tier 2  effectivePresent > daysPerWeeklyOff           →  floor(eff / dpw) WOs
 *   Tier 3  effectivePresent ≤ daysPerWeeklyOff           →  0 WOs
 *
 *   effectivePresent = daysPresent + daysHalfPresent + daysWOP + paidHolidays
 *                      (daysWOP counts — the employee actually showed up)
 *   daysPerWeeklyOff = workingDays / totalWeeklyOffs
 *
 * CONTRACTOR MODEL
 * ────────────────
 * Strictly daily wage. No weekly offs, no holidays, no base entitlement.
 *   finalPayable = daysPresent + daysHalfPresent + daysWOP
 *
 * GENERALISED WEEKLY OFF (not just Sunday)
 * ────────────────────────────────────────
 * The employee's `weekly_off_day` (0=Sun, 1=Mon, … 6=Sat) is passed in as
 * `options.weeklyOffDay`. All "Sunday" detection is generalised to this
 * field. The field is persisted on `employees.weekly_off_day`.
 */

const { parseHoursToDecimal } = require('./parser');

/** Hardcoded lenience: max absent working days before ANY weekly off is lost */
const WEEKLY_OFF_LENIENCY = 2;

/** Get all dates in a month as YYYY-MM-DD strings */
function getMonthDates(month, year) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }
  return dates;
}

/** Day of week (0=Sunday … 6=Saturday) */
function getDayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay();
}

function timeToHours(timeStr) {
  return parseHoursToDecimal(timeStr);
}

/** Count working days from a list of day records (legacy helper) */
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
 * Main day calculation.
 *
 * @param {string} employeeCode
 * @param {number} month 1-12
 * @param {number} year
 * @param {string} company
 * @param {Array}  attendanceRecords  attendance_processed rows for this employee this month
 * @param {Object} leaveBalances      { CL, EL, SL } — retained for backward compat, unused by WO logic
 * @param {Array}  holidays           [{ date, applicable_to }, …]
 * @param {Object} options
 * @param {boolean} options.isContractor
 * @param {number}  options.weeklyOffDay   0=Sun … 6=Sat (default 0)
 * @param {string}  options.employmentType Permanent / Contractor / Worker / SILP / …
 * @param {number}  options.manualExtraDutyDays
 * @param {string}  options.dateOfJoining  YYYY-MM-DD — pre-DOJ days excluded from
 *                                         working days, weekly offs, holidays, absences
 */
function calculateDays(employeeCode, month, year, company, attendanceRecords, leaveBalances, holidays, options = {}) {
  const contractorMode = options.isContractor || false;
  const weeklyOffDay = Number.isInteger(options.weeklyOffDay) ? options.weeklyOffDay : 0;
  const employmentType = options.employmentType || (contractorMode ? 'Contractor' : 'Permanent');

  // ── DOJ-based filtering (April 2026) ──
  // Employees who joined AFTER a date must NOT receive paid credit for any
  // holiday/weekly off/working day before their DOJ. Pre-DOJ days are also
  // never counted as absences.
  // dateOfJoining is YYYY-MM-DD; null = legacy / no filtering.
  const dateOfJoining = options.dateOfJoining || null;
  const isPreDOJ = (dateStr) => dateOfJoining && dateStr < dateOfJoining;

  const allDates = getMonthDates(month, year);
  const daysInMonth = allDates.length;

  // Eligible dates = on/after DOJ. For most employees this == allDates.
  const eligibleDates = dateOfJoining ? allDates.filter(d => d >= dateOfJoining) : allDates;
  const eligibleCalendarDays = eligibleDates.length;
  const isMidMonthJoiner = eligibleCalendarDays > 0 && eligibleCalendarDays < daysInMonth;

  // ── Build date → attendance record map (skip night-shift OUT-only rows) ──
  const recordByDate = {};
  for (const r of attendanceRecords) {
    if (r.is_night_out_only) continue;
    recordByDate[r.date] = r;
  }

  // ── Per-employee holiday filtering ──
  // Permanent employees see holidays tagged 'All' or 'Permanent'.
  // Contractors only see holidays explicitly tagged for them.
  const applicableHolidays = (holidays || []).filter(h => {
    const at = (h.applicable_to || 'All').toString().trim().toLowerCase();
    if (contractorMode) {
      return at === 'contract' || at === 'contractor';
    }
    return at === 'all' || at === 'permanent' || at === '';
  });
  const holidayDates = new Set(applicableHolidays.map(h => h.date));

  // ── Weekly off dates (generalised per employee, ELIGIBLE only) ──
  // Pre-DOJ weekly offs do not count — employee was not yet hired.
  const weeklyOffDates = eligibleDates.filter(d => getDayOfWeek(d) === weeklyOffDay);
  const totalWeeklyOffs = weeklyOffDates.length;

  // ── Holidays that are NOT on the employee's weekly off day ──
  // Holidays before DOJ are excluded from paid credit (mid-month joiner rule).
  const holidayNonWeeklyOff = [];
  let holidaysBeforeDOJ = 0;
  for (const hDate of holidayDates) {
    if (!allDates.includes(hDate)) continue;
    if (getDayOfWeek(hDate) === weeklyOffDay) continue;
    if (isPreDOJ(hDate)) {
      holidaysBeforeDOJ++;
    } else {
      holidayNonWeeklyOff.push(hDate);
    }
  }
  const holidayCount = holidayNonWeeklyOff.length;

  // workingDays = Mon-Sat-equivalent (eligible calendar days minus WOs minus applicable holidays)
  // For mid-month joiners eligibleCalendarDays < daysInMonth.
  const workingDays = eligibleCalendarDays - totalWeeklyOffs - holidayCount;

  // ── Attendance loop ──
  let daysPresent = 0;
  let daysHalfPresent = 0;
  let daysWOP = 0;
  let holidayDutyDays = 0;
  let daysAbsent = 0;
  let otHours = 0;
  let lateCount = 0;

  for (const dateStr of allDates) {
    // Skip dates before DOJ — employee had not joined yet, so absences,
    // weekly offs and holidays in this range do not count for them.
    if (isPreDOJ(dateStr)) continue;

    const isWeeklyOff = getDayOfWeek(dateStr) === weeklyOffDay;
    const isHoliday = holidayDates.has(dateStr);

    const rec = recordByDate[dateStr];
    if (!rec) {
      // No record → absent only if it's a regular working day
      if (!isHoliday && !isWeeklyOff) daysAbsent++;
      continue;
    }

    const status = rec.status_final || rec.status_original || '';

    if (status === 'P') daysPresent += 1;
    else if (status === 'WOP') daysWOP += 1;                      // worked on weekly off (extra)
    else if (status === '½P' || status === 'HP') daysHalfPresent += 0.5;
    else if (status === 'WO½P') daysWOP += 0.5;                   // half day on weekly off (extra)
    else if (status === 'A') {
      // Absent on a weekly off or holiday does not count as an absence
      if (!isWeeklyOff && !isHoliday) daysAbsent++;
    }
    else if (status === 'WO' || status === 'NH') {
      // Expected non-working day markers — no count
    }
    else {
      // GHOST STATUS CATCH-ALL — any unrecognised status (empty string ""
      // from a blank biometric cell, unknown code, whitespace, etc.) on a
      // regular working day MUST count as absent. Without this clause, a
      // ghost record silently fell through the if/else chain: the working
      // day stayed in `workingDays` (baseEntitlement), `daysAbsent` was
      // never incremented, and `finalPayable = baseEntitlement - absences`
      // inflated by one day per ghost. 232/422 employees in Mar 2026 were
      // affected; 4 "Returning" employees had 12-15 day overpayments
      // because only half the month had real biometric data.
      if (!isWeeklyOff && !isHoliday) daysAbsent++;
    }

    // Holiday duty — worked a declared non-weekly-off holiday
    if (isHoliday && !isWeeklyOff) {
      if (status === 'P' || status === 'WOP') holidayDutyDays += 1;
      else if (status === '½P' || status === 'HP' || status === 'WO½P') holidayDutyDays += 0.5;
    }

    if (rec.is_late_arrival) lateCount++;
    if (rec.overtime_minutes) otHours += rec.overtime_minutes / 60;
  }

  // ══════════════════════════════════════════════════════════════
  // CONTRACTOR PATH — daily wage, no weekly offs, no holidays
  // ══════════════════════════════════════════════════════════════
  if (contractorMode) {
    const finalPayable = Math.round((daysPresent + daysHalfPresent + daysWOP) * 100) / 100;
    const cWeekBreakdown = weeklyOffDates.map(d => ({
      sundayDate: d,
      weeklyOffDate: d,
      weekDays: [],
      availableDays: 0,
      workedDays: 0,
      requiredDays: 0,
      sundayPaid: false,
      weeklyOffPaid: false,
      clUsed: 0,
      elUsed: 0,
      lop: 0,
      note: 'Contractor — no paid weekly offs'
    }));
    return {
      employeeCode, month, year, company,
      totalCalendarDays: eligibleCalendarDays,
      weeklyOffDay,
      totalWeeklyOffs,
      totalSundays: totalWeeklyOffs,  // backward compat
      totalHolidays: 0,
      totalWorkingDays: workingDays,
      daysPresent: Math.round(daysPresent * 100) / 100,
      daysHalfPresent: Math.round(daysHalfPresent * 100) / 100,
      daysWOP: Math.round(daysWOP * 100) / 100,
      daysAbsent,
      paidWeeklyOffs: 0,
      unpaidWeeklyOffs: totalWeeklyOffs,
      paidSundays: 0,             // backward compat
      unpaidSundays: totalWeeklyOffs,
      paidHolidays: 0,
      clUsed: 0, elUsed: 0, slUsed: 0, lopDays: 0,
      baseEntitlement: 0,
      totalAbsences: 0,
      effectivePresent: Math.round((daysPresent + daysHalfPresent + daysWOP) * 100) / 100,
      daysPerWeeklyOff: 0,
      weeklyOffThreshold: null,
      weeklyOffTier: 'contractor',
      weeklyOffNote: 'Contractor — no paid weekly offs',
      totalPayableDays: finalPayable,
      extraDutyDays: 0,
      holidayDutyDays: Math.round(holidayDutyDays * 100) / 100,
      otHours: Math.round(otHours * 100) / 100,
      otDays: 0,
      lateCount,
      weekBreakdown: JSON.stringify(cWeekBreakdown),
      isContractor: 1,
      employmentType: 'Contractor',
      sundayLeniency: null,
      sundayThreshold: null,
      sundayNote: 'Contractor — no paid weekly offs',
      // DOJ visibility (April 2026)
      dateOfJoining,
      holidaysBeforeDOJ,
      isMidMonthJoiner: isMidMonthJoiner ? 1 : 0
    };
  }

  // ══════════════════════════════════════════════════════════════
  // PERMANENT PATH — baseline minus absences + extra work
  // ══════════════════════════════════════════════════════════════
  const paidHolidays = holidayCount;

  // daysPerWeeklyOff — how many working days "earn" one weekly off
  const daysPerWeeklyOff = totalWeeklyOffs > 0 ? workingDays / totalWeeklyOffs : workingDays;

  // effectivePresent — WOP counts! They showed up.
  const effectivePresent = daysPresent + daysHalfPresent + daysWOP + paidHolidays;
  const threshold = workingDays - WEEKLY_OFF_LENIENCY;

  // ── Three-tier weekly off granting ──
  let paidWeeklyOffs = 0;
  let unpaidWeeklyOffs = 0;
  let weeklyOffTier;
  let weeklyOffNote;

  if (effectivePresent >= threshold) {
    // TIER 1: good attendance → all weekly offs paid
    paidWeeklyOffs = totalWeeklyOffs;
    unpaidWeeklyOffs = 0;
    weeklyOffTier = 'tier1_full';
    weeklyOffNote = `Tier 1: ${effectivePresent}/${workingDays} present (≥${threshold}) → All ${totalWeeklyOffs} weekly offs paid`;
  } else if (effectivePresent > daysPerWeeklyOff) {
    // TIER 2: proportional — each chunk of working days earns 1 weekly off
    paidWeeklyOffs = Math.min(totalWeeklyOffs, Math.floor(effectivePresent / daysPerWeeklyOff));
    unpaidWeeklyOffs = totalWeeklyOffs - paidWeeklyOffs;
    weeklyOffTier = 'tier2_proportional';
    weeklyOffNote = `Tier 2: ${effectivePresent}/${workingDays} present. floor(${effectivePresent}/${daysPerWeeklyOff.toFixed(2)})=${paidWeeklyOffs} weekly off(s) paid, ${unpaidWeeklyOffs} lost`;
  } else {
    // TIER 3: severe absence → no weekly offs
    paidWeeklyOffs = 0;
    unpaidWeeklyOffs = totalWeeklyOffs;
    weeklyOffTier = 'tier3_none';
    weeklyOffNote = `Tier 3: ${effectivePresent}/${workingDays} present (≤${daysPerWeeklyOff.toFixed(2)}) → 0 weekly offs paid`;
  }

  // ── Baseline model ──
  const baseEntitlement = workingDays + paidWeeklyOffs + paidHolidays;
  const totalAbsences = daysAbsent + daysHalfPresent;
  // WOP is ADDITIONAL — on top of entitlement
  const rawPayable = baseEntitlement - totalAbsences + daysWOP;
  const manualGrantDays = options.manualExtraDutyDays || 0;
  const finalPayable = Math.max(0, Math.round((rawPayable + manualGrantDays) * 100) / 100);

  // Extra duty — anything above daysInMonth
  const extraDutyDays = Math.max(0, Math.round((finalPayable - daysInMonth) * 100) / 100);

  // ── Integrity assertion (ghost-status detector) ──
  // finalPayable should equal the sum of paid components:
  //   daysPresent + daysHalfPresent + paidWeeklyOffs + paidHolidays + daysWOP + manualGrantDays
  // Derivation: finalPayable = workingDays - daysAbsent - daysHalfPresent + paidWeeklyOffs + paidHolidays + daysWOP,
  // and workingDays = daysPresent + 2*daysHalfPresent + daysAbsent (assuming every
  // working day is accounted for as P / ½P / A — no ghost statuses).
  // If this mismatches, either a ghost record slipped through or the status
  // classification is missing a new code.
  const expectedPayable = daysPresent + daysHalfPresent + paidWeeklyOffs + paidHolidays + daysWOP + manualGrantDays;
  if (Math.abs(finalPayable - expectedPayable) > 0.01) {
    console.warn(
      `[DayCalc] Integrity warning ${employeeCode} ${month}/${year}: ` +
      `finalPayable=${finalPayable} but expected=${expectedPayable} ` +
      `(present=${daysPresent}, half=${daysHalfPresent}, paidWO=${paidWeeklyOffs}, ` +
      `holidays=${paidHolidays}, wop=${daysWOP}, absent=${daysAbsent}, workingDays=${workingDays})`
    );
  }

  // ── UI week breakdown: one entry per weekly off, first N paid ──
  const weekBreakdown = weeklyOffDates.map((d, i) => ({
    sundayDate: d,             // legacy field for existing UI
    weeklyOffDate: d,
    weekDays: [],
    availableDays: workingDays,
    workedDays: effectivePresent,
    requiredDays: threshold,
    sundayPaid: i < paidWeeklyOffs,
    weeklyOffPaid: i < paidWeeklyOffs,
    clUsed: 0,
    elUsed: 0,
    lop: 0,
    note: i < paidWeeklyOffs
      ? `Paid (${weeklyOffTier})`
      : `Unpaid (${weeklyOffTier})`
  }));

  return {
    employeeCode, month, year, company,
    totalCalendarDays: eligibleCalendarDays,

    // DOJ visibility (April 2026)
    dateOfJoining,
    holidaysBeforeDOJ,
    isMidMonthJoiner: isMidMonthJoiner ? 1 : 0,

    // New weekly off fields
    weeklyOffDay,
    totalWeeklyOffs,
    paidWeeklyOffs: Math.round(paidWeeklyOffs * 100) / 100,
    unpaidWeeklyOffs,
    weeklyOffNote,
    weeklyOffTier,
    weeklyOffThreshold: threshold,
    daysPerWeeklyOff: Math.round(daysPerWeeklyOff * 100) / 100,

    // Backward-compat Sunday field names (mapped to weekly off values)
    totalSundays: totalWeeklyOffs,
    paidSundays: Math.round(paidWeeklyOffs * 100) / 100,
    unpaidSundays: unpaidWeeklyOffs,

    totalHolidays: paidHolidays,
    totalWorkingDays: workingDays,

    daysPresent: Math.round(daysPresent * 100) / 100,
    daysHalfPresent: Math.round(daysHalfPresent * 100) / 100,
    daysWOP: Math.round(daysWOP * 100) / 100,
    daysAbsent,

    paidHolidays,

    // Transparency fields (baseline model)
    baseEntitlement: Math.round(baseEntitlement * 100) / 100,
    totalAbsences: Math.round(totalAbsences * 100) / 100,
    effectivePresent: Math.round(effectivePresent * 100) / 100,

    // Leave fields — retained for backward compat, unused by WO logic
    clUsed: 0,
    elUsed: 0,
    slUsed: 0,
    lopDays: 0,

    totalPayableDays: finalPayable,
    extraDutyDays,
    otHours: Math.round(otHours * 100) / 100,
    otDays: Math.round(otHours / 12 * 100) / 100,
    lateCount,
    holidayDutyDays: Math.round(holidayDutyDays * 100) / 100,

    weekBreakdown: JSON.stringify(weekBreakdown),

    isContractor: 0,
    employmentType,

    // Legacy sunday-* aliases
    sundayLeniency: WEEKLY_OFF_LENIENCY,
    sundayThreshold: threshold,
    sundayNote: weeklyOffNote
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
      is_contractor, sunday_threshold, sunday_note,
      weekly_off_day, base_entitlement, total_absences, effective_present,
      days_per_weekly_off, weekly_off_threshold, weekly_off_tier, weekly_off_note,
      date_of_joining, holidays_before_doj, is_mid_month_joiner
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
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
      weekly_off_day = excluded.weekly_off_day,
      base_entitlement = excluded.base_entitlement,
      total_absences = excluded.total_absences,
      effective_present = excluded.effective_present,
      days_per_weekly_off = excluded.days_per_weekly_off,
      weekly_off_threshold = excluded.weekly_off_threshold,
      weekly_off_tier = excluded.weekly_off_tier,
      weekly_off_note = excluded.weekly_off_note,
      date_of_joining = excluded.date_of_joining,
      holidays_before_doj = excluded.holidays_before_doj,
      is_mid_month_joiner = excluded.is_mid_month_joiner,
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
    calcResult.sundayNote || '',
    calcResult.weeklyOffDay ?? 0,
    calcResult.baseEntitlement ?? 0,
    calcResult.totalAbsences ?? 0,
    calcResult.effectivePresent ?? 0,
    calcResult.daysPerWeeklyOff ?? 0,
    calcResult.weeklyOffThreshold !== undefined && calcResult.weeklyOffThreshold !== null ? calcResult.weeklyOffThreshold : null,
    calcResult.weeklyOffTier || '',
    calcResult.weeklyOffNote || '',
    calcResult.dateOfJoining || null,
    calcResult.holidaysBeforeDOJ || 0,
    calcResult.isMidMonthJoiner ? 1 : 0
  );

  return calcResult;
}

module.exports = { calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek, WEEKLY_OFF_LENIENCY };
