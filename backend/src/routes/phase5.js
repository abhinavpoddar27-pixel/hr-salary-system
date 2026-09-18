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
const multer = require('multer');
const XLSX = require('xlsx');
const { getDb, logAudit } = require('../database/db');
const {
  runLeaveAccrual,
  initCLOpening,
  yearEndLapse,
  generateComplianceAlerts,
  computeAttritionRisk
} = require('../services/phase5Features');
const { recomputeLeaves, computeLeavePlan, applyLeavePlan, runYearEndLapse, getPolicy, getPolicyBool, istToday } = require('../services/leaveEngine');
const { autoStage6Status } = require('../services/leaveTriggers');
const { countStaleSalary } = require('../services/recompute');
// The local role helper this file used to carry compared req.user.role raw and
// so disagreed with every other route on capitalisation. Use the shared one,
// which normalises first.
const { requireHrOrAdmin, requireAdmin, roleIn } = require('../middleware/roles');

function requireHrFinanceOrAdmin(req, res, next) {
  if (roleIn(req, 'admin', 'hr', 'finance')) return next();
  return res.status(403).json({ success: false, error: 'HR, finance or admin access required' });
}

// Uploads stay in memory — the owner's EL list is a small one-off sheet and
// nothing needs it on disk after the rows are read.
const grantsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files are accepted'), ok);
  },
});

// ── Leave Accrual ────────────────────────────────────────

router.post('/accrue-leaves', requireHrOrAdmin, (req, res) => {
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
// Idempotent via policy_config guard (key: cl_seed_<year>_v1). First call
// seeds all eligible permanent employees; subsequent calls for the same
// year are no-ops and return { alreadyCompleted: true }. To force a
// re-seed, manually delete the guard row from policy_config.
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
      message: result.alreadyCompleted
        ? `CL opening for year ${y} was already seeded at ${result.completedAt}. No action taken.`
        : `Seeded ${result.seeded} employees for year ${y}, skipped ${result.skipped} non-eligible, ${result.errors.length} errors.`
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

router.get('/shift-roster', requireHrFinanceOrAdmin, (req, res) => {
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

router.post('/shift-roster', requireHrOrAdmin, (req, res) => {
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

router.post('/shift-roster/auto-generate', requireHrOrAdmin, (req, res) => {
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

router.post('/compliance-alerts', requireHrFinanceOrAdmin, (req, res) => {
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

router.get('/attrition-risk', requireHrFinanceOrAdmin, (req, res) => {
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


// ─────────────────────────────────────────────────────────────────────────────
// Leave automation (Sept 2026)
//
// Everything below is read-only or owner-gated. The apply path refuses to write
// balances until the owner has either uploaded the list of EL given outside the
// system or acknowledged there is none — see services/leaveEngine.applyLeavePlan.
//
// PII rule: responses carry employee codes and aggregates only. No names.
// ─────────────────────────────────────────────────────────────────────────────

const CSV_BOM = '﻿';

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(CSV_BOM + body);
}

function planToRows(plan) {
  return plan.employees.map((e) => [
    e.employee_code, e.company || '', e.department || '',
    e.days_worked_ytd, e.eligible ? 'yes' : 'no', e.days_to_eligibility,
    e.el.opening, e.el.earned, e.el.used, e.el.external, e.el.adjustments,
    e.el.current_balance, e.el.new_balance, e.el.delta,
    e.cl.opening, e.cl.computed_opening, e.cl.used, e.cl.external, e.cl.adjustments,
    e.cl.current_balance, e.cl.new_balance, e.cl.delta,
    e.reasons.join(' | '),
  ]);
}

const PLAN_CSV_HEADER = [
  'Employee Code', 'Company', 'Department',
  'Days Worked YTD', 'EL Eligible', 'Days To Eligibility',
  'EL Opening', 'EL Earned', 'EL Used', 'EL Outside System', 'EL Adjustments',
  'EL Current Balance', 'EL New Balance', 'EL Delta',
  'CL Opening', 'CL Entitlement', 'CL Used', 'CL Outside System', 'CL Adjustments',
  'CL Current Balance', 'CL New Balance', 'CL Delta',
  'Notes',
];

/**
 * GET /api/features/leave-recompute/preview
 * Dry run. Writes nothing.
 */
router.get('/leave-recompute/preview', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const year = parseInt(req.query.year, 10) || istToday().year;
    const plan = computeLeavePlan(db, { year });

    if ((req.query.format || 'json') === 'csv') {
      return sendCsv(res, `leave_recompute_preview_${year}.csv`, PLAN_CSV_HEADER, planToRows(plan));
    }

    const hasGrants = db.prepare('SELECT COUNT(*) AS c FROM leave_external_grants WHERE is_active = 1').get().c;
    res.json({
      success: true,
      year,
      months_covered: plan.months_covered,
      policy: plan.policy,
      totals: plan.totals,
      can_apply: hasGrants > 0 || getPolicyBool(db, 'leave_external_grants_acknowledged', false),
      external_grants_on_file: hasGrants,
      unresolved_finance_rows: plan.unresolved_finance_rows,
      employees: plan.employees,
    });
  } catch (err) {
    console.error('[leave-recompute/preview]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/features/leave-recompute/apply
 * The only route that writes balances on purpose.
 */
router.post('/leave-recompute/apply', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { year, confirm, note } = req.body || {};
    const y = parseInt(year, 10);
    if (!y) return res.status(400).json({ success: false, error: 'year is required' });
    if (confirm !== true) {
      return res.status(400).json({ success: false, error: 'confirm must be true' });
    }

    const actor = req.user?.username || 'admin';
    const out = recomputeLeaves(db, {
      year: y, dryRun: false, allowWrite: true, scope: 'manual', actor,
    });

    if (!out.applied) {
      return res.status(409).json({
        success: false,
        error: out.reason === 'external_grants_not_acknowledged'
          ? 'Upload the list of EL given outside the system, or acknowledge there is none, before applying.'
          : 'Leave automation is switched off.',
        reason: out.reason,
        run_id: out.run_id,
      });
    }

    try {
      logAudit('leave_balances', y, 'leave_recompute', null,
        `${out.plan.totals.changed} employee(s) changed`, 'leave_automation',
        note ? String(note).slice(0, 500) : 'Manual leave recompute', actor);
    } catch { /* audit failure must not undo the apply */ }

    res.json({
      success: true, year: y, run_id: out.run_id,
      written: out.written, totals: out.plan.totals,
    });
  } catch (err) {
    console.error('[leave-recompute/apply]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── External EL grants (given outside the system) ────────────────────────────

const GRANT_MODES = {
  'leave taken': 'leave_taken',
  'paid in salary': 'paid_salary',
  'paid in cash': 'paid_cash',
  leave_taken: 'leave_taken',
  paid_salary: 'paid_salary',
  paid_cash: 'paid_cash',
};

function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readGrantRows(file) {
  // Same SheetJS version and style the rest of the repo uses.
  const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return raw.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[normaliseHeader(k)] = v;
    return out;
  });
}

function validateGrantRow(db, row, index) {
  const code = String(row['employee code'] || '').trim();
  const rejected = (reason) => ({ row: index + 2, employee_code: code, accepted: false, reason });

  if (!code) return rejected('Employee Code is blank');
  const emp = db.prepare('SELECT id, company, employment_type, is_contractor, department, status FROM employees WHERE code = ?').get(code);
  if (!emp) return rejected('No employee with that code');

  const { isContractorForPayroll } = require('../utils/employeeClassification');
  if (isContractorForPayroll(emp)) return rejected('Contractors do not accrue leave');

  const year = parseInt(row.year, 10);
  const month = parseInt(row.month, 10);
  if (!year || year < 2000 || year > 2100) return rejected('Year is missing or out of range');
  if (!month || month < 1 || month > 12) return rejected('Month must be 1-12');

  const days = parseFloat(row['el days']);
  if (!Number.isFinite(days) || days <= 0) return rejected('EL Days must be a positive number');

  const mode = GRANT_MODES[normaliseHeader(row['how given'])];
  if (!mode) return rejected("How Given must be 'Leave taken', 'Paid in salary' or 'Paid in cash'");

  const paidMonth = parseInt(row['paid in salary month'], 10) || null;
  const paidYear = parseInt(row['paid in salary year'], 10) || null;

  const dupe = db.prepare(`
    SELECT id FROM leave_external_grants
    WHERE employee_code = ? AND year = ? AND month = ? AND leave_type = 'EL' AND mode = ?
  `).get(code, year, month, mode);
  if (dupe) return rejected(`Already recorded (grant #${dupe.id}) — delete it first to replace`);

  return {
    row: index + 2, employee_code: code, accepted: true,
    employee_id: emp.id, year, month, days, mode,
    paid_month: paidMonth, paid_year: paidYear,
    remark: String(row.remark || '').trim() || null,
  };
}

/**
 * POST /api/features/leave-external-grants/upload
 * Defaults to a dry run; pass ?dryRun=false to actually insert.
 */
router.post('/leave-external-grants/upload', requireAdmin, grantsUpload.single('file'), (req, res) => {
  try {
    const db = getDb();
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const dryRun = String(req.query.dryRun ?? 'true').toLowerCase() !== 'false';
    const rows = readGrantRows(req.file);
    if (!rows.length) return res.status(400).json({ success: false, error: 'The sheet has no data rows' });

    const checked = rows.map((r, i) => validateGrantRow(db, r, i));
    const accepted = checked.filter((r) => r.accepted);
    const rejected = checked.filter((r) => !r.accepted);

    if (dryRun) {
      return res.json({
        success: true, dryRun: true,
        totals: { rows: checked.length, accepted: accepted.length, rejected: rejected.length },
        rows: checked,
      });
    }

    const actor = req.user?.username || 'admin';
    const ins = db.prepare(`
      INSERT INTO leave_external_grants
        (employee_code, employee_id, year, month, leave_type, days, mode,
         paid_month, paid_year, remark, source_file, uploaded_by)
      VALUES (?, ?, ?, ?, 'EL', ?, ?, ?, ?, ?, ?, ?)
    `);
    const txn = db.transaction(() => {
      for (const r of accepted) {
        ins.run(r.employee_code, r.employee_id, r.year, r.month, r.days, r.mode,
          r.paid_month, r.paid_year, r.remark, req.file.originalname, actor);
      }
      // Uploading the list is itself the acknowledgement that unblocks apply.
      db.prepare("UPDATE policy_config SET value = 'true' WHERE key = 'leave_external_grants_acknowledged'").run();
    });
    txn();

    try {
      logAudit('leave_external_grants', 0, 'upload', null, `${accepted.length} row(s)`,
        'leave_automation', `Uploaded ${req.file.originalname}`, actor);
    } catch { /* best effort */ }

    res.json({
      success: true, dryRun: false,
      totals: { rows: checked.length, accepted: accepted.length, rejected: rejected.length },
      rows: checked,
    });
  } catch (err) {
    console.error('[leave-external-grants/upload]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/leave-external-grants', requireAdmin, (req, res) => {
  const db = getDb();
  const year = parseInt(req.query.year, 10) || istToday().year;
  const rows = db.prepare(`
    SELECT id, employee_code, year, month, leave_type, days, mode, paid_month, paid_year,
           remark, source_file, uploaded_by, uploaded_at, is_active
    FROM leave_external_grants
    WHERE year = ? AND is_active = 1
    ORDER BY employee_code, month
  `).all(year);
  res.json({
    success: true, year, count: rows.length,
    total_days: Math.round(rows.reduce((a, r) => a + (Number(r.days) || 0), 0) * 100) / 100,
    data: rows,
  });
});

router.delete('/leave-external-grants/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM leave_external_grants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: 'Grant not found' });
  // Soft delete — the upload history stays readable.
  db.prepare('UPDATE leave_external_grants SET is_active = 0 WHERE id = ?').run(id);
  try {
    logAudit('leave_external_grants', id, 'is_active', '1', '0', 'leave_automation',
      `Removed ${row.days} EL day(s) for ${row.employee_code} ${row.month}/${row.year}`,
      req.user?.username || 'admin');
  } catch { /* best effort */ }
  res.json({ success: true, id });
});

router.post('/leave-external-grants/acknowledge-none', requireAdmin, (req, res) => {
  const db = getDb();
  const actor = req.user?.username || 'admin';
  db.prepare("UPDATE policy_config SET value = 'true' WHERE key = 'leave_external_grants_acknowledged'").run();
  try {
    logAudit('policy_config', 0, 'leave_external_grants_acknowledged', 'false', 'true',
      'leave_automation', 'Owner confirmed there is no EL given outside the system', actor);
  } catch { /* best effort */ }
  res.json({ success: true, acknowledged: true });
});

// ── Automation status and switches ───────────────────────────────────────────

router.get('/leave-automation/status', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const year = parseInt(req.query.year, 10) || istToday().year;

    let queueDepth = 0;
    try {
      queueDepth = db.prepare(
        "SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending' AND type IN ('leave_recalc','leave_nightly','day_calculate')"
      ).get().c;
    } catch { /* the jobs table is created by the worker, not the schema */ }

    const lastRuns = db.prepare(`
      SELECT scope, MAX(started_at) AS started_at,
             (SELECT status FROM leave_recompute_runs r2 WHERE r2.scope = r1.scope ORDER BY r2.id DESC LIMIT 1) AS status,
             (SELECT message FROM leave_recompute_runs r3 WHERE r3.scope = r1.scope ORDER BY r3.id DESC LIMIT 1) AS message
      FROM leave_recompute_runs r1 GROUP BY scope
    `).all();

    const periods = db.prepare(`
      SELECT month, year, company, stage_6_done, stage_6_auto_at, is_finalised
      FROM monthly_imports WHERE year = ? ORDER BY month, company
    `).all(year);

    const openFlags = db.prepare('SELECT COUNT(*) AS c FROM leave_change_flags WHERE cleared_at IS NULL').get().c;

    const stale = db.prepare(`
      SELECT month, year, company, COUNT(*) AS c
      FROM day_calculations WHERE salary_stale = 1 AND year = ?
      GROUP BY month, year, company ORDER BY month
    `).all(year);

    res.json({
      success: true,
      year,
      automation_enabled: getPolicyBool(db, 'leave_automation_enabled', false),
      auto_stage6_enabled: getPolicyBool(db, 'leave_auto_stage6_enabled', true),
      external_grants_acknowledged: getPolicyBool(db, 'leave_external_grants_acknowledged', false),
      external_grants_on_file: db.prepare('SELECT COUNT(*) AS c FROM leave_external_grants WHERE is_active = 1').get().c,
      debounce_seconds: parseInt(getPolicy(db, 'leave_recompute_debounce_seconds', '45'), 10),
      queue_depth: queueDepth,
      last_runs: lastRuns,
      last_nightly: lastRuns.find((r) => r.scope === 'nightly') || null,
      periods: periods.map((p) => ({
        ...p,
        auto_stage6: autoStage6Status(db, p.company, p.month, p.year),
      })),
      open_flags: openFlags,
      stale_salary: stale,
    });
  } catch (err) {
    console.error('[leave-automation/status]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/leave-automation/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const actor = req.user?.username || 'admin';
  const { automation_enabled, auto_stage6_enabled } = req.body || {};
  const changed = [];

  const setFlag = (key, value) => {
    const before = getPolicy(db, key, 'false');
    const after = value ? 'true' : 'false';
    if (before === after) return;
    db.prepare('UPDATE policy_config SET value = ?, updated_at = datetime(\'now\') WHERE key = ?').run(after, key);
    changed.push({ key, from: before, to: after });
    try {
      logAudit('policy_config', 0, key, before, after, 'leave_automation', 'Changed from the Automation tab', actor);
    } catch { /* best effort */ }
  };

  if (automation_enabled !== undefined) setFlag('leave_automation_enabled', !!automation_enabled);
  if (auto_stage6_enabled !== undefined) setFlag('leave_auto_stage6_enabled', !!auto_stage6_enabled);

  res.json({
    success: true,
    changed,
    automation_enabled: getPolicyBool(db, 'leave_automation_enabled', false),
    auto_stage6_enabled: getPolicyBool(db, 'leave_auto_stage6_enabled', true),
  });
});

// ── Change flags (a change that landed on a finalized month) ─────────────────

router.get('/leave-change-flags', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const where = ['1 = 1'];
  const args = [];
  if (req.query.year) { where.push('year = ?'); args.push(parseInt(req.query.year, 10)); }
  if (req.query.month) { where.push('month = ?'); args.push(parseInt(req.query.month, 10)); }
  if (String(req.query.includeCleared || 'false') !== 'true') where.push('cleared_at IS NULL');
  const rows = db.prepare(
    `SELECT * FROM leave_change_flags WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 500`
  ).all(...args);
  res.json({ success: true, count: rows.length, data: rows });
});

router.post('/leave-change-flags/:id/clear', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const actor = req.user?.username || 'hr';
  const info = db.prepare(
    "UPDATE leave_change_flags SET cleared_at = datetime('now'), cleared_by = ? WHERE id = ? AND cleared_at IS NULL"
  ).run(actor, id);
  if (!info.changes) return res.status(404).json({ success: false, error: 'Flag not found or already cleared' });
  res.json({ success: true, id });
});

// ── Year-end lapse report ────────────────────────────────────────────────────

router.get('/leave-lapse-report', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const year = parseInt(req.query.year, 10) || istToday().year;

    // If the lapse has already run, report what it actually did.
    const recorded = db.prepare(`
      SELECT employee_code, leave_type, lapsed AS days_lapsed, company
      FROM leave_accrual_ledger
      WHERE year = ? AND month = 12 AND lapsed > 0
      ORDER BY employee_code, leave_type
    `).all(year);

    const out = recorded.length
      ? { already_run: true, year, report: recorded }
      : { already_run: false, ...runYearEndLapse(db, year, { dryRun: true }) };

    if ((req.query.format || 'json') === 'csv') {
      return sendCsv(res, `leave_lapse_${year}.csv`,
        ['Employee Code', 'Company', 'Leave Type', 'Days Lapsed', 'Year'],
        out.report.map((r) => [r.employee_code, r.company || '', r.leave_type, r.days_lapsed, year]));
    }
    res.json({ success: true, ...out });
  } catch (err) {
    console.error('[leave-lapse-report]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Stage 7 staleness ────────────────────────────────────────────────────────

router.get('/salary-stale', requireHrFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  const out = countStaleSalary(db, { month, year, company });
  res.json({ success: true, ...out, month: month ? parseInt(month, 10) : null, year: year ? parseInt(year, 10) : null, company: company || null });
});

module.exports = router;
