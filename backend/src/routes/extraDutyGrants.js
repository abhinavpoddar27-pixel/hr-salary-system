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
  const all = db.prepare('SELECT id, status, finance_status FROM extra_duty_grants WHERE month = ? AND year = ?').all(month, year);
  res.json({ success: true, data: {
    total: all.length,
    pending: all.filter(g => g.status === 'PENDING').length,
    hrApproved: all.filter(g => g.status === 'APPROVED').length,
    financeApproved: all.filter(g => g.finance_status === 'FINANCE_APPROVED').length,
    financeFlagged: all.filter(g => g.finance_status === 'FINANCE_FLAGGED').length,
    financeRejected: all.filter(g => g.finance_status === 'FINANCE_REJECTED').length,
    rejected: all.filter(g => g.status === 'REJECTED').length
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
// Per-grant salary impact is NOT stamped any more — it's computed live in
// salaryComputation.js (ed_pay) using the current month's gross / calendarDays,
// so there's no drift when salary structures change. The legacy
// `salary_impact_amount` column is left in the schema for audit but ignored.
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ? AND status = ?').get(req.params.id, 'PENDING');
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not pending' });

  const user = req.user?.username || 'hr';
  db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now') WHERE id = ?")
    .run(user, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'status', 'PENDING', 'APPROVED', 'HR_APPROVE',
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s)`);

  res.json({ success: true });
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

// POST /bulk-approve — HR bulk approve
router.post('/bulk-approve', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  const stmt = db.prepare("UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'PENDING'");
  const user = req.user?.username || 'hr';
  let count = 0;
  const txn = db.transaction(() => {
    for (const id of ids) {
      const g = db.prepare('SELECT id, employee_code, grant_date, duty_days, status FROM extra_duty_grants WHERE id = ?').get(id);
      if (!g || g.status !== 'PENDING') continue;
      const info = stmt.run(user, id);
      if (info.changes > 0) {
        logAudit('extra_duty_grants', id, 'status', 'PENDING', 'APPROVED', 'HR_BULK_APPROVE',
          `${g.employee_code} ${g.grant_date}: ${g.duty_days} day(s)`);
        count++;
      }
    }
  });
  txn();
  res.json({ success: true, count });
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
  query += ' ORDER BY edg.finance_status ASC, edg.duty_days DESC, edg.grant_date DESC';
  const data = db.prepare(query).all(...params);
  const summary = {
    total: data.length,
    unreviewed: data.filter(g => g.finance_status === 'UNREVIEWED').length,
    approved: data.filter(g => g.finance_status === 'FINANCE_APPROVED').length,
    flagged: data.filter(g => g.finance_status === 'FINANCE_FLAGGED').length
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
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s)`);

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
          `${g.employee_code} ${g.grant_date}: ${g.duty_days} day(s)`);
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

module.exports = router;
