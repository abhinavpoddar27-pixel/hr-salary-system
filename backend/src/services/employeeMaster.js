/**
 * P5-02: shared employee-master writers.
 *
 * setShift — moved from the PUT /api/employees/bulk-shift loop (employees.js). The route and the bulk master-edit
 * kind write the SAME employees update and the SAME `shift_assignment` audit row (stage employee_master, action
 * shift_change, remark "Bulk shift change from X to Y"). bulkMasterEdit.test.js proves the route is byte-identical to
 * the verbatim b2badcab handler.
 */

/**
 * @param {object} db
 * @param {object} emp        { id, code, shift_code } — the employees row before the write
 * @param {object} shift      { id } — the shifts row
 * @param {string} shiftCode  the code written to employees.shift_code (route: body shiftCode || shift.code)
 * @param {string} username   audit changed_by
 */
function setShift(db, emp, shift, shiftCode, username) {
  const prevCode = emp.shift_code || '';
  db.prepare("UPDATE employees SET default_shift_id = ?, shift_code = ?, updated_at = datetime('now') WHERE code = ?")
    .run(shift.id, shiftCode, emp.code);
  try {
    db.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'employees', emp.id, 'shift_assignment',
      prevCode, shiftCode,
      username,
      'employee_master',
      `Bulk shift change from ${prevCode || '(none)'} to ${shiftCode}`,
      emp.code,
      'shift_change'
    );
  } catch (e) { /* audit should not block bulk update */ }
}

module.exports = { setShift };
