const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireHrOrAdmin, requireFinanceOrAdmin } = require('../middleware/roles');
const { structureForDate } = require('../services/statutoryFlags');

// P5-04 (ruling Q-B7): the approval helpers and the approve body live in services/salaryChange.js,
// shared with the bulk salary revision so both paths approve the same way.
const {
  STATUTORY_FLAG_FIELDS, resolveApproval, istToday, requestedCeiling, sameUser, SELF_APPROVAL, approveSalaryChange,
  raiseSalaryChangeRequest,
} = require('../services/salaryChange');
const { checkRequestStructure } = require('../services/salarySplit');

/**
 * GET /api/salary-input/all
 * Get all employees with their current salary structures
 */
router.get('/all', (req, res) => {
  const db = getDb();

  const employees = db.prepare(`
    SELECT e.id, e.code, e.name, e.department, e.designation, e.company,
           e.date_of_joining, e.status,
           ss.basic, ss.da, ss.hra, ss.conveyance, ss.other_allowances,
           ss.pf_applicable, ss.esi_applicable, ss.lwf_applicable, ss.effective_from,
           (COALESCE(ss.basic,0) + COALESCE(ss.da,0) + COALESCE(ss.hra,0) +
            COALESCE(ss.conveyance,0) + COALESCE(ss.other_allowances,0)) as gross_salary
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id
      ORDER BY effective_from DESC LIMIT 1
    )
    WHERE e.status != 'Inactive'
    ORDER BY e.department, e.name
  `).all();

  res.json({ success: true, data: employees });
});

/**
 * POST /api/salary-input/request-change
 * HR proposes a salary structure change. Two-tier workflow modelled on
 * extra-duty grants: HR submits → Finance approves via /approve/:id.
 * Gated by requireHrOrAdmin so a viewer / employee / supervisor can't
 * silently inject gross-salary changes.
 */
router.post('/request-change', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { employeeCode, reason } = req.body;
  const requestedBy = req.user?.username || 'admin';
  const rawStructure = req.body.newStructure || {};
  const ignoredFields = STATUTORY_FLAG_FIELDS.filter((f) => rawStructure[f] !== undefined);
  const newStructure = Object.fromEntries(Object.entries(rawStructure).filter(([k]) => !STATUTORY_FLAG_FIELDS.includes(k)));

  const emp = db.prepare('SELECT id, code FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  // N-PF-LOWS: same number rules as Employee Master (text → NOT_A_NUMBER, negatives /
  // percents outside 0–100 / ceiling outside (0, ₹1,00,000] → SPLIT_OUT_OF_RANGE). Nothing written.
  const bad = checkRequestStructure(newStructure);
  if (bad) return res.status(400).json({ success: false, code: bad.code, field: bad.field, error: `${bad.error} — nothing was saved` });

  // Get current salary structure
  const current = db.prepare(`
    SELECT * FROM salary_structures WHERE employee_id = ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(emp.id);

  const num = (v) => parseFloat(v) || 0;
  const oldGross = current
    ? num(current.basic) + num(current.da) + num(current.hra) + num(current.conveyance) + num(current.other_allowances)
    : 0;

  const newGross = num(newStructure.basic) + num(newStructure.da) + num(newStructure.hra) +
    num(newStructure.conveyance) + num(newStructure.other_allowances);

  // N-PF-LOWS (ruling Q8): one Pending request per employee, the same rule as Employee Master.
  const raised = raiseSalaryChangeRequest(db, {
    emp, code: emp.code, requestedBy, oldGross, newGross,
    oldStructure: current, newStructure, reason: reason || '',
  });
  const extra = ignoredFields.length ? { ignoredFields } : {};
  if (raised.alreadyPending) {
    return res.json({
      success: true, pendingApproval: true, alreadyPending: true, notSaved: true, ...extra,
      message: 'A salary change request is already pending finance approval for this employee — this request was not saved.',
    });
  }
  res.json({ success: true, message: 'Salary change request submitted for approval', ...extra });
});

/**
 * GET /api/salary-input/pending-changes
 * Get all pending salary change requests
 */
router.get('/pending-changes', (req, res) => {
  const db = getDb();

  const records = db.prepare(`
    SELECT scr.*, e.name as employee_name, e.department, e.designation
    FROM salary_change_requests scr
    LEFT JOIN employees e ON scr.employee_code = e.code
    WHERE scr.status = 'Pending'
    ORDER BY scr.created_at DESC
  `).all();

  // Parse JSON fields
  const today = istToday();
  records.forEach(r => {
    try { r.old_structure = JSON.parse(r.old_structure); } catch { r.old_structure = {}; }
    try { r.new_structure = JSON.parse(r.new_structure); } catch { r.new_structure = {}; }
    // What an approval today would write (N-17) — same function as /approve.
    const current = r.employee_id ? structureForDate(db, 'plant', r.employee_id, today) : null;
    const p = resolveApproval(r.new_structure, current);
    r.approval_preview = { components: p.components, kept: p.kept, gross: p.gross, componentSum: p.componentSum, effective_from: today };
  });

  res.json({ success: true, data: records });
});

/**
 * GET /api/salary-input/all-changes
 * Get all salary change requests (history)
 */
router.get('/all-changes', (req, res) => {
  const db = getDb();

  const records = db.prepare(`
    SELECT scr.*, e.name as employee_name, e.department, e.designation
    FROM salary_change_requests scr
    LEFT JOIN employees e ON scr.employee_code = e.code
    ORDER BY scr.created_at DESC
    LIMIT 200
  `).all();

  records.forEach(r => {
    try { r.old_structure = JSON.parse(r.old_structure); } catch { r.old_structure = {}; }
    try { r.new_structure = JSON.parse(r.new_structure); } catch { r.new_structure = {}; }
  });

  res.json({ success: true, data: records });
});

/**
 * PUT /api/salary-input/approve/:id
 * Finance approves a salary change request — applies to salary_structures.
 * Gated by requireFinanceOrAdmin so HR cannot self-approve their own
 * gross-salary change request (the whole point of the two-tier flow).
 */
router.put('/approve/:id', requireFinanceOrAdmin, (req, res) => {
  const r = approveSalaryChange(getDb(), {
    id: req.params.id,
    actor: req.user?.username,
    approvedBy: req.user?.username || 'admin',
    effectiveFrom: req.body.effectiveFrom,
  });
  if (!r.ok) return res.status(r.status).json(r.body);
  res.json({ success: true, message: 'Salary change approved and applied', effectiveFrom: r.effectiveFrom, gross: r.gross, keptComponents: r.keptComponents });
});

/**
 * PUT /api/salary-input/reject/:id
 * Finance rejects a pending salary change request. Gated identical to
 * /approve/:id and archives the original payload to the unified
 * `finance_rejections` table so the rejection has a queryable audit
 * trail (matching the extra-duty / miss-punch reject flows).
 */
router.put('/reject/:id', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, error: 'Rejection reason required' });

  const rejectedBy = req.user?.username || 'finance';
  const request = db.prepare("SELECT * FROM salary_change_requests WHERE id = ? AND status = 'Pending'").get(id);
  if (!request) return res.status(404).json({ success: false, error: 'Request not found or already processed' });
  if (sameUser(req.user?.username, request.requested_by)) return res.status(403).json(SELF_APPROVAL);

  // Archive snapshot BEFORE flipping status, mirroring the
  // archiveRejection() helper used by extra-duty grants.
  try {
    const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(request.employee_code) || {};
    db.prepare(`
      INSERT INTO finance_rejections
        (rejection_type, source_table, source_record_id, employee_code,
         employee_name, department, month, year, company,
         original_details, rejection_reason, rejected_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'GROSS_SALARY_CHANGE_FINANCE', 'salary_change_requests', request.id, request.employee_code,
      emp.name || '', emp.department || '', null, null, '',
      JSON.stringify(request), reason, rejectedBy
    );
  } catch (e) {
    console.error('[finance_rejections] gross-salary archive error:', e.message);
  }

  db.prepare(`
    UPDATE salary_change_requests SET status = 'Rejected', approved_by = ?, approved_at = datetime('now')
    WHERE id = ? AND status = 'Pending'
  `).run(rejectedBy, id);

  res.json({ success: true, message: 'Salary change rejected' });
});

module.exports = router;
module.exports.resolveApproval = resolveApproval;
module.exports.istToday = istToday;
module.exports.requestedCeiling = requestedCeiling;
