// Short Leave / Gate Pass Management — April 2026, quota rules Oct 2026
//
// CRUD for gate passes (short_leaves table). Each record represents an
// authorised early departure for a specific employee on a specific date.
//
// Quota (owner ruling 10 Oct 2026): per employee per calendar month,
// 2 Short Leaves OR 1 Half Day. Modelled as points — Short Leave costs 1,
// Half Day costs 2, budget 2 — so one Short Leave leaves no room for a Half
// Day and a Half Day uses the whole month. Only an admin can go over, with a
// written reason. Short Leave is 2 hours ending at shift end.

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

// ─── Quota rules (Oct 2026) ─────────────────────────────────
const SHORT_LEAVE_HOURS = 2;
const PASS_POINTS = { short_leave: 1, half_day: 2 };
const MONTHLY_POINTS = 2;
const MIN_BREACH_REASON = 10;

// Points used by an employee's active passes in a calendar month, plus a
// per-type count so the screen can say "1 Short Leave used".
function quotaFor(db, employeeCode, month, year) {
  const rows = db.prepare(`
    SELECT leave_type, COUNT(*) AS n FROM short_leaves
    WHERE employee_code = ? AND calendar_month = ? AND calendar_year = ?
      AND cancelled_at IS NULL
    GROUP BY leave_type
  `).all(employeeCode, month, year);
  const counts = { short_leave: 0, half_day: 0 };
  for (const r of rows) counts[r.leave_type] = r.n;
  const usedPoints = counts.short_leave * PASS_POINTS.short_leave + counts.half_day * PASS_POINTS.half_day;
  const remaining = Math.max(0, MONTHLY_POINTS - usedPoints);
  return {
    used_points: usedPoints,
    limit_points: MONTHLY_POINTS,
    remaining_points: remaining,
    short_leaves_used: counts.short_leave,
    half_days_used: counts.half_day,
    can_short_leave: remaining >= PASS_POINTS.short_leave,
    can_half_day: remaining >= PASS_POINTS.half_day,
  };
}

function quotaMessage(q, leaveType) {
  const used = [];
  if (q.short_leaves_used) used.push(`${q.short_leaves_used} Short Leave${q.short_leaves_used > 1 ? 's' : ''}`);
  if (q.half_days_used) used.push(`${q.half_days_used} Half Day${q.half_days_used > 1 ? 's' : ''}`);
  const want = leaveType === 'half_day' ? 'a Half Day' : 'a Short Leave';
  return `Monthly allowance is 2 Short Leaves or 1 Half Day. This employee has already used ${used.join(' and ')} this month, so ${want} is not available.`;
}

// ────────────────────────────────────────────────────────────
// POST / — Create gate pass
// ────────────────────────────────────────────────────────────
router.post('/', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employee_code, date, leave_type, remark, force_quota_breach, breach_reason } = req.body;
    const isAdmin = req.user?.role === 'admin';

    // Validations
    if (!employee_code) return res.status(400).json({ success: false, error: 'employee_code is required' });
    if (!date) return res.status(400).json({ success: false, error: 'date is required' });
    if (!leave_type || !['short_leave', 'half_day'].includes(leave_type)) {
      return res.status(400).json({ success: false, error: 'leave_type must be short_leave or half_day' });
    }
    if (!remark || !remark.trim()) {
      return res.status(400).json({ success: false, error: 'Remark is required' });
    }

    // Backdating is open for now (owner ruling 10 Oct 2026 — the 7-day limit
    // is removed; it will be tightened later). The date must still be real.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    const dateObj = new Date(date + 'T00:00:00');
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ success: false, error: 'date is not a valid date' });
    }

    // Lookup employee
    const emp = db.prepare('SELECT id, name, department, company FROM employees WHERE code = ?').get(employee_code);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    // Get employee's shift
    let shift = null;
    // Try the employee's assigned shift — same order earlyExitDetection uses
    // (default_shift_id, then shift_code), so the pass's "leave from" time and
    // the detection agree on shift end. (employees has no `shift_id` column:
    // the old `SELECT shift_id` made every create fail with a 500.)
    const empShift = db.prepare('SELECT default_shift_id, shift_code FROM employees WHERE code = ?').get(employee_code);
    if (empShift?.default_shift_id) {
      shift = db.prepare('SELECT code, start_time, end_time FROM shifts WHERE id = ?').get(empShift.default_shift_id);
    }
    if (!shift && empShift?.shift_code) {
      shift = db.prepare('SELECT code, start_time, end_time FROM shifts WHERE code = ?').get(empShift.shift_code);
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
      durationHours = SHORT_LEAVE_HOURS;
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

    // One active pass per employee per date (a Short Leave and a Half Day on
    // the same day is refused; the UNIQUE index only covers the same type).
    const sameDay = db.prepare(`
      SELECT leave_type FROM short_leaves
      WHERE employee_code = ? AND date = ? AND cancelled_at IS NULL
    `).get(employee_code, date);
    if (sameDay) {
      return res.status(409).json({
        success: false,
        error: `This employee already has a ${sameDay.leave_type === 'half_day' ? 'Half Day' : 'Short Leave'} on ${date}. Cancel it first to change it.`,
      });
    }

    // Quota check — points (Short Leave 1, Half Day 2, budget 2 per month)
    const q = quotaFor(db, employee_code, calendarMonth, calendarYear);
    const cost = PASS_POINTS[leave_type];
    const overQuota = q.used_points + cost > MONTHLY_POINTS;
    const reason = typeof breach_reason === 'string' ? breach_reason.trim() : '';

    if (overQuota) {
      const message = quotaMessage(q, leave_type);
      if (!force_quota_breach) {
        return res.status(422).json({
          success: false, quota_warning: true, quota_exceeded: true,
          message, can_override: isAdmin, used: q.used_points, quota: q,
        });
      }
      if (!isAdmin) {
        return res.status(403).json({
          success: false, quota_exceeded: true,
          error: `${message} Only an admin can allow one more.`, quota: q,
        });
      }
      if (reason.length < MIN_BREACH_REASON) {
        return res.status(400).json({
          success: false, quota_exceeded: true,
          error: `A reason of at least ${MIN_BREACH_REASON} characters is required to go over the monthly allowance.`, quota: q,
        });
      }
    }

    const quotaBreach = overQuota ? 1 : 0;

    // Insert
    try {
      const result = db.prepare(`
        INSERT INTO short_leaves (
          employee_id, employee_code, employee_name, department, company,
          date, leave_type, duration_hours, shift_code, shift_end_time,
          authorized_leave_until, remark, quota_breach, breach_reason,
          calendar_month, calendar_year, created_by, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        emp.id, employee_code, emp.name, emp.department, emp.company,
        date, leave_type, durationHours, shift.code, shift.end_time,
        authorizedLeaveUntil, remark.trim(), quotaBreach, quotaBreach ? reason : null,
        calendarMonth, calendarYear, req.user.id, req.user.name || req.user.username
      );

      logAudit('short_leaves', result.lastInsertRowid, 'created', null, leave_type,
        quotaBreach ? 'short_leave_quota_override' : 'short_leave_create',
        quotaBreach
          ? `Gate pass created OVER monthly allowance for ${employee_code} on ${date}. Reason: ${reason}`
          : `Gate pass created for ${employee_code} on ${date}`,
        req.user?.username);

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

    const breachCount = records.filter(r => r.quota_breach).length;
    const q = quotaFor(db, employeeCode, month, year);

    // `used` / `limit` / `remaining` are in points (Short Leave 1, Half Day 2,
    // budget 2) — Oct 2026 rule. `passes` is the plain count of active passes.
    return res.json({
      success: true,
      employee_code: employeeCode,
      calendar_month: month,
      calendar_year: year,
      used: q.used_points,
      limit: q.limit_points,
      remaining: q.remaining_points,
      passes: records.length,
      ...q,
      short_leave_hours: SHORT_LEAVE_HOURS,
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
      'short_leave_cancel', `Gate pass cancelled for ${record.employee_code} on ${record.date}`, req.user?.username);

    return res.json({ success: true, message: 'Gate pass cancelled' });
  } catch (err) {
    console.error('[short-leaves] PUT /:id/cancel error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
