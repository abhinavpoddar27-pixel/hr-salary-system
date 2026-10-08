const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { requireHrOrAdmin, requireFinanceOrAdmin } = require('../middleware/roles');
const { isMonthFinalized } = require('../services/leaveTriggers');

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

// ─── Finance "Return for correction" eligibility ───────────
// A returned grant goes back to HR, who re-enters it through POST / (same id)
// and it lands in finance's queue again as UNREVIEWED. Pre-biometric grants
// are excluded: they own a placeholder attendance row that only
// finance-reject knows how to revert. Finalise is month-wide (payroll.js
// POST /finalise), so the month check ignores company — the 2026-09 target
// rows carry company ''. Returns null when returnable, else the reason.
const RETURNABLE_FINANCE_STATES = ['UNREVIEWED', 'FINANCE_REJECTED', 'FINANCE_APPROVED'];
function financeReturnBlocker(db, grant) {
  if (grant.status !== 'APPROVED') return `HR status is ${grant.status}; only HR-approved grants can be returned`;
  if (!RETURNABLE_FINANCE_STATES.includes(grant.finance_status)) return `finance status is ${grant.finance_status}`;
  if (grant.grant_type === 'PRE_BIOMETRIC_ACTIVATION') return 'pre-biometric grants cannot be returned; reject instead';
  if (grant.is_processed) return 'the grant is already processed';
  if (isMonthFinalized(db, null, grant.month, grant.year)) return `${grant.month}/${grant.year} is finalised`;
  return null;
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
    financeReturned: all.filter(g => g.finance_status === 'FINANCE_RETURNED').length,
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
// Stage 6 auto-creates a hidden PENDING 'BIOMETRIC_AUTO' row for every WOP
// day (services/recompute.js, INSERT OR IGNORE). HR's manual grant for the
// same employee+date used to hit UNIQUE(employee_code, grant_date, month, year)
// and 500 (Sentry HR-SALARY-BACKEND-2). An untouched auto row is now upgraded
// in place to HR's grant (same id, linked_attendance_id kept, still PENDING);
// a row finance returned for correction is replaced in place and goes back
// to finance as UNREVIEWED; any other existing row gets a 409 naming it.
router.post('/', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { employee_code, grant_date, month, year, company, grant_type, duty_days, verification_source, reference_number, remarks, original_punch_date } = req.body;
  if (!employee_code || !grant_date || !month || !year || !verification_source) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employee_code);
  const user = req.user?.username || 'hr';
  const grantType = grant_type || 'OVERNIGHT_STAY';
  const dutyDays = duty_days || 1;
  const findExisting = () => db.prepare(
    'SELECT * FROM extra_duty_grants WHERE employee_code = ? AND grant_date = ? AND month = ? AND year = ?'
  ).get(employee_code, grant_date, month, year);
  const conflict = (row) => res.status(409).json({
    success: false,
    error: `A grant already exists for this employee on ${grant_date} (status: ${row.status}, finance: ${row.finance_status}, source: ${row.verification_source}). Open that row instead.`,
    grant_id: row.id
  });

  let outcome;
  try {
    // IMMEDIATE so the lookup and the write see the same row state.
    outcome = db.transaction(() => {
      const existing = findExisting();
      if (!existing) {
        const result = db.prepare(`INSERT INTO extra_duty_grants (employee_code, employee_id, grant_date, month, year, company, grant_type, duty_days, verification_source, reference_number, remarks, original_punch_date, requested_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          employee_code, emp?.id, grant_date, month, year, company || '', grantType,
          dutyDays, verification_source, reference_number || '', remarks || '', original_punch_date || '', user
        );
        return { kind: 'created', id: result.lastInsertRowid };
      }
      // Finance returned this grant for correction. HR's re-entry is the
      // approval (HR approve has no side effects beyond status), so the row
      // goes straight back to finance's queue. Never PBA: those can't be
      // returned, and a PBA request must not take over a non-PBA row.
      if (existing.finance_status === 'FINANCE_RETURNED' && grantType !== 'PRE_BIOMETRIC_ACTIVATION') {
        if (isMonthFinalized(db, null, existing.month, existing.year)) return { kind: 'finalised', row: existing };
        db.prepare(`UPDATE extra_duty_grants
          SET duty_days = ?, grant_type = ?, verification_source = ?, reference_number = ?, remarks = ?,
              original_punch_date = ?, requested_by = ?, requested_at = datetime('now'),
              status = 'APPROVED', approved_by = ?, approved_at = datetime('now'),
              finance_status = 'UNREVIEWED', finance_reviewed_by = NULL, finance_reviewed_at = NULL
          WHERE id = ?`).run(
          dutyDays, grantType, verification_source, reference_number || '', remarks || '',
          original_punch_date || '', user, user, existing.id
        );
        return { kind: 'resubmitted', id: existing.id, old: existing };
      }
      if (existing.finance_status === 'FINANCE_REJECTED' && !financeReturnBlocker(db, existing)) {
        return { kind: 'finance_rejected', row: existing };
      }
      const untouchedAuto = existing.verification_source === 'BIOMETRIC_AUTO' && existing.status === 'PENDING'
        && existing.finance_status === 'UNREVIEWED' && !existing.is_processed;
      if (!untouchedAuto) return { kind: 'conflict', row: existing };
      // The kept linked_attendance_id points at the real WOP attendance row;
      // a PBA grant_type there would let finance-reject revert that day to 'A'.
      if (grantType === 'PRE_BIOMETRIC_ACTIVATION') return { kind: 'pba_conflict', row: existing };
      db.prepare(`UPDATE extra_duty_grants
        SET verification_source = ?, reference_number = ?, remarks = ?, duty_days = ?, grant_type = ?,
            original_punch_date = ?, requested_by = ?, requested_at = datetime('now')
        WHERE id = ?`).run(
        verification_source, reference_number || '', remarks || '', dutyDays, grantType,
        original_punch_date || '', user, existing.id
      );
      return { kind: 'upgraded', id: existing.id, old: existing };
    }).immediate();
  } catch (err) {
    // Race safety net: another writer inserted the same key first.
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const row = findExisting();
      if (row) return conflict(row);
      return res.status(409).json({ success: false, error: `A grant already exists for this employee on ${grant_date}.` });
    }
    throw err;
  }

  if (outcome.kind === 'conflict') return conflict(outcome.row);
  if (outcome.kind === 'finance_rejected') {
    const r = outcome.row;
    const on = (r.finance_reviewed_at || '').slice(0, 10) || 'an unknown date';
    const why = (r.finance_flag_reason || '').trim() || 'no reason recorded';
    return res.status(409).json({
      success: false,
      error: `Rejected by finance on ${on}: ${why}. Ask finance to Return it for correction.`,
      grant_id: r.id
    });
  }
  if (outcome.kind === 'finalised') {
    return res.status(409).json({
      success: false,
      error: `Cannot re-enter this grant: ${outcome.row.month}/${outcome.row.year} is finalised.`,
      grant_id: outcome.row.id
    });
  }
  if (outcome.kind === 'resubmitted') {
    const o = outcome.old;
    logAudit('extra_duty_grants', outcome.id, 'finance_status', 'FINANCE_RETURNED', 'UNREVIEWED', 'HR_RESUBMIT',
      `${employee_code} ${grant_date}: HR re-entered after finance return, duty_days ${o.duty_days} -> ${dutyDays}. ` +
      `Old: grant_type=${o.grant_type}, verification_source=${o.verification_source}, ` +
      `reference_number="${o.reference_number || ''}", remarks="${o.remarks || ''}", ` +
      `original_punch_date="${o.original_punch_date || ''}", requested_by=${o.requested_by}`,
      req.user?.username);
  }
  if (outcome.kind === 'pba_conflict') {
    return res.status(409).json({
      success: false,
      error: 'Pre-biometric grants cannot replace a system-generated entry for this date.',
      grant_id: outcome.row.id
    });
  }
  if (outcome.kind === 'upgraded') {
    const o = outcome.old;
    logAudit('extra_duty_grants', outcome.id, 'verification_source', 'BIOMETRIC_AUTO', verification_source, 'HR_UPGRADE_AUTO',
      `${employee_code} ${grant_date}: WOP date — HR grant replaced system-generated entry. ` +
      `Old: duty_days=${o.duty_days}, grant_type=${o.grant_type}, remarks="${o.remarks || ''}", ` +
      `reference_number="${o.reference_number || ''}", original_punch_date="${o.original_punch_date || ''}", ` +
      `requested_by=${o.requested_by}, requested_at=${o.requested_at}, linked_attendance_id=${o.linked_attendance_id}. ` +
      `New: ${dutyDays} day(s) ${grantType}`, req.user?.username);
  }
  res.json({ success: true, id: outcome.id });
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
           is_miss_punch, is_night_out_only, stage_5_done,
           month, year, company)
        VALUES (?, ?, ?,
                'A', ?,
                NULL, NULL,
                'pba_grant', 'PBA grant pending finance approval',
                0, 0, 1,
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
      `${employee_code} ${grant_date}: ${duty_days} day(s) (pre-biometric activation)`, req.user?.username);

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
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s)`, req.user?.username);

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
  logAudit('extra_duty_grants', req.params.id, 'status', 'PENDING', 'REJECTED', 'HR_REJECT', rejection_reason, req.user?.username);

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
          `${g.employee_code} ${g.grant_date}: ${g.duty_days} day(s)`, req.user?.username);
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
    flagged: data.filter(g => g.finance_status === 'FINANCE_FLAGGED').length,
    returned: data.filter(g => g.finance_status === 'FINANCE_RETURNED').length
  };
  res.json({ success: true, data, summary });
});

// POST /:id/finance-approve
router.post('/:id/finance-approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const grant = db.prepare("SELECT * FROM extra_duty_grants WHERE id = ? AND status = 'APPROVED'").get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found or not HR-approved' });
  // A returned grant still carries the values finance sent back; it is
  // approvable only after HR re-enters it (POST / → UNREVIEWED).
  if (grant.finance_status === 'FINANCE_RETURNED') {
    return res.status(409).json({ success: false, error: 'This grant was returned to HR for correction. Approve it after HR re-enters it.', grant_id: grant.id });
  }

  const user = req.user?.username || 'finance';
  db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
    .run(user, req.params.id);

  logAudit('extra_duty_grants', req.params.id, 'finance_status', grant.finance_status || 'UNREVIEWED',
    'FINANCE_APPROVED', 'FINANCE_APPROVE',
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s)`, req.user?.username);

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
    'FINANCE_FLAGGED', 'FINANCE_FLAG', finance_flag_reason, req.user?.username);

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
    'FINANCE_REJECTED', 'FINANCE_REJECT', finance_flag_reason, req.user?.username);

  res.json({ success: true });
});

// POST /:id/finance-return — send a grant back to HR for correction
// Reject is final (the UNIQUE key blocks re-entry); return is not: HR
// re-enters the same employee+date through POST /, which updates this row
// in place. status, duty_days and attendance are left untouched here, and
// FINANCE_RETURNED pays nothing (salary reads FINANCE_APPROVED only).
router.post('/:id/finance-return', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { finance_flag_reason } = req.body;
  const reason = typeof finance_flag_reason === 'string' ? finance_flag_reason.trim() : '';
  if (!reason) return res.status(400).json({ success: false, error: 'Return reason required' });

  const user = req.user?.username || 'finance';
  const outcome = db.transaction(() => {
    const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(req.params.id);
    if (!grant) return { kind: 'missing' };
    const blocker = financeReturnBlocker(db, grant);
    if (blocker) return { kind: 'blocked', grant, blocker };
    db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_RETURNED', finance_flag_reason = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ?")
      .run(reason, user, grant.id);
    return { kind: 'returned', grant };
  }).immediate();

  if (outcome.kind === 'missing') return res.status(404).json({ success: false, error: 'Grant not found' });
  if (outcome.kind === 'blocked') {
    return res.status(409).json({ success: false, error: `Cannot return this grant: ${outcome.blocker}.`, grant_id: outcome.grant.id });
  }
  const g = outcome.grant;
  logAudit('extra_duty_grants', g.id, 'finance_status', g.finance_status, 'FINANCE_RETURNED', 'FINANCE_RETURN',
    `${reason} (old duty_days=${g.duty_days})`, req.user?.username);

  res.json({ success: true });
});

// POST /bulk-finance-approve
router.post('/bulk-finance-approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  // Returned grants are skipped: they wait on HR's re-entry, not on finance.
  const stmt = db.prepare("UPDATE extra_duty_grants SET finance_status = 'FINANCE_APPROVED', finance_reviewed_by = ?, finance_reviewed_at = datetime('now') WHERE id = ? AND status = 'APPROVED' AND finance_status <> 'FINANCE_RETURNED'");
  const user = req.user?.username || 'finance';
  let count = 0;
  const txn = db.transaction(() => {
    for (const id of ids) {
      const g = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
      if (!g || g.status !== 'APPROVED' || g.finance_status === 'FINANCE_RETURNED') continue;
      const info = stmt.run(user, id);
      if (info.changes > 0) {
        logAudit('extra_duty_grants', id, 'finance_status', g.finance_status || 'UNREVIEWED',
          'FINANCE_APPROVED', 'FINANCE_BULK_APPROVE',
          `${g.employee_code} ${g.grant_date}: ${g.duty_days} day(s)`, req.user?.username);
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
