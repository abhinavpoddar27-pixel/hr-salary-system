// Test-only: POST /api/extra-duty-grants as it was on origin/main 8abee969 (verbatim handler + returnHint),
// used by bulkExtraDuty.test.js to prove the createGrant() extraction changed nothing.
const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../../database/db');
const { requireHrOrAdmin } = require('../../middleware/roles');

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

module.exports = router;
