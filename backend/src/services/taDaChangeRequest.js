'use strict';

/**
 * TA/DA Change Request Service (Phase 2, April 2026)
 *
 * All HR changes to sales_employees TA/DA rates go through this queue:
 *   HR submits a request (POST /ta-da-requests)
 *   Finance approves or rejects (POST /:id/approve | /:id/reject)
 *   HR can cancel their own pending request (POST /:id/cancel)
 *
 * Invariants (ALL enforced here, not in routes):
 *   1. Self-approval guard: approver username != requester username
 *   2. Supersede-previous-pending: a new request for an employee with an
 *      existing pending request is atomic — both rows updated in one txn
 *   3. Already-resolved guard: approve/reject/cancel on non-pending row 409s
 *   4. Approve is atomic: sales_employees update + request status flip in
 *      the same transaction (all-or-nothing)
 *
 * Routes (sales.js) are thin wrappers; business rules live here.
 */

const VALID_CLASSES = new Set([0, 1, 2, 3, 4, 5]);

function validateNumericOrNull(val, fieldName) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${fieldName} must be a non-negative number or null`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function validateClass(val) {
  if (val === null || val === undefined) {
    const err = new Error('new_ta_da_class is required');
    err.statusCode = 400;
    throw err;
  }
  const n = Number(val);
  if (!VALID_CLASSES.has(n)) {
    const err = new Error(`new_ta_da_class must be one of 0..5 (got ${val})`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * Create a new change request. If one is already pending for the
 * employee, mark it as superseded in the same transaction.
 *
 * @returns {{ request: Object, supersededId: number|null }}
 */
function createRequest(db, body, username) {
  if (!username) {
    const err = new Error('authenticated user required');
    err.statusCode = 401;
    throw err;
  }

  const {
    employee_code,
    new_ta_da_class,
    new_da_rate,
    new_da_outstation_rate,
    new_ta_rate_primary,
    new_ta_rate_secondary,
    new_ta_da_notes,
    reason,
  } = body || {};

  if (!employee_code || typeof employee_code !== 'string') {
    const err = new Error('employee_code is required');
    err.statusCode = 400;
    throw err;
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    const err = new Error('reason is required');
    err.statusCode = 400;
    throw err;
  }

  const cls = validateClass(new_ta_da_class);
  const daRate = validateNumericOrNull(new_da_rate, 'new_da_rate');
  const daOutstationRate = validateNumericOrNull(new_da_outstation_rate, 'new_da_outstation_rate');
  const taRatePrimary = validateNumericOrNull(new_ta_rate_primary, 'new_ta_rate_primary');
  const taRateSecondary = validateNumericOrNull(new_ta_rate_secondary, 'new_ta_rate_secondary');
  const notes = (new_ta_da_notes === null || new_ta_da_notes === undefined)
    ? null : String(new_ta_da_notes);

  const employee = db.prepare(
    'SELECT id, ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary, ta_da_notes FROM sales_employees WHERE code = ?'
  ).get(employee_code);
  if (!employee) {
    const err = new Error(`sales employee not found: ${employee_code}`);
    err.statusCode = 404;
    throw err;
  }

  const existingPending = db.prepare(
    "SELECT id FROM sales_ta_da_change_requests WHERE employee_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1"
  ).get(employee.id);

  const insertStmt = db.prepare(`
    INSERT INTO sales_ta_da_change_requests (
      employee_id, employee_code, status,
      new_ta_da_class, new_da_rate, new_da_outstation_rate,
      new_ta_rate_primary, new_ta_rate_secondary, new_ta_da_notes,
      old_ta_da_class, old_da_rate, old_da_outstation_rate,
      old_ta_rate_primary, old_ta_rate_secondary, old_ta_da_notes,
      reason, requested_by
    ) VALUES (
      ?, ?, 'pending',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  const supersedeStmt = db.prepare(`
    UPDATE sales_ta_da_change_requests
       SET status = 'superseded', superseded_by_request_id = ?, resolved_at = datetime('now')
     WHERE id = ? AND status = 'pending'
  `);

  const txn = db.transaction(() => {
    const info = insertStmt.run(
      employee.id, employee_code,
      cls, daRate, daOutstationRate, taRatePrimary, taRateSecondary, notes,
      employee.ta_da_class, employee.da_rate, employee.da_outstation_rate,
      employee.ta_rate_primary, employee.ta_rate_secondary, employee.ta_da_notes,
      reason.trim(), username
    );
    const newId = info.lastInsertRowid;
    let supersededId = null;
    if (existingPending) {
      supersedeStmt.run(newId, existingPending.id);
      supersededId = existingPending.id;
    }
    return { newId, supersededId };
  });

  const { newId, supersededId } = txn();
  const request = db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(newId);
  return { request, supersededId };
}

function approveRequest(db, id, username) {
  if (!username) {
    const err = new Error('authenticated user required');
    err.statusCode = 401;
    throw err;
  }
  const request = db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
  if (!request) {
    const err = new Error('request not found');
    err.statusCode = 404;
    throw err;
  }

  if (request.status !== 'pending') {
    const err = new Error(`request already ${request.status}`);
    err.statusCode = 409;
    err.actualStatus = request.status;
    throw err;
  }

  if (request.requested_by === username) {
    const err = new Error('cannot resolve your own request');
    err.statusCode = 403;
    throw err;
  }

  const updateEmp = db.prepare(`
    UPDATE sales_employees
       SET ta_da_class        = ?,
           da_rate            = ?,
           da_outstation_rate = ?,
           ta_rate_primary    = ?,
           ta_rate_secondary  = ?,
           ta_da_notes        = ?,
           ta_da_updated_at   = datetime('now'),
           ta_da_updated_by   = ?
     WHERE id = ?
  `);

  const updateReq = db.prepare(`
    UPDATE sales_ta_da_change_requests
       SET status       = 'approved',
           resolved_by  = ?,
           resolved_at  = datetime('now'),
           applied_at   = datetime('now')
     WHERE id = ? AND status = 'pending'
  `);

  const txn = db.transaction(() => {
    const r = updateReq.run(username, id);
    if (r.changes === 0) {
      // Race: another approver slipped in between our pre-check and UPDATE.
      // Re-read and throw 409.
      const fresh = db.prepare('SELECT status FROM sales_ta_da_change_requests WHERE id = ?').get(id);
      const err = new Error(`request already ${fresh?.status || 'resolved'}`);
      err.statusCode = 409;
      err.actualStatus = fresh?.status;
      throw err;
    }
    updateEmp.run(
      request.new_ta_da_class,
      request.new_da_rate,
      request.new_da_outstation_rate,
      request.new_ta_rate_primary,
      request.new_ta_rate_secondary,
      request.new_ta_da_notes,
      username,
      request.employee_id
    );
  });
  txn();

  return db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
}

function rejectRequest(db, id, body, username) {
  if (!username) {
    const err = new Error('authenticated user required');
    err.statusCode = 401;
    throw err;
  }
  const rejectionReason = (body && body.rejection_reason) || '';
  if (!rejectionReason || !String(rejectionReason).trim()) {
    const err = new Error('rejection_reason is required');
    err.statusCode = 400;
    throw err;
  }

  const request = db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
  if (!request) {
    const err = new Error('request not found');
    err.statusCode = 404;
    throw err;
  }
  if (request.status !== 'pending') {
    const err = new Error(`request already ${request.status}`);
    err.statusCode = 409;
    err.actualStatus = request.status;
    throw err;
  }
  if (request.requested_by === username) {
    const err = new Error('cannot resolve your own request');
    err.statusCode = 403;
    throw err;
  }

  const updateReq = db.prepare(`
    UPDATE sales_ta_da_change_requests
       SET status            = 'rejected',
           resolved_by       = ?,
           resolved_at       = datetime('now'),
           rejection_reason  = ?
     WHERE id = ? AND status = 'pending'
  `);
  const info = updateReq.run(username, String(rejectionReason).trim(), id);
  if (info.changes === 0) {
    const fresh = db.prepare('SELECT status FROM sales_ta_da_change_requests WHERE id = ?').get(id);
    const err = new Error(`request already ${fresh?.status || 'resolved'}`);
    err.statusCode = 409;
    err.actualStatus = fresh?.status;
    throw err;
  }

  return db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
}

function cancelRequest(db, id, username) {
  if (!username) {
    const err = new Error('authenticated user required');
    err.statusCode = 401;
    throw err;
  }
  const request = db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
  if (!request) {
    const err = new Error('request not found');
    err.statusCode = 404;
    throw err;
  }
  if (request.requested_by !== username) {
    const err = new Error('not the request owner');
    err.statusCode = 403;
    throw err;
  }
  if (request.status !== 'pending') {
    const err = new Error(`request already ${request.status}`);
    err.statusCode = 409;
    err.actualStatus = request.status;
    throw err;
  }

  const info = db.prepare(`
    UPDATE sales_ta_da_change_requests
       SET status       = 'cancelled',
           resolved_by  = ?,
           resolved_at  = datetime('now')
     WHERE id = ? AND status = 'pending'
  `).run(username, id);
  if (info.changes === 0) {
    const fresh = db.prepare('SELECT status FROM sales_ta_da_change_requests WHERE id = ?').get(id);
    const err = new Error(`request already ${fresh?.status || 'resolved'}`);
    err.statusCode = 409;
    err.actualStatus = fresh?.status;
    throw err;
  }

  return db.prepare('SELECT * FROM sales_ta_da_change_requests WHERE id = ?').get(id);
}

// ── Read endpoints ──────────────────────────────────────────────────

const JOIN_SELECT = `
  SELECT r.*,
         e.name         AS employee_name,
         e.company      AS employee_company,
         e.headquarters AS employee_headquarters
    FROM sales_ta_da_change_requests r
    LEFT JOIN sales_employees e ON e.id = r.employee_id
`;

function listRequests(db, { status, employee_code } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('r.status = ?'); args.push(status); }
  if (employee_code) { where.push('r.employee_code = ?'); args.push(employee_code); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `${JOIN_SELECT} ${whereSql} ORDER BY r.requested_at DESC, r.id DESC`
  ).all(...args);
  return rows;
}

function getRequestsByEmployee(db, employeeCode) {
  return db.prepare(
    `${JOIN_SELECT} WHERE r.employee_code = ? ORDER BY r.requested_at DESC, r.id DESC`
  ).all(employeeCode);
}

function getRequestById(db, id) {
  return db.prepare(`${JOIN_SELECT} WHERE r.id = ?`).get(id);
}

function countPending(db) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM sales_ta_da_change_requests WHERE status = 'pending'"
  ).get().n;
}

module.exports = {
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  listRequests,
  getRequestsByEmployee,
  getRequestById,
  countPending,
};
