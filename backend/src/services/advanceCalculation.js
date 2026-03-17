/**
 * Advance Calculation Service
 *
 * Calculate advance eligibility for all ACTIVE employees.
 * Employees with >=9 working days (1st-15th) receive 1/3 of gross salary as advance.
 * Advance is recovered from the final salary of the same month.
 *
 * NOTE: The 19th date restriction has been removed — advance can be calculated on any date.
 * Inactive/Exited employees are excluded from calculation.
 */

function getPolicyValue(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? parseFloat(row.value) || row.value : defaultVal;
}

/**
 * Calculate advance eligibility for all active employees in a month
 */
function calculateAdvances(db, month, year) {
  const cutoffDate = parseInt(getPolicyValue(db, 'advance_cutoff_date', 15));
  const minWorkingDays = parseInt(getPolicyValue(db, 'advance_min_working_days', 9));
  const advanceFraction = parseFloat(getPolicyValue(db, 'advance_fraction', 0.3333));

  // Get all ACTIVE employees with attendance in this month
  // Excludes Inactive and Exited employees
  const employees = db.prepare(`
    SELECT DISTINCT e.id, e.code, e.name, e.department, e.designation, e.gross_salary
    FROM employees e
    INNER JOIN attendance_processed ap ON e.code = ap.employee_code
    WHERE ap.month = ? AND ap.year = ?
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited'))
  `).all(month, year);

  const results = [];

  for (const emp of employees) {
    // Count working days from 1st to cutoff date
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
    const isEligible = workingDays >= minWorkingDays;

    // Get gross salary for this employee
    let advanceAmount = 0;
    if (isEligible) {
      // Try salary structure first
      const salStruct = db.prepare(`
        SELECT * FROM salary_structures
        WHERE employee_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC LIMIT 1
      `).get(emp.id, `${year}-${monthStr}-01`);

      if (salStruct) {
        const grossMonthly = (salStruct.basic || 0) + (salStruct.da || 0) +
          (salStruct.hra || 0) + (salStruct.conveyance || 0) +
          (salStruct.special_allowance || 0) + (salStruct.other_allowances || 0);
        advanceAmount = Math.round(grossMonthly * advanceFraction);
      } else if (emp.gross_salary > 0) {
        // Fallback to employee master gross
        advanceAmount = Math.round(emp.gross_salary * advanceFraction);
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
