const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const {
  getDailySummary,
  getNightShiftReport,
  getDepartmentBreakdown,
  getShiftWiseBreakdown,
  getDepartmentTypeBreakdown,
  getWorkerTypeBreakdown,
  getPreviousDayReport,
} = require('../services/dailyMIS');

/**
 * GET /api/daily-mis/summary
 * Enhanced daily summary with shift/dept-type/worker-type breakdowns
 */
router.get('/summary', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const summary = getDailySummary(db, date);
  const departments = getDepartmentBreakdown(db, date);
  const deptTypeBreakdown = getDepartmentTypeBreakdown(db, date);

  res.json({
    success: true,
    data: {
      ...summary,
      departments,
      deptTypeBreakdown,
    },
  });
});

/**
 * GET /api/daily-mis/night-shift
 * Previous night shift report with classification
 */
router.get('/night-shift', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const report = getNightShiftReport(db, date);
  res.json({ success: true, data: report });
});

/**
 * GET /api/daily-mis/shift-breakdown
 * Detailed day-shift vs night-shift breakdown
 */
router.get('/shift-breakdown', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const breakdown = getShiftWiseBreakdown(db, date);
  res.json({ success: true, data: breakdown });
});

/**
 * GET /api/daily-mis/worker-breakdown
 * Permanent vs contractor breakdown with department details
 */
router.get('/worker-breakdown', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const breakdown = getWorkerTypeBreakdown(db, date);
  res.json({ success: true, data: breakdown });
});

/**
 * GET /api/daily-mis/punched-in
 * Currently punched-in employees (no out time)
 */
router.get('/punched-in', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const records = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department, e.designation,
           ap.in_time_original as in_time, ap.shift_detected,
           ROUND((julianday('now') - julianday(ap.date || ' ' || ap.in_time_original)) * 24, 1) as hours_so_far
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND ap.in_time_original IS NOT NULL
    AND (ap.out_time_original IS NULL OR ap.out_time_original = '')
    AND ap.is_night_out_only = 0
    ORDER BY ap.in_time_original
  `).all(date);

  res.json({ success: true, data: records, count: records.length });
});

/**
 * GET /api/daily-mis/absentees
 * Absentees for a date
 */
router.get('/absentees', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const allEmployees = db.prepare(`
    SELECT code, name, department, designation FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).all(date, date);

  const presentCodes = new Set(
    db.prepare(`
      SELECT DISTINCT employee_code FROM attendance_processed
      WHERE date = ? AND COALESCE(status_final, status_original) IN ('P', '\u00bdP', 'WOP') AND is_night_out_only = 0
    `).all(date).map(r => r.employee_code)
  );

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const isSunday = dayOfWeek === 0;
  const isHoliday = !!db.prepare('SELECT id FROM holidays WHERE date = ?').get(date);

  const absentees = allEmployees
    .filter(e => !presentCodes.has(e.code))
    .map(e => ({ ...e, reason: isSunday ? 'Sunday (Weekly Off)' : isHoliday ? 'Holiday' : 'Absent' }));

  res.json({
    success: true,
    data: absentees,
    count: absentees.length,
    isSunday,
    isHoliday,
  });
});

/**
 * GET /api/daily-mis/dates
 * Dates with available attendance data
 */
router.get('/dates', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  let query = 'SELECT DISTINCT date FROM attendance_processed WHERE is_night_out_only = 0';
  const params = [];
  if (month && year) {
    query += ' AND month = ? AND year = ?';
    params.push(month, year);
  }
  query += ' ORDER BY date DESC LIMIT 60';

  const dates = db.prepare(query).all(...params).map(r => r.date);
  res.json({ success: true, data: dates });
});

/**
 * GET /api/daily-mis/previous-day-report
 * Complete attendance report for previous day — split by day/night shift
 */
router.get('/previous-day-report', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, error: 'date required' });

  const report = getPreviousDayReport(db, date);
  res.json({ success: true, data: report });
});

/**
 * GET /api/daily-mis/late-coming-summary
 * Late Coming Phase 1: Summary of employees who arrived late on a specific
 * date, enriched with month-to-date context and "left late yesterday" flag.
 * Powers the Daily MIS "Late Arrivals Today" section.
 */
router.get('/late-coming-summary', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const company = req.query.company || null;

  const [yStr, mStr, dStr] = String(date).split('-');
  const year = parseInt(yStr);
  const month = parseInt(mStr);
  const day = parseInt(dStr);
  if (!year || !month || !day) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }

  // Previous month (for trend comparison)
  const pMonth = month === 1 ? 12 : month - 1;
  const pYear = month === 1 ? year - 1 : year;

  // Yesterday (for "left late yesterday" context)
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yesterday = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

  const companyFilter = company ? ' AND (ap.company = ? OR ap.company IS NULL)' : '';
  const companyParams = company ? [company] : [];

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
  `).all(month, year, day, pMonth, pYear, yesterday, yesterday, date, ...companyParams);

  // Relative trend (this month's running count vs same-range last month).
  const employees = rows.map(r => {
    const cur = Number(r.month_to_date_late_count) || 0;
    const prev = Number(r.last_month_late_count) || 0;
    let trend = 'stable';
    if (cur === prev) trend = 'stable';
    else if (prev === 0 && cur > 0) trend = 'up';
    else if (cur > prev * 1.1) trend = 'up';
    else if (cur < prev * 0.9) trend = 'down';
    return {
      employee_code: r.employee_code,
      name: r.name,
      department: r.department,
      shift_code: r.shift_code,
      shift_start_time: r.shift_start_time,
      in_time: r.in_time,
      late_by_minutes: Number(r.late_by_minutes) || 0,
      month_to_date_late_count: cur,
      trend,
      yesterday_left_late: !!(r.yesterday_left_late && Number(r.yesterday_left_late) === 1),
      yesterday_left_late_minutes: Number(r.yesterday_left_late_minutes) || 0
    };
  });

  // Department breakdown for the header card.
  const deptMap = {};
  for (const emp of employees) {
    const key = emp.department || '(none)';
    deptMap[key] = (deptMap[key] || 0) + 1;
  }
  const departmentBreakdown = Object.entries(deptMap)
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    success: true,
    data: {
      totalLateToday: employees.length,
      departmentBreakdown,
      employees
    }
  });
});

module.exports = router;
