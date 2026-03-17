/**
 * Advance Calculation Service
 *
 * Calculate advance eligibility for all ACTIVE employees.
 *
 * NEW RULES (effective March 2026):
 * - Attendance is counted from 1st to 20th of each month.
 * - If employee has >=15 working days (1st-20th): advance = 50% of gross monthly salary.
 * - If employee has <15 but >0 working days: advance = 75% of pro-rata salary (gross × workingDays/26 × 0.75).
 * - Employees with 0 working days are not eligible.
 * - Inactive, Exited, and Left employees are excluded from calculation.
 *
 * Advance is recovered from the final salary of the same month.
 */

function getPolicyValue(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? parseFloat(row.value) || row.value : defaultVal;
}

/**
 * Calculate advance eligibility for all active employees in a month
 */
function calculateAdvances(db, month, year) {
  const cutoffDate = parseInt(getPolicyValue(db, 'advance_cutoff_date', 20));

  // Get all ACTIVE employees with attendance in this month
  // Excludes Inactive, Exited, and Left employees
  const employees = db.prepare(`
    SELECT DISTINCT e.id, e.code, e.name, e.department, e.designation, e.gross_salary
    FROM employees e
    INNER JOIN attendance_processed ap ON e.code = ap.employee_code
    WHERE ap.month = ? AND ap.year = ?
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(month, year);

  const results = [];

  for (const emp of employees) {
    // Count working days from 1st to cutoff date (20th)
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(cutoffDate).padStart(2, '0')}`;

    const workingDaysResult = db.prepare(`
      SELECT COUNT(*) as count FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ?
      AND date >= ? AND date <= ?
      AND (status_final IN ('P', '½P', 'WOP') OR status_original IN ('P', '½P', 'WOP'))
      AND is_night_out_only = 0
    `).get(emp.code, month, year, startDate, endDate);

    const workingDays = workingDaysResult?.count || 0;

    // Eligibility: employee must have any working days from 1st to 20th
    let isEligible = workingDays > 0;
    let advanceAmount = 0;

    if (isEligible) {
      // Determine gross monthly salary
      let grossMonthly = 0;

      // Try salary structure first
      const salStruct = db.prepare(`
        SELECT * FROM salary_structures
        WHERE employee_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC LIMIT 1
      `).get(emp.id, `${year}-${monthStr}-01`);

      if (salStruct) {
        grossMonthly = (salStruct.basic || 0) + (salStruct.da || 0) +
          (salStruct.hra || 0) + (salStruct.conveyance || 0) +
          (salStruct.special_allowance || 0) + (salStruct.other_allowances || 0);
      } else if (emp.gross_salary > 0) {
        // Fallback to employee master gross
        grossMonthly = emp.gross_salary;
      }

      if (grossMonthly > 0) {
        if (workingDays >= 15) {
          // 50% of gross monthly salary
          advanceAmount = Math.round(grossMonthly * 0.50);
        } else if (workingDays > 0) {
          // Pro-rata salary for actual days worked, then 75% of that
          const proRataSalary = (grossMonthly / 26) * workingDays;
          advanceAmount = Math.round(proRataSalary * 0.75);
        } else {
          // No working days = not eligible
          isEligible = false;
        }
      } else {
        // No salary info — not eligible
        isEligible = false;
      }
    }

    // Check if advance already exists for this month
    const existing = db.prepare(`
      SELECT id FROM salary_advances WHERE employee_code = ? AND month = ? AND year = ?
    `).get(emp.code, month, year);

    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE salary_advances SET
          working_days_1_to_15 = ?, is_eligible = ?, advance_amount = ?,
          calculation_date = datetime('now')
        WHERE id = ?
      `).run(workingDays, isEligible ? 1 : 0, advanceAmount, existing.id);
    } else {
      // Insert new
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
      isEligible,
      advanceAmount
    });
  }

  return results;
}

module.exports = { calculateAdvances };
