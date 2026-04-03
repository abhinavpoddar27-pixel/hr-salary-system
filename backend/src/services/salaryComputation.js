/**
 * Salary Computation Service
 * Indian manufacturing payroll — PF, ESI, Professional Tax (Punjab)
 * Phase 2: + zero-day filter, gross change detection, salary hold, advance/loan recovery
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
 * Check if employee is a new joinee (joined in this month)
 */
function isNewJoinee(db, employeeCode, month, year) {
  const emp = db.prepare('SELECT date_of_joining FROM employees WHERE code = ?').get(employeeCode);
  if (!emp || !emp.date_of_joining) return false;
  const doj = new Date(emp.date_of_joining);
  return doj.getMonth() + 1 === month && doj.getFullYear() === year;
}

/**
 * Check if employee has approved leave for this month
 */
function hasApprovedLeave(db, employeeCode, month, year) {
  try {
    const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employeeCode);
    if (!emp) return false;
    const monthStr = String(month).padStart(2, '0');
    const startOfMonth = `${year}-${monthStr}-01`;
    const endOfMonth = `${year}-${monthStr}-${new Date(year, month, 0).getDate()}`;
    const leave = db.prepare(`
      SELECT id FROM leave_applications
      WHERE employee_code = ? AND status = 'Approved'
      AND start_date <= ? AND end_date >= ?
    `).get(employeeCode, endOfMonth, startOfMonth);
    return !!leave;
  } catch { return false; }
}

/**
 * Get previous month gross salary for comparison
 */
function getPrevMonthGross(db, employeeCode, month, year) {
  let pm = month - 1, py = year;
  if (pm === 0) { pm = 12; py--; }
  const prev = db.prepare(`
    SELECT gross_salary FROM salary_computations
    WHERE employee_code = ? AND month = ? AND year = ?
  `).get(employeeCode, pm, py);
  return prev ? prev.gross_salary : 0;
}

/**
 * Get advance recovery amount for this month
 */
function getAdvanceRecovery(db, employeeCode, month, year) {
  try {
    const adv = db.prepare(`
      SELECT advance_amount FROM salary_advances
      WHERE employee_code = ? AND recovery_month = ? AND recovery_year = ?
      AND paid = 1 AND recovered = 0
    `).get(employeeCode, month, year);
    return adv ? adv.advance_amount : 0;
  } catch { return 0; }
}

/**
 * Get loan EMI deductions for this month
 */
function getLoanDeductions(db, employeeCode, month, year) {
  try {
    const repayments = db.prepare(`
      SELECT SUM(emi_amount) as total_emi FROM loan_repayments
      WHERE employee_code = ? AND month = ? AND year = ?
      AND status = 'Pending'
    `).get(employeeCode, month, year);
    return repayments?.total_emi || 0;
  } catch { return 0; }
}

/**
 * Compute salary for one employee for a month.
 */
function computeEmployeeSalary(db, employee, month, year, company) {
  // Get day calculation for this employee — try with company, then without
  let dayCalc = null;
  if (company) {
    dayCalc = db.prepare(`
      SELECT * FROM day_calculations
      WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
      LIMIT 1
    `).get(employee.code, month, year, company);
  }
  if (!dayCalc) {
    dayCalc = db.prepare(`
      SELECT * FROM day_calculations
      WHERE employee_code = ? AND month = ? AND year = ?
      LIMIT 1
    `).get(employee.code, month, year);
  }

  if (!dayCalc) {
    return {
      success: false,
      excluded: true,
      employeeCode: employee.code,
      reason: 'No day calculation — run Stage 6 first'
    };
  }

  // ── Zero-day check ──
  const daysPresent = dayCalc.days_present || 0;
  const daysHalfPresent = dayCalc.days_half_present || 0;
  if (daysPresent === 0 && daysHalfPresent === 0) {
    return {
      success: false,
      excluded: true,
      employeeCode: employee.code,
      reason: 'Zero working days — no attendance recorded'
    };
  }

  // Get salary structure (most recent effective from <= current month)
  const monthStr = `${year}-${String(month).padStart(2,'0')}-01`;
  let salStruct = db.prepare(`
    SELECT * FROM salary_structures
    WHERE employee_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(employee.id, monthStr);

  if (!salStruct) {
    // Auto-create salary structure from employee.gross_salary if available
    if (employee.gross_salary && employee.gross_salary > 0) {
      const gross = employee.gross_salary;
      const basicPct = 50;
      const hraPct = 20;
      const basic = gross * basicPct / 100;
      const hra = gross * hraPct / 100;
      db.prepare(`INSERT INTO salary_structures
        (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
         basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
        VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, ?, 0, ?, ?, ?, 15000)`).run(
          employee.id, gross, basic, hra,
          basicPct, hraPct,
          employee.pf_applicable || 0, employee.esi_applicable || 0, employee.pt_applicable ?? 1
      );
      salStruct = db.prepare(`
        SELECT * FROM salary_structures
        WHERE employee_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC LIMIT 1
      `).get(employee.id, monthStr);
    }
    if (!salStruct) {
      return {
        success: false,
        excluded: true,
        employeeCode: employee.code,
        reason: 'No salary structure — set gross salary in Employees page'
      };
    }
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
  const holdMinDays = parseFloat(getPolicyValue(db, 'salary_hold_min_days', 5));

  // Gross monthly salary — use gross_salary field first, fall back to component sum
  const basicMonthly = salStruct.basic || 0;
  const daMonthly = salStruct.da || 0;
  const hraMonthly = salStruct.hra || 0;
  const conveyanceMonthly = salStruct.conveyance || 0;
  const otherMonthly = salStruct.other_allowances || 0;
  const componentSum = basicMonthly + daMonthly + hraMonthly + conveyanceMonthly + otherMonthly;
  const grossMonthly = componentSum > 0 ? componentSum : (salStruct.gross_salary || employee.gross_salary || 0);

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
  const basicHourlyRate = basicMonthly / (divisor * 8);
  const otPay = Math.round(otHours * basicHourlyRate * otRate * 100) / 100;

  // Gross earned
  const grossEarned = basicEarned + daEarned + hraEarned + conveyanceEarned + otherEarned + otPay;

  // ─── PF ───
  let pfEmployee = 0, pfEmployer = 0, pfWages = 0, eps = 0;
  if (salStruct.pf_applicable) {
    const pfWageBase = pfWageCeiling > 0
      ? Math.min(basicEarned + daEarned, pfWageCeiling)
      : (basicEarned + daEarned);
    pfWages = Math.round(pfWageBase * 100) / 100;
    pfEmployee = Math.round(pfWageBase * pfEmpRate * 100) / 100;
    pfEmployer = Math.round(pfWageBase * pfEmprRate * 100) / 100;
    eps = Math.min(Math.round(pfWageBase * 0.0833 * 100) / 100, 1250);
  }

  // ─── ESI ───
  let esiEmployee = 0, esiEmployer = 0, esiWages = 0;
  if (salStruct.esi_applicable && grossMonthly <= esiThreshold) {
    esiWages = Math.round(grossEarned * 100) / 100;
    esiEmployee = Math.round(grossEarned * esiEmpRate * 100) / 100;
    esiEmployer = Math.round(grossEarned * esiEmprRate * 100) / 100;
  }

  // ─── Professional Tax ───
  const professionalTax = calcProfessionalTax(grossMonthly, db);

  // ─── LOP Deduction ───
  const lopDeduction = Math.round(lopDays * perDayRate * 100) / 100;

  // ─── Advance Recovery (from salary_advances table) ───
  const autoAdvanceRecovery = getAdvanceRecovery(db, employee.code, month, year);

  // ─── Loan EMI Recovery ───
  const loanRecovery = getLoanDeductions(db, employee.code, month, year);

  // ─── Preserve manual values if record already exists ───
  const existingComp = db.prepare(`
    SELECT tds, other_deductions, advance_recovery FROM salary_computations
    WHERE employee_code = ? AND month = ? AND year = ?
  `).get(employee.code, month, year);
  const tds = existingComp?.tds || 0;
  const otherDeductions = existingComp?.other_deductions || 0;
  // Use auto advance if available, else preserve manual
  const advanceRecovery = autoAdvanceRecovery > 0 ? autoAdvanceRecovery : (existingComp?.advance_recovery || 0);

  // ─── Total Deductions & Net ───
  const totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + advanceRecovery + lopDeduction + otherDeductions + loanRecovery;
  const netSalary = Math.max(0, Math.round((grossEarned - totalDeductions) * 100) / 100);

  // ─── Gross Change Detection ───
  const prevMonthGross = getPrevMonthGross(db, employee.code, month, year);
  const grossChanged = (prevMonthGross > 0 && Math.abs(grossMonthly - prevMonthGross) > 0.01) ? 1 : 0;

  // ─── Salary Hold Logic ───
  let salaryHeld = 0, holdReason = '';
  if (payableDays < holdMinDays) {
    const newJoinee = isNewJoinee(db, employee.code, month, year);
    const hasLeave = hasApprovedLeave(db, employee.code, month, year);
    if (!newJoinee && !hasLeave) {
      salaryHeld = 1;
      holdReason = `Only ${payableDays} payable days (min ${holdMinDays} required)`;
    }
  }

  return {
    success: true,
    employeeCode: employee.code,
    employeeId: employee.id,
    month, year, company,
    grossSalary: grossMonthly,
    payableDays: Math.round(payableDays * 100) / 100,
    perDayRate: Math.round(perDayRate * 100) / 100,
    basicEarned, daEarned, hraEarned, conveyanceEarned, otherEarned,
    otPay, grossEarned,
    pfWages, esiWages, eps,
    pfEmployee, pfEmployer,
    esiEmployee, esiEmployer,
    professionalTax, tds,
    advanceRecovery, lopDeduction, otherDeductions,
    loanRecovery,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netSalary,
    prevMonthGross, grossChanged,
    salaryHeld, holdReason
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
      total_deductions, net_salary,
      prev_month_gross, gross_changed, salary_held, hold_reason, loan_recovery
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?
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
      prev_month_gross = excluded.prev_month_gross,
      gross_changed = excluded.gross_changed,
      salary_held = excluded.salary_held,
      hold_reason = excluded.hold_reason,
      loan_recovery = excluded.loan_recovery,
      is_finalised = 0
  `).run(
    comp.employeeCode, comp.month, comp.year, comp.company,
    comp.grossSalary, comp.payableDays, comp.perDayRate,
    comp.basicEarned, comp.daEarned, comp.hraEarned, comp.conveyanceEarned, comp.otherEarned,
    comp.otPay, comp.grossEarned,
    comp.pfWages, comp.esiWages, comp.pfEmployee, comp.pfEmployer, comp.eps, comp.esiEmployee, comp.esiEmployer,
    comp.professionalTax, comp.tds, comp.advanceRecovery, comp.lopDeduction, comp.otherDeductions,
    comp.totalDeductions, comp.netSalary,
    comp.prevMonthGross, comp.grossChanged, comp.salaryHeld, comp.holdReason, comp.loanRecovery
  );

  // Mark advance as recovered if applicable
  if (comp.advanceRecovery > 0) {
    try {
      db.prepare(`
        UPDATE salary_advances SET recovered = 1
        WHERE employee_code = ? AND recovery_month = ? AND recovery_year = ?
        AND paid = 1 AND recovered = 0
      `).run(comp.employeeCode, comp.month, comp.year);
    } catch {}
  }

  // Mark loan repayments as deducted
  if (comp.loanRecovery > 0) {
    try {
      db.prepare(`
        UPDATE loan_repayments SET status = 'Deducted', deducted_from_salary = 1
        WHERE employee_code = ? AND month = ? AND year = ?
        AND status = 'Pending'
      `).run(comp.employeeCode, comp.month, comp.year);
    } catch {}
  }
}

/**
 * Generate payslip data for an employee
 */
function generatePayslipData(db, employeeCode, month, year) {
  const employee = db.prepare('SELECT * FROM employees WHERE code = ?').get(employeeCode);
  const comp = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(employeeCode, month, year);
  const dayCalc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?').get(employeeCode, month, year);

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
      { label: 'Loan EMI', amount: comp.loan_recovery },
      { label: 'LOP Deduction', amount: comp.lop_deduction },
      { label: 'Other Deductions', amount: comp.other_deductions }
    ].filter(d => d.amount > 0),
    grossEarned: comp.gross_earned,
    totalDeductions: comp.total_deductions,
    netSalary: comp.net_salary,
    pfEmployer: comp.pf_employer,
    esiEmployer: comp.esi_employer,
    grossChanged: comp.gross_changed,
    salaryHeld: comp.salary_held,
    holdReason: comp.hold_reason,
    prevMonthGross: comp.prev_month_gross,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { computeEmployeeSalary, saveSalaryComputation, generatePayslipData };
