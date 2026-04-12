const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { SCHEMA_REFERENCE } = require('../config/schemaReference');

const MAX_ROWS = 100;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Admin-only gate — applied to ALL routes in this file ────
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
});

// ── Validate SQL is safe (SELECT only) ──────────────────────
function validateSQL(sql) {
  const trimmed = sql.trim().replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const upper = trimmed.toUpperCase();

  // Must start with SELECT or WITH (for CTEs)
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { safe: false, reason: 'Only SELECT queries are allowed' };
  }

  // Block dangerous keywords anywhere in the query
  const blocked = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
                   'REPLACE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX'];
  for (const kw of blocked) {
    // Match as whole word (not inside column names like "updated_at")
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(trimmed)) {
      return { safe: false, reason: `Blocked keyword: ${kw}` };
    }
  }

  return { safe: true };
}

// ── Translate English to SQL via Anthropic API ──────────────
async function translateToSQL(question, month, year) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set. Natural language mode requires this key. Use "Paste SQL" mode instead.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a SQL query generator for a SQLite HR/payroll database. Given a natural language question, return ONLY a valid SQLite SELECT query. No explanation, no markdown, no backticks — just the raw SQL.

Rules:
- Only SELECT queries. Never INSERT/UPDATE/DELETE.
- Always LIMIT results to ${MAX_ROWS} unless the user specifies a different limit.
- When the user mentions a month/year, use month=${month} AND year=${year} unless they specify differently.
- Use the correct table and column names from the schema below.
- For "employees" queries, default to status='Active' unless the user asks about inactive/left employees.
- For money comparisons, values are in INR (Indian Rupees).
- Join tables using the patterns specified in the schema.
- Use ROUND() for money values to 2 decimal places.
- Always include employee_code and employee name in results for identification.

${SCHEMA_REFERENCE}`,
      messages: [{ role: 'user', content: question }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const sql = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('')
    .trim();

  return sql;
}

// ── POST /api/query-tool/run ────────────────────────────────
// Body: { mode: 'natural' | 'sql', query: string, month?: number, year?: number }
router.post('/run', async (req, res) => {
  try {
    const { mode, query, month, year } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }

    let sql;

    if (mode === 'sql') {
      // Raw SQL mode — user pasted SQL directly
      sql = query.trim();
    } else {
      // Natural language mode — translate via Claude
      const currentMonth = month || new Date().getMonth() + 1;
      const currentYear = year || new Date().getFullYear();
      sql = await translateToSQL(query.trim(), currentMonth, currentYear);
    }

    // Safety check
    const validation = validateSQL(sql);
    if (!validation.safe) {
      return res.status(400).json({
        success: false,
        error: validation.reason,
        sql: sql
      });
    }

    // Enforce row limit
    const upperSQL = sql.toUpperCase();
    if (!upperSQL.includes('LIMIT')) {
      sql = sql.replace(/;?\s*$/, '') + ` LIMIT ${MAX_ROWS}`;
    }

    // Execute
    const db = getDb();
    const startTime = Date.now();
    const rows = db.prepare(sql).all();
    const duration = Date.now() - startTime;

    // Extract column names from first row
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    res.json({
      success: true,
      sql: sql,
      columns: columns,
      rows: rows,
      rowCount: rows.length,
      truncated: rows.length >= MAX_ROWS,
      duration: duration
    });

  } catch (err) {
    console.error('[QueryTool] Error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      sql: req.body?.mode === 'sql' ? req.body.query : undefined
    });
  }
});

// ── GET /api/query-tool/saved ────────────────────────────────
// Returns the preset diagnostic queries
router.get('/saved', (req, res) => {
  const saved = [
    {
      id: 'drift-check',
      name: 'Net Salary Drift Check',
      description: 'Employees where net_salary \u2260 gross_earned \u2212 total_deductions',
      query: `SELECT sc.employee_code, e.name, e.department, sc.net_salary,
        sc.gross_earned, sc.total_deductions,
        ROUND(ABS(sc.net_salary - (sc.gross_earned - sc.total_deductions)), 2) AS drift
      FROM salary_computations sc
      JOIN employees e ON e.code = sc.employee_code
      WHERE sc.month = :month AND sc.year = :year
        AND ABS(sc.net_salary - (sc.gross_earned - sc.total_deductions)) > 1
      ORDER BY drift DESC LIMIT 50`
    },
    {
      id: 'payable-over-31',
      name: 'Payable Days > 31',
      description: 'Employees with more payable days than calendar days',
      query: `SELECT dc.employee_code, e.name, e.department,
        dc.days_present, dc.paid_sundays, dc.paid_holidays, dc.days_wop,
        dc.total_payable_days, dc.ot_hours
      FROM day_calculations dc
      JOIN employees e ON e.code = dc.employee_code
      WHERE dc.month = :month AND dc.year = :year
        AND dc.total_payable_days > 31
      ORDER BY dc.total_payable_days DESC`
    },
    {
      id: 'deduction-completeness',
      name: 'Zero Deductions Check',
      description: 'Active employees with gross > 15000 but zero total deductions',
      query: `SELECT sc.employee_code, e.name, e.department,
        sc.gross_salary, sc.gross_earned, sc.total_deductions,
        sc.pf_employee, sc.esi_employee, sc.advance_recovery
      FROM salary_computations sc
      JOIN employees e ON e.code = sc.employee_code
      WHERE sc.month = :month AND sc.year = :year
        AND sc.gross_salary > 15000
        AND sc.total_deductions = 0
        AND e.status = 'Active'
      ORDER BY sc.gross_salary DESC`
    },
    {
      id: 'ed-stuck',
      name: 'Extra Duty Grants Stuck',
      description: 'HR-approved grants not yet finance-approved',
      query: `SELECT edg.employee_code, e.name, e.department,
        edg.grant_date, edg.duty_days, edg.grant_type,
        edg.status AS hr_status, edg.finance_status,
        edg.requested_by, edg.remarks
      FROM extra_duty_grants edg
      JOIN employees e ON e.code = edg.employee_code
      WHERE edg.month = :month AND edg.year = :year
        AND edg.status = 'APPROVED'
        AND edg.finance_status NOT IN ('FINANCE_APPROVED')
      ORDER BY edg.grant_date`
    },
    {
      id: 'present-vs-payable',
      name: 'Present vs Payable Gap',
      description: 'Employees where payable days is 5+ more than days present + holidays + sundays',
      query: `SELECT dc.employee_code, e.name, e.department, e.employment_type,
        dc.days_present, dc.paid_sundays, dc.paid_holidays, dc.days_wop,
        dc.total_payable_days,
        ROUND(dc.total_payable_days - dc.days_present - dc.paid_sundays - dc.paid_holidays, 1) AS gap
      FROM day_calculations dc
      JOIN employees e ON e.code = dc.employee_code
      WHERE dc.month = :month AND dc.year = :year
        AND (dc.total_payable_days - dc.days_present - dc.paid_sundays - dc.paid_holidays) > 5
      ORDER BY gap DESC`
    }
  ];

  res.json({ success: true, data: saved });
});

module.exports = router;
