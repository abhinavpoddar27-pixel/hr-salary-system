/**
 * Phase 5 Feature Routes
 *
 * 1. Leave accrual (POST /accrue-leaves)
 * 2. Shift roster (CRUD)
 * 3. Compliance alerts (POST /compliance-alerts)
 * 4. Attrition risk (GET /attrition-risk)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const {
  runLeaveAccrual,
  initCLOpening,
  yearEndLapse,
  generateComplianceAlerts,
  computeAttritionRisk
} = require('../services/phase5Features');

// Local role helper — other routes here are currently auth-gated only. The
// two new Phase 1 endpoints below mutate balances so they need HR-or-admin.
function requireHrOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR or admin access required' });
  }
  next();
}

// ── Leave Accrual ────────────────────────────────────────

router.post('/accrue-leaves', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
    const result = runLeaveAccrual(db, parseInt(month), parseInt(year));
    res.json({ success: true, ...result, message: `Leaves accrued for ${result.accrued} employees` });
  } catch (err) {
    console.error('Leave accrual error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to accrue leaves: ' + err.message });
  }
});

// ── Init CL Opening Balances ─────────────────────────────
// One-time-per-year seed of Casual Leave opening balances. Pro-rata by DOJ
// month (Jan/Feb=7 … Nov/Dec=2). Safe to re-run — UPSERTs the opening on
// leave_balances and the anchor row on leave_accrual_ledger.
router.post('/init-cl-opening', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { year, deploymentMonth } = req.body || {};
    const y = parseInt(year);
    if (!y) return res.status(400).json({ success: false, error: 'year required' });
    const dm = deploymentMonth ? parseInt(deploymentMonth) : 1;
    const result = initCLOpening(db, y, dm);
    res.json({
      success: true,
      ...result,
      message: `CL opening seeded for ${result.seeded} employees (deploymentMonth=${dm})`
    });
  } catch (err) {
    console.error('Init CL opening error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to init CL opening: ' + err.message });
  }
});

// ── Year-End Lapse ───────────────────────────────────────
// Zeros out remaining CL + EL for the given year. Writes lapse rows to
// leave_accrual_ledger (month=12) and Year-End Lapse transactions. Run once
// at year-end (typically around Dec 31 / Jan 1).
router.post('/year-end-lapse', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { year } = req.body || {};
    const y = parseInt(year);
    if (!y) return res.status(400).json({ success: false, error: 'year required' });
    const result = yearEndLapse(db, y);
    res.json({ success: true, ...result, message: `Lapsed ${result.lapsed} balance rows for ${y}` });
  } catch (err) {
    console.error('Year-end lapse error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to lapse balances: ' + err.message });
  }
});

// ── Shift Roster ─────────────────────────────────────────

router.get('/shift-roster', (req, res) => {
  try {
    const db = getDb();
    const { weekStart, department, employeeCode } = req.query;

    let query = `
      SELECT sr.*, e.name, e.department, s.name as shift_name
      FROM shift_roster sr
      LEFT JOIN employees e ON sr.employee_code = e.code
      LEFT JOIN shifts s ON sr.shift_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (weekStart) { query += ' AND sr.week_start = ?'; params.push(weekStart); }
    if (department) { query += ' AND e.department = ?'; params.push(department); }
    if (employeeCode) { query += ' AND sr.employee_code = ?'; params.push(employeeCode); }
    query += ' ORDER BY sr.week_start DESC, e.department, e.name';

    const roster = db.prepare(query).all(...params);
    res.json({ success: true, data: roster });
  } catch (err) {
    console.error('Shift roster error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch shift roster: ' + err.message });
  }
});

router.post('/shift-roster', (req, res) => {
  try {
    const db = getDb();
    const { assignments } = req.body; // [{ employeeCode, weekStart, shiftCode }]
    const username = req.user?.username || 'Unknown';

    if (!assignments || !Array.isArray(assignments)) {
      return res.status(400).json({ success: false, error: 'assignments array required' });
    }

    const upsert = db.prepare(`
      INSERT INTO shift_roster (employee_code, week_start, shift_id, shift_code, assigned_by)
      VALUES (?, ?, (SELECT id FROM shifts WHERE code = ?), ?, ?)
      ON CONFLICT(employee_code, week_start) DO UPDATE SET
        shift_id = excluded.shift_id, shift_code = excluded.shift_code,
        assigned_by = excluded.assigned_by, created_at = datetime('now')
    `);

    const txn = db.transaction(() => {
      for (const a of assignments) {
        upsert.run(a.employeeCode, a.weekStart, a.shiftCode, a.shiftCode, username);
      }
    });
    txn();

    res.json({ success: true, message: `${assignments.length} shift assignments saved` });
  } catch (err) {
    console.error('Shift roster save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save shift roster: ' + err.message });
  }
});

router.post('/shift-roster/auto-generate', (req, res) => {
  try {
    const db = getDb();
    const { weekStart, pattern } = req.body; // pattern: 'rotate' or 'keep'
    const username = req.user?.username || 'Unknown';

    if (!weekStart) return res.status(400).json({ success: false, error: 'weekStart required' });

    // Get previous week's roster
    const prevWeek = new Date(new Date(weekStart).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const prevRoster = db.prepare('SELECT * FROM shift_roster WHERE week_start = ?').all(prevWeek);

    if (prevRoster.length === 0) {
      return res.json({ success: false, error: 'No previous week roster to generate from' });
    }

    const shifts = db.prepare('SELECT code FROM shifts ORDER BY id').all().map(s => s.code);
    const upsert = db.prepare(`
      INSERT INTO shift_roster (employee_code, week_start, shift_id, shift_code, assigned_by)
      VALUES (?, ?, (SELECT id FROM shifts WHERE code = ?), ?, ?)
      ON CONFLICT(employee_code, week_start) DO UPDATE SET
        shift_id = excluded.shift_id, shift_code = excluded.shift_code, assigned_by = excluded.assigned_by
    `);

    let count = 0;
    const txn = db.transaction(() => {
      for (const prev of prevRoster) {
        let newShift = prev.shift_code;
        if (pattern === 'rotate' && shifts.length >= 2) {
          const idx = shifts.indexOf(prev.shift_code);
          newShift = shifts[(idx + 1) % shifts.length];
        }
        upsert.run(prev.employee_code, weekStart, newShift, newShift, username);
        count++;
      }
    });
    txn();

    res.json({ success: true, message: `${count} assignments generated for ${weekStart}`, count });
  } catch (err) {
    console.error('Shift auto-generate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to auto-generate roster: ' + err.message });
  }
});

// ── Compliance Alerts ────────────────────────────────────

router.post('/compliance-alerts', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
    const alerts = generateComplianceAlerts(db, parseInt(month), parseInt(year));
    res.json({ success: true, count: alerts.length, data: alerts });
  } catch (err) {
    console.error('Compliance alerts error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate compliance alerts: ' + err.message });
  }
});

// ── Attrition Risk ───────────────────────────────────────

router.get('/attrition-risk', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    if (!month || !year) return res.json({ success: true, data: [] });
    const data = computeAttritionRisk(db, parseInt(month), parseInt(year));

    const summary = {
      total: data.length,
      high: data.filter(d => d.riskLevel === 'High').length,
      medium: data.filter(d => d.riskLevel === 'Medium').length,
      low: data.filter(d => d.riskLevel === 'Low').length,
    };

    res.json({ success: true, data, summary });
  } catch (err) {
    console.error('Attrition risk error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute attrition risk: ' + err.message });
  }
});

module.exports = router;
