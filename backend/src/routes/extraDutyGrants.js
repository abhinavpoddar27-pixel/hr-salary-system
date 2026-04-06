const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// GET / — List grants
router.get('/', (req, res) => {
  const db = getDb();
  const { month, year, company, status, finance_status, employee_code } = req.query;
  let query = `SELECT edg.*, e.name as employee_name, e.department, e.designation
    FROM extra_duty_grants edg LEFT JOIN employees e ON edg.employee_code = e.code
    WHERE edg.month = ? AND edg.year = ?`;
  const params = [month, year];
  if (company) { query += ' AND edg.company = ?'; params.push(company); }
  if (status) { query += ' AND edg.status = ?'; params.push(status); }
  if (finance_status) { query += ' AND edg.finance_status = ?'; params.push(finance_status); }
  if (employee_code) { query += ' AND edg.employee_code = ?'; params.push(employee_code); }
  query += ' ORDER BY edg.grant_date DESC';
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

// GET /summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const all = db.prepare('SELECT * FROM extra_duty_grants WHERE month = ? AND year = ?').all(month, year);
  res.json({ success: true, data: {
    total: all.length,
    pending: all.filter(g => g.status === 'PENDING').length,
    hrApproved: all.filter(g => g.status === 'APPROVED').length,
    financeApproved: all.filter(g => g.finance_status === 'FINANCE_APPROVED').length,
    financeFlagged: all.filter(g => g.finance_status === 'FINANCE_FLAGGED').length,
    financeRejected: all.filter(g => g.finance_status === 'FINANCE_REJECTED').length,
    rejected: all.filter(g => g.status === 'REJECTED').length,
    totalImpact: all.filter(g => g.status === 'APPROVED' && g.finance_status === 'FINANCE_APPROVED').reduce((s, g) => s + (g.salary_impact_amount || 0), 0)
  }});
});

// GET /employee/:code
router.get('/employee/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = db.prepare('SELECT * FROM extra_duty_grants WHERE employee_code = ? AND month = ? AND year = ? ORDER BY grant_date').all(req.params.code, month, year);
  res.json({ success: true, data });
});

// POST / — Create grant
router.post('/', (req, res) => {
  const db = getDb();
  const { employee_code, grant_date, month, year, company, grant_type, duty_days, verification_source, reference_number, remarks, original_punch_date } = req.body;
  if (!employee_code || !grant_date || !month || !year || !verification_source) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employee_code);
  const result = db.prepare(`INSERT INTO extra_duty_grants (employee_code, employee_id, grant_date, month, year, company, grant_type, duty_days, verification_source, reference_number, remarks, original_punch_date, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    employee_code, emp?.id, grant_date, month, year, company || '', grant_type || 'OVERNIGHT_STAY',
    duty_days || 1, verification_source, reference_number || '', remarks || '', original_punch_date || '', req.user?.username || 'hr'
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// POST /:id/approve — HR approve
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not pending' });

  // Calculate salary impact
  const emp = db.prepare(`SELECT ss.gross_salary FROM employees e JOIN salary_structures ss ON ss.employee_id = e.id WHERE e.code = ? ORDER BY ss.effective_from DESC LIMIT 1`).get(grant.employee_code);
  const perDay = (emp?.gross_salary || 0) / 26;
  const impact = Math.round(grant.duty_days * perDay * 100) / 100;

  db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now'), salary_impact_amount = ? WHERE id = ?")
    .run(req.user?.username || 'hr', impact, req.params.id);
  res.json({ success: true, salary_impact: impact });
});

// POST /:id/reject — HR reject
router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const { rejection_reason } = req.body;
  if (!rejection_reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });
  db.prepare("UPDATE extra_duty_grants SET status = 'REJECTED', rejection_reason = ? WHERE id = ? AND status = 'PENDING'")
    .run(rejection_reason, req.params.id);
  res.json({ success: true });
});

// POST /bulk-approve
router.post('/bulk-approve', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  const stmt = db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'PENDING'");
  const txn = db.transaction(() => { for (const id of ids) stmt.run(req.user?.username || 'hr', id); });
  txn();
  res.json({ success: true, count: ids.length });
});

// GET /finance-review
router.get('/finance-review', (req, res) => {
  const db = getDb();
  const { month, year, finance_status } = req.query;
  let query = `SELECT edg.*, e.name as employee_name, e.department FROM extra_duty_grants edg
    LEFT JOIN employees e ON edg.employee_code = e.code
    WHERE edg.status = 'APPROVED' AND edg.month = ? AND edg.year = ?`;
  const params = [month, year];
  if (finance_status) { query += ' AND edg.finance_status = ?'; params.push(finance_status); }
  query += ' ORDER BY edg.finance_status ASC, edg.salary_impact_amount DESC';
  const data = db.prepare(query).all(...params);
  const summary = {
    total: data.length,
    unreviewed: data.filter(g => g.finance_status === 'UNREVIEWED').length,
    approved: data.filter(g => g.finance_status === 'FINANCE_APPROVED').length,
    flagged: data.filter(g => g.finance_status === 'FINANCE_FLAGGED').length,
    totalImpact: data.reduce((s, g) => s + (g.salary_impact_amount || 0), 0)
  };
  res.json({ success: true, data, summary });
});

// POST /:id/finance-approve
router.post('/:id/finance-approve', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ? AND status = 'APPROVED'")
    .run(req.user?.username || 'finance', req.params.id);
  res.json({ success: true });
});

// POST /:id/finance-flag
router.post('/:id/finance-flag', (req, res) => {
  const db = getDb();
  const { finance_flag_reason, finance_notes } = req.body;
  if (!finance_flag_reason) return res.status(400).json({ success: false, error: 'Flag reason required' });
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_FLAGGED', finance_flag_reason = ?, finance_notes = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(finance_flag_reason, finance_notes || '', req.user?.username || 'finance', req.params.id);
  res.json({ success: true });
});

// POST /:id/finance-reject
router.post('/:id/finance-reject', (req, res) => {
  const db = getDb();
  const { finance_flag_reason } = req.body;
  if (!finance_flag_reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_REJECTED', finance_flag_reason = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(finance_flag_reason, req.user?.username || 'finance', req.params.id);
  res.json({ success: true });
});

// POST /bulk-finance-approve
router.post('/bulk-finance-approve', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  const stmt = db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ? AND status = 'APPROVED'");
  const txn = db.transaction(() => { for (const id of ids) stmt.run(req.user?.username || 'finance', id); });
  txn();
  res.json({ success: true, count: ids.length });
});

// GET /finance-impact-summary
router.get('/finance-impact-summary', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const all = db.prepare(`SELECT edg.*, e.department FROM extra_duty_grants edg LEFT JOIN employees e ON edg.employee_code = e.code WHERE edg.month = ? AND edg.year = ?`).all(month, year);
  const approved = all.filter(g => g.status === 'APPROVED' && g.finance_status === 'FINANCE_APPROVED');
  const pending = all.filter(g => g.status === 'APPROVED' && g.finance_status === 'UNREVIEWED');
  const byDept = {};
  for (const g of approved) {
    const d = g.department || 'Unknown';
    if (!byDept[d]) byDept[d] = { department: d, count: 0, duty_days: 0, salary_impact: 0 };
    byDept[d].count++; byDept[d].duty_days += g.duty_days; byDept[d].salary_impact += g.salary_impact_amount || 0;
  }
  res.json({ success: true, data: {
    total_grants: all.length,
    fully_approved: approved.length,
    pending_finance: pending.length,
    total_duty_days: approved.reduce((s, g) => s + g.duty_days, 0),
    total_salary_impact: Math.round(approved.reduce((s, g) => s + (g.salary_impact_amount || 0), 0)),
    pending_salary_impact: Math.round(pending.reduce((s, g) => s + (g.salary_impact_amount || 0), 0)),
    by_department: Object.values(byDept)
  }});
});

module.exports = router;
