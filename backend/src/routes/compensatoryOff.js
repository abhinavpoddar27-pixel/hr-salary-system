// Compensatory Off / On-Duty (OD) Requests — Phase 1 backend routes
//
// HR creates OD/comp-off requests for permanent employees (contractors
// excluded, same gate as OT / ED / late-coming). Finance reviews pending
// rows and approves or rejects with a mandatory remark. Approved rows are
// picked up by Stage 6 / Stage 7 in later phases — nothing here touches
// day_calculations or salary_computations.
//
// Mirrors the late_coming_deductions flow: immutable audit trail, role
// gates via req.user.role, finance_approvals row on every transition,
// audit_log entry for every state change.

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { isContractorForPayroll } = require('../utils/employeeClassification');

// ─── Role helpers ─────────────────────────────────────────
function requireHrOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR or admin access required' });
  }
  next();
}
function requireHrFinanceOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'finance' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR, finance, or admin access required' });
  }
  next();
}
function requireFinanceOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'finance' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Finance or admin access required' });
  }
  next();
}

// Helpers ───────────────────────────────────────────────
function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}
function isMonthFinalized(db, month, year, company) {
  let q = 'SELECT 1 FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1';
  const params = [month, year];
  if (company) { q += ' AND (company = ? OR company IS NULL)'; params.push(company); }
  q += ' LIMIT 1';
  return !!db.prepare(q).get(...params);
}
function writeAudit(db, payload) {
  try {
    db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.table_name, payload.record_id, payload.field_name,
      payload.old_value || '', payload.new_value || '',
      payload.changed_by, payload.stage, payload.remark || '',
      payload.employee_code, payload.action_type
    );
  } catch (e) { /* audit must never break the operation */ }
}

// ─── POST / — HR creates OD request ───────────────────────
router.post('/', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { employee_code, start_date, end_date, days, reason, hr_remark } = req.body || {};

  if (!employee_code || !start_date || !end_date || days == null || !reason || !hr_remark) {
    return res.status(400).json({
      success: false,
      error: 'employee_code, start_date, end_date, days, reason, hr_remark are required'
    });
  }
  if (!String(reason).trim() || !String(hr_remark).trim()) {
    return res.status(400).json({ success: false, error: 'reason and hr_remark cannot be empty' });
  }
  const numDays = parseFloat(days);
  if (isNaN(numDays) || numDays <= 0) {
    return res.status(400).json({ success: false, error: 'days must be > 0' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return res.status(400).json({ success: false, error: 'dates must be YYYY-MM-DD' });
  }
  if (start_date > end_date) {
    return res.status(400).json({ success: false, error: 'start_date must be <= end_date' });
  }

  const emp = db.prepare(`
    SELECT id, code, name, department, company, employment_type, is_contractor, category
    FROM employees WHERE code = ?
  `).get(employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  if (isContractorForPayroll(emp)) {
    return res.status(400).json({
      success: false,
      error: 'Compensatory off cannot be granted to contractors'
    });
  }

  const [y, m] = start_date.split('-').map(Number);
  const dim = daysInMonth(m, y);
  if (numDays > dim) {
    return res.status(400).json({
      success: false,
      error: `days (${numDays}) cannot exceed calendar days in month (${dim})`
    });
  }

  const company = emp.company || null;
  if (isMonthFinalized(db, m, y, company)) {
    return res.status(400).json({
      success: false,
      error: `Cannot submit comp-off for finalized month ${m}/${y}`
    });
  }

  let result;
  try {
    result = db.prepare(`
      INSERT INTO compensatory_off_requests
        (employee_code, employee_id, start_date, end_date, days, month, year, company,
         reason, hr_remark, applied_by, finance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      employee_code, emp.id, start_date, end_date, numDays, m, y, company,
      String(reason).trim(), String(hr_remark).trim(),
      req.user?.username || 'hr'
    );
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: 'A comp-off request already exists for this employee/start_date/month'
      });
    }
    throw err;
  }

  writeAudit(db, {
    table_name: 'compensatory_off_requests',
    record_id: result.lastInsertRowid,
    field_name: 'comp_off_applied',
    old_value: '',
    new_value: `${numDays} days (${start_date} → ${end_date})`,
    changed_by: req.user?.username || 'hr',
    stage: 'comp_off',
    remark: `Reason: ${String(reason).trim()} | HR: ${String(hr_remark).trim()}`,
    employee_code,
    action_type: 'comp_off_applied'
  });

  res.json({ success: true, id: result.lastInsertRowid });
});

// ─── GET / — List comp-off requests ───────────────────────
router.get('/', requireHrFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, company, employee_code, status } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (month) { where += ' AND c.month = ?'; params.push(parseInt(month)); }
  if (year)  { where += ' AND c.year = ?';  params.push(parseInt(year)); }
  if (company) { where += ' AND (c.company = ? OR c.company IS NULL)'; params.push(company); }
  if (employee_code) { where += ' AND c.employee_code = ?'; params.push(employee_code); }
  if (status && status !== 'all') {
    where += ' AND c.finance_status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT c.*, e.name, e.department, e.designation, e.shift_code
    FROM compensatory_off_requests c
    LEFT JOIN employees e ON e.code = c.employee_code
    ${where}
    ORDER BY c.applied_at DESC
  `).all(...params);

  res.json({ success: true, data: rows });
});

// ─── GET /pending — Finance review queue ──────────────────
router.get('/pending', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  let where = "WHERE c.finance_status = 'pending'";
  const params = [];
  if (month) { where += ' AND c.month = ?'; params.push(parseInt(month)); }
  if (year)  { where += ' AND c.year = ?';  params.push(parseInt(year)); }
  if (company) { where += ' AND (c.company = ? OR c.company IS NULL)'; params.push(company); }

  const rows = db.prepare(`
    SELECT c.*, e.name, e.department, e.designation, e.shift_code
    FROM compensatory_off_requests c
    LEFT JOIN employees e ON e.code = c.employee_code
    ${where}
    ORDER BY c.applied_at ASC
  `).all(...params);

  res.json({ success: true, data: rows });
});

// ─── PUT /:id/finance-review — approve / reject one row ───
// finance_remark is MANDATORY for both approve and reject (stricter than
// late_coming — an OD grant has real salary impact in Phase 3).
router.put('/:id/finance-review', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { status, finance_remark } = req.body || {};

  if (!id) return res.status(400).json({ success: false, error: 'id required' });
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, error: "status must be 'approved' or 'rejected'" });
  }
  if (!finance_remark || !String(finance_remark).trim()) {
    return res.status(400).json({ success: false, error: 'finance_remark is required for both approve and reject' });
  }

  const existing = db.prepare('SELECT * FROM compensatory_off_requests WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Comp-off request not found' });
  if (existing.finance_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Comp-off already ${existing.finance_status}` });
  }

  const reviewer = req.user?.username || 'finance';
  const cleanRemark = String(finance_remark).trim();

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE compensatory_off_requests
      SET finance_status = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now'),
          finance_remark = ?
      WHERE id = ?
    `).run(status, reviewer, cleanRemark, id);

    try {
      db.prepare(`
        INSERT INTO finance_approvals
          (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).run(
        existing.employee_code, existing.month, existing.year,
        id, status, reviewer, cleanRemark
      );
    } catch (e) { /* best effort — never break the review */ }

    writeAudit(db, {
      table_name: 'compensatory_off_requests',
      record_id: id,
      field_name: 'finance_status',
      old_value: 'pending',
      new_value: status,
      changed_by: reviewer,
      stage: 'comp_off',
      remark: `Finance ${status}: ${existing.days} days. ${cleanRemark}`,
      employee_code: existing.employee_code,
      action_type: 'finance_review'
    });
  });
  txn();

  res.json({ success: true, id, status });
});

// ─── PUT /bulk-review — batch approve / reject ────────────
router.put('/bulk-review', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { ids, status, finance_remark } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'ids array required' });
  }
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, error: "status must be 'approved' or 'rejected'" });
  }
  if (!finance_remark || !String(finance_remark).trim()) {
    return res.status(400).json({ success: false, error: 'finance_remark is required' });
  }

  const reviewer = req.user?.username || 'finance';
  const cleanRemark = String(finance_remark).trim();
  let count = 0;

  const txn = db.transaction(() => {
    for (const rawId of ids) {
      const id = parseInt(rawId);
      if (!id) continue;
      const existing = db.prepare('SELECT * FROM compensatory_off_requests WHERE id = ?').get(id);
      if (!existing || existing.finance_status !== 'pending') continue;

      db.prepare(`
        UPDATE compensatory_off_requests
        SET finance_status = ?, finance_reviewed_by = ?, finance_reviewed_at = datetime('now'),
            finance_remark = ?
        WHERE id = ?
      `).run(status, reviewer, cleanRemark, id);

      try {
        db.prepare(`
          INSERT INTO finance_approvals
            (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).run(
          existing.employee_code, existing.month, existing.year,
          id, status, reviewer, cleanRemark
        );
      } catch (e) { /* best effort */ }

      writeAudit(db, {
        table_name: 'compensatory_off_requests',
        record_id: id,
        field_name: 'finance_status',
        old_value: 'pending',
        new_value: status,
        changed_by: reviewer,
        stage: 'comp_off',
        remark: `Finance bulk ${status}: ${existing.days} days. ${cleanRemark}`,
        employee_code: existing.employee_code,
        action_type: 'finance_review'
      });

      count += 1;
    }
  });
  txn();

  res.json({ success: true, count });
});

// ─── DELETE /:id — HR cancels a pending request ────────────
// Only pending rows may be deleted, and only if the month is not finalized.
// Approved rows are immutable — they must be adjusted via a counter-request.
router.delete('/:id', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'id required' });

  const existing = db.prepare('SELECT * FROM compensatory_off_requests WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Comp-off request not found' });

  if (existing.finance_status !== 'pending') {
    return res.status(400).json({
      success: false,
      error: `Cannot delete: request is already ${existing.finance_status}`
    });
  }
  if (isMonthFinalized(db, existing.month, existing.year, existing.company)) {
    return res.status(400).json({
      success: false,
      error: `Cannot delete: month ${existing.month}/${existing.year} is finalized`
    });
  }

  db.prepare('DELETE FROM compensatory_off_requests WHERE id = ?').run(id);

  writeAudit(db, {
    table_name: 'compensatory_off_requests',
    record_id: id,
    field_name: 'comp_off_deleted',
    old_value: `pending (${existing.days} days)`,
    new_value: 'deleted',
    changed_by: req.user?.username || 'hr',
    stage: 'comp_off',
    remark: `HR cancelled pending comp-off: ${existing.reason}`,
    employee_code: existing.employee_code,
    action_type: 'comp_off_deleted'
  });

  res.json({ success: true, id });
});

module.exports = router;
