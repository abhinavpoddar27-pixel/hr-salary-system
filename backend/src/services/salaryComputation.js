/**
 * Salary Computation Service
 * Indian manufacturing payroll — PF, ESI, Professional Tax (Punjab)
 * Phase 2: + zero-day filter, gross change detection, salary hold, advance/loan recovery
 */

/**
 * Normalize company tag at write time to prevent duplicate rows under the
 * UNIQUE(employee_code, month, year, company) constraint.
 *
 * Background: Stage 7 has historically been called with company='' (empty),
 * 'null' (literal string from JS null stringification), 'Default' (parser
 * sheetName fallback), or the canonical company name. Each variant hits a
 * different conflict key, so re-runs INSERT duplicates instead of UPDATING.
 *
 * Resolution rule:
 *   1. If company is one of the canonical company names → return as-is
 *   2. If company is '', null, undefined, 'null', 'Default', 'default',
 *      or 'Sheet1', 'Sheet2', etc. → look up employees.company for this
 *      employee_code
 *   3. If still empty after lookup → THROW. We refuse to silently default.
 *      A loud error is far better than silent duplicates.
 *
 * Canonical companies: 'Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd'.
 * If a third real company is added later, extend CANONICAL_COMPANIES.
 */
const CANONICAL_COMPANIES = new Set([
  'Asian Lakto Ind Ltd',
  'Indriyan Beverages Pvt Ltd'
]);

const KNOWN_BAD_TAGS = new Set([
  '', 'null', 'Default', 'default', 'NULL', 'undefined',
  'Sheet1', 'Sheet2', 'Sheet3'
]);

function normalizeCompany(db, employeeCode, rawCompany) {
  // Normalize input: handle null/undefined explicitly, trim strings
  const trimmed = (rawCompany === null || rawCompany === undefined)
    ? ''
    : String(rawCompany).trim();

  // Canonical: pass through
  if (CANONICAL_COMPANIES.has(trimmed)) return trimmed;

  // Known bad tag OR not in canonical set → look up master
  if (KNOWN_BAD_TAGS.has(trimmed) || !trimmed) {
    const emp = db.prepare(
      'SELECT company FROM employees WHERE code = ?'
    ).get(employeeCode);

    const masterCompany = (emp?.company || '').trim();

    if (CANONICAL_COMPANIES.has(masterCompany)) {
      return masterCompany;
    }

    // Master ALSO has a bad tag — this is the master-data issue Abhinav
    // flagged (138 'Default'-master employees etc.). Fall through to throw.
  }

  // Unknown company that isn't canonical and isn't a recognised bad tag.
  // Could be a typo or a new real company. Refuse silently — throw loud.
  throw new Error(
    `[normalizeCompany] Cannot resolve company for employee ${employeeCode}: ` +
    `received "${rawCompany}" (trimmed: "${trimmed}"), ` +
    `master.company is "${(arguments[1] && db.prepare('SELECT company FROM employees WHERE code = ?').get(employeeCode)?.company) || 'NULL'}". ` +
    `This is a master-data issue: fix employees.company for ${employeeCode} ` +
    `to one of: ${[...CANONICAL_COMPANIES].join(', ')}, or extend ` +
    `CANONICAL_COMPANIES in salaryComputation.js if a new company was added.`
  );
}

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
    // First reset any advances that were marked recovered in a previous computation
    // so they can be re-found on recomputation
    db.prepare(`
      UPDATE salary_advances SET recovered = 0
      WHERE employee_code = ? AND recovered = 1
      AND ((recovery_month = ? AND recovery_year = ?) OR (month = ? AND year = ? AND recovery_month IS NULL))
    `).run(employeeCode, month, year, month, year);

    // Get any unrecovered advance for this month
    const adv = db.prepare(`
      SELECT SUM(advance_amount) as total FROM salary_advances
      WHERE employee_code = ? AND recovered = 0 AND advance_amount > 0
      AND (remark IS NULL OR remark != 'NO_ADVANCE')
      AND (
        (recovery_month = ? AND recovery_year = ?)
        OR (month = ? AND year = ? AND recovery_month IS NULL)
      )
    `).get(employeeCode, month, year, month, year);
    return adv?.total || 0;
  } catch (err) {
    console.error(`[ADVANCE RECOVERY ERROR] emp=${employeeCode} month=${month} year=${year}:`, err.message);
    return 0;
  }
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
function computeEmployeeSalary(db, employee, month, year, company, requestId = '') {
  const RID = requestId ? `[${requestId}]` : '[salary]';
  // ── Phase 2 Late Coming: reset applied flag for a clean recompute ──
  // saveSalaryComputation() later flips is_applied_to_salary to 1 after writing the
  // row. Clearing it here ensures a re-run picks up the latest approved deductions
  // (e.g. finance reviewed a row mid-cycle) without double-counting — the SELECT a
  // few lines below filters on is_applied_to_salary=0, and the UPDATE post-save
  // flips it back to 1.
  try {
    db.prepare(`
      UPDATE late_coming_deductions
      SET is_applied_to_salary = 0, applied_to_salary_at = NULL
      WHERE employee_code = ? AND month = ? AND year = ?
        AND finance_status = 'approved'
    `).run(employee.code, month, year);
  } catch (e) { /* silent — migration may not have run yet */ }

  // ── Early Exit Deduction: reset applied flag for clean recompute ──
  try {
    db.prepare(`
      UPDATE early_exit_deductions
      SET salary_applied = 0, salary_applied_at = NULL
      WHERE employee_code = ? AND payroll_month = ? AND payroll_year = ?
        AND finance_status = 'approved'
    `).run(employee.code, month, year);
  } catch (e) { /* silent — migration may not have run yet */ }

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
    console.error(`${RID} MISSING dayCalc for ${employee.code} — Stage 6 not run for ${month}/${year}?`);
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
  if (daysPresent === 0 && daysHalfPresent === 0 && (dayCalc.days_wop || 0) === 0) {
    return {
      success: false,
      excluded: false,
      silentSkip: true,
      employeeCode: employee.code,
      reason: 'Zero working days — no attendance recorded'
    };
  }

  // Get salary structure (most recent effective from <= current month, or any if none found)
  const monthStr = `${year}-${String(month).padStart(2,'0')}-01`;
  let salStruct = db.prepare(`
    SELECT * FROM salary_structures
    WHERE employee_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(employee.id, monthStr);

  // Fallback: if no structure found for this month, try the most recent one regardless of date
  if (!salStruct) {
    salStruct = db.prepare(`
      SELECT * FROM salary_structures
      WHERE employee_id = ?
      ORDER BY effective_from DESC LIMIT 1
    `).get(employee.id);
  }

  if (!salStruct) {
    // Auto-create salary structure from employee.gross_salary if available
    if (employee.gross_salary && employee.gross_salary > 0) {
      const gross = employee.gross_salary;
      const basicPct = 50;
      const hraPct = 20;
      const basic = gross * basicPct / 100;
      const hra = gross * hraPct / 100;
      try {
        db.prepare(`INSERT OR REPLACE INTO salary_structures
          (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
           basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
          VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, ?, 0, ?, ?, ?, 15000)`).run(
            employee.id, gross, basic, hra,
            basicPct, hraPct,
            employee.pf_applicable || 0, employee.esi_applicable || 0, employee.pt_applicable ?? 1
        );
      } catch (e) { /* structure may already exist */ }
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

  // If salary structure exists but has zero gross, update from employee master
  if (salStruct && (salStruct.gross_salary || 0) === 0 && employee.gross_salary > 0) {
    const gross = employee.gross_salary;
    const basicPct = salStruct.basic_percent || 50;
    const hraPct = salStruct.hra_percent || 20;
    db.prepare(`UPDATE salary_structures SET gross_salary = ?, basic = ?, hra = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(gross, gross * basicPct / 100, gross * hraPct / 100, salStruct.id);
    salStruct.gross_salary = gross;
    salStruct.basic = gross * basicPct / 100;
    salStruct.hra = gross * hraPct / 100;
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

  // ── Gross Salary Resolution & Component Scaling (Issue 2 fix) ──
  // Priority: employees.gross_salary → salStruct.gross_salary → componentSum
  // When components exist but don't sum to stated gross, scale them proportionally
  // to preserve ratios while honouring the authoritative gross figure.
  let basicMonthly = salStruct.basic || 0;
  let daMonthly = salStruct.da || 0;
  let hraMonthly = salStruct.hra || 0;
  let conveyanceMonthly = salStruct.conveyance || 0;
  let otherMonthly = salStruct.other_allowances || 0;
  const rawComponentSum = basicMonthly + daMonthly + hraMonthly + conveyanceMonthly + otherMonthly;
  const statedGross = (employee.gross_salary > 0 ? employee.gross_salary : 0)
                   || (salStruct.gross_salary > 0 ? salStruct.gross_salary : 0);

  let grossMonthly, scaleFactor = 1;
  if (rawComponentSum > 0 && statedGross > 0 && Math.abs(rawComponentSum - statedGross) > 1) {
    // Components don't match stated gross — scale proportionally to honour stated gross
    grossMonthly = statedGross;
    scaleFactor = statedGross / rawComponentSum;
  } else if (statedGross > 0) {
    grossMonthly = statedGross;
  } else if (rawComponentSum > 0) {
    grossMonthly = rawComponentSum;
  } else {
    grossMonthly = 0;
  }

  // ── Gross resolution trace ──
  // Log whenever there's a mismatch between employees.gross_salary and
  // salary_structures.gross_salary / component sum. This surfaces sync
  // regressions during a payroll run (the 60052 class of bug) instead of
  // leaving them to manifest as silently-wrong Stage 7 numbers.
  const empGrossRaw = parseFloat(employee.gross_salary) || 0;
  const structGrossRaw = parseFloat(salStruct.gross_salary) || 0;
  if (Math.abs(empGrossRaw - structGrossRaw) > 1
      || (rawComponentSum > 0 && Math.abs(rawComponentSum - grossMonthly) > 1)) {
    console.log(
      `[GROSS-RESOLVE] ${employee.code}: ` +
      `employees.gross=${empGrossRaw}, salStruct.gross=${structGrossRaw}, ` +
      `componentSum=${Math.round(rawComponentSum * 100) / 100}, ` +
      `resolved=${grossMonthly}, scaleFactor=${Math.round(scaleFactor * 10000) / 10000}`
    );
  }

  if (scaleFactor !== 1 && rawComponentSum > 0) {
    // Scale existing components preserving their ratios
    basicMonthly = Math.round(basicMonthly * scaleFactor * 100) / 100;
    daMonthly = Math.round(daMonthly * scaleFactor * 100) / 100;
    hraMonthly = Math.round(hraMonthly * scaleFactor * 100) / 100;
    conveyanceMonthly = Math.round(conveyanceMonthly * scaleFactor * 100) / 100;
    otherMonthly = Math.round(otherMonthly * scaleFactor * 100) / 100;
  } else if (rawComponentSum === 0 && grossMonthly > 0) {
    // No components at all — derive from percentage defaults
    const bPct = salStruct.basic_percent || 50;
    const hPct = salStruct.hra_percent || 20;
    basicMonthly = Math.round(grossMonthly * bPct / 100 * 100) / 100;
    hraMonthly = Math.round(grossMonthly * hPct / 100 * 100) / 100;
    daMonthly = 0;
    conveyanceMonthly = 0;
    otherMonthly = Math.round((grossMonthly - basicMonthly - hraMonthly) * 100) / 100;
  }

  // Calendar days of the month — used as the denominator for BOTH base salary
  // pro-rata and OT/extra-duty rate in the April 2026 overhaul. `divisor` from
  // policy_config is retained in the codebase for backward compat but no longer
  // drives the earned calculation.
  const calendarDays = new Date(year, month, 0).getDate();

  // Payable days and attendance info
  const rawPayableDays = dayCalc.total_payable_days || 0;
  const lopDays = dayCalc.lop_days || 0;
  const totalWorkingDays = dayCalc.total_working_days || divisor;
  const daysWOP = dayCalc.days_wop || 0;

  // ── Earned calculation (April 2026 overhaul — contractor/permanent split) ──
  // Permanent: regularDays = min(payableDays, daysInMonth), ratio = regular/daysInMonth.
  //            OT is computed SEPARATELY below and added AFTER deductions.
  // Contractor: daily wage, no Sundays/holidays. earned = (payable/daysInMonth) × gross.
  //             No OT for contractors.
  const { isContractorForPayroll } = require('../utils/employeeClassification');
  // employment_type on the employees row is the authoritative source.
  // Do NOT fall back to dayCalc.is_contractor — past Stage 6 runs may have
  // been buggy and persisted wrong flags; re-checking from the live employee
  // record self-heals without requiring Stage 6 to be re-run.
  const isContract = isContractorForPayroll(employee);
  console.log(`${RID} ${employee.code}: payable=${dayCalc.total_payable_days} gross=${grossMonthly} isContract=${isContract}`);
  const actualWorkDays = daysPresent + daysHalfPresent;
  const workedFullMonth = actualWorkDays >= totalWorkingDays;
  const daysInMonth = calendarDays; // alias for readability in formulas below

  let basicEarned, daEarned, hraEarned, conveyanceEarned, otherEarned;
  let earnedRatio, regularDays;
  const otPerDayRateDisplay = daysInMonth > 0 ? grossMonthly / daysInMonth : 0;

  if (isContract) {
    regularDays = rawPayableDays;
    earnedRatio = daysInMonth > 0 ? Math.min(regularDays / daysInMonth, 1.0) : 0;
  } else {
    regularDays = Math.min(rawPayableDays, daysInMonth);
    earnedRatio = daysInMonth > 0 ? regularDays / daysInMonth : 0;
  }
  console.log(`${RID} ${employee.code}: earnedRatio=${earnedRatio} regularDays=${regularDays} calendarDays=${calendarDays}`);
  basicEarned = Math.round(basicMonthly * earnedRatio * 100) / 100;
  daEarned = Math.round(daMonthly * earnedRatio * 100) / 100;
  hraEarned = Math.round(hraMonthly * earnedRatio * 100) / 100;
  conveyanceEarned = Math.round(conveyanceMonthly * earnedRatio * 100) / 100;
  otherEarned = Math.round(otherMonthly * earnedRatio * 100) / 100;

  // ═══ OT CALCULATION (day-based, SEPARATE from base salary) ═══
  // OT is ONLY added AFTER deductions — it never factors into grossEarned.
  // April 2026 ED-integration overhaul: OT and ED are now SEPARATE buckets.
  //
  //   ot_pay = punch-based extra duty days (dayCalc.extra_duty_days) × otDailyRate
  //   ed_pay = finance-APPROVED extra_duty_grants days × otDailyRate
  //            (minus dates that overlap with WOP/punch OT — anti-double-count)
  //
  // Same per-day rate (gross / calendarDays) for both, so payslips and the
  // Payable-OT register can show the two columns side by side. Contractors
  // get ZERO OT and ZERO ED.
  const otDailyRate = otPerDayRateDisplay;
  let totalOTDays = 0;
  let otPay = 0;
  let punchBasedOT = 0;
  let financeExtraDuty = 0;  // legacy reporting field — now mirrors edDays
  let edDays = 0;
  let edPay = 0;
  let otNote = '';

  if (!isContract) {
    // ─── Punch-based OT ───
    // dayCalc.extra_duty_days is the biometric-detected overflow (payable
    // beyond calendar days, sourced from WOP/WO½P statuses). Pay this as
    // OT — no merge with grants, no max(). The grant approval workflow
    // does NOT modify ot_pay any more.
    const dcExtraDuty = Math.max(0, dayCalc.extra_duty_days || 0);
    punchBasedOT = dcExtraDuty;
    totalOTDays = Math.min(Math.max(0, punchBasedOT), daysInMonth);
    otPay = Math.round(totalOTDays * otDailyRate * 100) / 100;

    // ─── Finance-approved Extra Duty (ED) — separate bucket ───
    // Pull every fully-approved grant for the month, then exclude any whose
    // grant_date already coincides with a WOP/WO½P attendance day (those
    // days were already paid via punch OT above). The remainder are truly
    // additional finance grants — overnight stays without biometric, gate-
    // record-only days, completed miss-punch reconciliations, etc.
    try {
      const wopRows = db.prepare(`
        SELECT DISTINCT date FROM attendance_processed
        WHERE employee_code = ? AND month = ? AND year = ?
          AND (status_final IN ('WOP', 'WO½P') OR status_original IN ('WOP', 'WO½P'))
      `).all(employee.code, month, year);
      const wopDateSet = new Set(wopRows.map(r => r.date));

      const approvedGrants = db.prepare(`
        SELECT grant_date, duty_days
        FROM extra_duty_grants
        WHERE employee_code = ?
          AND month = ?
          AND year = ?
          AND status = 'APPROVED'
          AND finance_status = 'FINANCE_APPROVED'
      `).all(employee.code, month, year);

      const validEDGrants = approvedGrants.filter(g => !wopDateSet.has(g.grant_date));
      const skipped = approvedGrants.length - validEDGrants.length;

      edDays = Math.round(
        validEDGrants.reduce((sum, g) => sum + (g.duty_days || 0), 0) * 100
      ) / 100;
      // Cap ED days at calendar days as a safety net
      edDays = Math.min(edDays, daysInMonth);
      edPay = Math.round(edDays * otDailyRate * 100) / 100;
      financeExtraDuty = edDays;  // legacy alias

      if (edDays > 0 || punchBasedOT > 0 || skipped > 0) {
        console.log(
          `[ED] ${employee.code} ${month}/${year}: ` +
          `${approvedGrants.length} approved grants, ` +
          `${validEDGrants.length} after WOP filter (skipped ${skipped}), ` +
          `punchOT=${punchBasedOT}, edDays=${edDays}, edPay=₹${edPay}`
        );
      }
    } catch (e) {
      console.error(`[ED] ${employee.code}: query failed — ${e.message}`);
    }

    const dcPayable = dayCalc.total_payable_days || 0;
    const parts = [];
    if (punchBasedOT > 0) parts.push(`${punchBasedOT}d punch OT`);
    if (edDays > 0) parts.push(`${edDays}d finance ED`);
    if (parts.length > 0) {
      otNote = `${parts.join(' + ')} × ₹${Math.round(otDailyRate)}/day`;
    } else {
      otNote = `Payable ${dcPayable}/${daysInMonth} days. No OT/ED.`;
    }
  } else {
    otNote = 'Contractor — no OT/ED';
  }

  // ─── Holiday Duty Pay ───
  // Treated like OT: separate from grossEarned, added to totalPayable after deductions.
  const holidayDutyDays = dayCalc.holiday_duty_days || 0;
  const holidayDutyPay = isContract
    ? 0
    : Math.round(holidayDutyDays * otPerDayRateDisplay * 100) / 100;

  // ── GROSS EARNED = BASE SALARY ONLY (no OT, no holiday duty) ──
  // Critical rule: deductions are calculated on base only. OT is clean add-on.
  const grossEarned = Math.round(
    Math.min(
      basicEarned + daEarned + hraEarned + conveyanceEarned + otherEarned,
      grossMonthly
    ) * 100
  ) / 100;

  // Retain otHours in return for backward compatibility (hourly OT no longer paid;
  // day-based OT replaces it entirely).
  const otHours = dayCalc.ot_hours || 0;
  const otDays = totalOTDays;

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

  console.log(`${RID} ${employee.code}: PF=${pfEmployee} ESI=${esiEmployee} grossEarned=${grossEarned}`);

  // ─── Professional Tax ───
  // PT is DISABLED per HR directive (Issue 6). No PT deduction applied.
  const professionalTax = 0;

  // ─── LOP Deduction ───
  // Pro-rating via earnedRatio already reduces salary for days not worked.
  // LOP deduction is ONLY for additional leave-without-pay days beyond
  // the pro-rating (e.g., days marked as LOP in day calculation).
  // If earned is already pro-rated (earnedRatio < 1), don't double-deduct.
  const lopDeduction = 0; // Pro-rating handles absent days; no separate LOP needed

  // ─── Advance Recovery (from salary_advances table) ───
  const autoAdvanceRecovery = getAdvanceRecovery(db, employee.code, month, year);
  if (autoAdvanceRecovery > 0) console.log(`[ADVANCE] ${employee.code}: auto recovery = ${autoAdvanceRecovery}`);

  // ─── Loan EMI Recovery ───
  const loanRecovery = getLoanDeductions(db, employee.code, month, year);

  // ─── TDS (auto-calculate if declaration exists, else preserve manual) ───
  let tds = 0;
  let tdsAutoCalculated = false;
  try {
    const { calculateMonthlyTDS } = require('./tdsCalculation');
    const fy = month >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
    const tdsResult = calculateMonthlyTDS(db, employee.code, grossMonthly, fy);
    if (tdsResult.monthly_tds > 0) {
      tds = tdsResult.monthly_tds;
      tdsAutoCalculated = true;
    }
  } catch {}

  // ─── Deductions are ALWAYS re-derived — never preserved across recomputes ───
  // Previously this block read the existing salary_computations row and fell
  // back to stored tds / other_deductions / advance_recovery whenever the fresh
  // derivation came back zero. That preservation logic existed for a manual
  // override endpoint (PUT /payroll/salary/:code/manual-deductions) which is
  // exported in api.js but has no caller in the frontend — it is dead code.
  //
  // The fallback produced ghost deductions when the source data legitimately
  // changed to zero:
  //   - Dalvir Singh (12003) Mar 2026: HR clicked "No Advance", but the stale
  //     advance_recovery from an earlier compute was still being charged.
  //   - SL Verma (23234) Mar 2026: Rs.10,487 TDS kept reappearing — this was
  //     the tdsCalculation auto value from BEFORE the "declaration required"
  //     gate was added, and the fallback resurrected it every recompute.
  //
  // Rule: advance_recovery comes from salary_advances, tds from tax_declarations
  // (via calculateMonthlyTDS), other_deductions defaults to 0. If manual overrides
  // are ever re-introduced they must be tracked via a dedicated flag column.
  if (!tdsAutoCalculated) tds = 0;
  const otherDeductions = 0;
  const advanceRecovery = autoAdvanceRecovery;

  // ─── Late Coming Deduction (Phase 2 — finance-approved only) ───
  // Sum up all late_coming_deductions rows for this employee/month with
  // finance_status='approved' AND is_applied_to_salary=0. Rupees amount uses
  // the calendar-day rate (same as OT/ED/holiday-duty). Contractors are excluded
  // — their pay is already daily, mirroring the OT/ED gating rule.
  let lateComingDeduction = 0;
  if (!isContract) {
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(deduction_days), 0) AS totalDays
        FROM late_coming_deductions
        WHERE employee_code = ? AND month = ? AND year = ?
          AND finance_status = 'approved' AND is_applied_to_salary = 0
      `).get(employee.code, month, year);
      if (row?.totalDays > 0) {
        lateComingDeduction = Math.round(row.totalDays * otPerDayRateDisplay * 100) / 100;
      }
    } catch (e) {
      console.warn(`${RID} Late coming deduction lookup failed for ${employee.code}: ${e.message}`);
    }
  }

  // ─── Early Exit Deduction (April 2026 — finance-approved only) ───
  // Sum approved deduction amounts from early_exit_deductions. Unlike late
  // coming (which uses deduction_days × day rate), early exit stores the
  // actual rupee amount directly. Contractors excluded (mirrors OT/ED gate).
  let earlyExitDeduction = 0;
  if (!isContract) {
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(deduction_amount), 0) AS total
        FROM early_exit_deductions
        WHERE employee_code = ? AND payroll_month = ? AND payroll_year = ?
          AND finance_status = 'approved' AND deduction_type != 'warning'
          AND salary_applied = 0
      `).get(employee.code, month, year);
      if (row?.total > 0) {
        earlyExitDeduction = Math.round(row.total * 100) / 100;
      }
    } catch (e) {
      console.warn(`${RID} Early exit deduction lookup failed for ${employee.code}: ${e.message}`);
    }
  }

  // ─── Total Deductions & Net ───
  let totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + advanceRecovery + lopDeduction + otherDeductions + loanRecovery + lateComingDeduction + earlyExitDeduction;
  let salaryWarning = '';

  // Cap deductions at gross earned — net salary must never go negative
  if (totalDeductions > grossEarned && grossEarned > 0) {
    salaryWarning = 'DEDUCTIONS_EXCEED_EARNINGS';
    totalDeductions = Math.round(grossEarned * 100) / 100;
  }
  // ── NET = BASE EARNED - DEDUCTIONS (no OT, no holiday duty, no ED) ──
  // Deductions apply ONLY to base earned. OT, holiday duty and ED are clean add-ons.
  const netSalary = Math.max(0, Math.round((grossEarned - totalDeductions) * 100) / 100);

  // ── TOTAL PAYABLE = Net Salary + OT Pay + Holiday Duty Pay ──
  // Existing field — represents net + punch-based add-ons. Kept stable so
  // existing consumers (reports, finance audit, bank NEFT) don't break.
  const totalPayable = Math.round((netSalary + otPay + holidayDutyPay) * 100) / 100;

  // ── TAKE HOME = TOTAL PAYABLE + ED PAY (April 2026) ──
  // The actual amount the employee walks away with, including finance-
  // approved Extra Duty grants. ED is excluded from total_payable so older
  // exports stay consistent — new reports use take_home instead.
  const takeHome = Math.round((totalPayable + edPay) * 100) / 100;
  console.log(`${RID} ${employee.code}: totalDed=${totalDeductions} net=${netSalary} takeHome=${takeHome}`);

  // ─── Gross Change Detection ───
  const prevMonthGross = getPrevMonthGross(db, employee.code, month, year);
  const grossChanged = (prevMonthGross > 0 && Math.abs(grossMonthly - prevMonthGross) > 0.01) ? 1 : 0;

  // ─── Salary Hold Logic ───
  let salaryHeld = 0, holdReason = '', financeRemark = '';
  if (rawPayableDays < holdMinDays) {
    const newJoinee = isNewJoinee(db, employee.code, month, year);
    const hasLeave = hasApprovedLeave(db, employee.code, month, year);
    if (!newJoinee && !hasLeave) {
      salaryHeld = 1;
      holdReason = `Only ${rawPayableDays} payable days (min ${holdMinDays} required)`;
    }
  }

  // ─── End-of-month absence streak hold ───
  if (!salaryHeld && rawPayableDays >= holdMinDays) {
    try {
      const absenceThreshold = 7;
      const daysInMonth = new Date(year, month, 0).getDate();
      const monthPad = String(month).padStart(2, '0');
      let consecutiveAbsent = 0;

      for (let d = daysInMonth; d >= 1; d--) {
        const dateStr = `${year}-${monthPad}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T12:00:00').getDay();
        if (dow === 0) continue; // skip Sundays

        const rec = db.prepare("SELECT COALESCE(status_final, status_original) as status FROM attendance_processed WHERE employee_code = ? AND date = ?").get(employee.code, dateStr);
        if (!rec || rec.status === 'A') { consecutiveAbsent++; }
        else { break; }
      }

      if (consecutiveAbsent >= absenceThreshold) {
        const leaveForStreak = hasApprovedLeave(db, employee.code, month, year);
        if (!leaveForStreak) {
          salaryHeld = 1;
          holdReason = `FINANCE REVIEW: ${consecutiveAbsent} consecutive absent days at month-end. Possible absconder/unapproved leave.`;
        } else {
          financeRemark = `${consecutiveAbsent} absent days at month-end but has approved leave on record.`;
        }
      }
    } catch {}
  }

  if (salaryHeld) {
    console.warn(`${RID} ${employee.code}: SALARY HELD — ${holdReason}`);
  }

  return {
    success: true,
    employeeCode: employee.code,
    employeeId: employee.id,
    month, year, company,
    grossSalary: grossMonthly,
    payableDays: Math.round(rawPayableDays * 100) / 100,
    perDayRate: Math.round(otPerDayRateDisplay * 100) / 100,
    basicEarned, daEarned, hraEarned, conveyanceEarned, otherEarned,
    otPay, holidayDutyPay, grossEarned,
    // Finance-approved Extra Duty (April 2026)
    edDays, edPay, takeHome,
    pfWages, esiWages, eps,
    pfEmployee, pfEmployer,
    esiEmployee, esiEmployer,
    professionalTax, tds,
    advanceRecovery, lopDeduction, otherDeductions,
    loanRecovery,
    // Phase 2 — finance-approved late coming deduction
    lateComingDeduction: Math.round(lateComingDeduction * 100) / 100,
    // Early exit deduction (April 2026)
    earlyExitDeduction: Math.round(earlyExitDeduction * 100) / 100,
    // Phase 3 — leave display buckets sourced from Stage 6 day_calculations.
    // These are DISPLAY-ONLY. All salary math already flowed through
    // payable_days via Phase 2's dayCalculation.js leave post-processing.
    clDays: Math.round((dayCalc.cl_used || 0) * 100) / 100,
    elDays: Math.round((dayCalc.el_used || 0) * 100) / 100,
    lwpDays: Math.round((dayCalc.lop_days || 0) * 100) / 100,
    odDays: Math.round((dayCalc.od_days || 0) * 100) / 100,
    shortLeaveDays: Math.round((dayCalc.short_leave_days || 0) * 100) / 100,
    uninformedAbsentDays: Math.max(0, Math.round((dayCalc.uninformed_absent || 0) * 100) / 100),
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netSalary,
    // ═══ TOTAL PAYABLE = netSalary + otPay + holidayDutyPay ═══
    // This is what the employee actually takes home. OT and holiday duty are
    // completely outside the deduction pipeline — clean addition after net.
    totalPayable,
    prevMonthGross, grossChanged,
    salaryHeld, holdReason,
    salaryWarning, financeRemark,
    // ── April 2026 overhaul fields ──
    isContractor: isContract ? 1 : 0,
    daysInMonth,
    regularDays: Math.round(regularDays * 100) / 100,
    otDays: Math.round(otDays * 100) / 100,
    otDailyRate: Math.round(otPerDayRateDisplay * 100) / 100,
    punchBasedOT: Math.round(punchBasedOT * 100) / 100,
    financeExtraDuty: Math.round(financeExtraDuty * 100) / 100,
    otNote,
    manualExtraDuty: 0 // kept for backward compat
  };
}

/**
 * Save salary computation to database
 */
function saveSalaryComputation(db, comp) {
  comp.company = normalizeCompany(db, comp.employeeCode, comp.company);
  db.prepare(`
    INSERT INTO salary_computations (
      employee_code, month, year, company, gross_salary, payable_days, per_day_rate,
      basic_earned, da_earned, hra_earned, conveyance_earned, other_allowances_earned,
      ot_pay, holiday_duty_pay, gross_earned,
      pf_wages, esi_wages, pf_employee, pf_employer, eps, esi_employee, esi_employer,
      professional_tax, tds, advance_recovery, lop_deduction, other_deductions,
      total_deductions, net_salary,
      prev_month_gross, gross_changed, salary_held, hold_reason, loan_recovery, finance_remark,
      is_contractor, days_in_month, regular_days, ot_days, ot_daily_rate, manual_extra_duty,
      punch_based_ot, finance_extra_duty, ot_note, total_payable,
      ed_days, ed_pay, take_home,
      late_coming_deduction,
      early_exit_deduction,
      cl_days, el_days, lwp_days, od_days, short_leave_days, uninformed_absent_days
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?,
      ?,
      ?, ?, ?, ?, ?, ?
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
      holiday_duty_pay = excluded.holiday_duty_pay,
      gross_earned = excluded.gross_earned,
      pf_wages = excluded.pf_wages,
      esi_wages = excluded.esi_wages,
      pf_employee = excluded.pf_employee,
      pf_employer = excluded.pf_employer,
      eps = excluded.eps,
      esi_employee = excluded.esi_employee,
      esi_employer = excluded.esi_employer,
      professional_tax = excluded.professional_tax,
      tds = excluded.tds,
      advance_recovery = excluded.advance_recovery,
      lop_deduction = excluded.lop_deduction,
      other_deductions = excluded.other_deductions,
      total_deductions = excluded.total_deductions,
      net_salary = excluded.net_salary,
      prev_month_gross = excluded.prev_month_gross,
      gross_changed = excluded.gross_changed,
      salary_held = excluded.salary_held,
      hold_reason = excluded.hold_reason,
      loan_recovery = excluded.loan_recovery,
      finance_remark = excluded.finance_remark,
      is_contractor = excluded.is_contractor,
      days_in_month = excluded.days_in_month,
      regular_days = excluded.regular_days,
      ot_days = excluded.ot_days,
      ot_daily_rate = excluded.ot_daily_rate,
      manual_extra_duty = excluded.manual_extra_duty,
      punch_based_ot = excluded.punch_based_ot,
      finance_extra_duty = excluded.finance_extra_duty,
      ot_note = excluded.ot_note,
      total_payable = excluded.total_payable,
      ed_days = excluded.ed_days,
      ed_pay = excluded.ed_pay,
      take_home = excluded.take_home,
      late_coming_deduction = excluded.late_coming_deduction,
      early_exit_deduction = excluded.early_exit_deduction,
      cl_days = excluded.cl_days,
      el_days = excluded.el_days,
      lwp_days = excluded.lwp_days,
      od_days = excluded.od_days,
      short_leave_days = excluded.short_leave_days,
      uninformed_absent_days = excluded.uninformed_absent_days,
      is_finalised = 0
  `).run(
    comp.employeeCode, comp.month, comp.year, comp.company,
    comp.grossSalary, comp.payableDays, comp.perDayRate,
    comp.basicEarned, comp.daEarned, comp.hraEarned, comp.conveyanceEarned, comp.otherEarned,
    comp.otPay, comp.holidayDutyPay || 0, comp.grossEarned,
    comp.pfWages, comp.esiWages, comp.pfEmployee, comp.pfEmployer, comp.eps, comp.esiEmployee, comp.esiEmployer,
    comp.professionalTax, comp.tds, comp.advanceRecovery, comp.lopDeduction, comp.otherDeductions,
    comp.totalDeductions, comp.netSalary,
    comp.prevMonthGross, comp.grossChanged, comp.salaryHeld, comp.holdReason, comp.loanRecovery, comp.financeRemark || '',
    comp.isContractor ? 1 : 0, comp.daysInMonth || null, comp.regularDays || 0,
    comp.otDays || 0, comp.otDailyRate || 0, comp.manualExtraDuty || 0,
    comp.punchBasedOT || 0, comp.financeExtraDuty || 0, comp.otNote || '', comp.totalPayable || 0,
    comp.edDays || 0, comp.edPay || 0, comp.takeHome || 0,
    comp.lateComingDeduction || 0,
    comp.earlyExitDeduction || 0,
    comp.clDays || 0, comp.elDays || 0, comp.lwpDays || 0,
    comp.odDays || 0, comp.shortLeaveDays || 0, comp.uninformedAbsentDays || 0
  );

  // ── Phase 2 Late Coming: mark approved deductions as applied ──
  // Flips is_applied_to_salary=1 so a second compute-salary run picks the
  // same amount back up via the identical guarded SELECT in computeEmployeeSalary()
  // — no double counting. If the row is recomputed later, computeEmployeeSalary()
  // resets the flag first, giving us clean re-entry.
  if (comp.lateComingDeduction > 0) {
    try {
      db.prepare(`
        UPDATE late_coming_deductions
        SET is_applied_to_salary = 1, applied_to_salary_at = datetime('now')
        WHERE employee_code = ? AND month = ? AND year = ?
          AND finance_status = 'approved' AND is_applied_to_salary = 0
      `).run(comp.employeeCode, comp.month, comp.year);

      const { logAudit } = require('../database/db');
      logAudit(
        'late_coming_deductions', 0, 'applied_to_salary', '0', '1',
        'salary_compute',
        `Late deduction of ₹${comp.lateComingDeduction} applied to ${comp.employeeCode} for ${comp.month}/${comp.year}`
      );
    } catch (e) {
      console.warn(`[salary] Failed to mark late deductions applied for ${comp.employeeCode}: ${e.message}`);
    }
  }

  // ── Early Exit Deduction: mark approved deductions as applied ──
  if (comp.earlyExitDeduction > 0) {
    try {
      db.prepare(`
        UPDATE early_exit_deductions
        SET salary_applied = 1, salary_applied_at = datetime('now')
        WHERE employee_code = ? AND payroll_month = ? AND payroll_year = ?
          AND finance_status = 'approved' AND salary_applied = 0
          AND deduction_type != 'warning'
      `).run(comp.employeeCode, comp.month, comp.year);

      const { logAudit } = require('../database/db');
      logAudit(
        'early_exit_deductions', 0, 'salary_applied', '0', '1',
        'salary_compute',
        `Early exit deduction of ₹${comp.earlyExitDeduction} applied to ${comp.employeeCode} for ${comp.month}/${comp.year}`
      );
    } catch (e) {
      console.warn(`[salary] Failed to mark early exit deductions applied for ${comp.employeeCode}: ${e.message}`);
    }
  }

  // Mark advance as recovered if applicable
  if (comp.advanceRecovery > 0) {
    try {
      db.prepare(`
        UPDATE salary_advances SET recovered = 1
        WHERE employee_code = ? AND recovery_month = ? AND recovery_year = ?
        AND is_eligible = 1 AND recovered = 0 AND advance_amount > 0
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

  // ── Auto-populate salary_manual_flags for finance audit ──
  try {
    populateManualFlags(db, comp);
  } catch {}
}

/**
 * Auto-detect and record manual interventions for finance audit
 */
function populateManualFlags(db, comp) {
  const insertFlag = db.prepare(`
    INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system', ?)
    ON CONFLICT(employee_code, month, year, flag_type) DO UPDATE SET
      system_value = excluded.system_value, manual_value = excluded.manual_value,
      delta = excluded.delta, changed_at = datetime('now'), notes = excluded.notes
  `);

  const ec = comp.employeeCode, m = comp.month, y = comp.year;

  // Manual TDS
  if (comp.tds > 0) {
    insertFlag.run(ec, m, y, 'MANUAL_TDS', 'tds', 0, comp.tds, comp.tds, `TDS of ${comp.tds} manually entered`);
  }

  // Manual other deductions
  if (comp.otherDeductions > 0) {
    insertFlag.run(ec, m, y, 'MANUAL_OTHER_DEDUCTION', 'other_deductions', 0, comp.otherDeductions, comp.otherDeductions, `Other deductions of ${comp.otherDeductions}`);
  }

  // Gross structure change from prev month
  if (comp.grossChanged) {
    insertFlag.run(ec, m, y, 'GROSS_STRUCTURE_CHANGE', 'gross_salary', comp.prevMonthGross, comp.grossSalary, comp.grossSalary - comp.prevMonthGross,
      `Gross changed from ${comp.prevMonthGross} to ${comp.grossSalary}`);
  }

  // Salary held
  if (comp.salaryHeld) {
    insertFlag.run(ec, m, y, 'SALARY_HELD', 'salary_held', 0, 1, 0, comp.holdReason || 'Below minimum payable days');
  }

  // Day correction exists
  try {
    const dc = db.prepare('SELECT * FROM day_corrections WHERE employee_code = ? AND month = ? AND year = ?').get(ec, m, y);
    if (dc) {
      insertFlag.run(ec, m, y, 'DAY_CORRECTION', 'total_payable_days', dc.original_system_days, dc.corrected_days, dc.correction_delta,
        `${dc.correction_reason}: ${dc.correction_notes || ''}`);
    }
  } catch {}

  // Punch correction exists
  try {
    const monthStr = String(m).padStart(2, '0');
    const pcCount = db.prepare(`SELECT COUNT(*) as cnt FROM punch_corrections WHERE employee_code = ? AND date LIKE ?`).get(ec, `${y}-${monthStr}-%`);
    if (pcCount && pcCount.cnt > 0) {
      insertFlag.run(ec, m, y, 'PUNCH_CORRECTION', 'punch_records', 0, pcCount.cnt, pcCount.cnt, `${pcCount.cnt} punch correction(s) this month`);
    }
  } catch {}
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
    // Phase 3 — leave breakdown for payslip display
    leaveSummary: {
      cl: comp.cl_days || 0,
      el: comp.el_days || 0,
      lwp: comp.lwp_days || 0,
      od: comp.od_days || 0,
      shortLeave: comp.short_leave_days || 0,
      uninformedAbsent: comp.uninformed_absent_days || 0
    },
    earnings: [
      { label: 'Basic Pay', amount: comp.basic_earned },
      { label: 'DA (Dearness Allowance)', amount: comp.da_earned },
      { label: 'HRA (House Rent Allowance)', amount: comp.hra_earned },
      { label: 'Conveyance Allowance', amount: comp.conveyance_earned },
      { label: 'Other Allowances', amount: comp.other_allowances_earned },
      { label: 'OT Pay', amount: comp.ot_pay },
      { label: 'Holiday Duty Pay', amount: comp.holiday_duty_pay },
      { label: 'Extra Duty Pay', amount: comp.ed_pay }
    ].filter(e => e.amount > 0),
    deductions: [
      { label: 'PF (Employee)', amount: comp.pf_employee },
      { label: 'ESI (Employee)', amount: comp.esi_employee },
      { label: 'Professional Tax', amount: comp.professional_tax },
      { label: 'TDS', amount: comp.tds },
      { label: 'Advance Recovery', amount: comp.advance_recovery },
      { label: 'Loan EMI', amount: comp.loan_recovery },
      { label: 'LOP Deduction', amount: comp.lop_deduction },
      { label: 'Late Coming Deduction', amount: comp.late_coming_deduction || 0 },
      { label: 'Early Exit Deduction', amount: comp.early_exit_deduction || 0 },
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
    // Authoritative contractor flag from salary_computations — used by
    // frontend payslipPdf to route employees into the right group without
    // relying on inline dept keyword checks.
    is_contractor: comp.is_contractor || 0,
    otPay: comp.ot_pay || 0,
    edPay: comp.ed_pay || 0,
    edDays: comp.ed_days || 0,
    holidayDutyPay: comp.holiday_duty_pay || 0,
    totalPayable: comp.total_payable || comp.net_salary || 0,
    // take_home = total_payable + ed_pay (the actual amount the employee
    // receives, including finance-approved Extra Duty grants)
    takeHome: comp.take_home || ((comp.total_payable || comp.net_salary || 0) + (comp.ed_pay || 0)),
    generatedAt: new Date().toISOString()
  };
}

module.exports = { computeEmployeeSalary, saveSalaryComputation, generatePayslipData, normalizeCompany };
