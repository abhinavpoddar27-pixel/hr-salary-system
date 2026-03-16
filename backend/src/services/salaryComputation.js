/**
 * Salary Computation Service
 * Indian manufacturing payroll — PF, ESI, Professional Tax (Punjab)
 */

/**
 * Get policy value from config
 */
function getPolicyValue(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? parseFloat(row.value) || row.value : defaultVal;
}

/**
 * Calculate Professional Tax as per Punjab slab
 */
function calcProfessionalTax(grossSalary, db) {
  const slab1Limit = parseFloat(getPolicyValue(db, 'pt_slab_1_limit', 15000));
  const slab2Limit = parseFloat(getPolicyValue(db, 'pt_slab_2_limit', 25000));
  const slab1Amt = parseFloat(getPolicyValue(db, 'pt_slab_1_amount', 0));
  const slab2Amt = parseFloat(getPolicyValue(db, 'pt_slab_2_amount', 150));
  const slab3Amt = parseFloat(getPolicyValue(db, 'pt_slab_3_amount', 200));

  if (grossSalary <= slab1Limit) return slab1Amt;
  if (grossSalary <= slab2Limit) return slab2Amt;
  return slab3Amt;
}

/**
 * Compute salary for one employee for a month.
 *
 * @param {Object} db - better-sqlite3 db
 * @param {Object} employee - employee record with code, id
 * @param {number} month
 * @param {number} year
 * @param {string} company
 * @returns {Object} salary computation result
 */
function computeEmployeeSalary(db, employee, month, year, company) {
  // Get day calculation for this employee
  const dayCalc = db.prepare(`
    SELECT * FROM day_calculations
    WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.code, month, year, company);

  if (!dayCalc) {
    return { success: false, error: 'Day calculation not found. Run Stage 6 first.' };
  }

  // Get salary structure (most recent effective from <= current month)
  const monthStr = `${year}-${String(month).padStart(2,'0')}-01`;
  const salStruct = db.prepare(`
    SELECT * FROM salary_structures
    WHERE employee_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(employee.id, monthStr);

  if (!salStruct) {
    return { success: false, error: 'Salary structure not found. Configure in Settings → Employee Master.' };
  }

  // Policy values
  const divisor = parseFloat(getPolicyValue(db, 'salary_divisor', 26));
  const pfEmpRate = parseFloat(getPolicyValue(db, 'pf_employee_rate', 0.12));
  const pfEmprRate = parseFloat(getPolicyValue(db, 'pf_employer_rate', 0.12));
  const esiEmpRate = parseFloat(getPolicyValue(db, 'esi_employee_rate', 0.0075));
  const esiEmprRate = parseFloat(getPolicyValue(db, 'esi_employer_rate', 0.0325));
  const esiThreshold = parseFloat(getPolicyValue(db, 'esi_threshold', 21000));
  const pfWageCeiling = parseFloat(getPolicyValue(db, 'pf_wage_ceiling', 15000));
  const otRate = parseFloat(getPolicyValue(db, 'ot_rate_multiplier', 2));

  // Gross monthly salary
  const basicMonthly = salStruct.basic || 0;
  const daMonthly = salStruct.da || 0;
  const hraMonthly = salStruct.hra || 0;
  const conveyanceMonthly = salStruct.conveyance || 0;
  const otherMonthly = salStruct.other_allowances || 0;
  const grossMonthly = basicMonthly + daMonthly + hraMonthly + conveyanceMonthly + otherMonthly;

  // Per-day rate
  const perDayRate = grossMonthly / divisor;

  // Payable days
  const payableDays = dayCalc.total_payable_days || 0;
  const lopDays = dayCalc.lop_days || 0;

  // Earned components (pro-rata)
  const earnedRatio = payableDays / divisor;
  const basicEarned = Math.round(basicMonthly * earnedRatio * 100) / 100;
  const daEarned = Math.round(daMonthly * earnedRatio * 100) / 100;
  const hraEarned = Math.round(hraMonthly * earnedRatio * 100) / 100;
  const conveyanceEarned = Math.round(conveyanceMonthly * earnedRatio * 100) / 100;
  const otherEarned = Math.round(otherMonthly * earnedRatio * 100) / 100;

  // OT pay
  const otHours = dayCalc.ot_hours || 0;
  const basicHourlyRate = basicMonthly / (divisor * 8); // 8 hours per day baseline
  const otPay = Math.round(otHours * basicHourlyRate * otRate * 100) / 100;

  // Gross earned
  const grossEarned = basicEarned + daEarned + hraEarned + conveyanceEarned + otherEarned + otPay;

  // ─── PF ───
  let pfEmployee = 0;
  let pfEmployer = 0;
  let pfWages = 0;
  let eps = 0;

  if (salStruct.pf_applicable) {
    const pfWageBase = pfWageCeiling > 0
      ? Math.min(basicEarned + daEarned, pfWageCeiling)
      : (basicEarned + daEarned);
    pfWages = Math.round(pfWageBase * 100) / 100;
    pfEmployee = Math.round(pfWageBase * pfEmpRate * 100) / 100;
    pfEmployer = Math.round(pfWageBase * pfEmprRate * 100) / 100;
    // EPS: 8.33% of pf wages (capped at 1250)
    eps = Math.min(Math.round(pfWageBase * 0.0833 * 100) / 100, 1250);
  }

  // ─── ESI ───
  let esiEmployee = 0;
  let esiEmployer = 0;
  let esiWages = 0;

  if (salStruct.esi_applicable && grossMonthly <= esiThreshold) {
    esiWages = Math.round(grossEarned * 100) / 100;
    esiEmployee = Math.round(grossEarned * esiEmpRate * 100) / 100;
    esiEmployer = Math.round(grossEarned * esiEmprRate * 100) / 100;
  }

  // ─── Professional Tax ───
  const professionalTax = calcProfessionalTax(grossMonthly, db);

  // ─── LOP Deduction ───
  const lopDeduction = Math.round(lopDays * perDayRate * 100) / 100;

  // ─── Advance Recovery (manual, from existing record or 0) ───
  const existingComp = db.prepare(`
    SELECT advance_recovery, tds, other_deductions FROM salary_computations
    WHERE employee_code = ? AND month = ? AND year = ?
  `).get(employee.code, month, year);
  const advanceRecovery = existingComp?.advance_recovery || 0;
  const tds = existingComp?.tds || 0;
  const otherDeductions = existingComp?.other_deductions || 0;

  // ─── Total Deductions & Net ───
  const totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + advanceRecovery + lopDeduction + otherDeductions;
  const netSalary = Math.max(0, Math.round((grossEarned - totalDeductions) * 100) / 100);

  return {
    success: true,
    employeeCode: employee.code,
    employeeId: employee.id,
    month, year, company,
    grossSalary: grossMonthly,
    payableDays: Math.round(payableDays * 100) / 100,
    perDayRate: Math.round(perDayRate * 100) / 100,
    basicEarned, daEarned, hraEarned, conveyanceEarned, otherEarned: otherEarned,
    otPay, grossEarned,
    pfWages, esiWages, eps,
    pfEmployee, pfEmployer,
    esiEmployee, esiEmployer,
    professionalTax, tds,
    advanceRecovery, lopDeduction, otherDeductions,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netSalary
  };
}

/**
 * Save salary computation to database
 */
function saveSalaryComputation(db, comp) {
  db.prepare(`
    INSERT INTO salary_computations (
      employee_code, month, year, company, gross_salary, payable_days, per_day_rate,
      basic_earned, da_earned, hra_earned, conveyance_earned, other_allowances_earned,
      ot_pay, gross_earned,
      pf_wages, esi_wages, pf_employee, pf_employer, eps, esi_employee, esi_employer,
      professional_tax, tds, advance_recovery, lop_deduction, other_deductions,
      total_deductions, net_salary
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(employee_code, month, year, company) DO UPDATE SET
      gross_salary = excluded.gross_salary,
      payable_days = excluded.payable_days,
      per_day_rate = excluded.per_day_rate,
      basic_earned = excluded.basic_earned,
      da_earned = excluded.da_earned,
      hra_earned = excluded.hra_earned,
      conveyance_earned = excluded.conveyance_earned,
      other_allowances_earned = excluded.other_allowances_earned,
      ot_pay = excluded.ot_pay,
      gross_earned = excluded.gross_earned,
      pf_wages = excluded.pf_wages,
      esi_wages = excluded.esi_wages,
      pf_employee = excluded.pf_employee,
      pf_employer = excluded.pf_employer,
      eps = excluded.eps,
      esi_employee = excluded.esi_employee,
      esi_employer = excluded.esi_employer,
      professional_tax = excluded.professional_tax,
      lop_deduction = excluded.lop_deduction,
      total_deductions = excluded.total_deductions,
      net_salary = excluded.net_salary,
      is_finalised = 0
  `).run(
    comp.employeeCode, comp.month, comp.year, comp.company,
    comp.grossSalary, comp.payableDays, comp.perDayRate,
    comp.basicEarned, comp.daEarned, comp.hraEarned, comp.conveyanceEarned, comp.otherEarned,
    comp.otPay, comp.grossEarned,
    comp.pfWages, comp.esiWages, comp.pfEmployee, comp.pfEmployer, comp.eps, comp.esiEmployee, comp.esiEmployer,
    comp.professionalTax, comp.tds, comp.advanceRecovery, comp.lopDeduction, comp.otherDeductions,
    comp.totalDeductions, comp.netSalary
  );
}

/**
 * Generate payslip data for an employee
 */
function generatePayslipData(db, employeeCode, month, year) {
  const employee = db.prepare('SELECT * FROM employees WHERE code = ?').get(employeeCode);
  const comp = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(employeeCode, month, year);
  const dayCalc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?').get(employeeCode, month, year);
  const salStruct = employee ? db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(employee.id) : null;

  if (!comp || !dayCalc) return null;

  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  return {
    employee: {
      code: employeeCode,
      name: employee?.name || employeeCode,
      designation: employee?.designation || '',
      department: employee?.department || '',
      company: employee?.company || '',
      pf_number: employee?.pf_number || '',
      uan: employee?.uan || '',
      esi_number: employee?.esi_number || '',
      bank_account: employee?.bank_account || '',
      ifsc: employee?.ifsc || '',
      date_of_joining: employee?.date_of_joining || ''
    },
    period: { month, year, monthName: MONTHS[month], period: `${MONTHS[month]} ${year}` },
    attendance: dayCalc,
    earnings: [
      { label: 'Basic Pay', amount: comp.basic_earned },
      { label: 'DA (Dearness Allowance)', amount: comp.da_earned },
      { label: 'HRA (House Rent Allowance)', amount: comp.hra_earned },
      { label: 'Conveyance Allowance', amount: comp.conveyance_earned },
      { label: 'Other Allowances', amount: comp.other_allowances_earned },
      { label: 'OT Pay', amount: comp.ot_pay }
    ].filter(e => e.amount > 0),
    deductions: [
      { label: 'PF (Employee)', amount: comp.pf_employee },
      { label: 'ESI (Employee)', amount: comp.esi_employee },
      { label: 'Professional Tax', amount: comp.professional_tax },
      { label: 'TDS', amount: comp.tds },
      { label: 'Advance Recovery', amount: comp.advance_recovery },
      { label: 'LOP Deduction', amount: comp.lop_deduction },
      { label: 'Other Deductions', amount: comp.other_deductions }
    ].filter(d => d.amount > 0),
    grossEarned: comp.gross_earned,
    totalDeductions: comp.total_deductions,
    netSalary: comp.net_salary,
    pfEmployer: comp.pf_employer,
    esiEmployer: comp.esi_employer,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { computeEmployeeSalary, saveSalaryComputation, generatePayslipData };
