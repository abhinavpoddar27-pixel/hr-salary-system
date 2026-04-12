/**
 * Salary Sanity Check Service
 * Runs 5 read-only checks against salary_computations after Stage 7.
 * Never modifies data. All queries use COALESCE to handle NULLs gracefully.
 */

const { getDb } = require('../database/db');

/**
 * Run all 5 sanity checks for a given month/year/company.
 * Returns a structured result object — never throws.
 *
 * @param {number} month
 * @param {number} year
 * @param {string} company  (empty string = all companies)
 * @returns {object}
 */
function runSanityCheck(month, year, company) {
  const db = getDb();
  const companyFilter = company ? 'AND sc.company = ?' : '';
  const params = [month, year, ...(company ? [company] : [])];

  // Count of rows we're checking
  let totalEmployees = 0;
  try {
    const countRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM salary_computations sc
      WHERE sc.month = ? AND sc.year = ?
      ${company ? 'AND sc.company = ?' : ''}
    `).get(...params);
    totalEmployees = countRow ? countRow.cnt : 0;
  } catch (e) {
    // If even the count fails, return a minimal error object
    return {
      timestamp: new Date().toISOString(),
      month, year, company,
      totalEmployees: 0,
      allPassed: false,
      passedCount: 0,
      failedCount: 0,
      checks: [],
      error: `Could not query salary_computations: ${e.message}`
    };
  }

  const checks = [];

  // ── Check 1: Drift — net_salary ≈ gross_earned - total_deductions ──
  checks.push(runCheck({
    id: 'drift',
    name: 'Net = Gross Earned − Deductions',
    db,
    sql: `
      SELECT sc.employee_code,
             COALESCE(e.name, sc.employee_code) AS name,
             ROUND(sc.net_salary, 2) AS net_salary,
             ROUND(sc.gross_earned, 2) AS gross_earned,
             ROUND(sc.total_deductions, 2) AS total_deductions,
             ROUND(ABS(COALESCE(sc.net_salary, 0) - (COALESCE(sc.gross_earned, 0) - COALESCE(sc.total_deductions, 0))), 2) AS drift
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ?
        ${companyFilter}
        AND ABS(COALESCE(sc.net_salary, 0) - (COALESCE(sc.gross_earned, 0) - COALESCE(sc.total_deductions, 0))) > 1
      ORDER BY drift DESC
    `,
    params,
    formatFailure: row => ({
      employee_code: row.employee_code,
      name: row.name,
      net_salary: row.net_salary,
      gross_earned: row.gross_earned,
      total_deductions: row.total_deductions,
      drift: row.drift
    })
  }));

  // ── Check 2: Payable Days > 31 ──
  checks.push(runCheck({
    id: 'payable_days',
    name: 'Payable Days ≤ 31',
    db,
    sql: `
      SELECT sc.employee_code,
             COALESCE(e.name, sc.employee_code) AS name,
             ROUND(COALESCE(sc.payable_days, 0), 2) AS payable_days
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ?
        ${companyFilter}
        AND COALESCE(sc.payable_days, 0) > 31
    `,
    params,
    formatFailure: row => ({
      employee_code: row.employee_code,
      name: row.name,
      payable_days: row.payable_days
    })
  }));

  // ── Check 3: Earned Ratio > 1.0 (base only — employees with zero OT and ED) ──
  checks.push(runCheck({
    id: 'earned_ratio',
    name: 'Earned Ratio ≤ 1.0 (base components)',
    db,
    sql: `
      SELECT sc.employee_code,
             COALESCE(e.name, sc.employee_code) AS name,
             ROUND(sc.gross_earned, 2) AS gross_earned,
             ROUND(COALESCE(e.gross_salary, ss.gross_salary, 0), 2) AS gross_monthly,
             ROUND(
               CASE WHEN COALESCE(e.gross_salary, ss.gross_salary, 0) > 0
                 THEN sc.gross_earned * 1.0 / COALESCE(e.gross_salary, ss.gross_salary, 1)
                 ELSE 0
               END,
               4
             ) AS earned_ratio
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      LEFT JOIN salary_structures ss ON ss.employee_id = e.id
      WHERE sc.month = ? AND sc.year = ?
        ${companyFilter}
        AND COALESCE(sc.ot_pay, 0) = 0
        AND COALESCE(sc.ed_pay, 0) = 0
        AND COALESCE(e.gross_salary, ss.gross_salary, 0) > 0
        AND sc.gross_earned > COALESCE(e.gross_salary, ss.gross_salary, 0) * 1.02
    `,
    params,
    formatFailure: row => ({
      employee_code: row.employee_code,
      name: row.name,
      gross_earned: row.gross_earned,
      gross_monthly: row.gross_monthly,
      earned_ratio: row.earned_ratio
    })
  }));

  // ── Check 4: Active employees with zero salary ──
  checks.push(runCheck({
    id: 'zero_salary',
    name: 'No Active Employee with ₹0 Salary',
    db,
    sql: `
      SELECT sc.employee_code,
             COALESCE(e.name, sc.employee_code) AS name,
             COALESCE(e.department, '') AS department
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ?
        ${companyFilter}
        AND COALESCE(e.status, 'Active') = 'Active'
        AND (sc.net_salary IS NULL OR sc.net_salary = 0)
        AND (sc.gross_earned IS NULL OR sc.gross_earned = 0)
    `,
    params,
    formatFailure: row => ({
      employee_code: row.employee_code,
      name: row.name,
      department: row.department
    })
  }));

  // ── Check 5: Negative net salary ──
  checks.push(runCheck({
    id: 'negative_net',
    name: 'No Negative Net Salary',
    db,
    sql: `
      SELECT sc.employee_code,
             COALESCE(e.name, sc.employee_code) AS name,
             ROUND(sc.net_salary, 2) AS net_salary,
             ROUND(COALESCE(sc.gross_earned, 0), 2) AS gross_earned,
             ROUND(COALESCE(sc.total_deductions, 0), 2) AS total_deductions
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE sc.month = ? AND sc.year = ?
        ${companyFilter}
        AND sc.net_salary < 0
    `,
    params,
    formatFailure: row => ({
      employee_code: row.employee_code,
      name: row.name,
      net_salary: row.net_salary,
      gross_earned: row.gross_earned,
      total_deductions: row.total_deductions
    })
  }));

  const passedCount = checks.filter(c => c.status === 'PASS').length;
  const failedCount = checks.filter(c => c.status === 'FAIL').length;

  return {
    timestamp: new Date().toISOString(),
    month,
    year,
    company: company || '',
    totalEmployees,
    allPassed: failedCount === 0,
    passedCount,
    failedCount,
    checks
  };
}

/**
 * Execute a single check query and return a check result object.
 * Catches SQL errors — returns status:'ERROR' rather than crashing.
 */
function runCheck({ id, name, db, sql, params, formatFailure }) {
  try {
    const rows = db.prepare(sql).all(...params);
    if (rows.length === 0) {
      return { id, name, status: 'PASS', failCount: 0, failures: [] };
    }
    return {
      id,
      name,
      status: 'FAIL',
      failCount: rows.length,
      failures: rows.map(formatFailure)
    };
  } catch (e) {
    return {
      id,
      name,
      status: 'ERROR',
      failCount: 0,
      failures: [],
      error: e.message
    };
  }
}

module.exports = { runSanityCheck };
