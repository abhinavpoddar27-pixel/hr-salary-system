/**
 * Sales Salary Computation Service — Phase 3 (+ Q5 reversal hotfix)
 *
 * Parallel to plant's backend/src/services/salaryComputation.js but tuned
 * for sales:
 *   - 4 components (basic, hra, cca, conveyance) — no DA
 *   - Day's Given from coordinator sheet is authoritative (Q1)
 *   - Sunday rule via shared sundayRule.js, leniency from policy_config
 *   - Diwali is a one-off Oct/Nov bonus via diwali_bonus (Q5, post-reversal).
 *     NO monthly deduction, NO ledger. The diwali_recovery column on
 *     sales_salary_computations is kept dead for UPSERT completeness only.
 *   - incentive_amount is HR-entered (Q6) and preserved across recomputes
 *
 * Plant tables reused (no sales-specific tables for these yet):
 *   - salary_advances        — shared advance table
 *   - loan_repayments        — shared loan repayments
 *   - tax_declarations       — shared tax declarations
 *   - policy_config          — rates, ceilings, PF ceiling
 *
 * UPSERT completeness (load-bearing — see CLAUDE.md):
 *   Every mutable column on sales_salary_computations MUST appear as
 *   `<col> = excluded.<col>` in the ON CONFLICT UPDATE. HR-entered fields
 *   (incentive_amount, diwali_bonus, other_deductions, hold_reason,
 *   status, finalized_at, finalized_by) are PRE-READ from the existing
 *   row and carried forward so a recompute never silently wipes them.
 *   `diwali_recovery` stays in the UPSERT column list but is always
 *   written as 0 (Q5 reversal — column is dead, writes preserve shape).
 */

const { calculateSundayCredit } = require('./sundayRule');

const DIVISOR_MODE_SUPPORTED = new Set(['calendar']);

// ── Policy helpers (mirror plant salaryComputation.js) ────────────────
function getPolicyValue(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? parseFloat(row.value) || row.value : defaultVal;
}

function getPolicyNumber(db, key, defaultVal) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  if (!row) return defaultVal;
  const n = parseFloat(row.value);
  return Number.isFinite(n) ? n : defaultVal;
}

// ── Advance / loan / TDS (reuse plant helpers' queries) ───────────────
function getAdvanceRecovery(db, employeeCode, month, year) {
  try {
    const rows = db.prepare(`
      SELECT id, requested_amount FROM salary_advances
       WHERE employee_code = ? AND month = ? AND year = ?
         AND status = 'Paid' AND recovered = 0
    `).all(employeeCode, month, year);
    return rows.reduce((s, r) => s + (r.requested_amount || 0), 0);
  } catch (e) { return 0; }
}

function getLoanRecovery(db, employeeCode, month, year) {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(emi_amount), 0) AS emi
        FROM loan_repayments
       WHERE employee_code = ? AND month = ? AND year = ? AND status = 'Pending'
    `).get(employeeCode, month, year);
    return row ? (row.emi || 0) : 0;
  } catch (e) { return 0; }
}

function getDeclaredTds(db, employeeCode, month, year) {
  // Plant uses financial year; sales has no separate tax_declarations table
  // in Phase 3 per design §9 Step 6. If a declaration exists we reuse it;
  // otherwise TDS=0 (HR can override via PUT /salary/:id → other_deductions
  // or a future Phase 4 manual-TDS column).
  try {
    const fy = month >= 4 ? `${year}-${String(year + 1).slice(-2)}`
                          : `${year - 1}-${String(year).slice(-2)}`;
    const decl = db.prepare(`
      SELECT estimated_annual_tds FROM tax_declarations
       WHERE employee_code = ? AND financial_year = ?
    `).get(employeeCode, fy);
    if (!decl || !decl.estimated_annual_tds) return 0;
    // Monthly TDS = annual / 12, rounded
    return Math.round((decl.estimated_annual_tds / 12) * 100) / 100;
  } catch (e) { return 0; }
}

// ── Calendar helpers ──────────────────────────────────────────────────
function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

function countSundaysInMonth(month, year) {
  const last = daysInMonth(month, year);
  let n = 0;
  for (let d = 1; d <= last; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) n++;
  }
  return n;
}

function monthStartISO(month, year) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function monthEndISO(month, year) {
  const d = daysInMonth(month, year);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Salary structure lookup ───────────────────────────────────────────
function getLatestStructure(db, employeeId, month, year) {
  const effectiveAsOf = `${year}-${String(month).padStart(2, '0')}`;
  return db.prepare(`
    SELECT * FROM sales_salary_structures
     WHERE employee_id = ? AND effective_from <= ?
  ORDER BY effective_from DESC, id DESC
     LIMIT 1
  `).get(employeeId, effectiveAsOf);
}

// ── Gazetted holiday count for (month, year, company) ────────────────
function countGazettedHolidays(db, month, year, company) {
  const start = monthStartISO(month, year);
  const end = monthEndISO(month, year);
  const rows = db.prepare(`
    SELECT holiday_date FROM sales_holidays
     WHERE company = ? AND is_gazetted = 1
       AND holiday_date BETWEEN ? AND ?
  `).all(company, start, end);
  // Per design §9 Step 1: holidays that fall on a Sunday are NOT double
  // counted in the working-day reduction. Exclude Sundays from the
  // gazetted count for the workingDays math.
  const nonSundayHolidays = rows.filter(h => {
    const d = new Date(h.holiday_date + 'T00:00:00');
    return d.getDay() !== 0;
  });
  return { totalHolidays: rows.length, workingDayHolidays: nonSundayHolidays.length };
}

// ══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — computeSalesEmployee
// ══════════════════════════════════════════════════════════════════════
function computeSalesEmployee(db, { salesEmployee, monthlyInputRow, month, year, company, requestId, user }) {
  const RID = requestId ? `[${requestId}]` : '[sales]';

  if (!salesEmployee || !salesEmployee.id) {
    return { success: false, excluded: true, reason: 'no_employee_record' };
  }
  if (!monthlyInputRow || monthlyInputRow.sheet_days_given === null || monthlyInputRow.sheet_days_given === undefined) {
    return { success: false, excluded: true, reason: 'no_days_given' };
  }

  const divisorMode = getPolicyValue(db, 'sales_salary_divisor_mode', 'calendar');
  if (!DIVISOR_MODE_SUPPORTED.has(String(divisorMode))) {
    return { success: false, error: `divisor mode '${divisorMode}' not implemented in Phase 3` };
  }

  const leniency = getPolicyNumber(db, 'sales_leniency', 2);
  const pfCeiling = getPolicyNumber(db, 'pf_wage_ceiling', 15000);
  const esiThreshold = getPolicyNumber(db, 'esi_threshold', 21000);
  const pfEmpRate = getPolicyNumber(db, 'pf_employee_rate', 0.12);
  const pfEmprRate = getPolicyNumber(db, 'pf_employer_rate', 0.12);
  const esiEmpRate = getPolicyNumber(db, 'esi_employee_rate', 0.0075);
  const esiEmprRate = getPolicyNumber(db, 'esi_employer_rate', 0.0325);

  const structure = getLatestStructure(db, salesEmployee.id, month, year);
  if (!structure) {
    return { success: false, excluded: true, reason: 'no_structure' };
  }

  const grossMonthly = Math.round((structure.gross_salary || 0) * 100) / 100;
  if (grossMonthly <= 0) {
    return { success: false, excluded: true, reason: 'zero_gross_in_structure' };
  }
  const basicMonthly = Math.round((structure.basic || 0) * 100) / 100;
  const hraMonthly = Math.round((structure.hra || 0) * 100) / 100;
  const ccaMonthly = Math.round((structure.cca || 0) * 100) / 100;
  const conveyanceMonthly = Math.round((structure.conveyance || 0) * 100) / 100;

  // ── Pre-read existing row so HR-entered values survive recompute ──
  // Phase 4: neft_exported_at + payslip_generated_at also pre-read so a
  // recompute never wipes audit stamps written by the export / payslip
  // side-effect endpoints.
  const prev = db.prepare(`
    SELECT incentive_amount, other_deductions, hold_reason,
           status, finalized_at, finalized_by, diwali_bonus,
           neft_exported_at, payslip_generated_at
      FROM sales_salary_computations
     WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
  `).get(salesEmployee.code, month, year, company);

  const incentiveAmount = prev?.incentive_amount ?? 0;
  // Q5 reversal: diwali_recovery column is kept dead. Always 0, never read.
  const diwaliRecovery = 0;
  const otherDeductions = prev?.other_deductions ?? 0;
  const holdReason = prev?.hold_reason ?? null;
  const diwaliBonus = prev?.diwali_bonus ?? 0;
  // Status: preserve reviewed/finalized/paid/hold, default to 'computed' for new rows
  const preserveStatus = prev?.status && ['reviewed', 'finalized', 'paid', 'hold'].includes(prev.status)
    ? prev.status : 'computed';
  const preservedFinalizedAt = prev?.finalized_at || null;
  const preservedFinalizedBy = prev?.finalized_by || null;
  // Phase 4 audit stamps — carry forward; compute never mints new values.
  const preservedNeftExportedAt = prev?.neft_exported_at || null;
  const preservedPayslipGeneratedAt = prev?.payslip_generated_at || null;

  // ── Step 1 — Days aggregation ──
  const daysGiven = parseFloat(monthlyInputRow.sheet_days_given);
  if (!Number.isFinite(daysGiven) || daysGiven < 0) {
    return { success: false, excluded: true, reason: 'invalid_days_given' };
  }
  const calendarDays = daysInMonth(month, year);
  const totalSundays = countSundaysInMonth(month, year);
  const { totalHolidays, workingDayHolidays } = countGazettedHolidays(db, month, year, company);
  const workingDays = calendarDays - totalSundays - workingDayHolidays;

  // ── Step 2 — Sunday rule (shared pure function) ──
  const sundayResult = calculateSundayCredit({
    effectivePresent: daysGiven,
    workingDays,
    totalSundays,
    leniency,
  });
  const sundaysPaid = sundayResult.paidSundays;

  // ── Step 3 — Gazetted holidays (v1 simplification: credit all) ──
  const gazettedHolidaysPaid = totalHolidays;

  // ── Step 4 — Total days and earned ratio ──
  const earnedLeaveDays = 0; // EL manual entry — future Phase 3.5+
  const totalDays = daysGiven + sundaysPaid + gazettedHolidaysPaid + earnedLeaveDays;
  const earnedRatio = Math.min(totalDays / calendarDays, 1.0);

  // ── Step 5 — Earned components ──
  const basicEarned = Math.round(basicMonthly * earnedRatio * 100) / 100;
  const hraEarned = Math.round(hraMonthly * earnedRatio * 100) / 100;
  const ccaEarned = Math.round(ccaMonthly * earnedRatio * 100) / 100;
  const conveyanceEarned = Math.round(conveyanceMonthly * earnedRatio * 100) / 100;
  const rawSum = basicEarned + hraEarned + ccaEarned + conveyanceEarned;
  const grossEarned = Math.round(Math.min(rawSum, grossMonthly * earnedRatio) * 100) / 100;

  // ── Step 6 — Deductions ──
  let pfEmployee = 0, pfEmployer = 0;
  if (structure.pf_applicable) {
    // Sales has no DA → PF base = min(basic_earned, ceiling)
    const ceiling = structure.pf_wage_ceiling_override || pfCeiling;
    const pfWageBase = ceiling > 0 ? Math.min(basicEarned, ceiling) : basicEarned;
    pfEmployee = Math.round(pfWageBase * pfEmpRate * 100) / 100;
    pfEmployer = Math.round(pfWageBase * pfEmprRate * 100) / 100;
  }

  let esiEmployee = 0, esiEmployer = 0;
  if (structure.esi_applicable && grossMonthly <= esiThreshold) {
    esiEmployee = Math.round(grossEarned * esiEmpRate * 100) / 100;
    esiEmployer = Math.round(grossEarned * esiEmprRate * 100) / 100;
  }

  // Professional Tax — disabled per plant policy (Issue 6, April 2026)
  const professionalTax = 0;

  const tds = getDeclaredTds(db, salesEmployee.code, month, year);
  const advanceRecovery = getAdvanceRecovery(db, salesEmployee.code, month, year);
  const loanRecovery = getLoanRecovery(db, salesEmployee.code, month, year);

  // Q5 reversal: total_deductions = PF_e + ESI_e + PT + TDS + advance + loan + other
  // (diwali_recovery term removed — Diwali is now only a bonus in Step 7).
  const totalDeductions = Math.round((
    pfEmployee + esiEmployee + professionalTax + tds +
    advanceRecovery + loanRecovery + otherDeductions
  ) * 100) / 100;

  // ── Step 7 — Net salary ──
  const netSalary = Math.round((
    grossEarned + diwaliBonus + incentiveAmount - totalDeductions
  ) * 100) / 100;

  // ── Step 8 — Assemble the compute object ──
  const sundayRuleTrace = JSON.stringify({
    ...sundayResult,
    effectivePresent: daysGiven,
    workingDays,
    totalSundays,
    leniency,
    computedAt: new Date().toISOString(),
  });

  console.log(`${RID} ${salesEmployee.code} ${month}/${year} ${company}: ` +
    `days=${daysGiven} sun=${sundaysPaid} hol=${gazettedHolidaysPaid} ` +
    `ratio=${earnedRatio.toFixed(3)} grossEarned=${grossEarned} ` +
    `PF=${pfEmployee} ESI=${esiEmployee} TDS=${tds} adv=${advanceRecovery} loan=${loanRecovery} ` +
    `other=${otherDeductions} incentive=${incentiveAmount} bonus=${diwaliBonus} → net=${netSalary}`);

  return {
    success: true,
    employee_code: salesEmployee.code,
    month, year, company,
    days_given: daysGiven,
    sundays_paid: sundaysPaid,
    gazetted_holidays_paid: gazettedHolidaysPaid,
    earned_leave_days: earnedLeaveDays,
    total_days: Math.round(totalDays * 100) / 100,
    calendar_days: calendarDays,
    earned_ratio: Math.round(earnedRatio * 10000) / 10000,
    basic_monthly: basicMonthly,
    hra_monthly: hraMonthly,
    cca_monthly: ccaMonthly,
    conveyance_monthly: conveyanceMonthly,
    gross_monthly: grossMonthly,
    basic_earned: basicEarned,
    hra_earned: hraEarned,
    cca_earned: ccaEarned,
    conveyance_earned: conveyanceEarned,
    gross_earned: grossEarned,
    pf_employee: pfEmployee,
    pf_employer: pfEmployer,
    esi_employee: esiEmployee,
    esi_employer: esiEmployer,
    professional_tax: professionalTax,
    tds,
    advance_recovery: advanceRecovery,
    loan_recovery: loanRecovery,
    diwali_recovery: diwaliRecovery,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    diwali_bonus: diwaliBonus,
    incentive_amount: incentiveAmount,
    net_salary: netSalary,
    sunday_rule_trace: sundayRuleTrace,
    status: preserveStatus,
    hold_reason: holdReason,
    computed_by: user || null,
    finalized_at: preservedFinalizedAt,
    finalized_by: preservedFinalizedBy,
    neft_exported_at: preservedNeftExportedAt,
    payslip_generated_at: preservedPayslipGeneratedAt,
    // Carry forward the previous netSalary for the frontend "finalized recompute warning"
    _prevNetSalary: prev ? undefined : null, // set after the fact if you want to detect drift
  };
}

// ══════════════════════════════════════════════════════════════════════
// saveSalesSalaryComputation — full-column UPSERT
// ══════════════════════════════════════════════════════════════════════
function saveSalesSalaryComputation(db, comp) {
  const info = db.prepare(`
    INSERT INTO sales_salary_computations (
      employee_code, month, year, company,
      days_given, sundays_paid, gazetted_holidays_paid, earned_leave_days,
      total_days, calendar_days, earned_ratio,
      basic_monthly, hra_monthly, cca_monthly, conveyance_monthly, gross_monthly,
      basic_earned, hra_earned, cca_earned, conveyance_earned, gross_earned,
      pf_employee, pf_employer, esi_employee, esi_employer,
      professional_tax, tds, advance_recovery, loan_recovery, diwali_recovery,
      other_deductions, total_deductions,
      diwali_bonus, incentive_amount, net_salary,
      sunday_rule_trace, status, hold_reason,
      computed_by, finalized_at, finalized_by,
      neft_exported_at, payslip_generated_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(employee_code, month, year, company) DO UPDATE SET
      days_given = excluded.days_given,
      sundays_paid = excluded.sundays_paid,
      gazetted_holidays_paid = excluded.gazetted_holidays_paid,
      earned_leave_days = excluded.earned_leave_days,
      total_days = excluded.total_days,
      calendar_days = excluded.calendar_days,
      earned_ratio = excluded.earned_ratio,
      basic_monthly = excluded.basic_monthly,
      hra_monthly = excluded.hra_monthly,
      cca_monthly = excluded.cca_monthly,
      conveyance_monthly = excluded.conveyance_monthly,
      gross_monthly = excluded.gross_monthly,
      basic_earned = excluded.basic_earned,
      hra_earned = excluded.hra_earned,
      cca_earned = excluded.cca_earned,
      conveyance_earned = excluded.conveyance_earned,
      gross_earned = excluded.gross_earned,
      pf_employee = excluded.pf_employee,
      pf_employer = excluded.pf_employer,
      esi_employee = excluded.esi_employee,
      esi_employer = excluded.esi_employer,
      professional_tax = excluded.professional_tax,
      tds = excluded.tds,
      advance_recovery = excluded.advance_recovery,
      loan_recovery = excluded.loan_recovery,
      diwali_recovery = excluded.diwali_recovery,
      other_deductions = excluded.other_deductions,
      total_deductions = excluded.total_deductions,
      diwali_bonus = excluded.diwali_bonus,
      incentive_amount = excluded.incentive_amount,
      net_salary = excluded.net_salary,
      sunday_rule_trace = excluded.sunday_rule_trace,
      status = excluded.status,
      hold_reason = excluded.hold_reason,
      computed_by = excluded.computed_by,
      finalized_at = excluded.finalized_at,
      finalized_by = excluded.finalized_by,
      neft_exported_at = excluded.neft_exported_at,
      payslip_generated_at = excluded.payslip_generated_at,
      computed_at = datetime('now')
  `).run(
    comp.employee_code, comp.month, comp.year, comp.company,
    comp.days_given, comp.sundays_paid, comp.gazetted_holidays_paid, comp.earned_leave_days,
    comp.total_days, comp.calendar_days, comp.earned_ratio,
    comp.basic_monthly, comp.hra_monthly, comp.cca_monthly, comp.conveyance_monthly, comp.gross_monthly,
    comp.basic_earned, comp.hra_earned, comp.cca_earned, comp.conveyance_earned, comp.gross_earned,
    comp.pf_employee, comp.pf_employer, comp.esi_employee, comp.esi_employer,
    comp.professional_tax, comp.tds, comp.advance_recovery, comp.loan_recovery, comp.diwali_recovery,
    comp.other_deductions, comp.total_deductions,
    comp.diwali_bonus, comp.incentive_amount, comp.net_salary,
    comp.sunday_rule_trace, comp.status, comp.hold_reason,
    comp.computed_by, comp.finalized_at, comp.finalized_by,
    comp.neft_exported_at, comp.payslip_generated_at
  );

  // Return the row id (on update, need to SELECT since lastInsertRowid=0)
  const row = db.prepare(
    'SELECT id FROM sales_salary_computations WHERE employee_code=? AND month=? AND year=? AND company=?'
  ).get(comp.employee_code, comp.month, comp.year, comp.company);
  return row ? row.id : info.lastInsertRowid;
}

// ══════════════════════════════════════════════════════════════════════
// generateSalesPayslipData
// ══════════════════════════════════════════════════════════════════════
function generateSalesPayslipData(db, employeeCode, month, year, company) {
  const comp = db.prepare(`
    SELECT * FROM sales_salary_computations
     WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
  `).get(employeeCode, month, year, company);
  if (!comp) {
    return { success: false, error: 'No computation for employee/month/year/company. Compute the period first.' };
  }

  const emp = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                .get(employeeCode, company);
  if (!emp) return { success: false, error: 'Sales employee not found' };

  const earnings = [
    { label: 'Basic', amount: comp.basic_earned },
    { label: 'HRA', amount: comp.hra_earned },
    { label: 'CCA', amount: comp.cca_earned },
    { label: 'Conveyance', amount: comp.conveyance_earned },
  ];
  if (comp.incentive_amount && comp.incentive_amount > 0) {
    earnings.push({ label: 'Incentive', amount: comp.incentive_amount });
  }
  if (comp.diwali_bonus && comp.diwali_bonus > 0) {
    earnings.push({ label: 'Diwali Bonus', amount: comp.diwali_bonus });
  }
  const totalEarnings = earnings.reduce((s, e) => s + (e.amount || 0), 0);

  const deductions = [
    { label: 'PF (Employee)', amount: comp.pf_employee },
    { label: 'ESI (Employee)', amount: comp.esi_employee },
    { label: 'Professional Tax', amount: comp.professional_tax },
    { label: 'TDS', amount: comp.tds },
    { label: 'Advance Recovery', amount: comp.advance_recovery },
    { label: 'Loan EMI', amount: comp.loan_recovery },
    { label: 'Other Deductions', amount: comp.other_deductions },
  ].filter(d => d.amount && d.amount > 0);

  return {
    success: true,
    employee: {
      code: emp.code, name: emp.name, designation: emp.designation,
      reporting_manager: emp.reporting_manager,
      headquarters: emp.headquarters, city_of_operation: emp.city_of_operation,
      doj: emp.doj, company: emp.company,
    },
    period: { month, year },
    days: {
      days_given: comp.days_given,
      sundays_paid: comp.sundays_paid,
      gazetted_holidays_paid: comp.gazetted_holidays_paid,
      total_days: comp.total_days,
      calendar_days: comp.calendar_days,
      earned_ratio: comp.earned_ratio,
    },
    earnings,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    deductions,
    totalDeductions: comp.total_deductions,
    netSalary: comp.net_salary,
    status: comp.status,
    bank: {
      bank_name: emp.bank_name,
      account_no: emp.account_no,
      ifsc: emp.ifsc,
    },
    computedAt: comp.computed_at,
    finalizedAt: comp.finalized_at,
    finalizedBy: comp.finalized_by,
  };
}

module.exports = {
  computeSalesEmployee,
  saveSalesSalaryComputation,
  generateSalesPayslipData,
};
