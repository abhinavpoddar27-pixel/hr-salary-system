const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { calculateDays, saveDayCalculation } = require('../services/dayCalculation');
const { computeEmployeeSalary, saveSalaryComputation, generatePayslipData } = require('../services/salaryComputation');
const XLSX = require('xlsx');

/**
 * POST /api/payroll/calculate-days
 * Run day calculation for all employees in a month
 */
router.post('/calculate-days', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // Get employee codes from attendance — include ALL employees with attendance data
  // (even those marked 'Left' who may have returned; auto-reactivate them)
  const empCodes = db.prepare(`
    SELECT DISTINCT ap.employee_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? ${company ? 'AND ap.company = ?' : ''}
    AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean)).map(r => r.employee_code);

  // Auto-reactivate 'Left' employees who have attendance this month
  db.prepare(`
    UPDATE employees SET status = 'Active', was_left_returned = 1, updated_at = datetime('now')
    WHERE code IN (${empCodes.map(() => '?').join(',')})
    AND status = 'Left'
  `).run(...empCodes);

  const monthStr = String(month).padStart(2,'0');
  const holidays = db.prepare(`
    SELECT date FROM holidays WHERE date LIKE ?
  `).all(`${year}-${monthStr}-%`);

  const results = [];
  const errors = [];

  const txn = db.transaction(() => {
    for (const empCode of empCodes) {
      try {
        const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(empCode);
        const records = db.prepare(`
          SELECT * FROM attendance_processed
          WHERE employee_code = ? AND month = ? AND year = ?
          ${company ? 'AND company = ?' : ''}
        `).all(...[empCode, month, year, company].filter(Boolean));

        const leaveBalances = { CL: 0, EL: 0, SL: 0 };
        if (emp) {
          const lbs = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
          for (const lb of lbs) {
            leaveBalances[lb.leave_type] = lb.balance || 0;
          }
        }

        // Detect contractor for day calc rules
        const empFull = db.prepare('SELECT * FROM employees WHERE code = ?').get(empCode);
        const { isContractor: checkContractor } = require('../utils/employeeClassification');
        // Get fully-approved extra duty grants for this employee
        let manualExtraDutyDays = 0;
        try {
          const grants = db.prepare("SELECT SUM(duty_days) as total FROM extra_duty_grants WHERE employee_code = ? AND month = ? AND year = ? AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'").get(empCode, month, year);
          manualExtraDutyDays = grants?.total || 0;
        } catch {}
        const calcResult = calculateDays(empCode, parseInt(month), parseInt(year), company || '', records, leaveBalances, holidays, { isContractor: checkContractor(empFull), manualExtraDutyDays });
        calcResult.employeeId = emp?.id;
        saveDayCalculation(db, calcResult);

        if (emp && (calcResult.clUsed > 0 || calcResult.elUsed > 0)) {
          if (calcResult.clUsed > 0) {
            db.prepare(`
              UPDATE leave_balances SET used = used + ?, balance = balance - ?
              WHERE employee_id = ? AND year = ? AND leave_type = 'CL'
            `).run(calcResult.clUsed, calcResult.clUsed, emp.id, year);
          }
          if (calcResult.elUsed > 0) {
            db.prepare(`
              UPDATE leave_balances SET used = used + ?, balance = balance - ?
              WHERE employee_id = ? AND year = ? AND leave_type = 'EL'
            `).run(calcResult.elUsed, calcResult.elUsed, emp.id, year);
          }
        }

        results.push({ employeeCode: empCode, ...calcResult });
      } catch (err) {
        errors.push({ employeeCode: empCode, error: err.message });
      }
    }
  });

  txn();
  db.prepare(`UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ?`).run(month, year);

  res.json({
    success: true,
    message: `Day calculation complete for ${results.length} employees`,
    processed: results.length,
    errors: errors.length,
    errorDetails: errors,
    summary: {
      totalPresent: results.reduce((s, r) => s + r.daysPresent, 0),
      totalAbsent: results.reduce((s, r) => s + r.daysAbsent, 0),
      totalPaidSundays: results.reduce((s, r) => s + r.paidSundays, 0),
      totalLOP: results.reduce((s, r) => s + r.lopDays, 0),
      avgPayableDays: results.length ? results.reduce((s, r) => s + r.totalPayableDays, 0) / results.length : 0
    }
  });
});

/**
 * GET /api/payroll/day-calculations
 */
router.get('/day-calculations', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const records = db.prepare(`
    SELECT dc.*,
      COALESCE(NULLIF(e.name, ''), ar_name.employee_name, dc.employee_code) as employee_name,
      COALESCE(NULLIF(e.department, ''), ar_name.department) as department,
      e.designation, e.status as employee_status,
      e.date_of_joining, e.date_of_exit,
      ss.gross_salary
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON dc.employee_code = ar_name.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY department, employee_name
  `).all(...[month, year, company].filter(Boolean));

  res.json({ success: true, data: records });
});

/**
 * GET /api/payroll/day-calculations/:code
 */
router.get('/day-calculations/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const { code } = req.params;

  const record = db.prepare(`
    SELECT dc.*,
      COALESCE(NULLIF(e.name, ''), ar_name.employee_name, dc.employee_code) as employee_name,
      COALESCE(NULLIF(e.department, ''), ar_name.department) as department
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON dc.employee_code = ar_name.employee_code
    WHERE dc.employee_code = ? AND dc.month = ? AND dc.year = ?
  `).get(code, month, year);

  if (!record) return res.status(404).json({ success: false, error: 'Day calculation not found' });

  if (record.week_breakdown) {
    try { record.week_breakdown = JSON.parse(record.week_breakdown); } catch (e) {}
  }

  res.json({ success: true, data: record });
});

/**
 * POST /api/payroll/compute-salary
 * Compute salary for all employees — with zero-day exclusion, gross change, holds
 */
router.post('/compute-salary', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // Include ALL employees with day calculations (even returning 'Left' employees)
  const employees = db.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    INNER JOIN day_calculations dc ON e.code = dc.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean));

  const results = [];
  const errors = [];
  const excluded = [];
  const held = [];

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || '');
        if (comp.success) {
          saveSalaryComputation(db, comp);
          results.push(comp);
          if (comp.salaryHeld) held.push({ code: emp.code, name: emp.name, reason: comp.holdReason });
        } else if (comp.excluded) {
          excluded.push({ code: comp.employeeCode, name: emp.name, reason: comp.reason });
        } else if (comp.silentSkip) {
          // Zero attendance — don't show as error, just count
        } else {
          errors.push({ employeeCode: emp.code, error: comp.error });
        }
      } catch (perEmpErr) {
        // Per-employee try/catch so ONE bad employee's SQL error doesn't roll
        // back the entire batch and leave Stage 7 stale.
        console.error(`[compute-salary] employee ${emp.code} failed: ${perEmpErr.message}`);
        if (perEmpErr.stack) console.error(perEmpErr.stack.split('\n').slice(0, 5).join('\n'));
        errors.push({ employeeCode: emp.code, error: perEmpErr.message });
      }
    }
  });
  txn();

  db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ?').run(month, year);

  const totalNetSalary = results.reduce((s, r) => s + r.netSalary, 0);
  const totalGross = results.reduce((s, r) => s + r.grossEarned, 0);
  const grossChangedCount = results.filter(r => r.grossChanged).length;
  const heldCount = results.filter(r => r.salaryHeld).length;

  res.json({
    success: true,
    processed: results.length,
    errors: errors.length,
    errorDetails: errors,
    excluded,
    held,
    summary: {
      totalNetSalary: Math.round(totalNetSalary * 100) / 100,
      totalGrossSalary: Math.round(totalGross * 100) / 100,
      totalOTPay: Math.round(results.reduce((s, r) => s + (r.otPay || 0), 0) * 100) / 100,
      totalPayable: Math.round(results.reduce((s, r) => s + (r.totalPayable || 0), 0) * 100) / 100,
      totalPFEmployee: Math.round(results.reduce((s, r) => s + r.pfEmployee, 0) * 100) / 100,
      totalPFEmployer: Math.round(results.reduce((s, r) => s + r.pfEmployer, 0) * 100) / 100,
      totalESIEmployee: Math.round(results.reduce((s, r) => s + r.esiEmployee, 0) * 100) / 100,
      totalESIEmployer: Math.round(results.reduce((s, r) => s + r.esiEmployer, 0) * 100) / 100,
      grossChangedCount,
      heldCount,
      excludedCount: excluded.length
    }
  });
});

/**
 * GET /api/payroll/salary-register
 * Includes new fields: gross_changed, salary_held, hold_reason, prev_month_gross, loan_recovery
 */
router.get('/salary-register', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const records = db.prepare(`
    SELECT sc.*,
           COALESCE(NULLIF(e.name, ''), ar_name.employee_name, sc.employee_code) as employee_name,
           COALESCE(NULLIF(e.department, ''), ar_name.department) as department,
           e.designation,
           e.bank_account, e.ifsc, e.was_left_returned, e.status as employee_status,
           dc.total_payable_days, dc.days_present, dc.days_absent, dc.lop_days, dc.paid_sundays,
           dc.days_half_present, dc.ot_hours,
           dc.late_count, dc.late_deduction_days, dc.late_deduction_remark
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON sc.employee_code = ar_name.employee_code
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY department, employee_name
  `).all(...[month, year, company].filter(Boolean));

  const activeRecords = records.filter(r => !r.salary_held);
  const heldRecords = records.filter(r => r.salary_held);

  const totals = records.length > 0 ? {
    totalGross: records.reduce((s, r) => s + (r.gross_earned || 0), 0),
    totalDeductions: records.reduce((s, r) => s + (r.total_deductions || 0), 0),
    totalNet: activeRecords.reduce((s, r) => s + (r.net_salary || 0), 0),
    totalPFEmployee: records.reduce((s, r) => s + (r.pf_employee || 0), 0),
    totalPFLiability: records.reduce((s, r) => s + (r.pf_employee || 0) + (r.pf_employer || 0), 0),
    totalESI: records.reduce((s, r) => s + (r.esi_employee || 0) + (r.esi_employer || 0), 0),
    totalLoanRecovery: records.reduce((s, r) => s + (r.loan_recovery || 0), 0),
    totalAdvanceRecovery: records.reduce((s, r) => s + (r.advance_recovery || 0), 0),
    count: records.length,
    heldCount: heldRecords.length,
    grossChangedCount: records.filter(r => r.gross_changed).length,
    bankTransferTotal: activeRecords.reduce((s, r) => s + (r.net_salary || 0), 0)
  } : {};

  res.json({ success: true, data: records, totals });
});

/**
 * PUT /api/payroll/salary/:code/hold-release
 * Release a held salary
 */
router.put('/salary/:code/hold-release', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year } = req.body;
  const user = req.user?.username || 'admin';

  db.prepare(`
    UPDATE salary_computations SET
      salary_held = 0, hold_released = 1, hold_released_by = ?, hold_released_at = datetime('now')
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(user, code, month, year);

  res.json({ success: true, message: `Salary released for ${code}` });
});

/**
 * GET /api/payroll/payslip/:code
 */
router.get('/payslip/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const payslip = generatePayslipData(db, req.params.code, parseInt(month), parseInt(year));

  if (!payslip) return res.status(404).json({ success: false, error: 'Payslip not found. Generate salary first.' });
  res.json({ success: true, data: payslip });
});

/**
 * PUT /api/payroll/salary/:code/manual-deductions
 */
router.put('/salary/:code/manual-deductions', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year, advanceRecovery, tds, otherDeductions } = req.body;

  // Recalculate total_deductions, net_salary AND total_payable (= net + ot + holidayDuty)
  // net is base-only (grossEarned is base); OT is clean add-on after deductions.
  db.prepare(`
    UPDATE salary_computations SET
      advance_recovery = ?, tds = ?, other_deductions = ?,
      total_deductions = pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0),
      net_salary = MAX(0, gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))),
      total_payable = MAX(0, gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))) + COALESCE(ot_pay, 0) + COALESCE(holiday_duty_pay, 0)
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    code, month, year
  );

  res.json({ success: true });
});

/**
 * POST /api/payroll/finalise
 */
router.post('/finalise', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;

  // Check finance sign-off
  try {
    const signoff = db.prepare("SELECT status FROM finance_month_signoff WHERE month = ? AND year = ? AND status = 'approved'").get(month, year);
    if (!signoff) {
      return res.status(403).json({
        success: false,
        error: 'Cannot finalise — finance audit sign-off is pending. The finance team must approve before finalisation.',
        requiresFinanceApproval: true
      });
    }
  } catch {} // table may not exist yet

  // Check extra duty grants reviewed
  try {
    const unreviewed = db.prepare("SELECT COUNT(*) as cnt FROM extra_duty_grants WHERE month = ? AND year = ? AND status = 'APPROVED' AND finance_status IN ('UNREVIEWED', 'FINANCE_FLAGGED')").get(month, year);
    if (unreviewed?.cnt > 0) {
      return res.status(400).json({ success: false, error: `Cannot finalise: ${unreviewed.cnt} extra duty grant(s) pending finance review.`, pendingGrants: unreviewed.cnt });
    }
  } catch {}

  db.prepare(`UPDATE salary_computations SET is_finalised = 1, finalised_at = datetime('now') WHERE month = ? AND year = ?`).run(month, year);
  db.prepare(`UPDATE monthly_imports SET is_finalised = 1, finalised_at = datetime('now') WHERE month = ? AND year = ?`).run(month, year);

  res.json({ success: true, message: 'Salary finalised' });
});

/**
 * PUT /api/payroll/day-calculations/:code/late-deduction
 * HR can apply late deduction for employees with >5 late days
 */
router.put('/day-calculations/:code/late-deduction', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year, deductionDays, remark } = req.body;

  // Validate
  if (deductionDays < 0 || deductionDays > 5) {
    return res.status(400).json({ success: false, error: 'Deduction must be 0-5 days' });
  }

  // Update day calculation
  const dc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
  if (!dc) return res.status(404).json({ success: false, error: 'Day calculation not found' });

  const newPayable = Math.max(0, (dc.total_payable_days || 0) - deductionDays + (dc.late_deduction_days || 0));
  const newLOP = Math.max(0, (dc.lop_days || 0) + deductionDays - (dc.late_deduction_days || 0));

  db.prepare(`
    UPDATE day_calculations SET
      late_deduction_days = ?,
      late_deduction_remark = ?,
      total_payable_days = ?,
      lop_days = ?
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(deductionDays, remark || `Late deduction: ${deductionDays} day(s) for ${dc.late_count || 0} late arrivals`, newPayable, newLOP, code, month, year);

  res.json({ success: true, message: `Late deduction of ${deductionDays} day(s) applied for ${code}` });
});

/**
 * GET /api/payroll/payslips/bulk
 * Get all payslip data for a month (for client-side bulk PDF generation)
 */
router.get('/payslips/bulk', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const employees = db.prepare(`
    SELECT DISTINCT sc.employee_code
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND sc.net_salary > 0
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY sc.employee_code
  `).all(...[month, year, company].filter(Boolean));

  const payslips = [];
  for (const emp of employees) {
    const ps = generatePayslipData(db, emp.employee_code, parseInt(month), parseInt(year));
    if (ps) payslips.push(ps);
  }

  // Fetch company config for headers
  const companyConfig = company
    ? db.prepare('SELECT * FROM company_config WHERE company_name = ?').get(company)
    : null;

  res.json({ success: true, data: payslips, companyConfig, count: payslips.length });
});

/**
 * GET /api/payroll/month-end-checklist
 * Pre-finalization validation checklist
 */
router.get('/month-end-checklist', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const items = [];

  // 1. Check pipeline stages by verifying actual data existence (more reliable than stage flags)
  const imports = db.prepare('SELECT * FROM monthly_imports WHERE month = ? AND year = ?').all(month, year);
  if (imports.length === 0) {
    items.push({ id: 'import', label: 'Attendance data imported', status: 'error', count: 0, detail: 'No import found for this month', link: '/pipeline/import' });
  } else {
    // Check actual data presence rather than per-row flags (flags may not be set on all import rows)
    const hasAttendance = db.prepare('SELECT COUNT(*) as cnt FROM attendance_processed WHERE month = ? AND year = ?').get(month, year).cnt > 0;
    const hasDayCalc = db.prepare('SELECT COUNT(*) as cnt FROM day_calculations WHERE month = ? AND year = ?').get(month, year).cnt > 0;
    const hasSalary = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ?').get(month, year).cnt > 0;

    if (hasAttendance) {
      items.push({ id: 'pipeline_import', label: 'Attendance data imported', status: 'ok', count: imports.length, detail: `${imports.length} import(s) for this month` });
    }
    if (!hasDayCalc) {
      items.push({ id: 'pipeline_daycalc', label: 'Day Calculation (Stage 6)', status: 'warning', count: 0, detail: 'Run day calculation before salary', link: '/pipeline/day-calc' });
    } else {
      items.push({ id: 'pipeline_daycalc', label: 'Day calculation completed', status: 'ok', count: 0 });
    }
    if (!hasSalary) {
      items.push({ id: 'pipeline_salary', label: 'Salary Computation (Stage 7)', status: 'warning', count: 0, detail: 'Run salary computation', link: '/pipeline/salary' });
    } else {
      items.push({ id: 'pipeline_salary', label: 'Salary computed', status: 'ok', count: 0 });
    }
  }

  // 2. Unresolved miss punches
  const unresolvedMP = db.prepare(`
    SELECT COUNT(*) as cnt FROM attendance_processed
    WHERE month = ? AND year = ? AND is_miss_punch = 1 AND miss_punch_resolved = 0
  `).get(month, year);
  items.push({
    id: 'miss_punches',
    label: 'Unresolved miss punches',
    status: unresolvedMP.cnt > 0 ? 'warning' : 'ok',
    count: unresolvedMP.cnt,
    detail: unresolvedMP.cnt > 0 ? `${unresolvedMP.cnt} miss punches need resolution` : 'All miss punches resolved',
    link: '/pipeline/miss-punch'
  });

  // 3. Unconfirmed night shifts
  const unconfirmedNS = db.prepare(`
    SELECT COUNT(*) as cnt FROM night_shift_pairs
    WHERE month = ? AND year = ? AND is_confirmed = 0 AND is_rejected = 0
  `).get(month, year);
  items.push({
    id: 'night_shifts',
    label: 'Unconfirmed night shift pairs',
    status: unconfirmedNS.cnt > 0 ? 'warning' : 'ok',
    count: unconfirmedNS.cnt,
    detail: unconfirmedNS.cnt > 0 ? `${unconfirmedNS.cnt} night shift pairs need confirmation` : 'All night shifts confirmed',
    link: '/pipeline/night-shift'
  });

  // 4. Employees missing salary structure — include names
  const missingSSRows = db.prepare(`
    SELECT DISTINCT dc.employee_code, COALESCE(e.name, dc.employee_code) as employee_name, e.department
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE dc.month = ? AND dc.year = ? AND ss.id IS NULL
    ORDER BY e.department, e.name
  `).all(month, year);
  const missingSS = { cnt: missingSSRows.length };
  const missingSSNames = missingSSRows.slice(0, 10).map(r => `${r.employee_name} (${r.employee_code})`).join(', ');
  items.push({
    id: 'salary_structure',
    label: 'Employees missing salary structure',
    status: missingSS.cnt > 0 ? 'warning' : 'ok',
    count: missingSS.cnt,
    detail: missingSS.cnt > 0 ? `${missingSSNames}${missingSSRows.length > 10 ? ` +${missingSSRows.length - 10} more` : ''}` : 'All employees have salary structures',
    link: '/employees',
    employees: missingSSRows,
  });

  // 5. Employees missing bank details
  const missingBank = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND sc.net_salary > 0 AND sc.salary_held = 0
    AND (e.account_number IS NULL OR e.account_number = '') AND (e.bank_account IS NULL OR e.bank_account = '')
  `).get(month, year);
  items.push({
    id: 'bank_details',
    label: 'Employees missing bank details',
    status: missingBank.cnt > 0 ? 'warning' : 'ok',
    count: missingBank.cnt,
    detail: missingBank.cnt > 0 ? `${missingBank.cnt} employees need bank details for NEFT` : 'All employees have bank details',
    link: '/employees'
  });

  // 6. Held salaries
  const heldSalaries = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations
    WHERE month = ? AND year = ? AND salary_held = 1 AND (hold_released IS NULL OR hold_released = 0)
  `).get(month, year);
  items.push({
    id: 'held_salaries',
    label: 'Held salaries not released',
    status: heldSalaries.cnt > 0 ? 'warning' : 'ok',
    count: heldSalaries.cnt,
    detail: heldSalaries.cnt > 0 ? `${heldSalaries.cnt} salaries are on hold` : 'No held salaries',
    link: '/pipeline/salary'
  });

  // 7. Already finalised check
  const finalised = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations
    WHERE month = ? AND year = ? AND is_finalised = 1
  `).get(month, year);
  if (finalised.cnt > 0) {
    items.push({
      id: 'finalised',
      label: 'Salary already finalised',
      status: 'ok',
      count: finalised.cnt,
      detail: `${finalised.cnt} records already finalised`
    });
  }

  const warnings = items.filter(i => i.status === 'warning').length;
  const errors = items.filter(i => i.status === 'error').length;

  res.json({ success: true, data: items, summary: { total: items.length, ok: items.filter(i => i.status === 'ok').length, warnings, errors } });
});

/**
 * GET /api/payroll/salary-comparison
 * Month-over-month salary comparison for anomaly detection
 */
router.get('/salary-comparison', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // Calculate previous month
  let prevMonth = parseInt(month) - 1;
  let prevYear = parseInt(year);
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }

  const currentData = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.department,
           sc.gross_salary, sc.gross_earned, sc.net_salary, sc.payable_days,
           sc.pf_employee, sc.esi_employee, sc.total_deductions,
           sc.gross_changed, sc.salary_held
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
  `).all(...[month, year, company].filter(Boolean));

  const prevData = db.prepare(`
    SELECT sc.employee_code, sc.gross_salary as prev_gross, sc.net_salary as prev_net,
           sc.payable_days as prev_payable_days, sc.gross_earned as prev_gross_earned
    FROM salary_computations sc
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
  `).all(...[prevMonth, prevYear, company].filter(Boolean));

  const prevMap = {};
  for (const p of prevData) prevMap[p.employee_code] = p;

  const comparisons = [];
  for (const curr of currentData) {
    const prev = prevMap[curr.employee_code];
    const flags = [];

    if (!prev) {
      flags.push('NEW');
    } else {
      const netChange = prev.prev_net > 0 ? ((curr.net_salary - prev.prev_net) / prev.prev_net) * 100 : 0;
      if (Math.abs(netChange) > 30) flags.push('LARGE_CHANGE');
      else if (Math.abs(netChange) > 20) flags.push('MODERATE_CHANGE');
      if (curr.gross_changed) flags.push('GROSS_CHANGED');

      curr.prev_net = prev.prev_net;
      curr.prev_gross = prev.prev_gross;
      curr.prev_payable_days = prev.prev_payable_days;
      curr.net_change_pct = Math.round(netChange * 100) / 100;
    }

    if (curr.salary_held) flags.push('HELD');
    curr.flags = flags;

    if (flags.length > 0) comparisons.push(curr);
  }

  // Check for employees in previous month but missing this month
  const currentCodes = new Set(currentData.map(c => c.employee_code));
  for (const prev of prevData) {
    if (!currentCodes.has(prev.employee_code)) {
      const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(prev.employee_code);
      comparisons.push({
        employee_code: prev.employee_code,
        employee_name: emp?.name || prev.employee_code,
        department: emp?.department || '',
        net_salary: 0,
        prev_net: prev.prev_net,
        prev_gross: prev.prev_gross,
        net_change_pct: -100,
        flags: ['MISSING'],
      });
    }
  }

  // Sort by severity
  const flagOrder = { MISSING: 0, LARGE_CHANGE: 1, HELD: 2, NEW: 3, GROSS_CHANGED: 4, MODERATE_CHANGE: 5 };
  comparisons.sort((a, b) => {
    const aMin = Math.min(...a.flags.map(f => flagOrder[f] ?? 99));
    const bMin = Math.min(...b.flags.map(f => flagOrder[f] ?? 99));
    return aMin - bMin;
  });

  res.json({
    success: true,
    data: comparisons,
    summary: {
      total: comparisons.length,
      new: comparisons.filter(c => c.flags.includes('NEW')).length,
      missing: comparisons.filter(c => c.flags.includes('MISSING')).length,
      largeChange: comparisons.filter(c => c.flags.includes('LARGE_CHANGE')).length,
      held: comparisons.filter(c => c.flags.includes('HELD')).length,
    },
    period: { current: { month, year }, previous: { month: prevMonth, year: prevYear } }
  });
});

/**
 * GET /api/payroll/salary-slip-excel
 * Generate single Excel file with all salary slips — 4 per page, with summary sheet
 */
router.get('/salary-slip-excel', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const MONTHS = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  // Fetch all salary data
  const rows = db.prepare(`
    SELECT sc.*, e.name, e.department, e.designation, e.date_of_joining,
      dc.total_payable_days, dc.days_present, dc.days_absent, dc.paid_sundays, dc.days_wop, dc.ot_hours
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ? AND sc.net_salary > 0
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY e.department, e.name
  `).all(...[parseInt(month), parseInt(year), company].filter(Boolean));

  if (rows.length === 0) return res.status(404).json({ success: false, error: 'No salary records found' });

  const companyName = company || 'ASIAN LAKTO IND LTD.';
  const monthTitle = `SALARY SLIP ${MONTHS[parseInt(month)]} ${year}`;

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: SUMMARY ──────────────────────────────────────
  const summaryData = [
    [companyName],
    [`SALARY SUMMARY — ${MONTHS[parseInt(month)]} ${year}`],
    [],
    ['S.No', 'EMP', 'NAME', 'DEPARTMENT', 'DESIGNATION', 'GROSS', 'EARNED', 'PF', 'ESI', 'ADVANCE', 'LOAN', 'LOP', 'TOT DED', 'NET PAYABLE', 'DAYS']
  ];

  rows.forEach((r, i) => {
    summaryData.push([
      i + 1, r.employee_code, r.name || '', r.department || '', r.designation || '',
      r.gross_salary || 0, r.gross_earned || 0,
      r.pf_employee || 0, r.esi_employee || 0,
      r.advance_recovery || 0, r.loan_recovery || 0, r.lop_deduction || 0,
      r.total_deductions || 0, r.net_salary || 0, r.total_payable_days || 0
    ]);
  });

  // Totals row
  const totals = rows.reduce((t, r) => {
    t.gross += r.gross_salary || 0; t.earned += r.gross_earned || 0;
    t.pf += r.pf_employee || 0; t.esi += r.esi_employee || 0;
    t.adv += r.advance_recovery || 0; t.loan += r.loan_recovery || 0; t.lop += r.lop_deduction || 0;
    t.ded += r.total_deductions || 0; t.net += r.net_salary || 0;
    return t;
  }, { gross: 0, earned: 0, pf: 0, esi: 0, adv: 0, loan: 0, lop: 0, ded: 0, net: 0 });

  summaryData.push([
    '', '', 'TOTAL', '', '',
    Math.round(totals.gross), Math.round(totals.earned),
    Math.round(totals.pf), Math.round(totals.esi),
    Math.round(totals.adv), Math.round(totals.loan), Math.round(totals.lop),
    Math.round(totals.ded), Math.round(totals.net), ''
  ]);

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [
    { wch: 5 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 6 },
    { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 6 }
  ];
  summarySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 15 } }
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'SUMMARY');

  // ── Sheet 2: SALARY SLIP ──────────────────────────────────
  const slipData = [];
  const slipMerges = [];
  let currentRow = 0;

  // Process employees in groups of 4
  for (let g = 0; g < rows.length; g += 4) {
    const group = rows.slice(g, g + 4);

    // Header rows for this page
    slipData.push([companyName]);
    slipMerges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
    currentRow++;

    slipData.push([monthTitle]);
    slipMerges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
    currentRow++;

    // Column headers
    slipData.push(['S.No', 'EMP', 'NAME', 'DESIGNATION', 'DATE.D', 'GROSS SALARY', 'TOTAL EARNED', 'ADVANCE', 'Total Days', 'PAYABLE', 'Net Payable', 'Signature']);
    currentRow++;

    // Employee rows (4 per page, with blank row between each)
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      const doj = r.date_of_joining ? r.date_of_joining.replace(/-/g, '/').replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$2/$3/$1').replace(/^0/, '') : '';

      // Blank row before employee
      slipData.push([]);
      currentRow++;

      slipData.push([
        g + i + 1,
        r.employee_code,
        r.name || '',
        (r.designation || '') + (r.department ? ` ${r.department}` : ''),
        doj,
        r.gross_salary || 0,
        r.gross_earned ? Math.round(r.gross_earned * 100) / 100 : 0,
        r.advance_recovery || 0,
        r.total_payable_days ? Math.round(r.total_payable_days * 100) / 100 : 0,
        r.net_salary ? Math.round((r.net_salary + (r.advance_recovery || 0)) * 100) / 100 : 0,
        r.net_salary ? Math.round(r.net_salary) : 0,
        ''
      ]);
      currentRow++;
    }

    // Yellow separator (blank row marker — will need styling in Excel)
    slipData.push([]);
    currentRow++;
    slipData.push(['─', '─', '─', '─', '─', '─', '─', '─', '─', '─', '─', '─']);
    currentRow++;
  }

  const slipSheet = XLSX.utils.aoa_to_sheet(slipData);
  slipSheet['!cols'] = [
    { wch: 5 }, { wch: 8 }, { wch: 22 }, { wch: 20 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }
  ];
  slipSheet['!merges'] = slipMerges;

  // Set print area and page breaks
  slipSheet['!print'] = { area: true };

  XLSX.utils.book_append_sheet(wb, slipSheet, 'SALARY SLIP');

  // Generate buffer and send
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Salary_Slip_${MONTHS[parseInt(month)]}_${year}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
});

/**
 * GET /api/payroll/debug-advance/:code
 * Debug endpoint to trace advance recovery chain
 */
router.get('/debug-advance/:code', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year } = req.query;

  const advByMonth = db.prepare('SELECT * FROM salary_advances WHERE employee_code = ? AND month = ? AND year = ?').all(code, month, year);
  const advByRecovery = db.prepare('SELECT * FROM salary_advances WHERE employee_code = ? AND recovery_month = ? AND recovery_year = ?').all(code, month, year);
  const allAdv = db.prepare('SELECT id, employee_code, month, year, advance_amount, paid, recovered, recovery_month, recovery_year, remark, is_eligible FROM salary_advances WHERE employee_code = ?').all(code);
  const salComp = db.prepare('SELECT employee_code, company, advance_recovery, total_deductions, net_salary, gross_earned FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').all(code, month, year);

  // Simulate the query
  let simulated = 0;
  let simError = null;
  try {
    db.prepare(`UPDATE salary_advances SET recovered = 0 WHERE employee_code = ? AND recovered = 1
      AND ((recovery_month = ? AND recovery_year = ?) OR (month = ? AND year = ? AND recovery_month IS NULL))`).run(code, month, year, month, year);
    const adv = db.prepare(`SELECT SUM(advance_amount) as total FROM salary_advances
      WHERE employee_code = ? AND recovered = 0 AND advance_amount > 0
      AND (remark IS NULL OR remark != 'NO_ADVANCE')
      AND ((recovery_month = ? AND recovery_year = ?) OR (month = ? AND year = ? AND recovery_month IS NULL))`).get(code, month, year, month, year);
    simulated = adv?.total || 0;
  } catch (e) { simError = e.message; }

  const totalAdvCount = db.prepare('SELECT COUNT(*) as cnt FROM salary_advances WHERE month = ? AND year = ?').get(month, year);

  res.json({
    employee_code: code, month, year,
    advances_by_month: advByMonth,
    advances_by_recovery_month: advByRecovery,
    all_advances_for_employee: allAdv,
    salary_computations: salComp,
    simulated_recovery: simulated,
    simulated_error: simError,
    total_advances_this_month: totalAdvCount?.cnt || 0
  });
});

// ═══════════════════════════════════════════════════════════════
// PAYABLE OT / EXTRA DUTY REGISTER
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/payroll/payable-ot
 * OT register — all employees with OT details for a month
 */
router.get('/payable-ot', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const m = parseInt(month);
  const y = parseInt(year);

  const records = db.prepare(`
    SELECT
      sc.employee_code,
      COALESCE(NULLIF(e.name, ''), sc.employee_code) as employee_name,
      e.department, e.designation, e.employment_type,
      dc.days_present, dc.days_half_present, dc.days_wop,
      dc.paid_sundays, dc.paid_holidays, dc.extra_duty_days, dc.total_payable_days,
      sc.gross_salary, sc.ot_pay, sc.ot_days, sc.ot_daily_rate,
      sc.punch_based_ot, sc.finance_extra_duty, sc.ot_note,
      sc.gross_earned, sc.net_salary, sc.total_payable,
      sc.is_finalised, sc.is_contractor, sc.company
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code
      AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status != 'Left')
    ORDER BY sc.ot_days DESC, e.department, e.name
  `).all(...(company ? [m, y, company] : [m, y]));

  const daysInMonth = new Date(y, m, 0).getDate();
  let sundaysInMonth = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() === 0) sundaysInMonth++;
  }
  const standardWorkingDays = daysInMonth - sundaysInMonth;

  const otRecords = records.filter(r => (r.ot_days || 0) > 0);

  const totalOTDays = otRecords.reduce((s, r) => s + (r.ot_days || 0), 0);
  const totalOTPay = otRecords.reduce((s, r) => s + (r.ot_pay || 0), 0);
  const totalPunchOT = otRecords.reduce((s, r) => s + (r.punch_based_ot || 0), 0);
  const totalFinanceED = otRecords.reduce((s, r) => s + (r.finance_extra_duty || 0), 0);

  res.json({
    success: true,
    data: records,
    otRecords,
    summary: {
      totalEmployees: records.length,
      employeesWithOT: otRecords.length,
      employeesWithoutOT: records.length - otRecords.length,
      totalOTDays: Math.round(totalOTDays * 100) / 100,
      totalOTPay: Math.round(totalOTPay * 100) / 100,
      totalPunchOT: Math.round(totalPunchOT * 100) / 100,
      totalFinanceED: Math.round(totalFinanceED * 100) / 100,
      daysInMonth, sundaysInMonth, standardWorkingDays,
      avgOTDailyRate: otRecords.length > 0
        ? Math.round(otRecords.reduce((s, r) => s + (r.ot_daily_rate || 0), 0) / otRecords.length)
        : 0
    }
  });
});

/**
 * POST /api/payroll/grant-extra-duty
 * Finance grants extra duty days to an employee. Stored in day_corrections
 * with correction_type='extra_duty' + finance_verified=1. Reuses the existing
 * correction_delta column for the day count so the NOT NULL constraints on
 * the table are satisfied.
 */
router.post('/grant-extra-duty', (req, res) => {
  const db = getDb();
  const { employeeCode, month, year, days, remark } = req.body;

  if (!employeeCode || !month || !year || !days) {
    return res.status(400).json({ success: false, error: 'employeeCode, month, year, days required' });
  }
  const n = parseFloat(days);
  if (isNaN(n) || n <= 0 || n > 10) {
    return res.status(400).json({ success: false, error: 'days must be a number 1..10' });
  }

  const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  const user = req.user?.username || 'finance';

  try {
    // day_corrections has a UNIQUE(employee_code, month, year, company) constraint.
    // To allow multiple extra-duty grants per employee/month, we must UPDATE the
    // existing row's delta instead of inserting a duplicate. For a fresh employee,
    // INSERT the row with correction_type='extra_duty'.
    const existing = db.prepare(
      "SELECT id, correction_delta, correction_type FROM day_corrections WHERE employee_code = ? AND month = ? AND year = ? AND COALESCE(company, '') = COALESCE(?, '')"
    ).get(employeeCode, month, year, emp.company || '');

    if (existing) {
      // Only add to delta if the existing row is already an extra_duty grant;
      // otherwise refuse to avoid clobbering an unrelated day correction.
      if (existing.correction_type !== 'extra_duty') {
        return res.status(409).json({
          success: false,
          error: 'An existing day correction (non-extra-duty) blocks this grant. Review the Corrections page first.'
        });
      }
      db.prepare(`
        UPDATE day_corrections SET
          correction_delta = COALESCE(correction_delta, 0) + ?,
          corrected_days = COALESCE(corrected_days, 0) + ?,
          remark = ?,
          finance_verified = 1,
          correction_type = 'extra_duty'
        WHERE id = ?
      `).run(n, n, remark || `Extra duty: +${n} day(s) granted by ${user}`, existing.id);
    } else {
      db.prepare(`
        INSERT INTO day_corrections (
          employee_id, employee_code, month, year, company,
          original_system_days, corrected_days, correction_delta,
          correction_reason, correction_notes, corrected_by,
          correction_type, finance_verified, remark
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'EXTRA_DUTY', ?, ?, 'extra_duty', 1, ?)
      `).run(
        emp.id, employeeCode, month, year, emp.company || '',
        n, n,
        remark || `Extra duty: ${n} day(s) granted by finance`,
        user,
        remark || `Extra duty: ${n} day(s) granted by ${user}`
      );
    }

    res.json({ success: true, message: `${n} extra duty day(s) granted to ${employeeCode}. Re-run salary computation to apply.` });
  } catch (e) {
    console.error('grant-extra-duty error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/payroll/revoke-extra-duty/:id
 */
router.delete('/revoke-extra-duty/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM day_corrections WHERE id = ? AND correction_type = 'extra_duty'").get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Extra duty grant not found' });
  db.prepare('DELETE FROM day_corrections WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Extra duty revoked. Re-run salary computation to apply.' });
});

/**
 * GET /api/payroll/extra-duty-grants
 * List finance-verified extra duty grants for a month.
 */
router.get('/extra-duty-grants', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
  const grants = db.prepare(`
    SELECT dc.id, dc.employee_code, dc.month, dc.year, dc.company,
      dc.correction_delta AS days, dc.remark, dc.correction_notes,
      dc.corrected_by AS granted_by, dc.corrected_at,
      COALESCE(e.name, dc.employee_code) as employee_name, e.department
    FROM day_corrections dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    WHERE dc.month = ? AND dc.year = ? AND dc.correction_type = 'extra_duty'
    ORDER BY dc.corrected_at DESC
  `).all(month, year);
  res.json({ success: true, data: grants });
});

module.exports = router;
