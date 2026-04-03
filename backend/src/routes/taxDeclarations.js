const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { calculateMonthlyTDS } = require('../services/tdsCalculation');

router.get('/:employeeCode', (req, res) => {
  const db = getDb();
  const { employeeCode } = req.params;
  const { financial_year } = req.query;
  const fy = financial_year || '2025-26';
  const decl = db.prepare('SELECT * FROM tax_declarations WHERE employee_code = ? AND financial_year = ?').get(employeeCode, fy);
  res.json({ success: true, data: decl || null });
});

router.put('/:employeeCode', (req, res) => {
  const db = getDb();
  const { employeeCode } = req.params;
  const { financial_year, regime, section_80c, section_80d, hra_exemption, other_exemptions } = req.body;
  const fy = financial_year || '2025-26';

  db.prepare(`INSERT INTO tax_declarations (employee_code, financial_year, regime, section_80c, section_80d, hra_exemption, other_exemptions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_code, financial_year) DO UPDATE SET
      regime = excluded.regime, section_80c = excluded.section_80c, section_80d = excluded.section_80d,
      hra_exemption = excluded.hra_exemption, other_exemptions = excluded.other_exemptions,
      updated_at = datetime('now')
  `).run(employeeCode, fy, regime || 'new', section_80c || 0, section_80d || 0, hra_exemption || 0, other_exemptions || 0);

  // Calculate projected TDS
  const emp = db.prepare(`SELECT ss.gross_salary FROM employees e
    JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.code = ? ORDER BY ss.effective_from DESC LIMIT 1`).get(employeeCode);
  const grossMonthly = emp?.gross_salary || 0;
  const tds = calculateMonthlyTDS(db, employeeCode, grossMonthly, fy);

  res.json({ success: true, tds });
});

router.get('/:employeeCode/calculate', (req, res) => {
  const db = getDb();
  const { employeeCode } = req.params;
  const { financial_year } = req.query;
  const fy = financial_year || '2025-26';

  const emp = db.prepare(`SELECT ss.gross_salary FROM employees e
    JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.code = ? ORDER BY ss.effective_from DESC LIMIT 1`).get(employeeCode);
  const grossMonthly = emp?.gross_salary || 0;
  const tds = calculateMonthlyTDS(db, employeeCode, grossMonthly, fy);

  res.json({ success: true, data: tds });
});

module.exports = router;
