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
      WHERE date = ? AND status IN ('P', '\u00bdP', 'WOP') AND is_night_out_only = 0
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

module.exports = router;
