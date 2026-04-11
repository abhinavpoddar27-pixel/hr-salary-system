// Early Exit Deductions — HR submit/revise/cancel + Finance approve/reject
//
// Linked to early_exit_detections. Each deduction goes through:
//   HR submit → Finance pending → Finance approve/reject
//   If rejected → HR can revise & resubmit
// Mounted at /api/early-exit-deductions.

const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');

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

function daysInMonth(dateStr) {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ────────────────────────────────────────────────────────────
// POST / — HR submit deduction
// ────────────────────────────────────────────────────────────
router.post('/', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { early_exit_detection_id, deduction_type, deduction_amount, hr_remark } = req.body;

    if (!early_exit_detection_id) {
      return res.status(400).json({ success: false, error: 'early_exit_detection_id is required' });
    }

    // Validate detection exists
    const detection = db.prepare('SELECT * FROM early_exit_detections WHERE id = ?').get(early_exit_detection_id);
    if (!detection) {
      return res.status(404).json({ success: false, error: 'Detection not found' });
    }
    if (!['flagged', 'actioned'].includes(detection.detection_status)) {
      return res.status(422).json({ success: false, error: `Detection status is '${detection.detection_status}', must be flagged or actioned` });
    }

    // Check no active deduction already exists
    const existing = db.prepare(`
      SELECT id FROM early_exit_deductions
      WHERE early_exit_detection_id = ? AND finance_status != 'cancelled'
    `).get(early_exit_detection_id);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An active deduction already exists for this detection' });
    }

    // Validate hr_remark
    if (!hr_remark || !hr_remark.trim()) {
      return res.status(400).json({ success: false, error: 'HR remark is required' });
    }

    // Validate deduction_type
    const validTypes = ['warning', 'half_day', 'full_day', 'custom'];
    if (!deduction_type || !validTypes.includes(deduction_type)) {
      return res.status(400).json({ success: false, error: `deduction_type must be one of: ${validTypes.join(', ')}` });
    }

    // Validate amount
    if (deduction_type !== 'warning' && (!deduction_amount || deduction_amount <= 0)) {
      return res.status(400).json({ success: false, error: 'deduction_amount is required for non-warning deductions' });
    }

    // Compute daily_gross_at_time
    const emp = db.prepare('SELECT gross_salary FROM employees WHERE code = ?').get(detection.employee_code);
    const grossSalary = emp?.gross_salary || 0;
    const dim = daysInMonth(detection.date);
    const dailyGross = Math.round(grossSalary / dim);

    // Extract payroll month/year from detection date
    const detDate = new Date(detection.date);
    const payrollMonth = detDate.getMonth() + 1;
    const payrollYear = detDate.getFullYear();

    // Generate auto remark
    const hrAutoRemark = `Early exit on ${detection.date}: left at ${detection.actual_punch_out_time} (shift ends ${detection.shift_end_time}), ${detection.flagged_minutes} min early.${detection.has_gate_pass ? ' Had gate pass.' : ''} Deduction: ${deduction_type}.`;

    const result = db.prepare(`
      INSERT INTO early_exit_deductions (
        early_exit_detection_id, employee_id, employee_code, employee_name,
        department, company, date, deduction_type, deduction_amount,
        daily_gross_at_time, payroll_month, payroll_year,
        hr_remark, hr_auto_remark, submitted_by, submitted_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      early_exit_detection_id, detection.employee_id, detection.employee_code,
      detection.employee_name, detection.department, detection.company,
      detection.date, deduction_type,
      deduction_type === 'warning' ? null : deduction_amount,
      dailyGross, payrollMonth, payrollYear,
      hr_remark.trim(), hrAutoRemark,
      req.user.id, req.user.name || req.user.username
    );

    // Audit
    db.prepare(`
      INSERT INTO early_exit_deduction_audit (
        deduction_id, action, new_deduction_type, new_amount,
        old_finance_status, new_finance_status, remark,
        performed_by, performed_by_name
      ) VALUES (?, 'submitted', ?, ?, NULL, 'pending', ?, ?, ?)
    `).run(
      result.lastInsertRowid, deduction_type,
      deduction_type === 'warning' ? null : deduction_amount,
      hr_remark.trim(), req.user.id, req.user.name || req.user.username
    );

    // Update detection status
    db.prepare("UPDATE early_exit_detections SET detection_status = 'actioned' WHERE id = ?")
      .run(early_exit_detection_id);

    return res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      deduction_amount: deduction_type === 'warning' ? 0 : deduction_amount
    });
  } catch (err) {
    console.error('[early-exit-deductions] POST / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /finance/pending — All pending deductions for finance
// ────────────────────────────────────────────────────────────
router.get('/finance/pending', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { company, month, year } = req.query;

    let sql = `
      SELECT edd.*,
        eed.shift_code, eed.shift_end_time, eed.actual_punch_out_time,
        eed.minutes_early, eed.flagged_minutes, eed.has_gate_pass,
        eed.gate_pass_overage_minutes,
        sl.quota_breach as gate_pass_quota_breach, sl.leave_type as gate_pass_type
      FROM early_exit_deductions edd
      JOIN early_exit_detections eed ON eed.id = edd.early_exit_detection_id
      LEFT JOIN short_leaves sl ON sl.id = eed.short_leave_id
      WHERE edd.finance_status = 'pending'
    `;
    const params = [];

    if (company) { sql += ' AND edd.company = ?'; params.push(company); }
    if (month) { sql += ' AND edd.payroll_month = ?'; params.push(parseInt(month)); }
    if (year) { sql += ' AND edd.payroll_year = ?'; params.push(parseInt(year)); }

    sql += ' ORDER BY edd.submitted_at DESC';

    const data = db.prepare(sql).all(...params);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[early-exit-deductions] GET /finance/pending error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET / — List deductions with filters
// ────────────────────────────────────────────────────────────
router.get('/', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employee_code, month, year, finance_status, company } = req.query;

    let sql = `
      SELECT edd.*,
        eed.shift_code, eed.shift_end_time, eed.actual_punch_out_time,
        eed.minutes_early, eed.flagged_minutes, eed.has_gate_pass
      FROM early_exit_deductions edd
      JOIN early_exit_detections eed ON eed.id = edd.early_exit_detection_id
      WHERE 1=1
    `;
    const params = [];

    if (employee_code) { sql += ' AND edd.employee_code = ?'; params.push(employee_code); }
    if (month) { sql += ' AND edd.payroll_month = ?'; params.push(parseInt(month)); }
    if (year) { sql += ' AND edd.payroll_year = ?'; params.push(parseInt(year)); }
    if (finance_status) { sql += ' AND edd.finance_status = ?'; params.push(finance_status); }
    if (company) { sql += ' AND edd.company = ?'; params.push(company); }

    sql += ' ORDER BY edd.submitted_at DESC';

    const data = db.prepare(sql).all(...params);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[early-exit-deductions] GET / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id — Single deduction with audit trail
// ────────────────────────────────────────────────────────────
router.get('/:id', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT edd.*,
        eed.shift_code, eed.shift_end_time, eed.actual_punch_out_time,
        eed.minutes_early, eed.flagged_minutes, eed.has_gate_pass,
        eed.detection_status
      FROM early_exit_deductions edd
      JOIN early_exit_detections eed ON eed.id = edd.early_exit_detection_id
      WHERE edd.id = ?
    `).get(req.params.id);

    if (!record) return res.status(404).json({ success: false, error: 'Deduction not found' });

    const audit = db.prepare(`
      SELECT * FROM early_exit_deduction_audit
      WHERE deduction_id = ?
      ORDER BY performed_at ASC
    `).all(req.params.id);

    return res.json({ success: true, data: record, audit });
  } catch (err) {
    console.error('[early-exit-deductions] GET /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /:id — HR revise deduction
// ────────────────────────────────────────────────────────────
router.put('/:id', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM early_exit_deductions WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Deduction not found' });

    if (!['rejected', 'pending'].includes(record.finance_status)) {
      return res.status(422).json({ success: false, error: `Cannot revise deduction with finance_status '${record.finance_status}'` });
    }

    const { deduction_type, deduction_amount, hr_remark } = req.body;

    if (hr_remark && !hr_remark.trim()) {
      return res.status(400).json({ success: false, error: 'HR remark cannot be empty' });
    }

    const newType = deduction_type || record.deduction_type;
    const newAmount = deduction_type === 'warning' ? null : (deduction_amount || record.deduction_amount);
    const newRemark = hr_remark ? hr_remark.trim() : record.hr_remark;

    db.prepare(`
      UPDATE early_exit_deductions
      SET deduction_type = ?, deduction_amount = ?, hr_remark = ?,
          hr_revised_at = datetime('now'), finance_status = 'pending'
      WHERE id = ?
    `).run(newType, newAmount, newRemark, req.params.id);

    // Audit
    db.prepare(`
      INSERT INTO early_exit_deduction_audit (
        deduction_id, action, old_deduction_type, new_deduction_type,
        old_amount, new_amount, old_finance_status, new_finance_status,
        remark, performed_by, performed_by_name
      ) VALUES (?, 'revised', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      req.params.id, record.deduction_type, newType,
      record.deduction_amount, newAmount,
      record.finance_status, newRemark,
      req.user.id, req.user.name || req.user.username
    );

    return res.json({ success: true, message: 'Deduction revised and resubmitted for finance approval' });
  } catch (err) {
    console.error('[early-exit-deductions] PUT /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /:id — HR cancel (soft)
// ────────────────────────────────────────────────────────────
router.delete('/:id', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM early_exit_deductions WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Deduction not found' });

    if (record.finance_status !== 'pending') {
      return res.status(422).json({ success: false, error: `Cannot cancel deduction with finance_status '${record.finance_status}'` });
    }

    db.prepare("UPDATE early_exit_deductions SET finance_status = 'cancelled' WHERE id = ?")
      .run(req.params.id);

    // Revert detection status
    db.prepare(`
      UPDATE early_exit_detections SET detection_status = 'flagged'
      WHERE id = ?
    `).run(record.early_exit_detection_id);

    // Audit
    db.prepare(`
      INSERT INTO early_exit_deduction_audit (
        deduction_id, action, old_finance_status, new_finance_status,
        remark, performed_by, performed_by_name
      ) VALUES (?, 'cancelled', 'pending', 'cancelled', ?, ?, ?)
    `).run(
      req.params.id, 'Cancelled by HR',
      req.user.id, req.user.name || req.user.username
    );

    return res.json({ success: true, message: 'Deduction cancelled' });
  } catch (err) {
    console.error('[early-exit-deductions] DELETE /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /:id/approve — Finance approve
// ────────────────────────────────────────────────────────────
router.put('/:id/approve', requireFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM early_exit_deductions WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Deduction not found' });

    if (record.finance_status !== 'pending') {
      return res.status(422).json({ success: false, error: `Cannot approve deduction with finance_status '${record.finance_status}'` });
    }

    db.prepare(`
      UPDATE early_exit_deductions
      SET finance_status = 'approved', finance_reviewed_by = ?,
          finance_reviewed_by_name = ?, finance_reviewed_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, req.user.name || req.user.username, req.params.id);

    // Audit
    db.prepare(`
      INSERT INTO early_exit_deduction_audit (
        deduction_id, action, old_finance_status, new_finance_status,
        remark, performed_by, performed_by_name
      ) VALUES (?, 'approved', 'pending', 'approved', ?, ?, ?)
    `).run(
      req.params.id, 'Approved by finance',
      req.user.id, req.user.name || req.user.username
    );

    logAudit('early_exit_deductions', req.params.id, 'finance_status', 'pending', 'approved',
      req.user.name || req.user.username, `Early exit deduction approved for ${record.employee_code}`);

    return res.json({ success: true, message: 'Deduction approved' });
  } catch (err) {
    console.error('[early-exit-deductions] PUT /:id/approve error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /:id/reject — Finance reject
// ────────────────────────────────────────────────────────────
router.put('/:id/reject', requireFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM early_exit_deductions WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Deduction not found' });

    if (record.finance_status !== 'pending') {
      return res.status(422).json({ success: false, error: `Cannot reject deduction with finance_status '${record.finance_status}'` });
    }

    const { finance_remark } = req.body;
    if (!finance_remark || !finance_remark.trim()) {
      return res.status(400).json({ success: false, error: 'Finance remark is required for rejection' });
    }

    db.prepare(`
      UPDATE early_exit_deductions
      SET finance_status = 'rejected', finance_remark = ?,
          finance_reviewed_by = ?, finance_reviewed_by_name = ?,
          finance_reviewed_at = datetime('now')
      WHERE id = ?
    `).run(finance_remark.trim(), req.user.id, req.user.name || req.user.username, req.params.id);

    // Audit
    db.prepare(`
      INSERT INTO early_exit_deduction_audit (
        deduction_id, action, old_finance_status, new_finance_status,
        remark, performed_by, performed_by_name
      ) VALUES (?, 'rejected', 'pending', 'rejected', ?, ?, ?)
    `).run(
      req.params.id, finance_remark.trim(),
      req.user.id, req.user.name || req.user.username
    );

    logAudit('early_exit_deductions', req.params.id, 'finance_status', 'pending', 'rejected',
      req.user.name || req.user.username, `Early exit deduction rejected for ${record.employee_code}`);

    return res.json({ success: true, message: 'Deduction rejected' });
  } catch (err) {
    console.error('[early-exit-deductions] PUT /:id/reject error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
