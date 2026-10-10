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

// ─── Return for correction (owner ruling 8 Oct 2026) ───────
// Only finance may reopen a finance-rejected (or flagged) grant. "Return to
// HR" sends it back as PENDING / UNREVIEWED with finance's note; HR corrects
// it (PUT /:id) and approves it again; finance re-reviews. HR can never
// override a finance rejection on its own. The old rejection stays in
// audit_log and in the finance_rejections archive.
const RETURNABLE_FINANCE_STATUSES = ['FINANCE_REJECTED', 'FINANCE_FLAGGED'];
const RETURNED_NOTE_PREFIX = 'Returned by finance';

// Extra text for the POST / 409 when HR re-enters a date finance already
// turned down: tells HR the one way forward instead of a dead end.
function returnHint(row) {
  if (!row || row.verification_source === 'BIOMETRIC_AUTO' || row.status !== 'APPROVED') return '';
  if (row.finance_status === 'FINANCE_REJECTED') {
    return ' Finance rejected it — ask finance to use "Return to HR" on that row; then correct it and approve it again.';
  }
  if (row.finance_status === 'FINANCE_FLAGGED') {
    return ' Finance flagged it — finance can approve it or use "Return to HR" so you can correct it.';
  }
  return '';
}

// Returns { ok: true, grant } or { ok: false, status, error }.
// Caller supplies the transaction; the UPDATE's WHERE re-checks the state so
// a concurrent approve/return can't be overwritten.
function returnGrantToHr(db, id, reason, user) {
  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
  if (!grant) return { ok: false, status: 404, error: 'Grant not found' };
  if (grant.verification_source === 'BIOMETRIC_AUTO') {
    return { ok: false, status: 409, error: 'System-generated entries cannot be returned to HR.' };
  }
  if (grant.status !== 'APPROVED' || !RETURNABLE_FINANCE_STATUSES.includes(grant.finance_status)) {
    return { ok: false, status: 409, error: `Only finance-rejected or flagged grants can be returned (this one is ${grant.status} / ${grant.finance_status}).` };
  }
  if (grant.is_processed) {
    return { ok: false, status: 409, error: 'This grant is already processed into salary and cannot be returned.' };
  }
  if (grant.grant_type === 'PRE_BIOMETRIC_ACTIVATION') {
    // A PBA grant owns a placeholder attendance row (rejection already turned
    // it back to 'A'); reopening it would need that row rebuilt. Not handled.
    return { ok: false, status: 409, error: 'Pre-biometric grants cannot be returned to HR. Ask the admin.' };
  }

  const note = `${RETURNED_NOTE_PREFIX} (${user}): ${reason}`;
  const info = db.prepare(`
    UPDATE extra_duty_grants
    SET status = 'PENDING', finance_status = 'UNREVIEWED',
        approved_by = NULL, approved_at = NULL,
        finance_flag_reason = NULL, finance_notes = ?,
        finance_reviewed_by = NULL, finance_reviewed_at = NULL
    WHERE id = ? AND status = 'APPROVED' AND finance_status IN ('FINANCE_REJECTED', 'FINANCE_FLAGGED')
      AND COALESCE(is_processed, 0) = 0
  `).run(note, id);
  if (info.changes !== 1) {
    return { ok: false, status: 409, error: 'Grant changed while returning it — refresh and try again.' };
  }

  // Old reason kept in the audit trail (ruling: "old reason kept in audit").
  logAudit('extra_duty_grants', id, 'finance_status', grant.finance_status, 'UNREVIEWED', 'FINANCE_RETURN',
    `${grant.employee_code} ${grant.grant_date}: ${grant.duty_days} day(s) returned to HR. ` +
    `Previous finance reason: "${grant.finance_flag_reason || ''}" (by ${grant.finance_reviewed_by || '?'} at ${grant.finance_reviewed_at || '?'}). ` +
    `Return reason: "${reason}"`, user);
  logAudit('extra_duty_grants', id, 'status', 'APPROVED', 'PENDING', 'FINANCE_RETURN',
    `${grant.employee_code} ${grant.grant_date}: HR approval (by ${grant.approved_by || '?'}) cleared by return to HR`, user);
  return { ok: true, grant };
}

function notifyReturned(count, sample) {
  try {
    const { createNotification } = require('../services/monthEndScheduler');
    const msg = count === 1
      ? `Finance returned the extra duty grant for ${sample.employee_code} (${sample.grant_date}) for correction`
      : `Finance returned ${count} extra duty grants for correction`;
    createNotification('hr', 'ED_GRANT_RETURNED', msg, '/extra-duty-grants');
  } catch (e) {}
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
// Stage 6 auto-creates a hidden PENDING 'BIOMETRIC_AUTO' row for every WOP
// day (services/recompute.js, INSERT OR IGNORE). HR's manual grant for the
// same employee+date used to hit UNIQUE(employee_code, grant_date, month, year)
// and 500 (Sentry HR-SALARY-BACKEND-2). An untouched auto row is now upgraded
// in place to HR's grant (same id, linked_attendance_id kept, still PENDING);
// any other existing row gets a 409 naming it.
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
    error: `A grant already exists for this employee on ${grant_date} (status: ${row.status}, finance: ${row.finance_status}, source: ${row.verification_source}). Open that row instead.`
      + returnHint(row),
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
          `${g.employee_code} ${g.grant_date}: ${g.duty_days} day(s)`, req.user?.username);
        count++;
      }
    }
  });
  txn();
  res.json({ success: true, count });
});

// POST /:id/finance-return — finance sends a rejected/flagged grant back to HR
router.post('/:id/finance-return', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const reason = String(req.body?.return_reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ success: false, error: 'Return reason required (at least 5 characters)' });
  const user = req.user?.username || 'finance';
  const result = db.transaction(() => returnGrantToHr(db, Number(req.params.id), reason, user)).immediate();
  if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
  notifyReturned(1, result.grant);
  res.json({ success: true });
});

// POST /bulk-finance-return — same, for several grants with one reason.
// Each grant is checked on its own; ineligible ones are reported, not fatal.
router.post('/bulk-finance-return', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const reason = String(req.body?.return_reason || '').trim();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (reason.length < 5) return res.status(400).json({ success: false, error: 'Return reason required (at least 5 characters)' });
  if (ids.length === 0) return res.status(400).json({ success: false, error: 'No grants selected' });
  const user = req.user?.username || 'finance';
  const returned = [];
  const skipped = [];
  db.transaction(() => {
    for (const id of ids) {
      const r = returnGrantToHr(db, id, reason, user);
      if (r.ok) returned.push(r.grant); else skipped.push({ id, error: r.error });
    }
  }).immediate();
  if (returned.length) notifyReturned(returned.length, returned[0]);
  res.json({ success: true, count: returned.length, skipped });
});

// PUT /:id — HR corrects a PENDING grant (typically one finance returned)
// before approving it again. Only HR-entered, unreviewed, unprocessed rows.
const EDITABLE_GRANT_TYPES = ['OVERNIGHT_STAY', 'EXTENDED_SHIFT', 'OTHER'];
router.put('/:id', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const grant = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(req.params.id);
  if (!grant) return res.status(404).json({ success: false, error: 'Grant not found' });
  if (grant.status !== 'PENDING' || grant.finance_status !== 'UNREVIEWED' || grant.is_processed) {
    return res.status(409).json({ success: false, error: `Only pending grants can be edited (this one is ${grant.status} / ${grant.finance_status}).` });
  }
  if (grant.verification_source === 'BIOMETRIC_AUTO' || grant.grant_type === 'PRE_BIOMETRIC_ACTIVATION') {
    return res.status(409).json({ success: false, error: 'This kind of grant cannot be edited here.' });
  }

  const b = req.body || {};
  const next = {};
  if (b.duty_days !== undefined) {
    const d = Number(b.duty_days);
    if (!(d > 0 && d <= 2 && Number.isInteger(d * 2))) {
      return res.status(400).json({ success: false, error: 'duty_days must be 0.5, 1, 1.5 or 2' });
    }
    next.duty_days = d;
  }
  if (b.grant_type !== undefined) {
    if (!EDITABLE_GRANT_TYPES.includes(b.grant_type)) return res.status(400).json({ success: false, error: 'Invalid grant type' });
    next.grant_type = b.grant_type;
  }
  if (b.verification_source !== undefined) {
    const v = String(b.verification_source).trim();
    if (!v || v === 'BIOMETRIC_AUTO') return res.status(400).json({ success: false, error: 'Verification source required' });
    next.verification_source = v;
  }
  if (b.reference_number !== undefined) next.reference_number = String(b.reference_number ?? '');
  if (b.remarks !== undefined) next.remarks = String(b.remarks ?? '');

  const changed = Object.keys(next).filter(k => String(next[k]) !== String(grant[k] ?? ''));
  if (changed.length === 0) return res.json({ success: true, changed: [] });

  const user = req.user?.username || 'hr';
  db.transaction(() => {
    const sets = changed.map(k => `${k} = ?`).join(', ');
    const info = db.prepare(`UPDATE extra_duty_grants SET ${sets}
      WHERE id = ? AND status = 'PENDING' AND finance_status = 'UNREVIEWED'`)
      .run(...changed.map(k => next[k]), grant.id);
    if (info.changes !== 1) throw Object.assign(new Error('Grant changed while saving — refresh and try again.'), { status: 409 });
    for (const k of changed) {
      logAudit('extra_duty_grants', grant.id, k, grant[k] ?? '', next[k], 'HR_EDIT',
        `${grant.employee_code} ${grant.grant_date}: ${k} corrected`, user);
    }
  }).immediate();
  res.json({ success: true, changed });
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
