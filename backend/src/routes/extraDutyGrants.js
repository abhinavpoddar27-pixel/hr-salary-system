const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');

// ─── Finance Rejections Archive helper ─────────────────────
// Writes one row per rejection into the unified `finance_rejections` archive.
// Called from every HR/Finance reject endpoint so there is a single, queryable
// history of everything that was turned down across the manual-intervention
// workflows. The original row is JSON-serialised so future reports don't rely
// on the source record still existing unchanged.
function archiveRejection(db, rejectionType, sourceTable, grant, reason, user) {
  try {
    const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(grant.employee_code) || {};
    db.prepare(`
      INSERT INTO finance_rejections
        (rejection_type, source_table, source_record_id, employee_code,
         employee_name, department, month, year, company,
         original_details, rejection_reason, rejected_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rejectionType, sourceTable, grant.id, grant.employee_code,
      emp.name || '', emp.department || '', grant.month, grant.year, grant.company || '',
      JSON.stringify(grant), reason, user
    );
  } catch (e) {
    console.error('[finance_rejections] archive error:', e.message);
  }
}

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

// Compute per-day OT rate using calendar days of the grant's month (HR rule:
// gross / calendarDays — Sundays must NOT inflate the rate). Returns 0 when
// gross is missing so callers store NULL safely.
function computeOtPerDay(db, employeeCode, month, year) {
  const row = db.prepare(`
    SELECT COALESCE(e.gross_salary, ss.gross_salary, 0) AS gross
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.code = ?
    ORDER BY ss.effective_from DESC LIMIT 1
  `).get(employeeCode);
  const gross = row?.gross || 0;
  if (gross <= 0 || !month || !year) return 0;
  const calendarDays = new Date(year, month, 0).getDate();
  return calendarDays > 0 ? gross / calendarDays : 0;
}

// POST /:id/approve — HR approve
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not pending' });

  // Salary impact = duty_days × (gross / calendarDays of grant month)
  const perDay = computeOtPerDay(db, grant.employee_code, grant.month, grant.year);
  const impact = Math.round(grant.duty_days * perDay * 100) / 100;
  const user = req.user?.username || 'hr';

  db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now'), salary_impact_amount = ? WHERE id = ?")
    .run(user, impact, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'status', 'PENDING', 'APPROVED', 'HR_APPROVE',
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days}d × ₹${Math.round(perDay)} = ₹${impact}`);

  res.json({ success: true, salary_impact: impact });
});

// POST /:id/reject — HR reject
router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const { rejection_reason } = req.body;
  if (!rejection_reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });

  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not pending' });

  const user = req.user?.username || 'hr';
  db.prepare("UPDATE extra_duty_grants SET status = 'REJECTED', rejection_reason = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?")
    .run(rejection_reason, user, req.params.id);

  archiveRejection(db, 'EXTRA_DUTY_HR', 'extra_duty_grants', grant, rejection_reason, user);
  logAudit('extra_duty_grants', req.params.id, 'status', 'PENDING', 'REJECTED', 'HR_REJECT', rejection_reason);

  res.json({ success: true });
});

// POST /bulk-approve — HR bulk approve, also stamps salary_impact_amount
router.post('/bulk-approve', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  const stmt = db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now'), salary_impact_amount = ? WHERE id = ? AND status = 'PENDING'");
  const user = req.user?.username || 'hr';
  let count = 0;
  const txn = db.transaction(() => {
    for (const id of ids) {
      const g = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
      if (!g || g.status !== 'PENDING') continue;
      const perDay = computeOtPerDay(db, g.employee_code, g.month, g.year);
      const impact = Math.round((g.duty_days || 0) * perDay * 100) / 100;
      const info = stmt.run(user, impact, id);
      if (info.changes > 0) {
        logAudit('extra_duty_grants', id, 'status', 'PENDING', 'APPROVED', 'HR_BULK_APPROVE',
          `${g.employee_code} ${g.grant_date}: ₹${impact}`);
        count++;
      }
    }
  });
  txn();
  res.json({ success: true, count });
});

// POST /backfill-impact — recompute salary_impact_amount for all approved grants
// in a given month using the new calendar-day rate. Useful one-shot after the
// rate fix to refresh historical entries that were stamped with /26.
router.post('/backfill-impact', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
  const grants = db.prepare("SELECT id, employee_code, duty_days, month, year FROM extra_duty_grants WHERE month = ? AND year = ? AND status = 'APPROVED'").all(month, year);
  const update = db.prepare('UPDATE extra_duty_grants SET salary_impact_amount = ? WHERE id = ?');
  let updated = 0;
  const txn = db.transaction(() => {
    for (const g of grants) {
      const perDay = computeOtPerDay(db, g.employee_code, g.month, g.year);
      const impact = Math.round((g.duty_days || 0) * perDay * 100) / 100;
      update.run(impact, g.id);
      updated++;
    }
  });
  txn();
  res.json({ success: true, updated });
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
  const grant = db.prepare("SELECT * FROM extra_duty_grants WHERE id = ? AND status = 'APPROVED'").get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not HR-approved' });

  const user = req.user?.username || 'finance';
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(user, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_APPROVED', 'FINANCE_APPROVE',
    `${grant.employee_code} ${grant.grant_date}: ₹${grant.salary_impact_amount || 0}`);

  res.json({ success: true });
});

// POST /:id/finance-flag
router.post('/:id/finance-flag', (req, res) => {
  const db = getDb();
  const { finance_flag_reason, finance_notes } = req.body;
  if (!finance_flag_reason) return res.status(400).json({ success: false, error: 'Flag reason required' });

  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found' });

  const user = req.user?.username || 'finance';
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_FLAGGED', finance_flag_reason = ?, finance_notes = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(finance_flag_reason, finance_notes || '', user, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_FLAGGED', 'FINANCE_FLAG', finance_flag_reason);

  res.json({ success: true });
});

// POST /:id/finance-reject
router.post('/:id/finance-reject', (req, res) => {
  const db = getDb();
  const { finance_flag_reason } = req.body;
  if (!finance_flag_reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });

  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found' });

  const user = req.user?.username || 'finance';
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_REJECTED', finance_flag_reason = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(finance_flag_reason, user, req.params.id);

  archiveRejection(db, 'EXTRA_DUTY_FINANCE', 'extra_duty_grants', grant, finance_flag_reason, user);
  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_REJECTED', 'FINANCE_REJECT', finance_flag_reason);

  res.json({ success: true });
});

// POST /bulk-finance-approve
router.post('/bulk-finance-approve', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  const stmt = db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ? AND status = 'APPROVED'");
  const user = req.user?.username || 'finance';
  let count = 0;
  const txn = db.transaction(() => {
    for (const id of ids) {
      const g = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
      if (!g || g.status !== 'APPROVED') continue;
      const info = stmt.run(user, id);
      if (info.changes > 0) {
        logAudit('extra_duty_grants', id, 'finance_status', g.finance_status || 'UNREVIEWED',
          'FINANCE_APPROVED', 'FINANCE_BULK_APPROVE',
          `${g.employee_code} ${g.grant_date}: ₹${g.salary_impact_amount || 0}`);
        count++;
      }
    }
  });
  txn();
  res.json({ success: true, count });
});

// ─── GET /finance-rejections ───────────────────────────────
// Read-only view of the unified finance_rejections archive, scoped to
// extra-duty and (optionally) a month. Used by FinanceVerification and
// FinanceAudit UIs to surface "rejected" history without chasing the
// source table's current state.
router.get('/finance-rejections', (req, res) => {
  const db = getDb();
  const { month, year, employee_code } = req.query;
  let query = "SELECT * FROM finance_rejections WHERE rejection_type LIKE 'EXTRA_DUTY_%'";
  const params = [];
  if (month) { query += ' AND month = ?'; params.push(parseInt(month)); }
  if (year) { query += ' AND year = ?'; params.push(parseInt(year)); }
  if (employee_code) { query += ' AND employee_code = ?'; params.push(employee_code); }
  query += ' ORDER BY rejected_at DESC';
  res.json({ success: true, data: db.prepare(query).all(...params) });
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
