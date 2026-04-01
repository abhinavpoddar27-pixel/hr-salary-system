const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { generatePFECR, generateESIFile, generateBankFile } = require('../services/exportFormats');

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

module.exports = router;
