const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { getDb } = require('../database/db');
const { generatePFECR, generateESIFile, generateBankFile } = require('../services/exportFormats');

// Role gate — HR / finance / admin may read the leave register.
function requireHrFinanceOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'finance' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR, finance, or admin access required' });
  }
  next();
}

// GET monthly attendance summary
router.get('/attendance-summary', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  // Join with day_calculations for payable days, lop, paid sundays
  const data = db.prepare(`
    SELECT
      ap.employee_code,
      e.name as employee_name, e.department, e.designation,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = 'P'   AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as present_days,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = 'A'   AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as absent_days,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = '½P'  AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as half_days,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = 'WO'  AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as wo_days,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = 'WOP' AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as wop_days,
      SUM(CASE WHEN (COALESCE(ap.status_final, ap.status_original)) = 'WO½P' AND ap.is_night_out_only = 0 THEN 0.5 ELSE 0 END) as wo_half_days,
      SUM(CASE WHEN ap.is_miss_punch = 1 THEN 1 ELSE 0 END) as miss_punch_count,
      SUM(CASE WHEN ap.miss_punch_resolved = 1 THEN 1 ELSE 0 END) as miss_punch_resolved,
      COALESCE(dc.paid_sundays, 0) as paid_sundays,
      COALESCE(dc.lop_days, 0) as lop_days,
      COALESCE(dc.total_payable_days, 0) as total_payable,
      COALESCE(dc.cl_used, 0) as cl_used,
      COALESCE(dc.el_used, 0) as el_used
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    LEFT JOIN day_calculations dc ON dc.employee_code = ap.employee_code AND dc.month = ap.month AND dc.year = ap.year
    WHERE ap.month = ? AND ap.year = ?
    ${company ? 'AND ap.company = ?' : ''}
    AND ap.is_night_out_only = 0
    GROUP BY ap.employee_code
    ORDER BY e.department, e.name
  `).all(...[month, year, company].filter(Boolean));

  res.json({ success: true, data, month, year });
});

// GET miss punch report
router.get('/miss-punch-report', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const data = db.prepare(`
    SELECT ap.id, ap.employee_code, e.name as employee_name, e.department,
           ap.date, ap.miss_punch_type, ap.is_miss_punch,
           ap.in_time_original, ap.out_time_original,
           ap.in_time_final, ap.out_time_final,
           ap.miss_punch_resolved, ap.correction_remark, ap.correction_source,
           ap.status_original, ap.status_final
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_miss_punch = 1
    ORDER BY ap.miss_punch_resolved ASC, e.department, ap.employee_code, ap.date
  `).all(month, year);

  const summary = {
    total: data.length,
    resolved: data.filter(r => r.miss_punch_resolved).length,
    unresolved: data.filter(r => !r.miss_punch_resolved).length,
    byType: data.reduce((acc, r) => {
      acc[r.miss_punch_type] = (acc[r.miss_punch_type] || 0) + 1;
      return acc;
    }, {})
  };

  res.json({ success: true, data, summary, month, year });
});

// GET late coming report
router.get('/late-coming', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const data = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department,
           ap.date, ap.in_time_final, ap.in_time_original,
           ap.late_by_minutes
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1
    ORDER BY e.department, ap.employee_code, ap.date
  `).all(month, year);

  res.json({ success: true, data, month, year });
});

// GET overtime report
router.get('/overtime', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const data = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department,
           SUM(ap.overtime_minutes) / 60.0 as total_ot_hours,
           COUNT(CASE WHEN ap.overtime_minutes > 0 THEN 1 END) as ot_days,
           AVG(CASE WHEN ap.overtime_minutes > 0 THEN ap.overtime_minutes / 60.0 END) as avg_ot_hours
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.overtime_minutes > 0
    GROUP BY ap.employee_code
    ORDER BY total_ot_hours DESC
  `).all(month, year);

  res.json({ success: true, data, month, year });
});

// GET PF monthly statement
router.get('/pf-statement', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const employees = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.uan, e.pf_number, e.department,
           sc.pf_wages,
           sc.pf_employee as employee_pf,
           sc.pf_employer as employer_pf,
           sc.eps,
           COALESCE(sc.pf_employee, 0) + COALESCE(sc.pf_employer, 0) + COALESCE(sc.eps, 0) as total
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND (COALESCE(sc.pf_employee,0) + COALESCE(sc.pf_employer,0)) > 0
    ORDER BY e.department, e.name
  `).all(month, year);

  const totals = {
    pfWages: employees.reduce((s, r) => s + (r.pf_wages || 0), 0),
    employeePF: employees.reduce((s, r) => s + (r.employee_pf || 0), 0),
    employerPF: employees.reduce((s, r) => s + (r.employer_pf || 0), 0),
    eps: employees.reduce((s, r) => s + (r.eps || 0), 0),
    total: employees.reduce((s, r) => s + (r.total || 0), 0)
  };

  res.json({ success: true, data: { employees, totals }, month, year });
});

// GET ESI statement
router.get('/esi-statement', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const employees = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.esi_number, e.department,
           sc.esi_wages,
           sc.esi_employee as employee_esi,
           sc.esi_employer as employer_esi,
           COALESCE(sc.esi_employee, 0) + COALESCE(sc.esi_employer, 0) as total
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND (COALESCE(sc.esi_employee,0) + COALESCE(sc.esi_employer,0)) > 0
    ORDER BY e.department, e.name
  `).all(month, year);

  const totals = {
    esiWages: employees.reduce((s, r) => s + (r.esi_wages || 0), 0),
    employeeESI: employees.reduce((s, r) => s + (r.employee_esi || 0), 0),
    employerESI: employees.reduce((s, r) => s + (r.employer_esi || 0), 0),
    total: employees.reduce((s, r) => s + (r.total || 0), 0)
  };

  res.json({ success: true, data: { employees, totals }, month, year });
});

// GET bank transfer sheet (NEFT)
router.get('/bank-transfer', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const data = db.prepare(`
    SELECT sc.employee_code,
           e.name as employee_name,
           COALESCE(e.account_number, e.bank_account) as account_number,
           COALESCE(e.ifsc_code, e.ifsc) as ifsc_code,
           e.bank_name, e.department,
           sc.net_salary as net_pay
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND sc.net_salary > 0
    ${company ? 'AND sc.company = ?' : ''}
    ORDER BY e.department, e.name
  `).all(...[month, year, company].filter(Boolean));

  res.json({
    success: true,
    data,
    totalAmount: data.reduce((s, r) => s + (r.net_pay || 0), 0),
    count: data.length,
    month, year
  });
});

// GET headcount report
router.get('/headcount', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  const data = db.prepare(`
    SELECT e.department, e.company, e.employment_type,
           COUNT(DISTINCT ap.employee_code) as headcount
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    GROUP BY e.department, e.company, e.employment_type
    ORDER BY e.department
  `).all(month, year);

  res.json({ success: true, data, month, year });
});

// GET audit trail
router.get('/audit-trail', (req, res) => {
  const db = getDb();
  const { month, year, employeeCode, stage } = req.query;

  let query = `SELECT al.*
    FROM audit_log al
    WHERE 1=1`;
  const params = [];

  if (stage) { query += ' AND al.stage = ?'; params.push(stage); }
  if (employeeCode) { query += ' AND al.remark LIKE ?'; params.push(`%${employeeCode}%`); }

  query += ' ORDER BY al.changed_at DESC LIMIT 1000';

  const data = db.prepare(query).all(...params);
  res.json({ success: true, data });
});

// GET PF ECR file (EPFO format)
router.get('/pf-ecr', (req, res) => {
  const db = getDb();
  const { month, year, company, download } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const result = generatePFECR(db, parseInt(month), parseInt(year), company);

  if (download === 'true') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.content);
  }

  res.json({ success: true, data: result.employees, totals: result.totals, filename: result.filename, month, year });
});

// GET ESI contribution file (ESIC format)
router.get('/esi-contribution', (req, res) => {
  const db = getDb();
  const { month, year, company, download } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const result = generateESIFile(db, parseInt(month), parseInt(year), company);

  if (download === 'true') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.content);
  }

  res.json({ success: true, data: result.employees, totals: result.totals, filename: result.filename, month, year });
});

// GET bank salary upload file (PNB/generic CSV format)
router.get('/bank-salary-file', (req, res) => {
  const db = getDb();
  const { month, year, company, download } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const result = generateBankFile(db, parseInt(month), parseInt(year), company);

  if (download === 'true') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.content);
  }

  res.json({
    success: true,
    data: result.employees,
    missing: result.missing,
    totals: result.totals,
    filename: result.filename,
    month, year
  });
});

// GET company config (for export headers, PF/ESI codes)
router.get('/company-config', (req, res) => {
  const db = getDb();
  const { company } = req.query;

  if (company) {
    const config = db.prepare('SELECT * FROM company_config WHERE company_name = ?').get(company);
    return res.json({ success: true, data: config });
  }

  const configs = db.prepare('SELECT * FROM company_config ORDER BY company_name').all();
  res.json({ success: true, data: configs });
});

// PUT company config
router.put('/company-config/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const fields = ['short_name', 'pf_establishment_code', 'esi_code', 'address_line1', 'address_line2',
    'city', 'state', 'pin', 'pan', 'tan', 'bank_name', 'bank_account', 'bank_ifsc'];

  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

  values.push(id);
  db.prepare(`UPDATE company_config SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true, message: 'Company config updated' });
});

// GET department payroll cost centre
router.get('/department-payroll', (req, res) => {
  try {
    const db = getDb();
    const { month, year, company } = req.query;
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

    const params = [parseInt(month), parseInt(year)];
    if (company) params.push(company);

    const rows = db.prepare(`
      SELECT
        e.department,
        COUNT(DISTINCT sc.employee_code) as headcount,
        COALESCE(SUM(sc.gross_salary), 0) as total_gross_ctc,
        COALESCE(SUM(sc.gross_earned), 0) as total_gross_earned,
        COALESCE(SUM(sc.basic_earned), 0) as total_basic,
        COALESCE(SUM(sc.da_earned), 0) as total_da,
        COALESCE(SUM(sc.hra_earned), 0) as total_hra,
        COALESCE(SUM(sc.conveyance_earned), 0) as total_conv,
        COALESCE(SUM(sc.other_allowances_earned), 0) as total_other,
        COALESCE(SUM(sc.ot_pay), 0) as total_ot,
        COALESCE(SUM(COALESCE(sc.ed_pay, 0)), 0) as total_ed,
        COALESCE(SUM(sc.holiday_duty_pay), 0) as total_holiday_duty,
        COALESCE(SUM(sc.pf_employee), 0) as total_pf_ee,
        COALESCE(SUM(sc.pf_employer), 0) as total_pf_er,
        COALESCE(SUM(sc.esi_employee), 0) as total_esi_ee,
        COALESCE(SUM(sc.esi_employer), 0) as total_esi_er,
        COALESCE(SUM(sc.professional_tax), 0) as total_pt,
        COALESCE(SUM(sc.total_deductions), 0) as total_deductions,
        COALESCE(SUM(sc.net_salary), 0) as total_net_salary,
        COALESCE(SUM(sc.total_payable), 0) as total_payable,
        COALESCE(SUM(COALESCE(sc.take_home, sc.total_payable)), 0) as total_take_home,
        SUM(CASE WHEN sc.salary_held = 1 THEN 1 ELSE 0 END) as held_count
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ?
        ${company ? 'AND sc.company = ?' : ''}
        AND (e.status IS NULL OR e.status NOT IN ('Exited'))
      GROUP BY e.department
      ORDER BY total_gross_earned DESC
    `).all(...params);

    const grandTotalGrossEarned = rows.reduce((s, r) => s + r.total_gross_earned, 0);

    const departments = rows.map(r => ({
      department: r.department || 'Unknown',
      headcount: r.headcount,
      grossCTC: Math.round(r.total_gross_ctc),
      grossEarned: Math.round(r.total_gross_earned),
      basic: Math.round(r.total_basic),
      da: Math.round(r.total_da),
      hra: Math.round(r.total_hra),
      conveyance: Math.round(r.total_conv),
      otherAllowances: Math.round(r.total_other),
      otPay: Math.round(r.total_ot),
      edPay: Math.round(r.total_ed),
      holidayDuty: Math.round(r.total_holiday_duty),
      pfEmployee: Math.round(r.total_pf_ee),
      pfEmployer: Math.round(r.total_pf_er),
      esiEmployee: Math.round(r.total_esi_ee),
      esiEmployer: Math.round(r.total_esi_er),
      professionalTax: Math.round(r.total_pt),
      totalDeductions: Math.round(r.total_deductions),
      netSalary: Math.round(r.total_net_salary),
      totalPayable: Math.round(r.total_payable),
      takeHome: Math.round(r.total_take_home),
      perEmployeeCost: r.headcount > 0 ? Math.round(r.total_gross_earned / r.headcount) : 0,
      totalCTC: Math.round(r.total_gross_ctc + r.total_pf_er + r.total_esi_er),
      heldCount: r.held_count || 0,
      costShare: grandTotalGrossEarned > 0
        ? Math.round(r.total_gross_earned / grandTotalGrossEarned * 1000) / 10
        : 0
    }));

    const grandTotals = {
      headcount: departments.reduce((s, d) => s + d.headcount, 0),
      grossCTC: departments.reduce((s, d) => s + d.grossCTC, 0),
      grossEarned: departments.reduce((s, d) => s + d.grossEarned, 0),
      netSalary: departments.reduce((s, d) => s + d.netSalary, 0),
      pfEmployee: departments.reduce((s, d) => s + d.pfEmployee, 0),
      pfEmployer: departments.reduce((s, d) => s + d.pfEmployer, 0),
      esiEmployee: departments.reduce((s, d) => s + d.esiEmployee, 0),
      esiEmployer: departments.reduce((s, d) => s + d.esiEmployer, 0),
      totalDeductions: departments.reduce((s, d) => s + d.totalDeductions, 0),
      totalCTC: departments.reduce((s, d) => s + d.totalCTC, 0)
    };

    res.json({ success: true, data: { departments, grandTotals }, month: parseInt(month), year: parseInt(year) });
  } catch (err) {
    console.error('Department payroll error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute department payroll: ' + err.message });
  }
});

// ─── Leave Register (April 2026, Phase 3) ─────────────────────────────────
// GET /leave-register?format=monthly|annual&month=MM&year=YYYY[&company=...][&download=xlsx]
//
// • monthly  — one row per employee for the given month; pulls CL/EL/LWP/OD
//              /short-leave/uninformed-absent straight off day_calculations
//              (already populated by the Stage-6 leave post-processing).
// • annual   — one row per employee for the given year; CL/EL opening /
//              accrued / used / lapsed / closing comes from
//              leave_accrual_ledger (closing = latest month's closing),
//              LWP/OD/short-leave/uninformed are summed across
//              day_calculations for the year.
//
// Pass ?download=xlsx to stream an XLSX file. Otherwise responds with JSON.
router.get('/leave-register', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { format = 'monthly', month, year, company, download } = req.query;
    if (!year) return res.status(400).json({ success: false, error: 'year is required' });
    if (format === 'monthly' && !month) {
      return res.status(400).json({ success: false, error: 'month is required for monthly format' });
    }
    if (format !== 'monthly' && format !== 'annual') {
      return res.status(400).json({ success: false, error: "format must be 'monthly' or 'annual'" });
    }

    let rows = [];
    let headers = [];
    let sheetName = '';
    let filename = '';

    if (format === 'monthly') {
      const params = [parseInt(month), parseInt(year)];
      let companyClause = '';
      if (company) { companyClause = 'AND dc.company = ?'; params.push(company); }

      rows = db.prepare(`
        SELECT dc.employee_code,
               COALESCE(e.name, dc.employee_code) AS name,
               e.department, e.designation, dc.company,
               COALESCE(dc.cl_used, 0)           AS cl_used,
               COALESCE(dc.el_used, 0)           AS el_used,
               COALESCE(dc.lop_days, 0)          AS lwp_days,
               COALESCE(dc.od_days, 0)           AS od_days,
               COALESCE(dc.short_leave_days, 0)  AS short_leave_days,
               COALESCE(dc.uninformed_absent, 0) AS uninformed_absent,
               COALESCE(dc.total_payable_days, 0) AS payable_days,
               COALESCE(dc.days_absent, 0)       AS days_absent
        FROM day_calculations dc
        LEFT JOIN employees e ON dc.employee_code = e.code
        WHERE dc.month = ? AND dc.year = ?
          ${companyClause}
        ORDER BY e.department, e.name
      `).all(...params);

      headers = [
        'Employee Code', 'Name', 'Department', 'Designation', 'Company',
        'CL Used', 'EL Used', 'LWP Days', 'OD Days',
        'Short Leave Days', 'Uninformed Absent', 'Days Absent', 'Payable Days'
      ];
      sheetName = 'Leave Register (Monthly)';
      filename = `leave_register_monthly_${year}_${String(month).padStart(2, '0')}.xlsx`;
    } else {
      // annual
      const params = [parseInt(year)];
      let companyClause = '';
      if (company) { companyClause = 'AND dc.company = ?'; params.push(company); }

      const aggregates = db.prepare(`
        SELECT dc.employee_code,
               COALESCE(e.name, dc.employee_code) AS name,
               e.department, e.designation, dc.company,
               SUM(COALESCE(dc.lop_days, 0))          AS lwp_days,
               SUM(COALESCE(dc.od_days, 0))           AS od_days,
               SUM(COALESCE(dc.short_leave_days, 0))  AS short_leave_days,
               SUM(COALESCE(dc.uninformed_absent, 0)) AS uninformed_absent,
               SUM(COALESCE(dc.cl_used, 0))           AS cl_used_ytd,
               SUM(COALESCE(dc.el_used, 0))           AS el_used_ytd
        FROM day_calculations dc
        LEFT JOIN employees e ON dc.employee_code = e.code
        WHERE dc.year = ?
          ${companyClause}
        GROUP BY dc.employee_code, e.name, e.department, e.designation, dc.company
        ORDER BY e.department, e.name
      `).all(...params);

      // Fetch per-employee CL / EL accrual ledger once for the year.
      // Opening = Jan's opening, closing = latest month's closing.
      // Accrued / used / lapsed = sums across the year.
      const ledger = db.prepare(`
        SELECT employee_code, leave_type,
               SUM(accrued)  AS accrued_total,
               SUM(used)     AS used_total,
               SUM(lapsed)   AS lapsed_total,
               MIN(month)    AS first_month,
               MAX(month)    AS last_month
        FROM leave_accrual_ledger
        WHERE year = ?
        GROUP BY employee_code, leave_type
      `).all(parseInt(year));

      const firstMonthStmt = db.prepare(`
        SELECT opening_balance FROM leave_accrual_ledger
        WHERE employee_code = ? AND year = ? AND leave_type = ? AND month = ?
      `);
      const lastMonthStmt = db.prepare(`
        SELECT closing_balance FROM leave_accrual_ledger
        WHERE employee_code = ? AND year = ? AND leave_type = ? AND month = ?
      `);

      const ledgerMap = {};
      for (const l of ledger) {
        const key = l.employee_code;
        if (!ledgerMap[key]) ledgerMap[key] = {};
        const opening = firstMonthStmt.get(l.employee_code, parseInt(year), l.leave_type, l.first_month);
        const closing = lastMonthStmt.get(l.employee_code, parseInt(year), l.leave_type, l.last_month);
        ledgerMap[key][l.leave_type] = {
          opening: opening?.opening_balance || 0,
          accrued: l.accrued_total || 0,
          used: l.used_total || 0,
          lapsed: l.lapsed_total || 0,
          closing: closing?.closing_balance || 0
        };
      }

      rows = aggregates.map(a => {
        const lg = ledgerMap[a.employee_code] || {};
        const cl = lg.CL || { opening: 0, accrued: 0, used: a.cl_used_ytd || 0, lapsed: 0, closing: 0 };
        const el = lg.EL || { opening: 0, accrued: 0, used: a.el_used_ytd || 0, lapsed: 0, closing: 0 };
        return {
          employee_code: a.employee_code,
          name: a.name,
          department: a.department,
          designation: a.designation,
          company: a.company,
          cl_opening: cl.opening, cl_accrued: cl.accrued,
          cl_used: cl.used,       cl_lapsed: cl.lapsed,  cl_closing: cl.closing,
          el_opening: el.opening, el_accrued: el.accrued,
          el_used: el.used,       el_lapsed: el.lapsed,  el_closing: el.closing,
          lwp_days: a.lwp_days || 0,
          od_days: a.od_days || 0,
          short_leave_days: a.short_leave_days || 0,
          uninformed_absent: a.uninformed_absent || 0
        };
      });

      headers = [
        'Employee Code', 'Name', 'Department', 'Designation', 'Company',
        'CL Opening', 'CL Accrued', 'CL Used', 'CL Lapsed', 'CL Closing',
        'EL Opening', 'EL Accrued', 'EL Used', 'EL Lapsed', 'EL Closing',
        'LWP Days (YTD)', 'OD Days (YTD)', 'Short Leave Days (YTD)', 'Uninformed Absent (YTD)'
      ];
      sheetName = 'Leave Register (Annual)';
      filename = `leave_register_annual_${year}.xlsx`;
    }

    if (String(download).toLowerCase() === 'xlsx') {
      const data = [headers];
      for (const r of rows) {
        if (format === 'monthly') {
          data.push([
            r.employee_code, r.name, r.department || '', r.designation || '', r.company || '',
            Number(r.cl_used) || 0, Number(r.el_used) || 0, Number(r.lwp_days) || 0,
            Number(r.od_days) || 0, Number(r.short_leave_days) || 0,
            Number(r.uninformed_absent) || 0, Number(r.days_absent) || 0,
            Number(r.payable_days) || 0
          ]);
        } else {
          data.push([
            r.employee_code, r.name, r.department || '', r.designation || '', r.company || '',
            Number(r.cl_opening) || 0, Number(r.cl_accrued) || 0, Number(r.cl_used) || 0,
            Number(r.cl_lapsed) || 0, Number(r.cl_closing) || 0,
            Number(r.el_opening) || 0, Number(r.el_accrued) || 0, Number(r.el_used) || 0,
            Number(r.el_lapsed) || 0, Number(r.el_closing) || 0,
            Number(r.lwp_days) || 0, Number(r.od_days) || 0,
            Number(r.short_leave_days) || 0, Number(r.uninformed_absent) || 0
          ]);
        }
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(buf);
    }

    res.json({
      success: true,
      format,
      month: month ? parseInt(month) : null,
      year: parseInt(year),
      company: company || null,
      count: rows.length,
      data: rows
    });
  } catch (err) {
    console.error('[leave-register] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to build leave register: ' + err.message });
  }
});

module.exports = router;
