const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { calculateDays, saveDayCalculation } = require('../services/dayCalculation');
const { computeEmployeeSalary, saveSalaryComputation, generatePayslipData } = require('../services/salaryComputation');

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

        const calcResult = calculateDays(empCode, parseInt(month), parseInt(year), company || '', records, leaveBalances, holidays);
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
      const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || '');
      if (comp.success) {
        saveSalaryComputation(db, comp);
        results.push(comp);
        if (comp.salaryHeld) held.push({ code: emp.code, name: emp.name, reason: comp.holdReason });
      } else if (comp.excluded) {
        excluded.push({ code: comp.employeeCode, name: emp.name, reason: comp.reason });
      } else {
        errors.push({ employeeCode: emp.code, error: comp.error });
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

  db.prepare(`
    UPDATE salary_computations SET
      advance_recovery = ?, tds = ?, other_deductions = ?,
      total_deductions = pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0),
      net_salary = gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(
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

module.exports = router;
