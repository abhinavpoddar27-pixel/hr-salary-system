/**
 * Finance Red Flag Detection Engine
 * Detects anomalies in salary data for finance audit review.
 */

function detectRedFlags(db, month, year) {
  const flags = [];
  let id = 0;

  const mkFlag = (type, severity, empCode, empName, dept, desc, details, action, extraFields = {}) => ({
    id: `rf_${++id}`, type, severity,
    employeeCode: empCode, employeeName: empName, department: dept,
    description: desc, details, suggestedAction: action,
    ...extraFields
  });

  // 1. salary_exceeds_gross (CRITICAL)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.gross_salary, sc.gross_earned, sc.ot_pay
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND (sc.gross_earned - COALESCE(sc.ot_pay, 0)) > sc.gross_salary + 1
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('salary_exceeds_gross', 'critical', r.employee_code, r.name, r.department,
        `Earned ₹${r.gross_earned} exceeds gross ₹${r.gross_salary}`,
        { grossSalary: r.gross_salary, grossEarned: r.gross_earned },
        'Verify if OT/holiday duty justifies excess'));
    }
  } catch {}

  // 2. negative_net (CRITICAL)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.net_salary
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.net_salary <= 0
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('negative_net', 'critical', r.employee_code, r.name, r.department,
        `Net salary is ₹${r.net_salary}`, { netSalary: r.net_salary },
        'Review deductions — may exceed earnings'));
    }
  } catch {}

  // 3. gross_changed (WARNING)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.gross_salary, sc.prev_month_gross
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.gross_changed = 1
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('gross_changed', 'warning', r.employee_code, r.name, r.department,
        `Gross changed: ₹${r.prev_month_gross} → ₹${r.gross_salary}`,
        { prev: r.prev_month_gross, current: r.gross_salary },
        'Verify salary structure change was authorized'));
    }
  } catch {}

  // 4. salary_held (INFO)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.hold_reason, sc.gross_salary, sc.gross_earned, sc.net_salary, sc.payable_days, sc.total_deductions, sc.advance_recovery
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.salary_held = 1
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('salary_held', 'info', r.employee_code, r.name, r.department,
        `Salary on hold: ${r.hold_reason}`, { grossSalary: r.gross_salary, netSalary: r.net_salary },
        'Review hold reason and decide whether to release',
        { holdReason: r.hold_reason, grossSalary: r.gross_salary, grossEarned: r.gross_earned, netSalary: r.net_salary, payableDays: r.payable_days }));
    }
  } catch {}

  // 5. high_absenteeism (INFO)
  try {
    const rows = db.prepare(`
      SELECT dc.employee_code, e.name, e.department, dc.days_absent
      FROM day_calculations dc LEFT JOIN employees e ON dc.employee_code = e.code
      WHERE dc.month = ? AND dc.year = ? AND dc.days_absent >= 10
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('high_absenteeism', 'info', r.employee_code, r.name, r.department,
        `${r.days_absent} absent days this month`, { daysAbsent: r.days_absent },
        'Verify if leave was applied or if employee has absconded'));
    }
  } catch {}

  // 6. compliance_gap (WARNING)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.pf_employee, sc.esi_employee,
        ss.pf_applicable, ss.esi_applicable
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      LEFT JOIN salary_structures ss ON ss.employee_id = e.id
      WHERE sc.month = ? AND sc.year = ?
      AND ((ss.pf_applicable = 1 AND sc.pf_employee = 0) OR (ss.esi_applicable = 1 AND sc.esi_employee = 0))
      AND ss.id = (SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1)
    `).all(month, year);
    for (const r of rows) {
      const gap = r.pf_applicable && !r.pf_employee ? 'PF' : 'ESI';
      flags.push(mkFlag('compliance_gap', 'warning', r.employee_code, r.name, r.department,
        `${gap} applicable but deduction is ₹0`, {},
        `Check why ${gap} was not deducted`));
    }
  } catch {}

  // 7. advance_exceeds_net (WARNING)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, sc.advance_recovery, sc.net_salary, sc.gross_salary, sc.gross_earned, sc.payable_days, sc.total_deductions
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.advance_recovery > sc.net_salary * 0.5 AND sc.advance_recovery > 0
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('advance_exceeds_net', 'warning', r.employee_code, r.name, r.department,
        `Advance ₹${r.advance_recovery} is > 50% of net ₹${r.net_salary}`,
        { advance: r.advance_recovery, net: r.net_salary, grossSalary: r.gross_salary },
        'Verify advance recovery amount',
        { grossSalary: r.gross_salary, grossEarned: r.gross_earned, netSalary: r.net_salary, payableDays: r.payable_days, advanceRecovery: r.advance_recovery, totalDeductions: r.total_deductions }));
    }
  } catch {}

  // 8. returning_employee (WARNING)
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND e.was_left_returned = 1
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('returning_employee', 'warning', r.employee_code, r.name, r.department,
        'Previously marked as Left, now has salary', {},
        'Verify re-joining was authorized'));
    }
  } catch {}

  // 9. doj_holiday_exclusion (INFO) — April 2026 mid-month joiner rule
  // Surfaces every employee whose DOJ falls in this month so the finance reviewer
  // can confirm the pre-DOJ holiday exclusion + pro-rata calculation.
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, e.name, e.department, e.date_of_joining,
             dc.holidays_before_doj, dc.is_mid_month_joiner, dc.total_payable_days,
             sc.gross_salary, sc.gross_earned, sc.net_salary
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
      WHERE sc.month = ? AND sc.year = ?
        AND dc.is_mid_month_joiner = 1
    `).all(month, year);
    for (const r of rows) {
      const excludedTxt = r.holidays_before_doj > 0
        ? `${r.holidays_before_doj} pre-DOJ holiday${r.holidays_before_doj > 1 ? 's' : ''} excluded`
        : 'no pre-DOJ holidays';
      flags.push(mkFlag('doj_holiday_exclusion', 'info', r.employee_code, r.name, r.department,
        `New joiner — DOJ ${r.date_of_joining || 'unknown'} (${excludedTxt})`,
        {
          dateOfJoining: r.date_of_joining,
          holidaysBeforeDOJ: r.holidays_before_doj || 0,
          payableDays: r.total_payable_days,
          grossSalary: r.gross_salary,
          grossEarned: r.gross_earned,
          netSalary: r.net_salary
        },
        'Verify pro-rata salary and pre-DOJ holiday exclusion are correct'));
    }
  } catch {}

  // 10. unverified_miss_punches (WARNING) — April 2026 finance approval gate
  // HR has resolved the miss punch but finance has NOT yet approved the
  // fabricated in/out times. Month cannot be finalised until cleared.
  try {
    const rows = db.prepare(`
      SELECT ap.employee_code, e.name, e.department,
             COUNT(*) as pending_count,
             GROUP_CONCAT(ap.date) as pending_dates
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.month = ? AND ap.year = ?
        AND ap.is_miss_punch = 1
        AND ap.miss_punch_resolved = 1
        AND ap.miss_punch_finance_status = 'pending'
      GROUP BY ap.employee_code, e.name, e.department
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('unverified_miss_punches', 'warning', r.employee_code, r.name, r.department,
        `${r.pending_count} miss-punch resolution(s) awaiting finance review`,
        { pendingCount: r.pending_count, pendingDates: r.pending_dates },
        'Review HR-fabricated in/out times and approve or reject'));
    }
  } catch {}

  // 11. late_deduction_high (WARNING) — April 2026 Phase 2
  // Finance has approved more than 2 days of late coming deductions for this
  // employee this month. Surfaces for review because the rupee impact is large
  // and should have clear HR justification.
  try {
    const rows = db.prepare(`
      SELECT sc.employee_code, COALESCE(e.name, sc.employee_code) AS name,
             e.department, sc.late_coming_deduction,
             COALESCE((
               SELECT SUM(deduction_days) FROM late_coming_deductions lcd
               WHERE lcd.employee_code = sc.employee_code
                 AND lcd.month = sc.month AND lcd.year = sc.year
                 AND lcd.finance_status = 'approved'
             ), 0) AS deduction_days
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND COALESCE(sc.late_coming_deduction, 0) > 0
    `).all(month, year);
    for (const r of rows) {
      if (r.deduction_days > 2) {
        flags.push(mkFlag('late_deduction_high', 'warning', r.employee_code, r.name, r.department,
          `Late coming deduction of ${r.deduction_days} days (₹${r.late_coming_deduction})`,
          { deductionDays: r.deduction_days, amount: r.late_coming_deduction },
          'Review HR justification and employee 6-month history before finalising'));
      }
    }
  } catch {}

  // Sort: critical first, then warning, then info
  const sev = { critical: 0, warning: 1, info: 2 };
  flags.sort((a, b) => (sev[a.severity] || 9) - (sev[b.severity] || 9));

  return flags;
}

module.exports = { detectRedFlags };
