// Late Coming Management System — Phase 1 backend routes
//
// Provides analytics, detail views, deduction entry, and Excel export for the
// Late Coming feature. Reads exclusively from `attendance_processed` (filled
// by import.js post-processing) and `employees` (shift assignment). Does NOT
// modify any existing pipeline stage — deductions land in the new
// `late_coming_deductions` table with finance_status='pending', to be wired
// into Stage 7 in Phase 2.

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { getDb } = require('../database/db');

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

// ─── Utility: previous month/year ─────────────────────────
function prevMonth(month, year) {
  const m = parseInt(month);
  const y = parseInt(year);
  if (m === 1) return { month: 12, year: y - 1 };
  return { month: m - 1, year: y };
}

// Normalise "up" / "down" / "stable" trend. Uses a relative threshold so tiny
// swings don't get flagged as regressions.
function trendLabel(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (c === p) return 'stable';
  if (p === 0 && c > 0) return 'up';
  if (p === 0 && c === 0) return 'stable';
  const diff = c - p;
  const rel = Math.abs(diff) / Math.max(p, 1);
  if (rel < 0.1) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

// ─── GET /analytics ───────────────────────────────────────
// Per-employee punctuality data for a month. Sorted by late_count_this_month
// descending so the worst offenders are at the top of the HR view.
router.get('/analytics', (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const company = req.query.company || null;
  const shiftCode = req.query.shiftCode || null;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  const prev = prevMonth(month, year);

  // Build the parameter list in the same order as the placeholders.
  // Five aggregates × 2 (month, year) = 10 placeholders, plus optional
  // company/shift filters appended at the end.
  const baseParams = [
    month, year,                     // late_count_this_month
    prev.month, prev.year,           // late_count_last_month
    prev.month, prev.year,           // left_late_count_last_month
    month, year,                     // avg_late_minutes
    month, year                      // left_late_count_this_month
  ];
  let companyFilter = '';
  if (company) {
    companyFilter = ' AND (e.company = ? OR ap.company = ?)';
    baseParams.push(company, company);
  }
  let shiftFilter = '';
  if (shiftCode) {
    shiftFilter = " AND e.shift_code = ?";
    baseParams.push(shiftCode);
  }

  const rows = db.prepare(`
    SELECT
      e.code AS employee_code,
      e.name,
      e.department,
      e.shift_code,
      s.start_time AS shift_start_time,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count_this_month,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count_last_month,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_left_late = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_count_last_month,
      AVG(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN ap.late_by_minutes END) AS avg_late_minutes,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_left_late = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_count_this_month
    FROM employees e
    LEFT JOIN shifts s ON e.default_shift_id = s.id
    LEFT JOIN attendance_processed ap ON ap.employee_code = e.code
    WHERE (e.status IS NULL OR e.status != 'Left')
      ${companyFilter}
      ${shiftFilter}
    GROUP BY e.code, e.name, e.department, e.shift_code, s.start_time
    ORDER BY late_count_this_month DESC, e.name ASC
  `).all(...baseParams);

  const data = rows.map(r => ({
    employee_code: r.employee_code,
    name: r.name,
    department: r.department,
    shift_code: r.shift_code,
    shift_start_time: r.shift_start_time,
    late_count_this_month: Number(r.late_count_this_month) || 0,
    late_count_last_month: Number(r.late_count_last_month) || 0,
    trend: trendLabel(r.late_count_this_month, r.late_count_last_month),
    avg_late_minutes: r.avg_late_minutes ? Math.round(r.avg_late_minutes * 10) / 10 : 0,
    left_late_count_this_month: Number(r.left_late_count_this_month) || 0,
    left_late_count_last_month: Number(r.left_late_count_last_month) || 0
  }));

  res.json({ success: true, data });
});

// ─── GET /department-summary ─────────────────────────────
router.get('/department-summary', (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const company = req.query.company || null;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }
  const prev = prevMonth(month, year);

  const companyFilterEmp = company ? ' AND e.company = ?' : '';
  const companyFilterAp = company ? ' AND (ap.company = ? OR ap.company IS NULL)' : '';

  // Current-month per-employee rollup (department)
  const currentRows = db.prepare(`
    SELECT
      e.department,
      COUNT(DISTINCT e.code) AS employee_count,
      SUM(CASE WHEN ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS total_late_instances,
      AVG(CASE WHEN ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN ap.late_by_minutes END) AS avg_late_minutes,
      SUM(CASE WHEN ap.is_left_late = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_count
    FROM employees e
    LEFT JOIN attendance_processed ap ON ap.employee_code = e.code AND ap.month = ? AND ap.year = ?${companyFilterAp}
    WHERE (e.status IS NULL OR e.status != 'Left')${companyFilterEmp}
    GROUP BY e.department
    ORDER BY total_late_instances DESC
  `).all(...[month, year, ...(company ? [company] : []), ...(company ? [company] : [])]);

  // Previous-month counts per department for trend
  const prevRows = db.prepare(`
    SELECT e.department,
      SUM(CASE WHEN ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS prev_late
    FROM employees e
    LEFT JOIN attendance_processed ap ON ap.employee_code = e.code AND ap.month = ? AND ap.year = ?${companyFilterAp}
    WHERE (e.status IS NULL OR e.status != 'Left')${companyFilterEmp}
    GROUP BY e.department
  `).all(...[prev.month, prev.year, ...(company ? [company] : []), ...(company ? [company] : [])]);

  const prevMap = {};
  for (const r of prevRows) prevMap[r.department || ''] = Number(r.prev_late) || 0;

  // Worst offender per department
  const offenderRows = db.prepare(`
    SELECT e.department, e.code AS employee_code, e.name,
      SUM(CASE WHEN ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count
    FROM employees e
    LEFT JOIN attendance_processed ap ON ap.employee_code = e.code AND ap.month = ? AND ap.year = ?${companyFilterAp}
    WHERE (e.status IS NULL OR e.status != 'Left')${companyFilterEmp}
    GROUP BY e.department, e.code, e.name
  `).all(...[month, year, ...(company ? [company] : []), ...(company ? [company] : [])]);

  const offenderMap = {};
  for (const r of offenderRows) {
    const key = r.department || '';
    const count = Number(r.late_count) || 0;
    if (!offenderMap[key] || count > offenderMap[key].late_count) {
      offenderMap[key] = { employee_code: r.employee_code, name: r.name, late_count: count };
    }
  }

  const data = currentRows.map(r => {
    const prevCount = prevMap[r.department || ''] || 0;
    const currentCount = Number(r.total_late_instances) || 0;
    const worst = offenderMap[r.department || ''] || null;
    return {
      department: r.department || '(none)',
      employee_count: Number(r.employee_count) || 0,
      total_late_instances: currentCount,
      avg_late_minutes: r.avg_late_minutes ? Math.round(r.avg_late_minutes * 10) / 10 : 0,
      left_late_count: Number(r.left_late_count) || 0,
      prev_late_count: prevCount,
      trend: trendLabel(currentCount, prevCount),
      worst_offender: (worst && worst.late_count > 0) ? worst : null
    };
  });

  res.json({ success: true, data });
});

// ─── GET /daily-detail ────────────────────────────────────
// Late arrivals for a single date. Used by Daily MIS.
router.get('/daily-detail', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  const company = req.query.company || null;
  if (!date) {
    return res.status(400).json({ success: false, error: 'date required' });
  }
  const [yStr, mStr, dStr] = String(date).split('-');
  const year = parseInt(yStr);
  const month = parseInt(mStr);
  const day = parseInt(dStr);
  if (!year || !month || !day) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }

  const prev = prevMonth(month, year);

  // Yesterday's date (string) — accounts for month boundaries via JS Date.
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yesterday = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

  const companyFilter = company ? ' AND (ap.company = ? OR ap.company IS NULL)' : '';

  const rows = db.prepare(`
    SELECT
      ap.employee_code,
      e.name,
      e.department,
      e.shift_code,
      s.start_time AS shift_start_time,
      COALESCE(ap.in_time_final, ap.in_time_original) AS in_time,
      ap.late_by_minutes,
      (
        SELECT COUNT(*) FROM attendance_processed ap2
        WHERE ap2.employee_code = ap.employee_code
          AND ap2.month = ? AND ap2.year = ?
          AND CAST(substr(ap2.date, 9, 2) AS INTEGER) <= ?
          AND ap2.is_late_arrival = 1
          AND ap2.is_night_out_only = 0
      ) AS month_to_date_late_count,
      (
        SELECT COUNT(*) FROM attendance_processed ap3
        WHERE ap3.employee_code = ap.employee_code
          AND ap3.month = ? AND ap3.year = ?
          AND ap3.is_late_arrival = 1
          AND ap3.is_night_out_only = 0
      ) AS last_month_late_count,
      (
        SELECT ap4.is_left_late FROM attendance_processed ap4
        WHERE ap4.employee_code = ap.employee_code AND ap4.date = ?
        LIMIT 1
      ) AS yesterday_left_late,
      (
        SELECT ap5.left_late_minutes FROM attendance_processed ap5
        WHERE ap5.employee_code = ap.employee_code AND ap5.date = ?
        LIMIT 1
      ) AS yesterday_left_late_minutes
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    LEFT JOIN shifts s ON e.default_shift_id = s.id
    WHERE ap.date = ?
      AND ap.is_late_arrival = 1
      AND ap.is_night_out_only = 0
      AND (e.status IS NULL OR e.status != 'Left')
      ${companyFilter}
    ORDER BY ap.late_by_minutes DESC, e.name ASC
  `).all(month, year, day, prev.month, prev.year, yesterday, yesterday, date, ...(company ? [company] : []));

  // The "yesterday" subquery is executed twice so SQLite gives us two
  // separate columns. A simpler rewrite would use a JOIN but keeping the
  // subqueries makes it obvious the lookup is per-employee.

  const data = rows.map(r => ({
    employee_code: r.employee_code,
    name: r.name,
    department: r.department,
    shift_code: r.shift_code,
    shift_start_time: r.shift_start_time,
    in_time: r.in_time,
    late_by_minutes: Number(r.late_by_minutes) || 0,
    month_to_date_late_count: Number(r.month_to_date_late_count) || 0,
    trend: trendLabel(r.month_to_date_late_count, r.last_month_late_count),
    yesterday_left_late: !!(r.yesterday_left_late && Number(r.yesterday_left_late) === 1),
    yesterday_left_late_minutes: Number(r.yesterday_left_late_minutes) || 0
  }));

  res.json({ success: true, totalLateToday: data.length, data });
});

// ─── GET /employee-history ────────────────────────────────
router.get('/employee-history', (req, res) => {
  const db = getDb();
  const employeeCode = req.query.employeeCode;
  const months = Math.min(24, Math.max(1, parseInt(req.query.months) || 6));
  if (!employeeCode) {
    return res.status(400).json({ success: false, error: 'employeeCode required' });
  }

  // Build last N (month, year) tuples working backwards from today.
  const today = new Date();
  const tuples = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    tuples.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }

  const history = [];
  for (const t of tuples) {
    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count,
        AVG(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN late_by_minutes END) AS avg_late_minutes,
        SUM(CASE WHEN is_left_late = 1 AND is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_count
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ?
    `).get(employeeCode, t.month, t.year);
    const deductions = db.prepare(`
      SELECT id, late_count, deduction_days, remark, applied_by, applied_at,
             finance_status, finance_remark, is_applied_to_salary
      FROM late_coming_deductions
      WHERE employee_code = ? AND month = ? AND year = ?
      ORDER BY applied_at DESC
    `).all(employeeCode, t.month, t.year);
    history.push({
      month: t.month,
      year: t.year,
      late_count: Number(stats?.late_count) || 0,
      avg_late_minutes: stats?.avg_late_minutes ? Math.round(stats.avg_late_minutes * 10) / 10 : 0,
      left_late_count: Number(stats?.left_late_count) || 0,
      deductions
    });
  }

  res.json({ success: true, data: history });
});

// ─── POST /deduction ──────────────────────────────────────
router.post('/deduction', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { employeeCode, month, year, company, lateCount, deductionDays, remark } = req.body;

  if (!employeeCode || !month || !year) {
    return res.status(400).json({ success: false, error: 'employeeCode, month, year required' });
  }
  const ded = parseFloat(deductionDays);
  if (isNaN(ded) || ded <= 0 || ded > 5) {
    return res.status(400).json({ success: false, error: 'deductionDays must be > 0 and <= 5' });
  }
  if (!remark || !String(remark).trim()) {
    return res.status(400).json({ success: false, error: 'remark is required' });
  }

  const emp = db.prepare('SELECT id, code, name FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const result = db.prepare(`
    INSERT INTO late_coming_deductions
      (employee_code, employee_id, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    employeeCode, emp.id, parseInt(month), parseInt(year), company || null,
    parseInt(lateCount) || 0, ded, String(remark).trim(),
    req.user?.username || 'hr'
  );

  try {
    db.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'late_coming_deductions', result.lastInsertRowid, 'deduction_applied',
      '', `${ded} days`,
      req.user?.username || 'hr',
      'late_coming',
      `Late coming deduction applied: ${String(remark).trim()}`,
      employeeCode,
      'late_deduction_applied'
    );
  } catch (e) { /* audit should not break insertion */ }

  res.json({ success: true, id: result.lastInsertRowid });
});

// ─── GET /deductions ──────────────────────────────────────
router.get('/deductions', (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const company = req.query.company || null;
  const status = req.query.status || null;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  let where = 'WHERE lcd.month = ? AND lcd.year = ?';
  const params = [month, year];
  if (company) {
    where += ' AND (lcd.company = ? OR lcd.company IS NULL)';
    params.push(company);
  }
  if (status && status !== 'all') {
    where += ' AND lcd.finance_status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT lcd.*,
      e.name, e.department, e.shift_code
    FROM late_coming_deductions lcd
    LEFT JOIN employees e ON e.code = lcd.employee_code
    ${where}
    ORDER BY lcd.applied_at DESC
  `).all(...params);

  res.json({ success: true, data: rows });
});

// ─── GET /export ──────────────────────────────────────────
// Excel download of the per-employee late coming analytics for a month.
router.get('/export', requireHrFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const company = req.query.company || null;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }
  const prev = prevMonth(month, year);

  const params = [month, year, prev.month, prev.year, prev.month, prev.year, month, year];
  let companyFilter = '';
  if (company) {
    companyFilter = ' AND (e.company = ? OR ap.company = ?)';
    params.push(company, company);
  }

  const rows = db.prepare(`
    SELECT
      e.code, e.name, e.department, e.shift_code,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_this,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_last,
      AVG(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN ap.late_by_minutes END) AS avg_min,
      SUM(CASE WHEN ap.month = ? AND ap.year = ? AND ap.is_left_late = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_this
    FROM employees e
    LEFT JOIN attendance_processed ap ON ap.employee_code = e.code
    WHERE (e.status IS NULL OR e.status != 'Left')${companyFilter}
    GROUP BY e.code, e.name, e.department, e.shift_code
    ORDER BY late_this DESC, e.name ASC
  `).all(...params);

  // Pull deductions for the month so the export shows HR actions alongside the
  // raw punctuality data.
  const deductions = db.prepare(`
    SELECT employee_code, SUM(deduction_days) AS total_days,
      GROUP_CONCAT(finance_status) AS statuses
    FROM late_coming_deductions
    WHERE month = ? AND year = ?
    GROUP BY employee_code
  `).all(month, year);
  const dedMap = {};
  for (const d of deductions) dedMap[d.employee_code] = d;

  const header = [
    'Employee Code', 'Name', 'Department', 'Shift',
    'Late Count (This Month)', 'Late Count (Last Month)', 'Avg Minutes Late',
    'Left Late Count', 'Deduction Days', 'Deduction Status'
  ];
  const data = [header];
  for (const r of rows) {
    const d = dedMap[r.code];
    data.push([
      r.code, r.name, r.department || '', r.shift_code || '',
      Number(r.late_this) || 0,
      Number(r.late_last) || 0,
      r.avg_min ? Math.round(r.avg_min * 10) / 10 : 0,
      Number(r.left_late_this) || 0,
      d ? Number(d.total_days) : 0,
      d ? d.statuses : ''
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Late Coming');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `late_coming_${year}_${String(month).padStart(2, '0')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// ─── Finance approval helpers (Phase 2) ───────────────────
// Returns the last N (month, year) tuples ending at (refMonth, refYear).
function lastNMonths(refMonth, refYear, n) {
  const tuples = [];
  let m = parseInt(refMonth);
  let y = parseInt(refYear);
  for (let i = 0; i < n; i++) {
    tuples.push({ month: m, year: y });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return tuples;
}

// Build 6-month history for a given employee ending at (month, year).
function buildDeductionHistory(db, employeeCode, month, year, monthsBack = 6) {
  const tuples = lastNMonths(month, year, monthsBack);
  const history = [];
  let leftLateTotal = 0;
  for (const t of tuples) {
    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count,
        AVG(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN late_by_minutes END) AS avg_late_minutes,
        SUM(CASE WHEN is_left_late = 1 AND is_night_out_only = 0 THEN 1 ELSE 0 END) AS left_late_count
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ?
    `).get(employeeCode, t.month, t.year);
    const deds = db.prepare(`
      SELECT id, deduction_days, remark, applied_by, applied_at,
             finance_status, finance_remark, is_applied_to_salary
      FROM late_coming_deductions
      WHERE employee_code = ? AND month = ? AND year = ?
      ORDER BY applied_at DESC
    `).all(employeeCode, t.month, t.year);
    const leftLateCount = Number(stats?.left_late_count) || 0;
    leftLateTotal += leftLateCount;
    history.push({
      month: t.month,
      year: t.year,
      late_count: Number(stats?.late_count) || 0,
      avg_late_minutes: stats?.avg_late_minutes ? Math.round(stats.avg_late_minutes * 10) / 10 : 0,
      left_late_count: leftLateCount,
      deductions: deds
    });
  }
  return { history, leftLateTotal };
}

// ─── GET /finance-pending ─────────────────────────────────
// List all pending deductions for a month with enriched context so Finance
// can make approve/reject decisions without additional round-trips.
router.get('/finance-pending', requireHrFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const company = req.query.company || null;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  let where = "WHERE lcd.month = ? AND lcd.year = ? AND lcd.finance_status = 'pending'";
  const params = [month, year];
  if (company) {
    where += ' AND (lcd.company = ? OR lcd.company IS NULL)';
    params.push(company);
  }

  const rows = db.prepare(`
    SELECT lcd.id, lcd.employee_code, lcd.month, lcd.year, lcd.company,
      lcd.late_count, lcd.deduction_days, lcd.remark, lcd.applied_by, lcd.applied_at,
      lcd.finance_status,
      e.name, e.department, e.designation, e.shift_code,
      s.name AS shift_name, s.start_time AS shift_start, s.end_time AS shift_end
    FROM late_coming_deductions lcd
    LEFT JOIN employees e ON e.code = lcd.employee_code
    LEFT JOIN shifts s ON s.code = e.shift_code
    ${where}
    ORDER BY lcd.applied_at DESC
  `).all(...params);

  // Enrich with current-month stats + 6-month history
  const enriched = rows.map(r => {
    const currentStats = db.prepare(`
      SELECT
        SUM(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN 1 ELSE 0 END) AS late_count,
        AVG(CASE WHEN is_late_arrival = 1 AND is_night_out_only = 0 THEN late_by_minutes END) AS avg_minutes
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ?
    `).get(r.employee_code, month, year);
    const { history, leftLateTotal } = buildDeductionHistory(db, r.employee_code, month, year, 6);
    return {
      ...r,
      current_month_late_count: Number(currentStats?.late_count) || 0,
      current_month_avg_minutes: currentStats?.avg_minutes
        ? Math.round(currentStats.avg_minutes * 10) / 10
        : 0,
      history,
      leftLateTotal
    };
  });

  res.json({ success: true, data: enriched });
});

// ─── PUT /finance-review/:id ──────────────────────────────
// Approve or reject a single pending deduction.
router.put('/finance-review/:id', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { status, remark } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id required' });
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, error: "status must be 'approved' or 'rejected'" });
  }
  if (status === 'rejected' && (!remark || !String(remark).trim())) {
    return res.status(400).json({ success: false, error: 'remark is required when rejecting' });
  }

  const existing = db.prepare('SELECT * FROM late_coming_deductions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Deduction not found' });
  if (existing.finance_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Deduction already ${existing.finance_status}` });
  }

  const reviewer = req.user?.username || 'finance';
  const cleanRemark = remark ? String(remark).trim() : '';

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE late_coming_deductions
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
    } catch (e) { /* finance_approvals insert should not break review */ }

    try {
      db.prepare(`
        INSERT INTO audit_log
          (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'late_coming_deductions', id, 'finance_status',
        'pending', status, reviewer, 'late_coming',
        `Finance ${status}: ${existing.deduction_days} days deduction. ${cleanRemark || ''}`.trim(),
        existing.employee_code, 'finance_review'
      );
    } catch (e) { /* audit should not break review */ }
  });
  txn();

  res.json({ success: true, id, status });
});

// ─── PUT /finance-bulk-review ─────────────────────────────
// Approve or reject multiple pending deductions in a single transaction.
router.put('/finance-bulk-review', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { deductionIds, status, remark } = req.body || {};
  if (!Array.isArray(deductionIds) || deductionIds.length === 0) {
    return res.status(400).json({ success: false, error: 'deductionIds array required' });
  }
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, error: "status must be 'approved' or 'rejected'" });
  }
  if (status === 'rejected' && (!remark || !String(remark).trim())) {
    return res.status(400).json({ success: false, error: 'remark is required when rejecting' });
  }

  const reviewer = req.user?.username || 'finance';
  const cleanRemark = remark ? String(remark).trim() : '';
  let count = 0;

  const txn = db.transaction(() => {
    for (const rawId of deductionIds) {
      const id = parseInt(rawId);
      if (!id) continue;
      const existing = db.prepare('SELECT * FROM late_coming_deductions WHERE id = ?').get(id);
      if (!existing || existing.finance_status !== 'pending') continue;

      db.prepare(`
        UPDATE late_coming_deductions
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

      try {
        db.prepare(`
          INSERT INTO audit_log
            (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'late_coming_deductions', id, 'finance_status',
          'pending', status, reviewer, 'late_coming',
          `Finance bulk ${status}: ${existing.deduction_days} days. ${cleanRemark || ''}`.trim(),
          existing.employee_code, 'finance_review'
        );
      } catch (e) { /* best effort */ }

      count += 1;
    }
  });
  txn();

  res.json({ success: true, count });
});

module.exports = router;
