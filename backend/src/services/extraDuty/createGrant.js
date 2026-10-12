/**
 * Extra duty grant write path (P3-01) — extracted unchanged from
 * POST /api/extra-duty-grants so the single route and the bulk engine use the
 * same code (MASTER_PLAN §10.10 "extract, don't copy").
 *
 * writeGrant() opens NO transaction: the caller wraps it (the single route in
 * its own IMMEDIATE transaction; bulk inside the batch's IMMEDIATE transaction,
 * where a nested call is a savepoint).
 *
 * Stage 6 auto-creates a hidden PENDING 'BIOMETRIC_AUTO' row for every WOP day
 * (services/recompute.js, INSERT OR IGNORE). An untouched auto row is upgraded
 * in place to HR's grant (same id, linked_attendance_id kept, still PENDING);
 * any other existing row is a conflict.
 */

function findExisting(db, employee_code, grant_date, month, year) {
  return db.prepare(
    'SELECT * FROM extra_duty_grants WHERE employee_code = ? AND grant_date = ? AND month = ? AND year = ?'
  ).get(employee_code, grant_date, month, year);
}

function isUntouchedAuto(row) {
  return !!row && row.verification_source === 'BIOMETRIC_AUTO' && row.status === 'PENDING'
    && row.finance_status === 'UNREVIEWED' && !row.is_processed;
}

/**
 * @param input { employee_code, employee_id, grant_date, month, year, company, grant_type,
 *                duty_days, verification_source, reference_number, remarks, original_punch_date }
 * @returns { kind: 'created', id } | { kind: 'upgraded', id, old } | { kind: 'conflict', row }
 *          | { kind: 'pba_conflict', row }
 */
function writeGrant(db, input, user) {
  const { employee_code, employee_id, grant_date, month, year, company, verification_source,
    reference_number, remarks, original_punch_date } = input;
  const grantType = input.grant_type || 'OVERNIGHT_STAY';
  const dutyDays = input.duty_days || 1;
  const existing = findExisting(db, employee_code, grant_date, month, year);
  if (!existing) {
    const result = db.prepare(`INSERT INTO extra_duty_grants (employee_code, employee_id, grant_date, month, year, company, grant_type, duty_days, verification_source, reference_number, remarks, original_punch_date, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      employee_code, employee_id, grant_date, month, year, company || '', grantType,
      dutyDays, verification_source, reference_number || '', remarks || '', original_punch_date || '', user
    );
    return { kind: 'created', id: result.lastInsertRowid };
  }
  if (!isUntouchedAuto(existing)) return { kind: 'conflict', row: existing };
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
}

// Exact HR_UPGRADE_AUTO audit remark (unchanged text).
function upgradeAuditRemark(employee_code, grant_date, o, dutyDays, grantType) {
  return `${employee_code} ${grant_date}: WOP date — HR grant replaced system-generated entry. ` +
    `Old: duty_days=${o.duty_days}, grant_type=${o.grant_type}, remarks="${o.remarks || ''}", ` +
    `reference_number="${o.reference_number || ''}", original_punch_date="${o.original_punch_date || ''}", ` +
    `requested_by=${o.requested_by}, requested_at=${o.requested_at}, linked_attendance_id=${o.linked_attendance_id}. ` +
    `New: ${dutyDays} day(s) ${grantType}`;
}

module.exports = { writeGrant, findExisting, isUntouchedAuto, upgradeAuditRemark };
