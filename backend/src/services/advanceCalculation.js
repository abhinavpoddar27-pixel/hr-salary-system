/**
 * Advance Calculation Service
 *
 * Calculate advance eligibility for all ACTIVE employees.
 *
 * RULES (updated March 2026):
 * - Attendance counted from 1st to 20th of each month.
 * - Working days include: P, ½P, WOP PLUS paid Sundays (Sunday rule applies).
 * - Sundays within the 1st-20th window where the employee qualifies for paid Sunday
 *   (worked ≥4 days in that week) count as working days.
 * - If ≥15 working days (1st-20th): advance = 55% of gross monthly salary.
 * - If <15 but >0 working days: advance = 80% of pro-rata salary (gross × workingDays/26 × 0.80).
 * - Employees with 0 working days are not eligible.
 * - Inactive, Exited, and Left employees are excluded.
 * - Advance is recovered from the final salary of the same month.
 */

function getPolicyValue(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? parseFloat(row.value) || row.value : defaultVal;
}

/**
 * Count Sundays within a date range that fall in weeks where employee worked enough days
 */
function countPaidSundays(db, empCode, month, year, startDate, endDate) {
  // Get all records for the date range
  const records = db.prepare(`
    SELECT date, COALESCE(status_final, status_original) as status
    FROM attendance_processed
    WHERE employee_code = ? AND month = ? AND year = ?
    AND date >= ? AND date <= ?
    AND is_night_out_only = 0
  `).all(empCode, month, year, startDate, endDate);

  const statusByDate = {};
  for (const r of records) statusByDate[r.date] = r.status;

  // Find all Sundays in the range
  let paidSundays = 0;
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) continue; // Not Sunday

    // Count working days in the Mon-Sat before this Sunday
    let weekWorkDays = 0;
    for (let offset = 1; offset <= 6; offset++) {
      const wd = new Date(d);
      wd.setDate(wd.getDate() - offset);
      if (wd < start) continue; // Before our window
      const dateStr = wd.toISOString().split('T')[0];
      const st = statusByDate[dateStr];
      if (st === 'P' || st === 'WOP') weekWorkDays += 1;
      else if (st === '\u00bdP' || st === 'WO\u00bdP') weekWorkDays += 0.5;
    }

    // Sunday rule: ≥4 working days in the week → paid Sunday
    if (weekWorkDays >= 4) paidSundays++;
  }

  return paidSundays;
}

/**
 * Calculate advance eligibility for all active employees in a month
 */
function calculateAdvances(db, month, year) {
  const cutoffDate = parseInt(getPolicyValue(db, 'advance_cutoff_date', 20));
  const advanceFractionHigh = parseFloat(getPolicyValue(db, 'advance_fraction', 0.55));
  const advanceFractionLow = parseFloat(getPolicyValue(db, 'advance_fraction_low', 0.80));

  const employees = db.prepare(`
    SELECT DISTINCT e.id, e.code, e.name, e.department, e.designation, e.gross_salary
    FROM employees e
    INNER JOIN attendance_processed ap ON e.code = ap.employee_code
    WHERE ap.month = ? AND ap.year = ?
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(month, year);

  const results = [];

  for (const emp of employees) {
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(cutoffDate).padStart(2, '0')}`;

    // Count actual present days (P, ½P, WOP) — excludes Sundays
    const workingDaysResult = db.prepare(`
      SELECT COUNT(*) as count FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ?
      AND date >= ? AND date <= ?
      AND (COALESCE(status_final, status_original) IN ('P', '\u00bdP', 'WOP', 'WO\u00bdP'))
      AND is_night_out_only = 0
    `).get(emp.code, month, year, startDate, endDate);

    const presentDays = workingDaysResult?.count || 0;

    // Count paid Sundays (Sunday rule: ≥4 working days in that week)
    const paidSundays = countPaidSundays(db, emp.code, month, year, startDate, endDate);

    // Total working days = present + paid Sundays
    const workingDays = presentDays + paidSundays;

    let isEligible = workingDays > 0;
    let advanceAmount = 0;

    if (isEligible) {
      let grossMonthly = 0;

      const salStruct = db.prepare(`
        SELECT * FROM salary_structures
        WHERE employee_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC LIMIT 1
      `).get(emp.id, `${year}-${monthStr}-01`);

      if (salStruct) {
        // Use gross_salary field first (always set), fall back to component sum
        const componentSum = (salStruct.basic || 0) + (salStruct.da || 0) +
          (salStruct.hra || 0) + (salStruct.conveyance || 0) +
          (salStruct.special_allowance || 0) + (salStruct.other_allowances || 0);
        grossMonthly = salStruct.gross_salary > 0 ? salStruct.gross_salary : (componentSum > 0 ? componentSum : emp.gross_salary || 0);
      } else if (emp.gross_salary > 0) {
        grossMonthly = emp.gross_salary;
      }

      if (grossMonthly > 0) {
        if (workingDays >= 15) {
          // 55% of gross monthly salary, rounded to nearest ₹100
          advanceAmount = Math.round(grossMonthly * advanceFractionHigh / 100) * 100;
        } else if (workingDays > 0) {
          // Pro-rata: (gross / 26) × workingDays × 80%, rounded to nearest ₹100
          const proRataSalary = (grossMonthly / 26) * workingDays;
          advanceAmount = Math.round(proRataSalary * advanceFractionLow / 100) * 100;
        } else {
          isEligible = false;
        }
      } else {
        isEligible = false;
      }
    }

    // Check if advance already exists — preserve remark/status if set
    const existing = db.prepare(`
      SELECT id, remark, paid, advance_amount AS prev_amount FROM salary_advances WHERE employee_code = ? AND month = ? AND year = ?
    `).get(emp.code, month, year);

    if (existing) {
      // Don't overwrite custom reduced amount or remark
      const updateAmount = (existing.remark === 'REDUCED' && existing.prev_amount > 0) ? existing.prev_amount : advanceAmount;
      db.prepare(`
        UPDATE salary_advances SET
          working_days_1_to_15 = ?, is_eligible = ?,
          advance_amount = CASE WHEN remark = 'REDUCED' THEN advance_amount ELSE ? END,
          calculation_date = datetime('now')
        WHERE id = ?
      `).run(workingDays, isEligible ? 1 : 0, advanceAmount, existing.id);
    } else {
      db.prepare(`
        INSERT INTO salary_advances (
          employee_id, employee_code, month, year, working_days_1_to_15,
          is_eligible, advance_amount, calculation_date, recovery_month, recovery_year
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
      `).run(emp.id, emp.code, month, year, workingDays, isEligible ? 1 : 0, advanceAmount, month, year);
    }

    results.push({
      employeeCode: emp.code,
      employeeName: emp.name,
      department: emp.department,
      workingDays,
      presentDays,
      paidSundays,
      isEligible,
      advanceAmount
    });
  }

  return results;
}

module.exports = { calculateAdvances };
