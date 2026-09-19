/**
 * The floor: `leave_balances.balance` may not go below zero.
 *
 * Why this exists
 * ---------------
 * Employee 23725 reached -5 EL and -2 CL through six single-day debits in four
 * minutes. The path taken (POST /api/leaves/adjust) had no balance check at all.
 * Two other paths — the leave approval and the finance apply-leave screen — did
 * check, but check-then-act: they SELECTed the balance, returned 400 if it was
 * short, then opened a transaction and ran an UPDATE with no predicate of its
 * own. Six requests in four minutes is exactly the shape that walks through a
 * non-atomic check.
 *
 * So the floor is enforced by the UPDATE statement itself:
 *
 *     ... WHERE employee_id = ? AND year = ? AND leave_type = ?
 *           AND balance + :delta >= 0
 *
 * and `changes !== 1` is the rejection path. Nothing here trusts a prior SELECT.
 * A read still happens, but only to build the error message after the write has
 * already declined — never to decide whether the write may proceed.
 *
 * There is deliberately NO CHECK constraint on the column. A CHECK would also
 * reject the admin override below, and it would reject the leave engine's
 * `applyLeavePlan`, whose negative closing balances are a derived *report* of
 * over-debiting rather than an act of it. The floor belongs on the write paths
 * a human can reach, not in the schema.
 *
 * The override
 * ------------
 * An authenticated admin may pass `allow_negative: true` together with a reason
 * of at least 10 characters. That, and only that, writes below zero, and it
 * always leaves an `audit_log` row with action `leave_balance_negative_override`.
 * A non-admin override is rejected. An override without a usable reason is
 * rejected. Nothing is ever silently clamped: every call either writes exactly
 * what the caller asked for, or refuses and says why.
 */

const MIN_OVERRIDE_REASON = 10;

/** Result helpers. Callers get a plain object, never a thrown class — an
 *  `instanceof` check across jest's per-file sandboxes is not reliable. */
const reject = (error, code, extra = {}) => ({ ok: false, status: 400, error, code, ...extra });

/**
 * Validate an override request.
 * @returns {null} when no override was asked for or it is usable,
 *          or a rejection object when it was asked for and is not.
 */
function checkOverride({ allowNegative, reason, role }) {
  if (!allowNegative) return null;
  if (String(role || '').trim().toLowerCase() !== 'admin') {
    return reject(
      'Only an admin may take a leave balance below zero.',
      'NEGATIVE_OVERRIDE_NOT_ADMIN'
    );
  }
  if (String(reason || '').trim().length < MIN_OVERRIDE_REASON) {
    return reject(
      `A reason of at least ${MIN_OVERRIDE_REASON} characters is required to take a leave balance below zero.`,
      'NEGATIVE_OVERRIDE_REASON_REQUIRED'
    );
  }
  return null;
}

function writeOverrideAudit(db, { employeeId, employeeCode, leaveType, days, newBalance, reason, username }) {
  try {
    db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by,
         stage, remark, employee_code, action_type)
      VALUES ('leave_balances', ?, ?, ?, ?, ?, 'leave_balance_guard', ?, ?, 'leave_balance_negative_override')
    `).run(
      employeeId, leaveType, String(days), String(newBalance),
      username || 'unknown', String(reason || ''), employeeCode || null
    );
  } catch (e) {
    // An audit failure must not roll back a write the admin authorised, but it
    // must be loud — a silent override is the thing this module exists to stop.
    console.error('[leaveBalanceGuard] override audit write failed:', e.message);
  }
}

/**
 * Move a leave balance by a relative delta, atomically, with the floor in SQL.
 *
 * @param {object}  db
 * @param {object}  o
 * @param {number}  o.employeeId
 * @param {string}  o.employeeCode    for error text and the audit row
 * @param {number}  o.year
 * @param {string}  o.leaveType
 * @param {number}  o.delta           change to `balance`; negative debits
 * @param {number} [o.usedDelta=0]    change to `used`
 * @param {boolean}[o.ensureRow=false] create a zeroed row first if missing
 * @param {boolean}[o.allowNegative=false]
 * @param {string} [o.reason]
 * @param {string} [o.role]
 * @param {string} [o.username]
 * @returns {{ok: true, oldBalance: number, newBalance: number, overridden: boolean}
 *         | {ok: false, status: number, error: string, code: string}}
 */
function adjustLeaveBalance(db, o) {
  const {
    employeeId, employeeCode, year, leaveType,
    delta, usedDelta = 0, ensureRow = false,
    allowNegative = false, reason, role, username,
  } = o;

  const d = Number(delta);
  if (!Number.isFinite(d)) return reject('days must be a finite number', 'INVALID_DAYS');

  const bad = checkOverride({ allowNegative, reason, role });
  if (bad) return bad;
  const overriding = Boolean(allowNegative);

  const run = db.transaction(() => {
    if (ensureRow) {
      db.prepare(`
        INSERT OR IGNORE INTO leave_balances
          (employee_id, year, leave_type, opening, accrued, used, balance)
        VALUES (?, ?, ?, 0, 0, 0, 0)
      `).run(employeeId, year, leaveType);
    }

    // The floor lives in the WHERE clause. With the override the predicate is
    // dropped, so an admin write is the only one that can land below zero.
    const sql = `
      UPDATE leave_balances
      SET used = used + ?, balance = balance + ?
      WHERE employee_id = ? AND year = ? AND leave_type = ?
      ${overriding ? '' : 'AND balance + ? >= 0'}
    `;
    const params = overriding
      ? [Number(usedDelta) || 0, d, employeeId, year, leaveType]
      : [Number(usedDelta) || 0, d, employeeId, year, leaveType, d];

    const info = db.prepare(sql).run(...params);

    if (info.changes !== 1) {
      // The write declined. Only now do we read, and only to say why.
      const row = db.prepare(
        'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
      ).get(employeeId, year, leaveType);
      const available = row ? Number(row.balance) || 0 : 0;
      return reject(
        `Cannot debit ${Math.abs(d)} day(s) of ${leaveType} for ${employeeCode}: `
        + `${available} day(s) available. An admin may override with a written reason.`,
        'INSUFFICIENT_LEAVE_BALANCE',
        { employeeCode, leaveType, requested: Math.abs(d), available }
      );
    }

    const after = db.prepare(
      'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
    ).get(employeeId, year, leaveType);
    const newBalance = Number(after.balance) || 0;

    if (overriding && newBalance < 0) {
      writeOverrideAudit(db, {
        employeeId, employeeCode, leaveType, days: d, newBalance, reason, username,
      });
    }

    return { ok: true, oldBalance: Math.round((newBalance - d) * 100) / 100, newBalance, overridden: overriding && newBalance < 0 };
  });

  return run();
}

/**
 * Overwrite `opening` / `used` outright and derive `balance` from them.
 *
 * Used by PUT /api/employees/:code/leaves, which is a correction of the record
 * rather than a movement of it. No race to lose here: the write is absolute, so
 * concurrent callers cannot compound into an overdraft the way two relative
 * debits can. The floor is simply that the derived balance must not be negative.
 */
function setLeaveBalance(db, o) {
  const {
    employeeId, employeeCode, year, leaveType, opening, used,
    allowNegative = false, reason, role, username,
  } = o;

  const op = parseFloat(opening) || 0;
  const us = parseFloat(used) || 0;
  const balance = Math.round((op - us) * 100) / 100;

  const bad = checkOverride({ allowNegative, reason, role });
  if (bad) return bad;

  if (balance < 0 && !allowNegative) {
    return reject(
      `Cannot set ${leaveType} for ${employeeCode} to ${balance}: `
      + `opening ${op} minus used ${us} is below zero. An admin may override with a written reason.`,
      'NEGATIVE_LEAVE_BALANCE',
      { employeeCode, leaveType, opening: op, used: us, balance }
    );
  }

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO leave_balances (employee_id, year, leave_type, opening, used, balance)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
        opening = excluded.opening, used = excluded.used, balance = excluded.balance
    `).run(employeeId, year, leaveType, op, us, balance);

    if (balance < 0) {
      writeOverrideAudit(db, {
        employeeId, employeeCode, leaveType, days: balance, newBalance: balance, reason, username,
      });
    }
    return { ok: true, newBalance: balance, overridden: balance < 0 };
  });

  return run();
}

module.exports = { adjustLeaveBalance, setLeaveBalance, MIN_OVERRIDE_REASON };
