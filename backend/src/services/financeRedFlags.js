/**
 * Finance Red Flag Detection Engine
 * Detects anomalies in salary data for finance audit review.
 */

function detectRedFlags(db, month, year) {
  const flags = [];
  let id = 0;

  const mkFlag = (type, severity, empCode, empName, dept, desc, details, action) => ({
    id: `rf_${++id}`, type, severity,
    employeeCode: empCode, employeeName: empName, department: dept,
    description: desc, details, suggestedAction: action
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
      SELECT sc.employee_code, e.name, e.department, sc.hold_reason
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.salary_held = 1
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('salary_held', 'info', r.employee_code, r.name, r.department,
        `Salary on hold: ${r.hold_reason}`, {},
        'Review hold reason and decide whether to release'));
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
      SELECT sc.employee_code, e.name, e.department, sc.advance_recovery, sc.net_salary
      FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ? AND sc.advance_recovery > sc.net_salary * 0.5 AND sc.advance_recovery > 0
    `).all(month, year);
    for (const r of rows) {
      flags.push(mkFlag('advance_exceeds_net', 'warning', r.employee_code, r.name, r.department,
        `Advance ₹${r.advance_recovery} is > 50% of net ₹${r.net_salary}`,
        { advance: r.advance_recovery, net: r.net_salary },
        'Verify advance recovery amount'));
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

  // Sort: critical first, then warning, then info
  const sev = { critical: 0, warning: 1, info: 2 };
  flags.sort((a, b) => (sev[a.severity] || 9) - (sev[b.severity] || 9));

  return flags;
}

module.exports = { detectRedFlags };
