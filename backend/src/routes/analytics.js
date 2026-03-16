const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const {
  computeOrgOverview, computeHeadcountTrend, computeAttrition,
  computeChronicAbsentees, computePunctualityReport, computeOvertimeReport,
  computeWorkingHoursReport, computeDepartmentDeepDive, generateAlerts
} = require('../services/analytics');

// GET org overview
router.get('/overview', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeOrgOverview(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET headcount trend (last 6 months)
router.get('/headcount-trend', (req, res) => {
  const db = getDb();
  const { month, year, months: numMonths = 6 } = req.query;

  const endMonth = parseInt(month);
  const endYear = parseInt(year);
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
});

// GET attrition analysis
router.get('/attrition', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeAttrition(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET chronic absentees
router.get('/absentees', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeChronicAbsentees(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET punctuality report
router.get('/punctuality', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computePunctualityReport(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET department stats
router.get('/departments', (req, res) => {
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
    punctualityRate: d.totalDays > 0 ? Math.round((1 - d.lateDays / d.presentDays) * 1000) / 10 : 100,
    avgHoursPerDay: d.hoursCount > 0 ? Math.round(d.totalHours / d.hoursCount * 100) / 100 : 0,
    totalOtHours: Math.round(d.otMinutes / 60 * 10) / 10
  })).sort((a, b) => b.headcount - a.headcount);

  res.json({ success: true, data: departments });
});

// GET overtime report
router.get('/overtime', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeOvertimeReport(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET working hours distribution
router.get('/working-hours', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeWorkingHoursReport(db, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET department deep-dive
router.get('/department/:name', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const data = computeDepartmentDeepDive(db, req.params.name, parseInt(month), parseInt(year));
  res.json({ success: true, data });
});

// GET attendance heatmap (employee × day for selected month)
router.get('/heatmap', (req, res) => {
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
});

// GET alerts
router.get('/alerts', (req, res) => {
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
});

// POST generate alerts for a month
router.post('/alerts/generate', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;

  const alerts = generateAlerts(db, parseInt(month), parseInt(year));
  res.json({ success: true, count: alerts.length, alerts });
});

// PUT mark alert as read
router.put('/alerts/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET employee profile with historical data
router.get('/employee/:code', (req, res) => {
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
  const now = new Date();
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
});

module.exports = router;
