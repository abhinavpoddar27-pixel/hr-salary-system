const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const {
  computeOrgOverview, computeHeadcountTrend, computeAttrition,
  computeChronicAbsentees, computePunctualityReport, computeOvertimeReport,
  computeWorkingHoursReport, computeDepartmentDeepDive, generateAlerts
} = require('../services/analytics');
const { detectPatterns, detectAllPatterns, generateNarrative } = require('../services/behavioralPatterns');
const { computeProfileRange } = require('../services/employeeProfileService');
const { generateAIReview } = require('../services/aiReviewService');
const { computeDepartmentAnalytics } = require('../services/deptAnalyticsService');
const { computeOrgMetrics } = require('../services/orgMetricsService');

// GET org overview
router.get('/overview', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computeOrgOverview(db, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || {} });
  } catch (err) {
    console.error('Analytics overview error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute overview: ' + err.message });
  }
});

// GET headcount trend (last 6 months)
router.get('/headcount-trend', (req, res) => {
  try {
    const db = getDb();
    const { month, year, months: numMonths = 6 } = req.query;

    const endMonth = parseInt(month);
    const endYear = parseInt(year);
    if (isNaN(endMonth) || isNaN(endYear)) {
      return res.json({ success: true, data: [] });
    }
    const monthsArray = [];

    for (let i = parseInt(numMonths) - 1; i >= 0; i--) {
      let m = endMonth - i;
      let y = endYear;
      while (m <= 0) { m += 12; y--; }
      while (m > 12) { m -= 12; y++; }
      monthsArray.push({ month: m, year: y });
    }

    const trend = computeHeadcountTrend(db, monthsArray);
    res.json({ success: true, data: trend });
  } catch (err) {
    console.error('Headcount trend error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute headcount trend: ' + err.message });
  }
});

// GET attrition analysis
router.get('/attrition', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    const data = computeAttrition(db, parseInt(month), parseInt(year));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Attrition error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute attrition: ' + err.message });
  }
});

// GET chronic absentees
router.get('/absentees', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computeChronicAbsentees(db, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Absentees error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute absentees: ' + err.message });
  }
});

// GET punctuality report
router.get('/punctuality', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computePunctualityReport(db, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || {} });
  } catch (err) {
    console.error('Punctuality error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute punctuality report: ' + err.message });
  }
});

// GET department stats
router.get('/departments', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;

    const records = db.prepare(`
      SELECT ap.employee_code, ap.status_final, ap.status_original, ap.date,
             ap.is_late_arrival, ap.late_by_minutes, ap.overtime_minutes, ap.actual_hours,
             e.department, e.company
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    `).all(month, year);

    const deptMap = {};
    for (const r of records) {
      const dept = r.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { department: dept, employees: new Set(), totalDays: 0, presentDays: 0, lateDays: 0, otMinutes: 0, totalHours: 0, hoursCount: 0 };
      deptMap[dept].employees.add(r.employee_code);

      const dow = new Date(r.date + 'T12:00:00').getDay();
      if (dow !== 0) {
        deptMap[dept].totalDays++;
        const status = r.status_final || r.status_original || '';
        if (status === 'P' || status === 'WOP') deptMap[dept].presentDays += 1;
        else if (status === '½P' || status === 'WO½P') deptMap[dept].presentDays += 0.5;
      }
      if (r.is_late_arrival) deptMap[dept].lateDays++;
      if (r.overtime_minutes) deptMap[dept].otMinutes += r.overtime_minutes;
      if (r.actual_hours) { deptMap[dept].totalHours += r.actual_hours; deptMap[dept].hoursCount++; }
    }

    const departments = Object.values(deptMap).map(d => ({
      department: d.department,
      headcount: d.employees.size,
      attendanceRate: d.totalDays > 0 ? Math.round(d.presentDays / d.totalDays * 1000) / 10 : 0,
      punctualityRate: d.presentDays > 0 ? Math.round((1 - d.lateDays / d.presentDays) * 1000) / 10 : 100,
      avgHoursPerDay: d.hoursCount > 0 ? Math.round(d.totalHours / d.hoursCount * 100) / 100 : 0,
      totalOtHours: Math.round(d.otMinutes / 60 * 10) / 10
    })).sort((a, b) => b.headcount - a.headcount);

    res.json({ success: true, data: departments });
  } catch (err) {
    console.error('Department stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute department stats: ' + err.message });
  }
});

// GET overtime report
router.get('/overtime', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computeOvertimeReport(db, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || {} });
  } catch (err) {
    console.error('Overtime report error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute overtime report: ' + err.message });
  }
});

// GET working hours distribution
router.get('/working-hours', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computeWorkingHoursReport(db, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || {} });
  } catch (err) {
    console.error('Working hours error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute working hours report: ' + err.message });
  }
});

// GET department deep-dive
router.get('/department/:name', (req, res) => {
  try {
    const db = getDb();
    const { month, year, startDate, endDate } = req.query;
    const data = computeDepartmentDeepDive(db, req.params.name, parseInt(month), parseInt(year), startDate, endDate);
    res.json({ success: true, data: data || { department: req.params.name, employees: [] } });
  } catch (err) {
    console.error('Department deep-dive error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute department deep-dive: ' + err.message });
  }
});

// GET attendance heatmap (employee × day for selected month)
router.get('/heatmap', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;

    if (!month || !year) {
      return res.json({ success: true, data: { employees: [] } });
    }

    // Get all attendance records for the month
    const records = db.prepare(`
      SELECT ap.employee_code, e.name, ap.date, ap.is_night_out_only,
             COALESCE(ap.status_final, ap.status_original, '') as status
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.month = ? AND ap.year = ?
      ORDER BY e.department, e.name, ap.date
    `).all(month, year);

    // Group by employee
    const empMap = {};
    for (const r of records) {
      if (r.is_night_out_only) continue;
      if (!empMap[r.employee_code]) {
        empMap[r.employee_code] = { code: r.employee_code, name: r.name || r.employee_code, days: [] };
      }
      const day = parseInt(r.date.split('-')[2]);
      empMap[r.employee_code].days[day - 1] = { day, status: r.status };
    }

    const employees = Object.values(empMap);
    res.json({ success: true, data: { employees } });
  } catch (err) {
    console.error('Heatmap error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute heatmap: ' + err.message });
  }
});

// GET alerts
router.get('/alerts', (req, res) => {
  try {
    const db = getDb();
    const { month, year, unread } = req.query;

    let query = `SELECT a.*,
      a.type as alert_type,
      COALESCE(a.description, a.title) as message,
      e.name as employee_name
      FROM alerts a
      LEFT JOIN employees e ON a.employee_code = e.code
      WHERE 1=1`;
    const params = [];

    if (month) { query += ' AND a.month = ?'; params.push(month); }
    if (year) { query += ' AND a.year = ?'; params.push(year); }
    if (unread === 'true') { query += ' AND a.is_read = 0'; }

    query += ` ORDER BY CASE LOWER(a.severity)
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5
      END, a.created_at DESC`;

    const alerts = db.prepare(query).all(...params);

    const counts = {
      total: alerts.length,
      critical: alerts.filter(a => a.severity?.toLowerCase() === 'critical').length,
      high: alerts.filter(a => a.severity?.toLowerCase() === 'high').length,
      unread: alerts.filter(a => !a.is_read).length
    };

    res.json({ success: true, data: alerts, counts });
  } catch (err) {
    console.error('Alerts error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch alerts: ' + err.message });
  }
});

// POST generate alerts for a month
router.post('/alerts/generate', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.body;

    const alerts = generateAlerts(db, parseInt(month), parseInt(year));
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err) {
    console.error('Generate alerts error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate alerts: ' + err.message });
  }
});

// PUT mark alert as read
router.put('/alerts/:id/read', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark alert read error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to mark alert as read: ' + err.message });
  }
});

// GET employee profile with historical data
router.get('/employee/:code', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;

    const employee = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    // Last 6 months attendance history
    const history = db.prepare(`
      SELECT month, year,
        SUM(CASE WHEN is_night_out_only = 0 AND (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                 WHEN is_night_out_only = 0 AND (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5
                 ELSE 0 END) as present_days,
        SUM(CASE WHEN is_night_out_only = 0 AND strftime('%w', date) != '0' THEN 1 ELSE 0 END) as working_days,
        SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late_count,
        AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
      FROM attendance_processed
      WHERE employee_code = ? AND is_night_out_only = 0
      GROUP BY year, month
      ORDER BY year DESC, month DESC
      LIMIT 12
    `).all(code);

    // Current month daily attendance
    const attendance = db.prepare(`
      SELECT date, status_final, status_original, in_time_final, out_time_final,
             actual_hours, is_night_shift, is_late_arrival, late_by_minutes
      FROM attendance_processed
      WHERE employee_code = ? AND is_night_out_only = 0
      ORDER BY date DESC LIMIT 60
    `).all(code);

    // Salary history
    const salaryHistory = db.prepare(`
      SELECT month, year, gross_earned, net_salary, total_deductions
      FROM salary_computations WHERE employee_code = ?
      ORDER BY year DESC, month DESC LIMIT 12
    `).all(code);

    // Leave balances
    const leaveBalances = db.prepare(`
      SELECT * FROM leave_balances WHERE employee_id = ? ORDER BY year DESC
    `).all(employee.id);

    res.json({
      success: true,
      data: { employee, history, attendance, salaryHistory, leaveBalances }
    });
  } catch (err) {
    console.error('Employee profile error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch employee profile: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/analytics/detect-inactive
// Auto-detect employees inactive for 14+ consecutive days
// Mark them as "Left" so they are excluded from workforce
// Also auto-reactivate employees who have returned
// ─────────────────────────────────────────────────────────
router.post('/detect-inactive', (req, res) => {
  try {
    const db = getDb();
    const { month, year, inactiveDays = 14 } = req.body;

    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

    const m = parseInt(month);
    const y = parseInt(year);

    const result = runDetectLeftLogic(db, m, y, parseInt(inactiveDays));

    res.json({
      success: true,
      total: result.total,
      markedLeft: result.markedLeft.length,
      reactivated: result.reactivated.length,
      markedLeftDetails: result.markedLeft,
      reactivatedDetails: result.reactivated
    });
  } catch (err) {
    console.error('Detect inactive error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to detect inactive employees: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/analytics/auto-detect-left
// Lighter version that auto-runs after import
// ─────────────────────────────────────────────────────────
router.post('/auto-detect-left', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.body;

    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

    const m = parseInt(month);
    const y = parseInt(year);

    const result = runDetectLeftLogic(db, m, y, 14);

    res.json({
      success: true,
      summary: {
        totalEmployees: result.total,
        markedLeft: result.markedLeft.length,
        reactivated: result.reactivated.length
      },
      markedLeft: result.markedLeft,
      reactivated: result.reactivated
    });
  } catch (err) {
    console.error('Auto-detect left error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to auto-detect left employees: ' + err.message });
  }
});

/**
 * Shared logic for detecting left employees and auto-reactivating returned ones.
 * @param {Object} db - database instance
 * @param {number} m - month
 * @param {number} y - year
 * @param {number} inactiveDays - threshold days for marking as Left
 * @returns {{ total: number, markedLeft: Array, reactivated: Array }}
 */
function runDetectLeftLogic(db, m, y, inactiveDays) {
  // Get all employee codes that appear in attendance for this month
  const allEmps = db.prepare(`
    SELECT DISTINCT ap.employee_code, e.id as emp_id, e.name, e.department, e.employment_type, e.status, e.inactive_since
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
  `).all(m, y);

  const markedLeft = [];
  const reactivated = [];

  for (const emp of allEmps) {
    // Skip already marked as exited
    if (emp.status === 'Exited') continue;

    // ── Auto-reactivation check ──
    // If employee is currently 'Left' or 'Inactive', check if they have NEW present records after inactive_since
    if ((emp.status === 'Left' || emp.status === 'Inactive') && emp.inactive_since) {
      const newPresent = db.prepare(`
        SELECT COUNT(*) as cnt FROM attendance_processed
        WHERE employee_code = ? AND is_night_out_only = 0
        AND date > ?
        AND (COALESCE(status_final, status_original) IN ('P','½P','WOP','WO½P'))
      `).get(emp.employee_code, emp.inactive_since);

      if (newPresent && newPresent.cnt > 0) {
        db.prepare(`
          UPDATE employees SET status = 'Active', auto_inactive = 0, was_left_returned = 1,
          updated_at = datetime('now')
          WHERE code = ?
        `).run(emp.employee_code);
        reactivated.push({
          code: emp.employee_code, name: emp.name, department: emp.department,
          type: emp.employment_type, previousStatus: emp.status,
          inactiveSince: emp.inactive_since, newPresentDays: newPresent.cnt
        });
        continue;
      }
    }

    // Skip employees already marked as Left or Inactive (not reactivated above)
    if (emp.status === 'Left' || emp.status === 'Inactive') continue;

    // ── Mark as Left check ──
    // Find last date with P, ½P, WOP status (across all months)
    const lastPresent = db.prepare(`
      SELECT MAX(date) as last_date FROM attendance_processed
      WHERE employee_code = ? AND is_night_out_only = 0
      AND (COALESCE(status_final, status_original) IN ('P','½P','WOP','WO½P'))
    `).get(emp.employee_code);

    // Find latest attendance record date for this month
    const latestRecord = db.prepare(`
      SELECT MAX(date) as last_date FROM attendance_processed
      WHERE employee_code = ? AND is_night_out_only = 0 AND month = ? AND year = ?
    `).get(emp.employee_code, m, y);

    if (!lastPresent?.last_date && latestRecord?.last_date) {
      // Never showed up at all — definitely left
      db.prepare(`
        UPDATE employees SET status = 'Left', auto_inactive = 1,
        inactive_since = ?, updated_at = datetime('now')
        WHERE code = ? AND status NOT IN ('Exited', 'Left', 'Inactive')
      `).run(latestRecord.last_date, emp.employee_code);
      markedLeft.push({ code: emp.employee_code, name: emp.name, department: emp.department, type: emp.employment_type, reason: 'Never present in period', lastPresent: null });
      continue;
    }

    if (lastPresent?.last_date && latestRecord?.last_date) {
      const lastPresentDate = new Date(lastPresent.last_date + 'T12:00:00');
      const latestDate = new Date(latestRecord.last_date + 'T12:00:00');
      const diffDays = Math.floor((latestDate - lastPresentDate) / (1000 * 60 * 60 * 24));

      if (diffDays >= inactiveDays) {
        db.prepare(`
          UPDATE employees SET status = 'Left', auto_inactive = 1,
          inactive_since = ?, updated_at = datetime('now')
          WHERE code = ? AND status NOT IN ('Exited', 'Left', 'Inactive')
        `).run(lastPresent.last_date, emp.employee_code);
        markedLeft.push({
          code: emp.employee_code, name: emp.name, department: emp.department,
          type: emp.employment_type, reason: `Absent ${diffDays} consecutive days`,
          lastPresent: lastPresent.last_date
        });
      }
    }
  }

  return { total: allEmps.length, markedLeft, reactivated };
}

// GET /api/analytics/inactive-employees
// List all auto-detected inactive employees
router.get('/inactive-employees', (req, res) => {
  try {
    const db = getDb();

    const inactive = db.prepare(`
      SELECT code, name, department, employment_type, status, inactive_since, auto_inactive, was_left_returned
      FROM employees
      WHERE status IN ('Inactive', 'Left') OR auto_inactive = 1
      ORDER BY department, name
    `).all();

    res.json({ success: true, data: inactive, total: inactive.length });
  } catch (err) {
    console.error('Inactive employees error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch inactive employees: ' + err.message });
  }
});

// POST /api/analytics/reactivate-employee
// Reactivate an employee that was auto-marked inactive
router.post('/reactivate-employee', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.body;

    db.prepare(`
      UPDATE employees SET status = 'Active', auto_inactive = 0, inactive_since = NULL, updated_at = datetime('now')
      WHERE code = ?
    `).run(code);

    res.json({ success: true, message: `Employee ${code} reactivated` });
  } catch (err) {
    console.error('Reactivate employee error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to reactivate employee: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/analytics/patterns
// Behavioral pattern detection for all employees in a month
// ─────────────────────────────────────────────────────────
router.get('/patterns', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    if (!month || !year) return res.json({ success: true, data: { employees: [], summary: [] } });

    const data = detectAllPatterns(db, parseInt(month), parseInt(year));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Pattern detection error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to detect patterns: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/analytics/employee/:code/profile
// Full behavioral profile for a single employee
// ─────────────────────────────────────────────────────────
router.get('/employee/:code/profile', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;
    const { month, year } = req.query;

    const employee = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    // Current month patterns
    const patternResult = detectPatterns(db, code, m, y);

    // Narrative assessment
    const narrative = generateNarrative(db, code, m, y);

    // 6-month history for trend charts
    const history = db.prepare(`
      SELECT month, year,
        COUNT(CASE WHEN is_night_out_only = 0 AND strftime('%w', date) != '0' THEN 1 END) as total_days,
        SUM(CASE WHEN is_night_out_only = 0 AND (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                 WHEN is_night_out_only = 0 AND (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5
                 ELSE 0 END) as present_days,
        SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late_count,
        SUM(CASE WHEN is_early_departure = 1 THEN 1 ELSE 0 END) as early_count,
        SUM(CASE WHEN is_overtime = 1 THEN overtime_minutes ELSE 0 END) as ot_minutes,
        AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
      FROM attendance_processed
      WHERE employee_code = ? AND is_night_out_only = 0
      GROUP BY year, month
      ORDER BY year DESC, month DESC
      LIMIT 6
    `).all(code);

    // Department average for comparison
    const deptAvg = db.prepare(`
      SELECT
        AVG(sub.att_rate) as avg_att_rate,
        AVG(sub.late_rate) as avg_late_rate,
        AVG(sub.avg_hrs) as avg_hours
      FROM (
        SELECT ap.employee_code,
          CAST(SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                       WHEN (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5 ELSE 0 END) AS REAL)
            / NULLIF(COUNT(CASE WHEN strftime('%w', ap.date) != '0' THEN 1 END), 0) as att_rate,
          CAST(SUM(CASE WHEN ap.is_late_arrival = 1 THEN 1 ELSE 0 END) AS REAL)
            / NULLIF(SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1 ELSE 0 END), 0) as late_rate,
          AVG(CASE WHEN ap.actual_hours > 0 THEN ap.actual_hours END) as avg_hrs
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
        AND e.department = (SELECT department FROM employees WHERE code = ?)
        GROUP BY ap.employee_code
      ) sub
    `).get(m, y, code);

    // Arrival time distribution for the month
    const arrivalDist = db.prepare(`
      SELECT in_time_final, in_time_original, date
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
      AND (status_final IN ('P','WOP') OR status_original IN ('P','WOP'))
      ORDER BY date
    `).all(code, m, y);

    res.json({
      success: true,
      data: {
        employee: {
          code: employee.code, name: employee.name, department: employee.department,
          company: employee.company, designation: employee.designation,
          shiftCode: employee.shift_code, dateOfJoining: employee.date_of_joining
        },
        month: m, year: y,
        patterns: patternResult?.patterns || [],
        stats: patternResult?.stats || {},
        narrative,
        history: history.reverse(),
        departmentAvg: {
          attendanceRate: deptAvg?.avg_att_rate ? Math.round(deptAvg.avg_att_rate * 1000) / 10 : null,
          lateRate: deptAvg?.avg_late_rate ? Math.round(deptAvg.avg_late_rate * 1000) / 10 : null,
          avgHours: deptAvg?.avg_hours ? Math.round(deptAvg.avg_hours * 100) / 100 : null
        },
        arrivalTimes: arrivalDist.map(r => ({
          date: r.date,
          time: r.in_time_final || r.in_time_original
        }))
      }
    });
  } catch (err) {
    console.error('Employee profile error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch employee profile: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/analytics/working-hours-by-dept
// Working hours breakdown grouped by department
// ─────────────────────────────────────────────────────────
router.get('/working-hours-by-dept', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.query;
    if (!month || !year) return res.json({ success: true, data: [] });

    const records = db.prepare(`
      SELECT ap.employee_code, ap.actual_hours, e.department
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
      AND ap.actual_hours > 0
      AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
    `).all(month, year);

    const deptMap = {};
    for (const r of records) {
      const dept = r.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { employees: new Set(), totalHours: 0, records: 0, buckets: { '<6h': 0, '6-8h': 0, '8-10h': 0, '10-12h': 0, '>12h': 0 } };
      deptMap[dept].employees.add(r.employee_code);
      deptMap[dept].totalHours += r.actual_hours;
      deptMap[dept].records++;
      const h = r.actual_hours;
      if (h < 6) deptMap[dept].buckets['<6h']++;
      else if (h < 8) deptMap[dept].buckets['6-8h']++;
      else if (h < 10) deptMap[dept].buckets['8-10h']++;
      else if (h < 12) deptMap[dept].buckets['10-12h']++;
      else deptMap[dept].buckets['>12h']++;
    }

    const departments = Object.entries(deptMap).map(([dept, d]) => ({
      department: dept,
      headcount: d.employees.size,
      avgHours: d.records > 0 ? Math.round(d.totalHours / d.records * 100) / 100 : 0,
      totalHours: Math.round(d.totalHours),
      totalRecords: d.records,
      distribution: d.buckets
    })).sort((a, b) => b.headcount - a.headcount);

    res.json({ success: true, data: departments });
  } catch (err) {
    console.error('Working hours by dept error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute dept working hours: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/analytics/salary-trend
// Multi-year monthly payroll cost trend from salary_computations
// ─────────────────────────────────────────────────────────
router.get('/salary-trend', (req, res) => {
  try {
    const db = getDb();
    const endMonth = parseInt(req.query.month) || new Date().getMonth() + 1;
    const endYear = parseInt(req.query.year) || new Date().getFullYear();
    const numYears = Math.min(parseInt(req.query.years) || 3, 5);
    const company = req.query.company || null;

    const startYear = endYear - numYears;
    const startKey = startYear * 12 + 1;
    const endKey = endYear * 12 + endMonth;

    const params = [startKey, endKey];
    if (company) params.push(company);

    const rows = db.prepare(`
      SELECT
        sc.month,
        sc.year,
        COUNT(DISTINCT sc.employee_code) as headcount,
        COALESCE(SUM(sc.gross_salary), 0) as total_gross_ctc,
        COALESCE(SUM(sc.gross_earned), 0) as total_gross_earned,
        COALESCE(SUM(sc.net_salary), 0) as total_net_salary,
        COALESCE(SUM(sc.total_payable), 0) as total_payable,
        COALESCE(SUM(COALESCE(sc.take_home, sc.total_payable)), 0) as total_take_home,
        COALESCE(SUM(sc.pf_employee), 0) as total_pf_ee,
        COALESCE(SUM(sc.pf_employer), 0) as total_pf_er,
        COALESCE(SUM(sc.esi_employee), 0) as total_esi_ee,
        COALESCE(SUM(sc.esi_employer), 0) as total_esi_er,
        COALESCE(SUM(sc.ot_pay), 0) as total_ot,
        COALESCE(SUM(COALESCE(sc.ed_pay, 0)), 0) as total_ed
      FROM salary_computations sc
      WHERE (sc.year * 12 + sc.month) >= ?
        AND (sc.year * 12 + sc.month) <= ?
        ${company ? 'AND sc.company = ?' : ''}
      GROUP BY sc.year, sc.month
      ORDER BY sc.year ASC, sc.month ASC
    `).all(...params);

    const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const months = rows.map(r => ({
      month: r.month,
      year: r.year,
      label: `${MN[r.month]} ${r.year}`,
      headcount: r.headcount,
      totalGrossCTC: Math.round(r.total_gross_ctc),
      totalGrossEarned: Math.round(r.total_gross_earned),
      totalNetSalary: Math.round(r.total_net_salary),
      totalTakeHome: Math.round(r.total_take_home),
      totalPFEmployee: Math.round(r.total_pf_ee),
      totalPFEmployer: Math.round(r.total_pf_er),
      totalESIEmployee: Math.round(r.total_esi_ee),
      totalESIEmployer: Math.round(r.total_esi_er),
      totalOT: Math.round(r.total_ot),
      totalED: Math.round(r.total_ed),
      perEmployeeCost: r.headcount > 0 ? Math.round(r.total_gross_earned / r.headcount) : 0,
      totalCTC: Math.round(r.total_gross_ctc + r.total_pf_er + r.total_esi_er)
    }));

    const byYear = {};
    for (const m of months) {
      if (!byYear[m.year]) byYear[m.year] = { year: m.year, months: [], totalNet: 0, headcounts: [] };
      byYear[m.year].months.push(m);
      byYear[m.year].totalNet += m.totalNetSalary;
      byYear[m.year].headcounts.push(m.headcount);
    }

    const yearSummaries = Object.values(byYear).map((y, idx, arr) => {
      const avgHC = y.headcounts.length > 0 ? Math.round(y.headcounts.reduce((a, b) => a + b, 0) / y.headcounts.length) : 0;
      const avgMonthly = y.months.length > 0 ? Math.round(y.totalNet / y.months.length) : 0;
      const prevYear = idx > 0 ? arr[idx - 1] : null;
      const yoyChange = prevYear && prevYear.totalNet > 0
        ? Math.round((y.totalNet - prevYear.totalNet) / prevYear.totalNet * 1000) / 10
        : null;
      return { year: y.year, avgHeadcount: avgHC, totalNetSalary: Math.round(y.totalNet), avgMonthlyCost: avgMonthly, yoyChange };
    });

    res.json({ success: true, data: { months, yearSummaries } });
  } catch (err) {
    console.error('Salary trend error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute salary trend: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/analytics/employee/:code/profile-range
// Full multi-section employee profile with custom date range
// ─────────────────────────────────────────────────────────
router.get('/employee/:code/profile-range', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;
    let { from, to } = req.query;

    // Defaults: from = 6 months ago, to = today
    if (!to) {
      to = new Date().toISOString().split('T')[0];
    }
    if (!from) {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      from = d.toISOString().split('T')[0];
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    if (from > to) {
      return res.status(400).json({ success: false, error: '"from" must be <= "to".' });
    }

    const result = computeProfileRange(db, code, from, to);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Profile range error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute profile: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/analytics/employee/:code/ai-review
// AI-powered qualitative review via Claude API
// Body (all optional): { from, to }
// Requires ANTHROPIC_API_KEY env var
// ─────────────────────────────────────────────────────────
router.post('/employee/:code/ai-review', async (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;
    let { from, to } = req.body || {};

    // Defaults: from = 6 months ago, to = today
    if (!to) {
      to = new Date().toISOString().split('T')[0];
    }
    if (!from) {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      from = d.toISOString().split('T')[0];
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    if (from > to) {
      return res.status(400).json({ success: false, error: '"from" must be <= "to".' });
    }

    const result = await generateAIReview(db, code, from, to);

    if (!result.success) {
      // Distinguish missing API key (503) from employee not found (404) from other errors (500)
      if (result.error === 'Employee not found') {
        return res.status(404).json(result);
      }
      if (result.error && result.error.includes('ANTHROPIC_API_KEY not configured')) {
        return res.status(503).json(result);
      }
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('[AI Review] route error:', err.message);
    res.status(500).json({ success: false, error: 'AI review failed: ' + err.message });
  }
});

// GET /api/analytics/department-dashboard
router.get('/department-dashboard', (req, res) => {
  try {
    const db = getDb();
    let { from, to } = req.query;
    if (!to) to = new Date().toISOString().split('T')[0];
    if (!from) { const d = new Date(); d.setMonth(d.getMonth() - 6); from = d.toISOString().split('T')[0]; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }
    if (from > to) return res.status(400).json({ success: false, error: 'from must be <= to' });
    const result = computeDepartmentAnalytics(db, from, to);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Department dashboard error:', err.message);
    res.status(500).json({ success: false, error: 'Failed: ' + err.message });
  }
});

// GET /api/analytics/org-metrics
router.get('/org-metrics', (req, res) => {
  try {
    const db = getDb();
    let { from, to } = req.query;
    if (!to) to = new Date().toISOString().split('T')[0];
    if (!from) { const d = new Date(); d.setMonth(d.getMonth() - 6); from = d.toISOString().split('T')[0]; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }
    if (from > to) return res.status(400).json({ success: false, error: 'from must be <= to' });
    const result = computeOrgMetrics(db, from, to);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Org metrics error:', err.message);
    res.status(500).json({ success: false, error: 'Failed: ' + err.message });
  }
});

module.exports = router;
