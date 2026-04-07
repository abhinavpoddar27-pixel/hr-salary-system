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
  const { isContractor: checkContractor } = require('../utils/employeeClassification');
  const isContract = checkContractor(employee) || (dayCalc.is_contractor === 1);
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
  basicEarned = Math.round(basicMonthly * earnedRatio * 100) / 100;
  daEarned = Math.round(daMonthly * earnedRatio * 100) / 100;
  hraEarned = Math.round(hraMonthly * earnedRatio * 100) / 100;
  conveyanceEarned = Math.round(conveyanceMonthly * earnedRatio * 100) / 100;
  otherEarned = Math.round(otherMonthly * earnedRatio * 100) / 100;

  // ═══ OT CALCULATION (day-based, SEPARATE from base salary) ═══
  // OT is ONLY added AFTER deductions — it never factors into grossEarned.
  // Two triggers:
  //   1. Punch-detected excess: daysPresent > (daysInMonth − sundaysInMonth)
  //   2. Finance-verified extra duty from day_corrections
  // Contractors get ZERO OT. Ever.
  const otDailyRate = otPerDayRateDisplay;
  let totalOTDays = 0;
  let otPay = 0;
  let punchBasedOT = 0;
  let financeExtraDuty = 0;
  let otNote = '';

  if (!isContract) {
    // Count Sundays in this month
    let sundaysInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month - 1, d).getDay() === 0) sundaysInMonth++;
    }
    const standardWorkingDays = daysInMonth - sundaysInMonth;

    // Condition 1: Punch-detected excess
    // Total attended = daysPresent (Mon-Sat P) + daysWOP (Sundays/offs worked) +
    // daysHalfPresent (½P). OT kicks in when total attended > standard working days,
    // i.e. the employee worked additional days beyond their Mon-Sat capacity.
    const totalAttended = daysPresent + (dayCalc.days_wop || 0) + daysHalfPresent;
    punchBasedOT = Math.max(0, totalAttended - standardWorkingDays);

    // Condition 2: Finance-verified manual extra duty from day_corrections
    // (stored in correction_delta, flagged via correction_type='extra_duty' + finance_verified=1)
    try {
      const manualED = db.prepare(`
        SELECT COALESCE(SUM(correction_delta), 0) AS total
        FROM day_corrections
        WHERE employee_code = ? AND month = ? AND year = ?
          AND COALESCE(correction_type, 'day') = 'extra_duty'
          AND COALESCE(finance_verified, 0) = 1
      `).get(employee.code, month, year);
      financeExtraDuty = manualED?.total || 0;
    } catch {}

    // Also absorb fully-approved extra_duty_grants (legacy dual-approval workflow)
    let extraDutyDaysFromGrants = 0;
    try {
      const grantsRow = db.prepare(`
        SELECT COALESCE(SUM(duty_days), 0) AS total_days
        FROM extra_duty_grants
        WHERE employee_code = ? AND month = ? AND year = ?
          AND status = 'APPROVED'
          AND finance_status = 'FINANCE_APPROVED'
      `).get(employee.code, month, year);
      extraDutyDaysFromGrants = grantsRow?.total_days || 0;
    } catch {}

    // Hard caps: non-negative, never exceed daysInMonth
    totalOTDays = Math.max(0, punchBasedOT + financeExtraDuty + extraDutyDaysFromGrants);
    totalOTDays = Math.min(totalOTDays, daysInMonth);

    otPay = Math.round(totalOTDays * otDailyRate * 100) / 100;

    otNote = totalOTDays > 0
      ? `Attended ${totalAttended}/${standardWorkingDays} working days. Punch OT: ${punchBasedOT}, Finance ED: ${financeExtraDuty + extraDutyDaysFromGrants}. Total OT: ${totalOTDays} days @ ₹${Math.round(otDailyRate)}/day`
      : `Attended ${totalAttended}/${standardWorkingDays} working days. No OT.`;
  } else {
    otNote = 'Contractor — no OT';
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

  // ─── Preserve manual values if record already exists ───
  const existingComp = db.prepare(`
    SELECT tds, other_deductions, advance_recovery FROM salary_computations
    WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.code, month, year, company);
  // Use auto TDS if calculated, else fall back to manual/existing
  if (!tdsAutoCalculated) tds = existingComp?.tds || 0;
  const otherDeductions = existingComp?.other_deductions || 0;
  // Use auto advance if available, else preserve manual
  const advanceRecovery = autoAdvanceRecovery > 0 ? autoAdvanceRecovery : (existingComp?.advance_recovery || 0);

  // ─── Total Deductions & Net ───
  let totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + advanceRecovery + lopDeduction + otherDeductions + loanRecovery;
  let salaryWarning = '';

  // Cap deductions at gross earned — net salary must never go negative
  if (totalDeductions > grossEarned && grossEarned > 0) {
    salaryWarning = 'DEDUCTIONS_EXCEED_EARNINGS';
    totalDeductions = Math.round(grossEarned * 100) / 100;
  }
  // ── NET = BASE EARNED - DEDUCTIONS (no OT, no holiday duty) ──
  // Deductions apply ONLY to base earned. OT and holiday duty are clean add-ons.
  const netSalary = Math.max(0, Math.round((grossEarned - totalDeductions) * 100) / 100);

  // ── TOTAL PAYABLE = Net Salary + OT Pay + Holiday Duty Pay ──
  // This is what the employee actually receives — clean addition after deductions.
  const totalPayable = Math.round((netSalary + otPay + holidayDutyPay) * 100) / 100;

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
    pfWages, esiWages, eps,
    pfEmployee, pfEmployer,
    esiEmployee, esiEmployer,
    professionalTax, tds,
    advanceRecovery, lopDeduction, otherDeductions,
    loanRecovery,
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
      punch_based_ot, finance_extra_duty, ot_note, total_payable
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
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
    comp.punchBasedOT || 0, comp.financeExtraDuty || 0, comp.otNote || '', comp.totalPayable || 0
  );

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
