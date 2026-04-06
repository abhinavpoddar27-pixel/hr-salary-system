const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { detectRedFlags } = require('../services/financeRedFlags');

function requireFinanceOrAdmin(req, res, next) {
  if (!req.user || !['finance', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Finance or admin access required' });
  }
  next();
}

// GET /dashboard
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const sc = db.prepare('SELECT COUNT(*) as cnt, SUM(net_salary) as totalNet, SUM(gross_earned) as totalGross, SUM(total_deductions) as totalDed FROM salary_computations WHERE month = ? AND year = ?').get(month, year);
  const held = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ? AND salary_held = 1').get(month, year);
  const changed = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ? AND gross_changed = 1').get(month, year);

  let verified = 0, flagged = 0, rejected = 0;
  try {
    verified = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status = 'verified'").get(month, year)?.cnt || 0;
    flagged = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status = 'flagged'").get(month, year)?.cnt || 0;
    rejected = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status = 'rejected'").get(month, year)?.cnt || 0;
  } catch {}

  let signoffStatus = 'pending';
  try {
    const so = db.prepare('SELECT status FROM finance_month_signoff WHERE month = ? AND year = ?').get(month, year);
    if (so) signoffStatus = so.status;
  } catch {}

  const redFlags = detectRedFlags(db, parseInt(month), parseInt(year));
  const rfSummary = {};
  for (const f of redFlags) rfSummary[f.type] = (rfSummary[f.type] || 0) + 1;

  res.json({
    success: true,
    data: {
      summary: {
        totalEmployees: sc?.cnt || 0,
        pending: (sc?.cnt || 0) - verified - flagged - rejected,
        verified, flagged, rejected,
        totalNetSalary: Math.round(sc?.totalNet || 0),
        totalGrossEarned: Math.round(sc?.totalGross || 0),
        totalDeductions: Math.round(sc?.totalDed || 0),
        heldSalaries: held?.cnt || 0,
        grossChangedCount: changed?.cnt || 0,
        signoffStatus
      },
      redFlagSummary: rfSummary,
      redFlagCount: redFlags.length
    }
  });
});

// GET /red-flags
router.get('/red-flags', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const flags = detectRedFlags(db, parseInt(month), parseInt(year));
  res.json({ success: true, data: flags, total: flags.length });
});

// GET /employees
router.get('/employees', (req, res) => {
  const db = getDb();
  const { month, year, status, search, department } = req.query;

  let query = `SELECT sc.*, e.name as employee_name, e.department, e.designation,
    fas.status as audit_status, fas.flag_reason, fas.verified_by
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN finance_audit_status fas ON fas.employee_code = sc.employee_code AND fas.month = sc.month AND fas.year = sc.year
    WHERE sc.month = ? AND sc.year = ?`;
  const params = [month, year];

  if (status && status !== 'all') { query += ' AND fas.status = ?'; params.push(status); }
  if (search) { query += ' AND (e.name LIKE ? OR sc.employee_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (department) { query += ' AND e.department = ?'; params.push(department); }
  query += ' ORDER BY e.department, e.name';

  try {
    const data = db.prepare(query).all(...params);
    res.json({ success: true, data });
  } catch (e) {
    // Fallback without audit status join if table doesn't exist yet
    const data = db.prepare(`SELECT sc.*, e.name as employee_name, e.department FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code WHERE sc.month = ? AND sc.year = ? ORDER BY e.department, e.name`).all(month, year);
    res.json({ success: true, data });
  }
});

// GET /employee/:code
router.get('/employee/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const code = req.params.code;

  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  const sc = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
  const dc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);

  let auditStatus = null, comments = [];
  try {
    auditStatus = db.prepare('SELECT * FROM finance_audit_status WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
    comments = db.prepare('SELECT * FROM finance_audit_comments WHERE (employee_code = ? OR employee_code IS NULL) AND month = ? AND year = ? ORDER BY created_at DESC').all(code, month, year);
  } catch {}

  let prevMonth = null;
  try {
    let pm = parseInt(month) - 1, py = parseInt(year);
    if (pm === 0) { pm = 12; py--; }
    prevMonth = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, pm, py);
  } catch {}

  const redFlags = detectRedFlags(db, parseInt(month), parseInt(year)).filter(f => f.employeeCode === code);

  res.json({
    success: true,
    data: { employee: emp, salaryComputation: sc, dayCalculation: dc, auditStatus, comments, previousMonth: prevMonth, redFlags }
  });
});

// POST /status
router.post('/status', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { employeeCode, month, year, status, flagReason, flagCategory, notes } = req.body;
  if (!employeeCode || !month || !year || !status) return res.status(400).json({ success: false, error: 'Missing required fields' });

  db.prepare(`INSERT INTO finance_audit_status (employee_code, month, year, status, flag_reason, flag_category, verified_by, verified_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(employee_code, month, year) DO UPDATE SET
      status = excluded.status, flag_reason = excluded.flag_reason, flag_category = excluded.flag_category,
      verified_by = excluded.verified_by, verified_at = excluded.verified_at, notes = excluded.notes
  `).run(employeeCode, month, year, status, flagReason || null, flagCategory || null, req.user?.username || 'finance', notes || null);

  res.json({ success: true });
});

// POST /bulk-verify
router.post('/bulk-verify', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, employeeCodes, filter } = req.body;

  let codes = employeeCodes || [];
  if (filter === 'no-red-flags') {
    const redFlags = detectRedFlags(db, parseInt(month), parseInt(year));
    const flaggedCodes = new Set(redFlags.map(f => f.employeeCode));
    const all = db.prepare('SELECT employee_code FROM salary_computations WHERE month = ? AND year = ?').all(month, year);
    codes = all.map(r => r.employee_code).filter(c => !flaggedCodes.has(c));
  }

  const stmt = db.prepare(`INSERT INTO finance_audit_status (employee_code, month, year, status, verified_by, verified_at)
    VALUES (?, ?, ?, 'verified', ?, datetime('now'))
    ON CONFLICT(employee_code, month, year) DO UPDATE SET status = 'verified', verified_by = excluded.verified_by, verified_at = excluded.verified_at`);
  const txn = db.transaction(() => { for (const c of codes) stmt.run(c, month, year, req.user?.username || 'finance'); });
  txn();

  res.json({ success: true, verified: codes.length });
});

// POST /comment
router.post('/comment', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { employeeCode, month, year, comment, category, severity } = req.body;
  db.prepare('INSERT INTO finance_audit_comments (employee_code, month, year, comment, category, severity, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(employeeCode || null, month, year, comment, category || 'observation', severity || 'info', req.user?.username || 'finance');
  res.json({ success: true });
});

// GET /comments
router.get('/comments', (req, res) => {
  const db = getDb();
  const { month, year, employeeCode } = req.query;
  let query = 'SELECT * FROM finance_audit_comments WHERE month = ? AND year = ?';
  const params = [month, year];
  if (employeeCode) { query += ' AND (employee_code = ? OR employee_code IS NULL)'; params.push(employeeCode); }
  query += ' ORDER BY created_at DESC';
  try {
    res.json({ success: true, data: db.prepare(query).all(...params) });
  } catch { res.json({ success: true, data: [] }); }
});

// PUT /comment/:id/resolve
router.put('/comment/:id/resolve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE finance_audit_comments SET resolved = 1, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(req.user?.username || 'finance', req.params.id);
  res.json({ success: true });
});

// POST /signoff
router.post('/signoff', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, company, status, rejectionReason } = req.body;

  if (status === 'approved') {
    const flagged = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status IN ('flagged', 'rejected')").get(month, year);
    if (flagged?.cnt > 0) {
      return res.status(400).json({ success: false, error: `Cannot approve — ${flagged.cnt} employee(s) still flagged/rejected. Resolve all flags first.` });
    }
  }

  if (status === 'rejected' && !rejectionReason) {
    return res.status(400).json({ success: false, error: 'Rejection reason is required' });
  }

  const sc = db.prepare('SELECT COUNT(*) as cnt, SUM(net_salary) as total FROM salary_computations WHERE month = ? AND year = ?').get(month, year);
  const verified = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status = 'verified'").get(month, year);
  const flagged = db.prepare("SELECT COUNT(*) as cnt FROM finance_audit_status WHERE month = ? AND year = ? AND status = 'flagged'").get(month, year);

  db.prepare(`INSERT INTO finance_month_signoff (month, year, company, status, total_employees, verified_count, flagged_count, rejected_count, total_net_salary, rejection_reason, signed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(month, year, company) DO UPDATE SET
      status = excluded.status, total_employees = excluded.total_employees, verified_count = excluded.verified_count,
      flagged_count = excluded.flagged_count, total_net_salary = excluded.total_net_salary,
      rejection_reason = excluded.rejection_reason, signed_by = excluded.signed_by, signed_at = datetime('now')
  `).run(month, year, company || null, status, sc?.cnt || 0, verified?.cnt || 0, flagged?.cnt || 0, Math.round(sc?.total || 0), rejectionReason || null, req.user?.username || 'finance');

  res.json({ success: true });
});

// GET /signoff-status
router.get('/signoff-status', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  try {
    const so = db.prepare('SELECT * FROM finance_month_signoff WHERE month = ? AND year = ?').get(month, year);
    res.json({ success: true, data: so || { status: 'pending' } });
  } catch { res.json({ success: true, data: { status: 'pending' } }); }
});

module.exports = router;
