/**
 * Loans engine — event + audit writer (Loans PR-2, docs/loans/SPEC.md §5.2 r12).
 *
 * Every state change writes one loan_events row (append-only, enforced by the
 * PR-1 triggers) AND one audit_log row. Both go through the db handle the
 * caller passes, inside the caller's transaction — db.js logAudit() is not used
 * because it writes through the global getDb() handle, outside the transaction
 * and to the wrong database in tests and the simulation.
 */
const { toRupees } = require('./money');

function writeEvent(db, {
  loan, instalmentId = null, event, fromState = null, toState = null,
  amountPaise = null, actor, reason = null, field = 'status',
}) {
  const username = typeof actor === 'string' ? actor : actor && actor.username;
  if (!username) throw new Error('writeEvent: actor is required');
  const amount = amountPaise === null || amountPaise === undefined ? null : toRupees(amountPaise);
  const info = db.prepare(`
    INSERT INTO loan_events (loan_id, instalment_id, event, from_state, to_state, amount, actor, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(loan.id, instalmentId, event, fromState, toState, amount, username, reason);
  db.prepare(`
    INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by,
                           stage, remark, employee_code, action_type)
    VALUES ('loans', ?, ?, ?, ?, ?, 'loans', ?, ?, ?)
  `).run(loan.id, field, fromState == null ? '' : String(fromState), toState == null ? '' : String(toState),
    username, [reason, amount !== null ? `amount ₹${amount}` : null].filter(Boolean).join(' · ') || null,
    loan.employee_code, `loan_${event}`);
  return info.lastInsertRowid;
}

module.exports = { writeEvent };
