const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { requireHrOrAdmin, requireFinanceOrAdmin } = require('../middleware/roles');

// Role gates are imported from the centralised middleware module so the
// same canonical normalizeRole-based check is enforced everywhere
// (extraDutyGrants, financeVerification, financeAudit, salary-input).

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
    WHERE edg.month = ? AND edg.year = ? AND edg.verification_source != 'BIOMETRIC_AUTO'`;
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
  const all = db.prepare("SELECT id, status, finance_status FROM extra_duty_grants WHERE month = ? AND year = ? AND verification_source != 'BIOMETRIC_AUTO'").all(month, year);
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
  const data = db.prepare("SELECT * FROM extra_duty_grants WHERE employee_code = ? AND month = ? AND year = ? AND verification_source != 'BIOMETRIC_AUTO' ORDER BY grant_date").all(req.params.code, month, year);
  res.json({ success: true, data });
});

// POST / — Create grant (HR/admin)
router.post('/', requireHrOrAdmin, (req, res) => {
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

// POST /pba — Pre-Biometric Activation grant (HR/admin)
// Creates a placeholder attendance_processed row (status_final P or ½P)
// and a linked extra_duty_grants row in ONE transaction. Used when a new
// joiner was physically present between their DOJ and the first biometric
// punch — those days have no attendance_processed rows, so Stage 5 has
// nothing to click on. The placeholder closes that gap while the linked
// grant routes the day through the same HR→Finance dual-approval pipeline
// as any other extra-duty claim. Rejection reverts the placeholder (see
// POST /:id/finance-reject below).
router.post('/pba', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { employee_code, grant_date, month, year, company, duty_days, remarks } = req.body;

  if (!employee_code || !grant_date || !month || !year || !company) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  if (duty_days !== 0.5 && duty_days !== 1.0 && duty_days !== 1) {
    return res.status(400).json({ success: false, error: 'duty_days must be 0.5 or 1.0' });
  }
  const remarkTrim = String(remarks || '').trim();
  if (remarkTrim.length < 10) {
    return res.status(400).json({ success: false, error: 'remarks must be at least 10 characters' });
  }

  const emp = db.prepare('SELECT id, date_of_joining FROM employees WHERE code = ?').get(employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  if (!emp.date_of_joining) {
    return res.status(400).json({ success: false, error: 'Employee has no date_of_joining on record' });
  }
  if (grant_date < emp.date_of_joining) {
    return res.status(400).json({ success: false, error: `grant_date must be on or after DOJ (${emp.date_of_joining})` });
  }
  // Must fall inside the claimed month
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${mm}-01`;
  const monthEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  if (grant_date < monthStart || grant_date > monthEnd) {
    return res.status(400).json({ success: false, error: 'grant_date is outside the specified month/year' });
  }

  // PBA window: grant_date must be strictly before the earliest existing
  // attendance row for this employee in this month. If no rows exist yet,
  // any date on/after DOJ within the month is valid.
  const firstPunch = db.prepare(
    'SELECT MIN(date) AS first_date FROM attendance_processed WHERE employee_code = ? AND month = ? AND year = ?'
  ).get(employee_code, parseInt(month), parseInt(year));
  if (firstPunch?.first_date && grant_date >= firstPunch.first_date) {
    return res.status(400).json({
      success: false,
      error: `grant_date must be before first biometric punch (${firstPunch.first_date})`
    });
  }

  // Pre-check 409: UNIQUE(employee_code, grant_date, month, year) on extra_duty_grants.
  const existing = db.prepare(
    'SELECT id FROM extra_duty_grants WHERE employee_code = ? AND grant_date = ? AND month = ? AND year = ?'
  ).get(employee_code, grant_date, parseInt(month), parseInt(year));
  if (existing) {
    return res.status(409).json({ success: false, error: 'A grant already exists for this date', grant_id: existing.id });
  }

  const statusFinal = duty_days === 0.5 ? '½P' : 'P';
  const user = req.user?.username || 'hr';

  try {
    let grantId, attendanceId;
    const txn = db.transaction(() => {
      const apResult = db.prepare(`
        INSERT INTO attendance_processed
          (employee_code, employee_id, date,
           status_original, status_final,
           in_time_final, out_time_final,
           correction_source, correction_remark,
           is_miss_punch, stage_5_done,
           month, year, company)
        VALUES (?, ?, ?,
                'A', ?,
                NULL, NULL,
                'pba_grant', 'PBA grant pending finance approval',
                0, 1,
                ?, ?, ?)
      `).run(employee_code, emp.id, grant_date, statusFinal, parseInt(month), parseInt(year), company);
      attendanceId = apResult.lastInsertRowid;

      const grantResult = db.prepare(`
        INSERT INTO extra_duty_grants
          (employee_code, employee_id, grant_date, month, year, company,
           grant_type, duty_days, verification_source, remarks,
           linked_attendance_id, status, finance_status, requested_by)
        VALUES (?, ?, ?, ?, ?, ?,
                'PRE_BIOMETRIC_ACTIVATION', ?, 'HR_NEW_JOINER', ?,
                ?, 'PENDING', 'UNREVIEWED', ?)
      `).run(
        employee_code, emp.id, grant_date, parseInt(month), parseInt(year), company,
        duty_days, remarkTrim, attendanceId, user
      );
      grantId = grantResult.lastInsertRowid;
    });
    txn();

    logAudit('extra_duty_grants', grantId, 'status', '', 'PENDING', 'PBA_CREATE',
      `${employee_code} ${grant_date}: ${duty_days} day(s) (pre-biometric activation)`);

    res.json({ success: true, grant_id: grantId, attendance_id: attendanceId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /:id/approve — HR approve
// Per-grant salary impact is NOT stamped any more — it's computed live in
// salaryComputation.js (ed_pay) using the current month's gross / calendarDays,
// so there's no drift when salary structures change. The legacy
// `salary_impact_amount` column is left in the schema for audit but ignored.
router.post('/:id/approve', requireHrOrAdmin, (req, res) => {
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
router.post('/:id/reject', requireHrOrAdmin, (req, res) => {
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
router.post('/bulk-approve', requireHrOrAdmin, (req, res) => {
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
    WHERE edg.status = 'APPROVED' AND edg.month = ? AND edg.year = ? AND edg.verification_source != 'BIOMETRIC_AUTO'`;
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
router.post('/:id/finance-approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const grant = db.prepare("SELECT * FROM extra_duty_grants WHERE id = ? AND status = 'APPROVED'").get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not HR-approved' });

  const user = req.user?.username || 'finance';
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(user, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_APPROVED', 'FINANCE_APPROVE',
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s)`);

  try {
    const { createNotification } = require('../services/monthEndScheduler');
    createNotification('hr', 'ED_GRANT_APPROVED',
      `Extra Duty grant approved by finance for ${grant.employee_code}`,
      '/extra-duty-grants');
  } catch (e) {}

  res.json({ success: true });
});

// POST /:id/finance-flag
router.post('/:id/finance-flag', requireFinanceOrAdmin, (req, res) => {
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
router.post('/:id/finance-reject', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { finance_flag_reason } = req.body;
  if (!finance_flag_reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });

  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found' });

  const user = req.user?.username || 'finance';
  // Wrap in a transaction so the PBA placeholder revert never drifts
  // from the grant status flip — either both land or neither does.
  const txn = db.transaction(() => {
    db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_REJECTED', finance_flag_reason = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
      .run(finance_flag_reason, user, req.params.id);

    // PBA revert: the grant created a placeholder attendance_processed row
    // (status_final P/½P) on the linked date. Rejection must roll it back
    // to an absence so salary computation doesn't pay for a day Finance
    // declined. The row is kept — only the corrected-status fields are
    // cleared so the original 'A' re-surfaces.
    if (grant.grant_type === 'PRE_BIOMETRIC_ACTIVATION' && grant.linked_attendance_id) {
      db.prepare(`
        UPDATE attendance_processed
        SET status_final = 'A',
            correction_source = NULL,
            correction_remark = NULL,
            stage_5_done = 0
        WHERE id = ?
      `).run(grant.linked_attendance_id);
    }
  });
  txn();

  archiveRejection(db, 'EXTRA_DUTY_FINANCE', 'extra_duty_grants', grant, finance_flag_reason, user);
  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_REJECTED', 'FINANCE_REJECT', finance_flag_reason);

  res.json({ success: true });
});

// POST /bulk-finance-approve
router.post('/bulk-finance-approve', requireFinanceOrAdmin, (req, res) => {
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
