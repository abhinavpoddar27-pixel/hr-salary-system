// Short Leave / Gate Pass Management — April 2026
//
// CRUD for gate passes (short_leaves table). Each record represents an
// authorised early departure for a specific employee on a specific date.
// Quota: 2 per employee per calendar month (breachable with force flag).

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

// ─── Helpers ─────────────────────────────────────────
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────
// POST / — Create gate pass
// ────────────────────────────────────────────────────────────
router.post('/', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employee_code, date, leave_type, remark, force_quota_breach } = req.body;

    // Validations
    if (!employee_code) return res.status(400).json({ success: false, error: 'employee_code is required' });
    if (!date) return res.status(400).json({ success: false, error: 'date is required' });
    if (!leave_type || !['short_leave', 'half_day'].includes(leave_type)) {
      return res.status(400).json({ success: false, error: 'leave_type must be short_leave or half_day' });
    }
    if (!remark || !remark.trim()) {
      return res.status(400).json({ success: false, error: 'Remark is required' });
    }

    // Date not > 7 days in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateObj = new Date(date + 'T00:00:00');
    const diffDays = Math.floor((today - dateObj) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) {
      return res.status(422).json({ success: false, error: 'Cannot create gate pass for a date more than 7 days in the past' });
    }

    // Lookup employee
    const emp = db.prepare('SELECT id, name, department, company FROM employees WHERE code = ?').get(employee_code);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    // Get employee's shift
    let shift = null;
    // Try from employee's assigned shift_id
    const empShift = db.prepare('SELECT shift_id FROM employees WHERE code = ?').get(employee_code);
    if (empShift?.shift_id) {
      shift = db.prepare('SELECT code, start_time, end_time FROM shifts WHERE id = ?').get(empShift.shift_id);
    }
    // Fallback: most recent attendance_processed with shift
    if (!shift) {
      const rec = db.prepare(`
        SELECT s.code, s.start_time, s.end_time
        FROM attendance_processed ap
        JOIN shifts s ON s.id = ap.shift_id
        WHERE ap.employee_code = ? AND ap.shift_id IS NOT NULL
        ORDER BY ap.date DESC LIMIT 1
      `).get(employee_code);
      if (rec) shift = rec;
    }
    // Fallback: default 12HR shift
    if (!shift) {
      shift = db.prepare("SELECT code, start_time, end_time FROM shifts WHERE code = '12HR' LIMIT 1").get();
    }
    if (!shift) {
      shift = { code: '12HR', start_time: '08:00', end_time: '20:00' };
    }

    // Compute duration & authorized_leave_until
    const shiftStartMins = timeToMinutes(shift.start_time);
    const shiftEndMins = timeToMinutes(shift.end_time);
    let durationHours;
    if (leave_type === 'short_leave') {
      durationHours = 3.0;
    } else {
      // half_day: half of shift duration
      const shiftDuration = shiftEndMins > shiftStartMins
        ? shiftEndMins - shiftStartMins
        : (24 * 60 - shiftStartMins + shiftEndMins);
      durationHours = Math.round(shiftDuration / 60 / 2 * 10) / 10;
    }

    const authorizedLeaveMins = shiftEndMins - Math.round(durationHours * 60);
    const authorizedLeaveUntil = minutesToTime(authorizedLeaveMins >= 0 ? authorizedLeaveMins : authorizedLeaveMins + 24 * 60);

    // Extract calendar month/year
    const calendarMonth = dateObj.getMonth() + 1;
    const calendarYear = dateObj.getFullYear();

    // Quota check
    const activeCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM short_leaves
      WHERE employee_code = ? AND calendar_month = ? AND calendar_year = ?
        AND cancelled_at IS NULL
    `).get(employee_code, calendarMonth, calendarYear);
    const used = activeCount?.cnt || 0;

    if (used >= 2 && !force_quota_breach) {
      return res.status(422).json({
        success: false,
        quota_warning: true,
        message: 'Employee has already used 2 gate passes this month.',
        used
      });
    }

    const quotaBreach = used >= 2 ? 1 : 0;

    // Insert
    try {
      const result = db.prepare(`
        INSERT INTO short_leaves (
          employee_id, employee_code, employee_name, department, company,
          date, leave_type, duration_hours, shift_code, shift_end_time,
          authorized_leave_until, remark, quota_breach,
          calendar_month, calendar_year, created_by, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        emp.id, employee_code, emp.name, emp.department, emp.company,
        date, leave_type, durationHours, shift.code, shift.end_time,
        authorizedLeaveUntil, remark.trim(), quotaBreach,
        calendarMonth, calendarYear, req.user.id, req.user.name || req.user.username
      );

      logAudit('short_leaves', result.lastInsertRowid, 'created', null, leave_type,
        req.user.name || req.user.username, `Gate pass created for ${employee_code} on ${date}`);

      return res.status(201).json({ success: true, id: result.lastInsertRowid, quota_breach: quotaBreach });
    } catch (e) {
      if (e.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ success: false, error: 'Gate pass already exists for this employee on this date.' });
      }
      throw e;
    }
  } catch (err) {
    console.error('[short-leaves] POST / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET / — List gate passes with filtering
// ────────────────────────────────────────────────────────────
router.get('/', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employee_code, date_from, date_to, leave_type, status, company, calendar_month, calendar_year } = req.query;

    let sql = 'SELECT * FROM short_leaves WHERE 1=1';
    const params = [];

    if (employee_code) { sql += ' AND employee_code = ?'; params.push(employee_code); }
    if (date_from) { sql += ' AND date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND date <= ?'; params.push(date_to); }
    if (leave_type) { sql += ' AND leave_type = ?'; params.push(leave_type); }
    if (company) { sql += ' AND company = ?'; params.push(company); }
    if (calendar_month) { sql += ' AND calendar_month = ?'; params.push(parseInt(calendar_month)); }
    if (calendar_year) { sql += ' AND calendar_year = ?'; params.push(parseInt(calendar_year)); }

    if (status === 'active') sql += ' AND cancelled_at IS NULL';
    if (status === 'cancelled') sql += ' AND cancelled_at IS NOT NULL';

    sql += ' ORDER BY date DESC, created_at DESC';

    const rows = db.prepare(sql).all(...params);

    // Add computed status field
    const data = rows.map(r => ({
      ...r,
      status: r.cancelled_at ? 'cancelled' : 'active'
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[short-leaves] GET / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /quota/:employeeCode — Quota status
// ────────────────────────────────────────────────────────────
router.get('/quota/:employeeCode', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employeeCode } = req.params;
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const records = db.prepare(`
      SELECT * FROM short_leaves
      WHERE employee_code = ? AND calendar_month = ? AND calendar_year = ?
        AND cancelled_at IS NULL
      ORDER BY date ASC
    `).all(employeeCode, month, year);

    const used = records.length;
    const breachCount = records.filter(r => r.quota_breach).length;

    return res.json({
      success: true,
      employee_code: employeeCode,
      calendar_month: month,
      calendar_year: year,
      used,
      limit: 2,
      remaining: Math.max(0, 2 - used),
      quota_breach_count: breachCount,
      records
    });
  } catch (err) {
    console.error('[short-leaves] GET /quota error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id — Single record
// ────────────────────────────────────────────────────────────
router.get('/:id', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM short_leaves WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Gate pass not found' });
    return res.json({ success: true, data: { ...record, status: record.cancelled_at ? 'cancelled' : 'active' } });
  } catch (err) {
    console.error('[short-leaves] GET /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /:id/cancel — Soft cancel
// ────────────────────────────────────────────────────────────
router.put('/:id/cancel', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM short_leaves WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Gate pass not found' });
    if (record.cancelled_at) return res.status(400).json({ success: false, error: 'Gate pass is already cancelled' });

    // Check if employee has already punched out
    const att = db.prepare(`
      SELECT COALESCE(out_time_final, out_time_original) as out_time
      FROM attendance_processed
      WHERE employee_code = ? AND date = ?
    `).get(record.employee_code, record.date);

    if (att?.out_time) {
      return res.status(422).json({ success: false, error: 'Employee has already punched out. Cancellation not allowed.' });
    }

    const cancelReason = req.body.cancel_reason || '';
    db.prepare(`
      UPDATE short_leaves
      SET cancelled_at = datetime('now'), cancelled_by = ?, cancelled_by_name = ?, cancel_reason = ?
      WHERE id = ?
    `).run(req.user.id, req.user.name || req.user.username, cancelReason, req.params.id);

    logAudit('short_leaves', req.params.id, 'cancelled', 'active', 'cancelled',
      req.user.name || req.user.username, `Gate pass cancelled for ${record.employee_code} on ${record.date}`);

    return res.json({ success: true, message: 'Gate pass cancelled' });
  } catch (err) {
    console.error('[short-leaves] PUT /:id/cancel error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
