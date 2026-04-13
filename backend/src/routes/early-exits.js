// Early Exit Detection & Deduction Routes — April 2026
//
// Detection: detect early departures, list/filter results, analytics.
// Mounted at /api/early-exits.

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { getDb, logAudit } = require('../database/db');
const { detectEarlyExits } = require('../services/earlyExitDetection');

// ─── Utility: previous month/year ─────────────────────────
function prevMonth(month, year) {
  const m = parseInt(month);
  const y = parseInt(year);
  if (m === 1) return { month: 12, year: y - 1 };
  return { month: m - 1, year: y };
}

// Normalise "up" / "down" / "stable" trend. Uses a relative threshold so tiny
// swings don't get flagged as regressions. Mirrors lateComing.js.
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

// Validate YYYY-MM-DD. Accepts only ISO dates.
function isValidDate(s) {
  if (!s || typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

// Days between two YYYY-MM-DD strings (inclusive).
function daysBetween(start, end) {
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

// Last day of a given month/year as YYYY-MM-DD (calendar end-of-month).
function lastDayOfMonth(month, year) {
  const d = new Date(Date.UTC(year, month, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

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

// ────────────────────────────────────────────────────────────
// POST /detect — Run early exit detection for a date
// ────────────────────────────────────────────────────────────
router.post('/detect', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    let { date } = req.body;

    // Default to yesterday
    if (!date) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      date = d.toISOString().split('T')[0];
    }

    // Reject future dates — detection requires actual punch-out data
    const today = new Date().toISOString().split('T')[0];
    if (date > today) {
      return res.status(400).json({
        success: false,
        error: 'Detection date cannot be in the future'
      });
    }

    const result = detectEarlyExits(db, date);

    return res.json({
      success: true,
      date,
      detected: result.detected,
      exempted: result.exempted,
      skipped: result.skipped
    });
  } catch (err) {
    console.error('[early-exits] POST /detect error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /detect-range — Batch detect early exits for a date range
// Loops detectEarlyExits() for each date in the range.
// Max 90 days. Returns per-date results.
// ────────────────────────────────────────────────────────────
router.post('/detect-range', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate required (YYYY-MM-DD)' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: 'startDate must be <= endDate' });
    }
    const today = new Date().toISOString().split('T')[0];
    const effectiveEnd = endDate > today ? today : endDate;
    const span = daysBetween(startDate, effectiveEnd);
    if (span > 90) {
      return res.status(400).json({ success: false, error: 'Maximum range is 90 days' });
    }

    const results = [];
    let totalDetected = 0, totalExempted = 0, totalSkipped = 0;

    const current = new Date(startDate + 'T00:00:00Z');
    const end = new Date(effectiveEnd + 'T00:00:00Z');

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const result = detectEarlyExits(db, dateStr);
      results.push({ date: dateStr, ...result });
      totalDetected += result.detected;
      totalExempted += result.exempted;
      totalSkipped += result.skipped;
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return res.json({
      success: true,
      datesProcessed: results.length,
      totalDetected,
      totalExempted,
      totalSkipped,
      details: results
    });
  } catch (err) {
    console.error('[early-exits] POST /detect-range error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET / — List detections with filters
// ────────────────────────────────────────────────────────────
router.get('/', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { date_from, date_to, employee_code, department, company,
            detection_status, has_gate_pass, month, year } = req.query;

    let sql = `
      SELECT eed.*,
        edd.id as deduction_id,
        edd.deduction_type,
        edd.deduction_amount,
        edd.finance_status as deduction_finance_status
      FROM early_exit_detections eed
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE 1=1
    `;
    const params = [];

    if (date_from) { sql += ' AND eed.date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND eed.date <= ?'; params.push(date_to); }
    if (employee_code) { sql += ' AND eed.employee_code = ?'; params.push(employee_code); }
    if (department) { sql += ' AND eed.department = ?'; params.push(department); }
    if (company) { sql += ' AND eed.company = ?'; params.push(company); }
    if (detection_status) { sql += ' AND eed.detection_status = ?'; params.push(detection_status); }
    if (has_gate_pass !== undefined && has_gate_pass !== '') {
      sql += ' AND eed.has_gate_pass = ?'; params.push(parseInt(has_gate_pass));
    }
    if (month && year) {
      sql += " AND CAST(strftime('%m', eed.date) AS INTEGER) = ? AND CAST(strftime('%Y', eed.date) AS INTEGER) = ?";
      params.push(parseInt(month), parseInt(year));
    }

    sql += ' ORDER BY eed.date DESC, eed.flagged_minutes DESC';

    const data = db.prepare(sql).all(...params);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[early-exits] GET / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /summary — Org-wide summary for dashboard
// ────────────────────────────────────────────────────────────
router.get('/summary', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const company = req.query.company;

    let whereClause = "CAST(strftime('%m', eed.date) AS INTEGER) = ? AND CAST(strftime('%Y', eed.date) AS INTEGER) = ?";
    const params = [month, year];
    if (company) { whereClause += ' AND eed.company = ?'; params.push(company); }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN eed.detection_status = 'flagged' THEN 1 ELSE 0 END) as flagged,
        SUM(CASE WHEN eed.detection_status = 'exempted' THEN 1 ELSE 0 END) as exempted_count,
        SUM(CASE WHEN eed.detection_status = 'actioned' THEN 1 ELSE 0 END) as actioned,
        ROUND(AVG(CASE WHEN eed.detection_status != 'exempted' THEN eed.flagged_minutes END), 1) as avg_flagged_minutes
      FROM early_exit_detections eed
      WHERE ${whereClause}
    `).get(...params);

    // Pending finance
    const pendingFinance = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_deductions
      WHERE finance_status = 'pending'
        AND payroll_month = ? AND payroll_year = ?
    `).get(month, year);

    // Trend: current 30d vs previous 30d
    const now = new Date();
    const d30ago = new Date(now); d30ago.setDate(d30ago.getDate() - 30);
    const d60ago = new Date(now); d60ago.setDate(d60ago.getDate() - 60);

    let trendWhere = "eed.detection_status != 'exempted'";
    if (company) trendWhere += ` AND eed.company = '${company}'`;

    const current30 = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_detections eed
      WHERE eed.date >= ? AND eed.date <= ? AND ${trendWhere}
    `).get(d30ago.toISOString().split('T')[0], now.toISOString().split('T')[0]);

    const prev30 = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_detections eed
      WHERE eed.date >= ? AND eed.date < ? AND ${trendWhere}
    `).get(d60ago.toISOString().split('T')[0], d30ago.toISOString().split('T')[0]);

    const trend = (current30?.cnt || 0) - (prev30?.cnt || 0);

    return res.json({
      success: true,
      month, year,
      total: stats?.total || 0,
      flagged: stats?.flagged || 0,
      exempted: stats?.exempted_count || 0,
      actioned: stats?.actioned || 0,
      pending_hr: stats?.flagged || 0,
      pending_finance: pendingFinance?.cnt || 0,
      avg_flagged_minutes: stats?.avg_flagged_minutes || 0,
      trend,
      trend_direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
    });
  } catch (err) {
    console.error('[early-exits] GET /summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /employee/:employeeCode/analytics — Per-employee analytics
// ────────────────────────────────────────────────────────────
router.get('/employee/:employeeCode/analytics', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employeeCode } = req.params;
    const now = new Date();

    // 4 x 30-day windows
    const windows = [];
    for (let i = 0; i < 4; i++) {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - (i * 30));
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);

      const count = db.prepare(`
        SELECT COUNT(*) as cnt FROM early_exit_detections
        WHERE employee_code = ? AND date >= ? AND date <= ?
          AND detection_status != 'exempted'
      `).get(employeeCode, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

      windows.push({
        period: i === 0 ? 'Current' : `${i * 30}d ago`,
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        count: count?.cnt || 0
      });
    }

    const currentCount = windows[0]?.count || 0;
    const prevCount = windows[1]?.count || 0;
    const isHabitual = currentCount >= 3;
    const trend = currentCount - prevCount;

    // History
    const history = db.prepare(`
      SELECT eed.*,
        edd.id as deduction_id,
        edd.deduction_type,
        edd.deduction_amount,
        edd.finance_status as deduction_finance_status,
        edd.hr_remark
      FROM early_exit_detections eed
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE eed.employee_code = ?
      ORDER BY eed.date DESC
      LIMIT 90
    `).all(employeeCode);

    return res.json({
      success: true,
      employee_code: employeeCode,
      is_habitual: isHabitual,
      current_30d_count: currentCount,
      trend,
      trend_direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
      chart_data: windows.reverse(),
      history
    });
  } catch (err) {
    console.error('[early-exits] GET /employee/:code/analytics error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /range-report — Early exits for an arbitrary date range
// ────────────────────────────────────────────────────────────
// Query params: startDate, endDate (YYYY-MM-DD, both required),
// company, employeeCode, department, minMinutes (optional filters).
// Max 90-day range. Returns row-level details plus summary aggregates.
router.get('/range-report', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate, company, employeeCode, department } = req.query;
    const minMinutes = req.query.minMinutes !== undefined && req.query.minMinutes !== ''
      ? parseInt(req.query.minMinutes)
      : null;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ success: false, error: 'Dates must be valid YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: 'startDate must be on or before endDate' });
    }
    const span = daysBetween(startDate, endDate);
    if (span > 90) {
      return res.status(400).json({ success: false, error: 'Maximum range is 90 days' });
    }

    let sql = `
      SELECT
        eed.id,
        eed.employee_code,
        eed.employee_name,
        eed.department,
        eed.company,
        eed.date,
        eed.shift_code,
        eed.shift_end_time,
        eed.actual_punch_out_time,
        eed.minutes_early,
        eed.has_gate_pass,
        eed.flagged_minutes,
        eed.detection_status,
        sl.id AS short_leave_id,
        sl.remark AS short_leave_remark,
        sl.authorized_leave_until
      FROM early_exit_detections eed
      LEFT JOIN short_leaves sl ON eed.short_leave_id = sl.id
      WHERE eed.date BETWEEN ? AND ?
    `;
    const params = [startDate, endDate];
    if (company) { sql += ' AND eed.company = ?'; params.push(company); }
    if (employeeCode) { sql += ' AND eed.employee_code = ?'; params.push(employeeCode); }
    if (department) { sql += ' AND eed.department = ?'; params.push(department); }
    if (minMinutes !== null && !isNaN(minMinutes)) {
      sql += ' AND eed.minutes_early >= ?';
      params.push(minMinutes);
    }
    sql += ' ORDER BY eed.date DESC, eed.minutes_early DESC';

    const rows = db.prepare(sql).all(...params);

    // Summary aggregates — only flagged rows (exempted rows don't count
    // against the "early exit" narrative but are still returned in the list).
    const nonExempt = rows.filter(r => r.detection_status !== 'exempted');
    const uniqueEmpSet = new Set(nonExempt.map(r => r.employee_code));
    const totalFlaggedMinutes = nonExempt.reduce((s, r) => s + (Number(r.flagged_minutes) || 0), 0);
    const totalMinutesEarly = nonExempt.reduce((s, r) => s + (Number(r.minutes_early) || 0), 0);
    const withGatePass = rows.filter(r => r.has_gate_pass === 1 || r.has_gate_pass === true).length;
    const withoutGatePass = rows.length - withGatePass;
    const avgMinutesEarly = nonExempt.length > 0
      ? Math.round((totalMinutesEarly / nonExempt.length) * 10) / 10
      : 0;

    return res.json({
      success: true,
      data: rows,
      summary: {
        totalIncidents: rows.length,
        nonExemptIncidents: nonExempt.length,
        uniqueEmployees: uniqueEmpSet.size,
        avgMinutesEarly,
        totalFlaggedMinutes,
        withGatePass,
        withoutGatePass,
        dateRange: { start: startDate, end: endDate, days: span }
      },
      filters: {
        company: company || null,
        employeeCode: employeeCode || null,
        department: department || null,
        minMinutes: minMinutes !== null && !isNaN(minMinutes) ? minMinutes : null
      }
    });
  } catch (err) {
    console.error('[early-exits] GET /range-report error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /employee-summary — Per-employee grouped view for date range
// Groups early exits by employee with prev-period comparison and
// habitual offender flag. Max 90-day range.
// Query params: startDate, endDate (required), company, department,
//               minExits (optional, default 1)
// ────────────────────────────────────────────────────────────
router.get('/employee-summary', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate, company, department } = req.query;
    const minExits = req.query.minExits !== undefined && req.query.minExits !== ''
      ? Math.max(1, parseInt(req.query.minExits) || 1)
      : 1;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ success: false, error: 'Dates must be valid YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: 'startDate must be on or before endDate' });
    }
    const days = daysBetween(startDate, endDate);
    if (days > 90) {
      return res.status(400).json({ success: false, error: 'Maximum range is 90 days' });
    }

    // ── Main GROUP BY query ──────────────────────────────────
    let sql = `
      SELECT
        eed.employee_code,
        eed.employee_name,
        eed.department,
        eed.company,
        COUNT(*) AS total_exits,
        ROUND(AVG(eed.minutes_early), 1) AS avg_minutes_early,
        MAX(eed.minutes_early) AS max_minutes_early,
        MIN(eed.date) AS first_exit_date,
        MAX(eed.date) AS last_exit_date,
        SUM(CASE WHEN eed.has_gate_pass = 1 THEN 1 ELSE 0 END) AS gate_pass_count,
        SUM(CASE WHEN eed.detection_status = 'actioned' THEN 1 ELSE 0 END) AS actioned_count,
        SUM(CASE WHEN eed.detection_status = 'exempted' THEN 1 ELSE 0 END) AS exempted_count,
        GROUP_CONCAT(
          eed.date || ':' || eed.minutes_early || ':' ||
          COALESCE(eed.actual_punch_out_time, '') || ':' ||
          eed.has_gate_pass || ':' || eed.detection_status,
          '|'
        ) AS date_details
      FROM early_exit_detections eed
      WHERE eed.date BETWEEN ? AND ?
    `;
    const params = [startDate, endDate];
    if (company) { sql += ' AND eed.company = ?'; params.push(company); }
    if (department) { sql += ' AND eed.department = ?'; params.push(department); }
    sql += ' GROUP BY eed.employee_code HAVING COUNT(*) >= ? ORDER BY total_exits DESC, avg_minutes_early DESC';
    params.push(minExits);

    const rows = db.prepare(sql).all(...params);

    // ── Previous period comparison (same duration, immediately before startDate) ─
    const prevEnd = new Date(startDate + 'T00:00:00Z');
    prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    let prevSql = `
      SELECT employee_code, COUNT(*) AS prev_exits
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
    `;
    const prevParams = [prevStartStr, prevEndStr];
    if (company) { prevSql += ' AND company = ?'; prevParams.push(company); }
    if (department) { prevSql += ' AND department = ?'; prevParams.push(department); }
    prevSql += ' GROUP BY employee_code';

    const prevRows = db.prepare(prevSql).all(...prevParams);
    const prevMap = {};
    prevRows.forEach(r => { prevMap[r.employee_code] = r.prev_exits; });

    // ── Enrich each row ──────────────────────────────────────
    rows.forEach(row => {
      // Parse date_details into per-incident array
      row.incidents = (row.date_details || '').split('|').filter(Boolean).map(s => {
        const parts = s.split(':');
        return {
          date: parts[0] || '',
          minutes_early: Number(parts[1]) || 0,
          punch_out: parts[2] || '',
          has_gate_pass: parts[3] === '1',
          status: parts[4] || 'flagged'
        };
      });
      delete row.date_details;

      row.prev_exits = prevMap[row.employee_code] || 0;
      row.trend = trendLabel(row.total_exits, row.prev_exits);
      row.is_habitual = row.total_exits >= 5 || (row.total_exits >= 3 && row.avg_minutes_early >= 60);
    });

    // ── Summary block ────────────────────────────────────────
    const totalIncidents = rows.reduce((s, r) => s + r.total_exits, 0);
    return res.json({
      success: true,
      data: rows,
      summary: {
        totalEmployees: rows.length,
        habitualCount: rows.filter(r => r.is_habitual).length,
        totalIncidents,
        avgExitsPerEmployee: rows.length
          ? Math.round((totalIncidents / rows.length) * 10) / 10
          : 0,
        dateRange: { start: startDate, end: endDate, days }
      }
    });
  } catch (err) {
    console.error('[early-exits] GET /employee-summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /mtd-summary — Per-employee month-to-date with trend
// ────────────────────────────────────────────────────────────
router.get('/mtd-summary', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);
    const company = req.query.company || null;
    if (!month || !year) {
      return res.status(400).json({ success: false, error: 'month and year required' });
    }

    const prev = prevMonth(month, year);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = lastDayOfMonth(month, year);
    const prevStart = `${prev.year}-${String(prev.month).padStart(2, '0')}-01`;
    const prevEnd = lastDayOfMonth(prev.month, prev.year);

    const companyFilter = company ? ' AND company = ?' : '';
    const currParams = [monthStart, monthEnd, ...(company ? [company] : [])];
    const prevParams = [prevStart, prevEnd, ...(company ? [company] : [])];

    const currentRows = db.prepare(`
      SELECT
        employee_code,
        employee_name,
        department,
        company,
        COUNT(*) AS exit_count_this_month,
        ROUND(AVG(minutes_early), 1) AS avg_minutes_early,
        SUM(flagged_minutes) AS total_flagged_minutes,
        SUM(CASE WHEN has_gate_pass = 1 THEN 1 ELSE 0 END) AS gate_pass_count
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
        AND detection_status != 'exempted'
        ${companyFilter}
      GROUP BY employee_code, employee_name, department, company
      ORDER BY exit_count_this_month DESC, employee_name ASC
    `).all(...currParams);

    const prevRows = db.prepare(`
      SELECT employee_code, COUNT(*) AS prev_count
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
        AND detection_status != 'exempted'
        ${companyFilter}
      GROUP BY employee_code
    `).all(...prevParams);
    const prevMap = {};
    for (const r of prevRows) prevMap[r.employee_code] = Number(r.prev_count) || 0;

    const data = currentRows.map(r => {
      const prevCount = prevMap[r.employee_code] || 0;
      return {
        employee_code: r.employee_code,
        name: r.employee_name,
        department: r.department,
        company: r.company,
        exit_count_this_month: Number(r.exit_count_this_month) || 0,
        exit_count_last_month: prevCount,
        avg_minutes_early: r.avg_minutes_early ? Number(r.avg_minutes_early) : 0,
        total_flagged_minutes: Number(r.total_flagged_minutes) || 0,
        gate_pass_count: Number(r.gate_pass_count) || 0,
        trend: trendLabel(r.exit_count_this_month, prevCount)
      };
    });

    // Aggregate totals for card display
    const totalIncidents = data.reduce((s, r) => s + r.exit_count_this_month, 0);
    const totalPrev = data.reduce((s, r) => s + r.exit_count_last_month, 0);

    return res.json({
      success: true,
      month,
      year,
      totals: {
        total_this_month: totalIncidents,
        total_last_month: totalPrev,
        unique_employees: data.length,
        trend: trendLabel(totalIncidents, totalPrev)
      },
      data
    });
  } catch (err) {
    console.error('[early-exits] GET /mtd-summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /department-summary — Per-department rollup with trend
// ────────────────────────────────────────────────────────────
router.get('/department-summary', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);
    const company = req.query.company || null;
    if (!month || !year) {
      return res.status(400).json({ success: false, error: 'month and year required' });
    }

    const prev = prevMonth(month, year);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = lastDayOfMonth(month, year);
    const prevStart = `${prev.year}-${String(prev.month).padStart(2, '0')}-01`;
    const prevEnd = lastDayOfMonth(prev.month, prev.year);

    const companyFilter = company ? ' AND company = ?' : '';
    const currParams = [monthStart, monthEnd, ...(company ? [company] : [])];
    const prevParams = [prevStart, prevEnd, ...(company ? [company] : [])];

    const currentRows = db.prepare(`
      SELECT
        department,
        COUNT(*) AS total_incidents,
        COUNT(DISTINCT employee_code) AS employee_count,
        ROUND(AVG(minutes_early), 1) AS avg_minutes_early,
        SUM(flagged_minutes) AS total_flagged_minutes
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
        AND detection_status != 'exempted'
        ${companyFilter}
      GROUP BY department
      ORDER BY total_incidents DESC
    `).all(...currParams);

    const prevRows = db.prepare(`
      SELECT department, COUNT(*) AS prev_count
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
        AND detection_status != 'exempted'
        ${companyFilter}
      GROUP BY department
    `).all(...prevParams);
    const prevMap = {};
    for (const r of prevRows) prevMap[r.department || ''] = Number(r.prev_count) || 0;

    // Worst offender per department
    const offenderRows = db.prepare(`
      SELECT department, employee_code, employee_name,
             COUNT(*) AS exit_count
      FROM early_exit_detections
      WHERE date BETWEEN ? AND ?
        AND detection_status != 'exempted'
        ${companyFilter}
      GROUP BY department, employee_code, employee_name
    `).all(...currParams);
    const offenderMap = {};
    for (const r of offenderRows) {
      const key = r.department || '';
      const count = Number(r.exit_count) || 0;
      if (!offenderMap[key] || count > offenderMap[key].exit_count) {
        offenderMap[key] = {
          employee_code: r.employee_code,
          name: r.employee_name,
          exit_count: count
        };
      }
    }

    const data = currentRows.map(r => {
      const prevCount = prevMap[r.department || ''] || 0;
      const current = Number(r.total_incidents) || 0;
      return {
        department: r.department || '(none)',
        employee_count: Number(r.employee_count) || 0,
        total_incidents: current,
        prev_incidents: prevCount,
        avg_minutes_early: r.avg_minutes_early ? Number(r.avg_minutes_early) : 0,
        total_flagged_minutes: Number(r.total_flagged_minutes) || 0,
        trend: trendLabel(current, prevCount),
        worst_offender: offenderMap[r.department || ''] || null
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[early-exits] GET /department-summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /export — XLSX download of range-report data
// ────────────────────────────────────────────────────────────
router.get('/export', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { startDate, endDate, company, employeeCode, department } = req.query;
    const minMinutes = req.query.minMinutes !== undefined && req.query.minMinutes !== ''
      ? parseInt(req.query.minMinutes)
      : null;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ success: false, error: 'Dates must be valid YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: 'startDate must be on or before endDate' });
    }
    const span = daysBetween(startDate, endDate);
    if (span > 90) {
      return res.status(400).json({ success: false, error: 'Maximum range is 90 days' });
    }

    let sql = `
      SELECT
        eed.date,
        eed.employee_code,
        eed.employee_name,
        eed.department,
        eed.company,
        eed.shift_code,
        eed.shift_end_time,
        eed.actual_punch_out_time,
        eed.minutes_early,
        eed.has_gate_pass,
        eed.flagged_minutes,
        eed.detection_status
      FROM early_exit_detections eed
      WHERE eed.date BETWEEN ? AND ?
    `;
    const params = [startDate, endDate];
    if (company) { sql += ' AND eed.company = ?'; params.push(company); }
    if (employeeCode) { sql += ' AND eed.employee_code = ?'; params.push(employeeCode); }
    if (department) { sql += ' AND eed.department = ?'; params.push(department); }
    if (minMinutes !== null && !isNaN(minMinutes)) {
      sql += ' AND eed.minutes_early >= ?';
      params.push(minMinutes);
    }
    sql += ' ORDER BY eed.date DESC, eed.minutes_early DESC';

    const rows = db.prepare(sql).all(...params);

    // Summary sheet
    const nonExempt = rows.filter(r => r.detection_status !== 'exempted');
    const uniqueEmp = new Set(nonExempt.map(r => r.employee_code)).size;
    const totalFlaggedMin = nonExempt.reduce((s, r) => s + (Number(r.flagged_minutes) || 0), 0);
    const avgMin = nonExempt.length > 0
      ? Math.round((nonExempt.reduce((s, r) => s + (Number(r.minutes_early) || 0), 0) / nonExempt.length) * 10) / 10
      : 0;
    const withGp = rows.filter(r => r.has_gate_pass === 1).length;

    const summaryData = [
      ['Early Exit Report'],
      [],
      ['Date Range', `${startDate} to ${endDate}`],
      ['Days', span],
      ['Company Filter', company || 'All'],
      ['Employee Filter', employeeCode || 'All'],
      ['Department Filter', department || 'All'],
      ['Min Minutes Filter', minMinutes !== null && !isNaN(minMinutes) ? minMinutes : 'None'],
      [],
      ['Total Incidents', rows.length],
      ['Non-Exempt Incidents', nonExempt.length],
      ['Unique Employees', uniqueEmp],
      ['Avg Minutes Early', avgMin],
      ['Total Flagged Minutes', totalFlaggedMin],
      ['With Gate Pass', withGp],
      ['Without Gate Pass', rows.length - withGp]
    ];

    const detailHeader = [
      'Date', 'Employee Code', 'Employee Name', 'Department', 'Company',
      'Shift', 'Shift End', 'Actual Punch Out', 'Minutes Early',
      'Gate Pass', 'Flagged Minutes', 'Status'
    ];
    const detailData = [detailHeader];
    for (const r of rows) {
      detailData.push([
        r.date,
        r.employee_code,
        r.employee_name || '',
        r.department || '',
        r.company || '',
        r.shift_code || '',
        r.shift_end_time || '',
        r.actual_punch_out_time || '',
        Number(r.minutes_early) || 0,
        r.has_gate_pass === 1 ? 'Yes' : 'No',
        Number(r.flagged_minutes) || 0,
        r.detection_status || ''
      ]);
    }

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 24 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
    wsDetail['!cols'] = [
      { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 20 }, { wch: 18 },
      { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
      { wch: 10 }, { wch: 16 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Early Exit Details');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `EarlyExitReport_${startDate}_to_${endDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (err) {
    console.error('[early-exits] GET /export error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id — Single detection record
// ────────────────────────────────────────────────────────────
router.get('/:id', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT eed.*,
        sl.leave_type as gate_pass_type, sl.duration_hours as gate_pass_duration,
        sl.remark as gate_pass_remark, sl.quota_breach as gate_pass_quota_breach,
        edd.id as deduction_id, edd.deduction_type, edd.deduction_amount,
        edd.finance_status as deduction_finance_status, edd.hr_remark, edd.finance_remark
      FROM early_exit_detections eed
      LEFT JOIN short_leaves sl ON sl.id = eed.short_leave_id
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE eed.id = ?
    `).get(req.params.id);

    if (!record) return res.status(404).json({ success: false, error: 'Detection not found' });
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('[early-exits] GET /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
