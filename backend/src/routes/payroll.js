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

  const empCodes = db.prepare(`
    SELECT DISTINCT employee_code
    FROM attendance_processed
    WHERE month = ? AND year = ? ${company ? 'AND company = ?' : ''}
    AND is_night_out_only = 0
  `).all(...[month, year, company].filter(Boolean)).map(r => r.employee_code);

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
    SELECT dc.*, e.name as employee_name, e.department, e.designation
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    ORDER BY e.department, e.name
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
    SELECT dc.*, e.name as employee_name, e.department
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
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

  const employees = db.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    INNER JOIN day_calculations dc ON e.code = dc.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
  `).all(...[month, year, company].filter(Boolean));

  const results = [];
  const errors = [];
  const excluded = [];
  const held = [];

  const txn = db.transaction(() => {
    for (const emp of employees) {
      const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || emp.company || '');
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
    SELECT sc.*, e.name as employee_name, e.department, e.designation,
           e.bank_account, e.ifsc,
           dc.total_payable_days, dc.days_present, dc.days_absent, dc.lop_days, dc.paid_sundays,
           dc.days_half_present, dc.ot_hours
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    ORDER BY e.department, e.name
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

module.exports = router;
